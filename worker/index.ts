// B 站 API 代理 Worker。
// 站点是纯静态（astro build:cf → dist-cf/），Bilibili 应用需要的跨域代理
// 无法用 Astro 的 src/pages/api 动态路由实现（静态构建会报
// GetStaticPathsRequired），所以代理逻辑放在这里：
// - /api/bilibili/*  → 本 Worker 处理（转发 api.bilibili.com / passport.bilibili.com）
// - 其余路径         → 回退到静态资产（ASSETS binding）

interface Env {
  ASSETS: { fetch: (request: Request) => Promise<Response> };
}

const API_BASE = 'https://api.bilibili.com';
const PASSPORT_BASE = 'https://passport.bilibili.com';
const PROXY_PREFIX = '/api/bilibili';

const JSON_HEADERS = { 'content-type': 'application/json;charset=utf-8' };

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

async function proxyUpstream(targetUrl: URL, request: Request): Promise<Response> {
  const headers = new Headers();
  const cookie = request.headers.get('cookie');
  const userAgent = request.headers.get('user-agent') ?? 'Mozilla/5.0';
  const referer = request.headers.get('referer');

  headers.set('user-agent', userAgent);
  if (cookie) headers.set('cookie', cookie);
  if (referer) headers.set('referer', referer);

  const upstream = await fetch(targetUrl, {
    headers,
    redirect: 'follow',
  });

  const responseHeaders = new Headers();
  upstream.headers.forEach((value, key) => {
    if (['content-length', 'transfer-encoding', 'content-encoding'].includes(key.toLowerCase())) {
      return;
    }
    if (key.toLowerCase() === 'set-cookie') {
      responseHeaders.append(key, value);
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

async function handleBilibili(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const rawSlug = url.pathname.slice(PROXY_PREFIX.length).replace(/^\/+/, '');
  const slug = rawSlug ? rawSlug.split('/') : [];

  if (slug[0] === 'dm') {
    const cid = url.searchParams.get('cid');
    if (!cid) {
      return new Response(JSON.stringify({ error: '缺少 cid 参数' }), {
        status: 400,
        headers: JSON_HEADERS,
      });
    }

    const dmUrl = new URL(`https://comment.bilibili.com/${cid}.xml`);
    const upstream = await fetch(dmUrl, {
      headers: {
        'user-agent': request.headers.get('user-agent') ?? 'Mozilla/5.0',
      },
    });

    if (!upstream.ok) {
      return new Response(JSON.stringify({ error: '弹幕接口请求失败' }), {
        status: upstream.status,
        headers: JSON_HEADERS,
      });
    }

    const xml = await upstream.text();
    return new Response(JSON.stringify({ items: buildDmPayload(xml) }), {
      headers: JSON_HEADERS,
    });
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

  return proxyUpstream(targetUrl, request);
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === PROXY_PREFIX || url.pathname.startsWith(`${PROXY_PREFIX}/`)) {
      try {
        return await handleBilibili(request);
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
