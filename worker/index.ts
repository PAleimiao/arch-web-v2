// B 站 API 代理 Worker。
// 站点是纯静态（astro build:cf → dist-cf/），Bilibili 应用需要的跨域代理
// 无法用 Astro 的 src/pages/api 动态路由实现（静态构建会报
// GetStaticPathsRequired），所以代理逻辑放在这里：
// - /api/bilibili/*  → 本 Worker 处理（转发 api.bilibili.com / passport.bilibili.com）
// - 其余路径         → 回退到静态资产（ASSETS binding）
//
// 风控对策（B 站对裸请求返回 412 风控页）：
// - 首次访问用 finger/spi 接口引导 buvid3/buvid4，作为匿名访客身份
// - 所有上游请求强制带 Referer/Origin: www.bilibili.com + 真实浏览器 UA
// - 搜索接口需要 WBI 签名（w_rid/wts），用 nav 拿 wbi_img 密钥现场签
// - 登录 cookie（SESSDATA 等）由 Worker 侧 cookie jar 保管（Cache API，按
//   bili_sid 匿名会话分桶），不透传给浏览器——B 站下发的 Domain=.bilibili.com
//   cookie 在本站域名下会被浏览器丢弃，透传没有意义还会泄露会话

import { createHash } from 'node:crypto';

interface Env {
  ASSETS: { fetch: (request: Request) => Promise<Response> };
}

const API_BASE = 'https://api.bilibili.com';
const PASSPORT_BASE = 'https://passport.bilibili.com';
const PROXY_PREFIX = '/api/bilibili';
const SITE_REFERER = 'https://www.bilibili.com/';

const JSON_HEADERS = { 'content-type': 'application/json;charset=utf-8' };
const JAR_TTL_SECONDS = 60 * 60 * 6; // cookie jar 保存 6 小时
const BILIBILI_COOKIE_DOMAINS = ['.bilibili.com', 'bilibili.com', '.hdslb.com'];

function decodeHtml(text: string): string {
  return text
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function buildDmPayload(xml: string) {
  const matches = [...xml.matchAll(/<d p="([^"]+)">([^<]+)<\/d>/g)];
  return matches.slice(0, 300).map((match) => {
    const [time, type, fontSize, color, date, pool, userId] = match[1].split(',');
    return {
      text: decodeHtml(match[2] ?? ''),
      time: Number(time ?? 0),
      type: Number(type ?? 0),
      fontSize: Number(fontSize ?? 25),
      color: Number(color ?? 16777215),
      date: Number(date ?? 0),
      pool: Number(pool ?? 0),
      userId: Number(userId ?? 0),
    };
  });
}

// ---------------------------------------------------------------------------
// Cookie jar（Cache API 按 bili_sid 分桶）
// ---------------------------------------------------------------------------

const jarCache = caches.default;

function jarKey(sid: string): URL {
  return new URL(`https://jar.internal/bili/${encodeURIComponent(sid)}`);
}

async function readJar(sid: string): Promise<string[]> {
  if (!sid) return [];
  try {
    const hit = await jarCache.match(jarKey(sid));
    if (!hit) return [];
    const list = (await hit.json()) as unknown;
    return Array.isArray(list) ? (list as string[]) : [];
  } catch {
    return [];
  }
}

async function writeJar(sid: string, cookies: string[]): Promise<void> {
  if (!sid) return;
  await jarCache.put(
    jarKey(sid),
    new Response(JSON.stringify(cookies), {
      headers: {
        'content-type': 'application/json',
        'cache-control': `public, max-age=${JAR_TTL_SECONDS}`,
      },
    }),
  );
}

function mergeCookies(jar: string[], incoming: string[]): string[] {
  const map = new Map<string, string>();
  for (const cookie of jar) {
    const eq = cookie.indexOf('=');
    if (eq > 0) map.set(cookie.slice(0, eq).trim(), cookie.slice(eq + 1).trim());
  }
  for (const raw of incoming) {
    const pair = raw.split(';')[0] ?? '';
    const eq = pair.indexOf('=');
    if (eq > 0) map.set(pair.slice(0, eq).trim(), pair.slice(eq + 1).trim());
  }
  return [...map.entries()].map(([name, value]) => `${name}=${value}`);
}

// 浏览器侧只留一个匿名会话 id；B 站域的 cookie 一律进 jar 不进浏览器
function getOrCreateSid(request: Request): { sid: string; isNew: boolean } {
  const raw = request.headers.get('cookie') ?? '';
  const match = raw.match(/(?:^|;\s*)bili_sid=([^;]+)/);
  if (match?.[1]) return { sid: match[1].trim(), isNew: false };
  return { sid: crypto.randomUUID(), isNew: true };
}

// ---------------------------------------------------------------------------
// buvid 引导（匿名访客身份，绕开 412 风控的第一道门槛）
// ---------------------------------------------------------------------------

let bootCache: { cookies: string[]; expires: number } | null = null;

function buildUpstreamHeaders(request: Request, cookies: string[]): Headers {
  const headers = new Headers();
  const userAgent =
    request.headers.get('user-agent') ??
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

  headers.set('user-agent', userAgent);
  headers.set('referer', SITE_REFERER);
  headers.set('origin', 'https://www.bilibili.com');
  if (cookies.length > 0) headers.set('cookie', cookies.join('; '));
  return headers;
}

async function getBuvidCookies(request: Request): Promise<string[]> {
  const now = Date.now();
  if (bootCache && bootCache.expires > now) return bootCache.cookies;

  try {
    const res = await fetch(`${API_BASE}/x/frontend/finger/spi`, {
      headers: buildUpstreamHeaders(request, []),
    });
    if (res.ok) {
      const json = (await res.json()) as { data?: { b_3?: string; b_4?: string } };
      const b3 = json.data?.b_3;
      if (b3) {
        const cookies = [`buvid3=${b3}`, ...(json.data?.b_4 ? [`buvid4=${json.data.b_4}`] : [])];
        bootCache = { cookies, expires: now + 60 * 60 * 1000 };
        return cookies;
      }
    }
  } catch {
    // 引导失败不阻塞代理，退回无 buvid（可能被 412，但至少不崩）
  }
  return [];
}

// ---------------------------------------------------------------------------
// WBI 签名（搜索等接口强制要求 w_rid + wts）
// ---------------------------------------------------------------------------

const MIXIN_KEY_ENC_TAB = [
  46, 47, 18, 2, 53, 8, 23, 32, 15, 50, 10, 31, 58, 3, 45, 35, 27, 43, 5, 49,
  33, 9, 42, 19, 29, 28, 14, 39, 12, 38, 41, 13, 37, 48, 7, 16, 24, 55, 40,
  61, 26, 17, 0, 1, 60, 51, 30, 4, 22, 25, 54, 21, 56, 59, 6, 63, 57, 62, 11,
  36, 20, 34, 44, 52,
];

let wbiCache: { mixinKey: string; expires: number } | null = null;

function extractWbiKey(url: string): string {
  const filename = url.split('/').pop() ?? '';
  return filename.replace(/\.(png|gif|jpe?g|webp)$/i, '');
}

async function getWbiMixinKey(request: Request): Promise<string | null> {
  const now = Date.now();
  if (wbiCache && wbiCache.expires > now) return wbiCache.mixinKey;

  try {
    const res = await fetch(`${API_BASE}/x/web-interface/nav`, {
      headers: buildUpstreamHeaders(request, []),
    });
    if (!res.ok) return null;
    const json = (await res.json()) as {
      data?: { wbi_img?: { img_url?: string; sub_url?: string } };
    };
    const wbi = json.data?.wbi_img;
    if (!wbi?.img_url || !wbi?.sub_url) return null;

    const raw = extractWbiKey(wbi.img_url) + extractWbiKey(wbi.sub_url);
    if (raw.length < 32) return null;

    const mixinKey = MIXIN_KEY_ENC_TAB.map((i) => raw[i]).join('').slice(0, 32);
    wbiCache = { mixinKey, expires: now + 60 * 60 * 1000 };
    return mixinKey;
  } catch {
    return null;
  }
}

function signWbiQuery(params: URLSearchParams, mixinKey: string): void {
  params.set('wts', String(Math.floor(Date.now() / 1000)));

  const sorted = [...params.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  const query = sorted
    .map(([key, value]) => {
      const cleaned = value.replace(/[!'()*]/g, '');
      return `${encodeURIComponent(key)}=${encodeURIComponent(cleaned)}`;
    })
    .join('&');

  params.set('w_rid', createHash('md5').update(query + mixinKey, 'utf8').digest('hex'));
}

// ---------------------------------------------------------------------------
// 上游转发 + jar 回写
// ---------------------------------------------------------------------------

function isBilibiliCookie(setCookie: string): boolean {
  const lower = setCookie.toLowerCase();
  return BILIBILI_COOKIE_DOMAINS.some((domain) => lower.includes(`domain=${domain}`));
}

async function fetchAndTrack(
  targetUrl: URL,
  request: Request,
  sid: string,
  jar: string[],
): Promise<Response> {
  const upstream = await fetch(targetUrl, {
    method: 'GET',
    headers: buildUpstreamHeaders(request, jar),
    redirect: 'follow',
  });

  const setCookies = upstream.headers.getSetCookie?.() ?? [];
  const bilibiliCookies = setCookies.filter((sc) => isBilibiliCookie(sc));

  // 风控页 / 异常 HTML：转成 JSON 错误，别把一坨 HTML 丢给前端当错误消息
  const contentType = upstream.headers.get('content-type') ?? '';
  if (contentType.includes('text/html')) {
    return new Response(
      JSON.stringify({ error: `B站返回风控页面（HTTP ${upstream.status}），请稍后重试` }),
      { status: 502, headers: JSON_HEADERS },
    );
  }

  if (bilibiliCookies.length > 0) {
    await writeJar(sid, mergeCookies(jar, bilibiliCookies));
  }

  const responseHeaders = new Headers();
  upstream.headers.forEach((value, key) => {
    const lower = key.toLowerCase();
    if (['content-length', 'transfer-encoding', 'content-encoding', 'set-cookie'].includes(lower)) {
      return;
    }
    responseHeaders.set(key, value);
  });

  const body = await upstream.text();
  return new Response(body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers: responseHeaders,
  });
}

// ---------------------------------------------------------------------------
// /api/bilibili/* 处理
// ---------------------------------------------------------------------------

async function handleBilibili(request: Request, sid: string): Promise<Response> {
  const url = new URL(request.url);
  const rawSlug = url.pathname.slice(PROXY_PREFIX.length).replace(/^\/+/, '');
  const slug = rawSlug ? rawSlug.split('/') : [];

  const jar = await readJar(sid);
  if (!jar.some((cookie) => cookie.startsWith('buvid3='))) {
    const buvid = await getBuvidCookies(request);
    if (buvid.length > 0) {
      await writeJar(sid, mergeCookies(jar, buvid));
      jar.push(
        ...buvid.filter((cookie) => !jar.some((existing) => existing.split('=')[0] === cookie.split('=')[0])),
      );
    }
  }

  if (slug[0] === 'dm') {
    const cid = url.searchParams.get('cid');
    if (!cid) {
      return new Response(JSON.stringify({ error: '缺少 cid 参数' }), {
        status: 400,
        headers: JSON_HEADERS,
      });
    }

    const dmUrl = new URL(`https://comment.bilibili.com/${encodeURIComponent(cid)}.xml`);
    return fetchAndTrack(dmUrl, request, sid, jar);
  }

  const isPassport = slug[0] === 'passport';
  const base = isPassport ? PASSPORT_BASE : API_BASE;
  const rest = (isPassport ? slug.slice(1) : slug).join('/');
  const safePath = rest.replace(/^\/+/, '');

  if (!safePath) {
    return new Response(JSON.stringify({ error: '空路径' }), {
      status: 400,
      headers: JSON_HEADERS,
    });
  }

  const targetUrl = new URL(
    `${safePath}${url.search ? `${url.search}` : ''}`,
    `${base}/`,
  );

  // 搜索接口需要 WBI 签名；带 w_rid 的请求不重复签
  if (safePath.includes('/search') && !targetUrl.searchParams.has('w_rid')) {
    const mixinKey = await getWbiMixinKey(request);
    if (mixinKey) {
      signWbiQuery(targetUrl.searchParams, mixinKey);
    }
  }

  return fetchAndTrack(targetUrl, request, sid, jar);
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === PROXY_PREFIX || url.pathname.startsWith(`${PROXY_PREFIX}/`)) {
      const { sid, isNew } = getOrCreateSid(request);
      try {
        const response = await handleBilibili(request, sid);
        if (isNew) {
          response.headers.append(
            'set-cookie',
            `bili_sid=${sid}; Path=/; Max-Age=31536000; SameSite=Lax; HttpOnly`,
          );
        }
        return response;
      } catch {
        return new Response(JSON.stringify({ error: '代理请求失败' }), {
          status: 502,
          headers: JSON_HEADERS,
        });
      }
    }

    return env.ASSETS.fetch(request);
  },
};
