// B 站 API 代理 Worker。
// 站点是纯静态（astro build:cf → dist-cf/），Bilibili 应用需要的跨域代理
// 无法用 Astro 的 src/pages/api 动态路由实现（静态构建会报
// GetStaticPathsRequired），所以代理逻辑放在这里：
// - /api/bilibili/*      → 本 Worker 处理（转发 api.bilibili.com / passport.bilibili.com）
// - /api/netease/comment → 网易云歌曲评论代理（官方公开接口，解决浏览器 CORS）
// - 其余路径             → 回退到静态资产（ASSETS binding）
//
// 风控对策（B 站对裸请求返回 412 风控页）：
// - 首次访问用 finger/spi 接口引导 buvid3/buvid4，作为匿名访客身份
// - 所有上游请求强制带 Referer/Origin: www.bilibili.com + 真实浏览器 UA
// - 搜索接口需要 WBI 签名（w_rid/wts），用 nav 拿 wbi_img 密钥现场签
// - 登录 cookie（SESSDATA 等）由 Worker 侧 cookie jar 保管（Cache API，按
//   bili_sid 匿名会话分桶），不透传给浏览器——B 站下发的 Domain=.bilibili.com
//   cookie 在本站域名下会被浏览器丢弃，透传没有意义还会泄露会话

import { createHash } from "node:crypto";

interface Env {
  ASSETS: { fetch: (request: Request) => Promise<Response> };
}

const API_BASE = "https://api.bilibili.com";
const PASSPORT_BASE = "https://passport.bilibili.com";
const PROXY_PREFIX = "/api/bilibili";
const NETEASE_COMMENT_PATH = "/api/netease/comment";
const NETEASE_ORIGIN = "https://music.163.com";
const SITE_REFERER = "https://www.bilibili.com/";

const JSON_HEADERS = { "content-type": "application/json;charset=utf-8" };
const JAR_TTL_SECONDS = 60 * 60 * 6; // cookie jar 保存 6 小时
const BILIBILI_COOKIE_DOMAINS = [".bilibili.com", "bilibili.com", ".hdslb.com"];

function decodeHtml(text: string): string {
  return text
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function buildDmPayload(xml: string) {
  const matches = [...xml.matchAll(/<d p="([^"]+)">([^<]+)<\/d>/g)];
  return matches.slice(0, 300).map((match) => {
    const [time, type, fontSize, color, date, pool, userId] =
      match[1].split(",");
    return {
      text: decodeHtml(match[2] ?? ""),
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

// Cache API 的 default 分桶是 Workers 运行时专属，DOM 类型里没有
const jarCache = (caches as unknown as { default: Cache }).default;

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
        "content-type": "application/json",
        "cache-control": `public, max-age=${JAR_TTL_SECONDS}`,
      },
    }),
  );
}

function mergeCookies(jar: string[], incoming: string[]): string[] {
  const map = new Map<string, string>();
  for (const cookie of jar) {
    const eq = cookie.indexOf("=");
    if (eq > 0)
      map.set(cookie.slice(0, eq).trim(), cookie.slice(eq + 1).trim());
  }
  for (const raw of incoming) {
    const pair = raw.split(";")[0] ?? "";
    const eq = pair.indexOf("=");
    if (eq > 0) map.set(pair.slice(0, eq).trim(), pair.slice(eq + 1).trim());
  }
  return [...map.entries()].map(([name, value]) => `${name}=${value}`);
}

// 浏览器侧只留一个匿名会话 id；B 站域的 cookie 一律进 jar 不进浏览器
function getOrCreateSid(request: Request): { sid: string; isNew: boolean } {
  const raw = request.headers.get("cookie") ?? "";
  const match = raw.match(/(?:^|;\s*)bili_sid=([^;]+)/);
  if (match?.[1]) return { sid: match[1].trim(), isNew: false };
  return { sid: crypto.randomUUID(), isNew: true };
}

// ---------------------------------------------------------------------------
// buvid 引导（匿名访客身份，绕开 412 风控的第一道门槛）
// ---------------------------------------------------------------------------

let bootCache: { cookies: string[]; expires: number } | null = null;

/** 固定用正常桌面 Chrome UA：绝不透传浏览器的 UA（无头 / 脚本 UA 会直接被 B 站判机器人） */
const BILI_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

function buildUpstreamHeaders(_request: Request, cookies: string[]): Headers {
  const headers = new Headers();
  headers.set("user-agent", BILI_UA);
  headers.set("referer", SITE_REFERER);
  headers.set("origin", "https://www.bilibili.com");
  headers.set("accept", "application/json, text/plain, */*");
  headers.set("accept-language", "zh-CN,zh;q=0.9,en;q=0.8");
  // 补全 sec-fetch 元数据，让请求指纹贴近真实浏览器，降低 -352 / 412 命中率
  headers.set("sec-fetch-site", "same-site");
  headers.set("sec-fetch-mode", "cors");
  headers.set("sec-fetch-dest", "empty");
  if (cookies.length > 0) headers.set("cookie", cookies.join("; "));
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
      const json = (await res.json()) as {
        data?: { b_3?: string; b_4?: string };
      };
      const b3 = json.data?.b_3;
      if (b3) {
        const cookies = [
          `buvid3=${b3}`,
          ...(json.data?.b_4 ? [`buvid4=${json.data.b_4}`] : []),
        ];
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
  33, 9, 42, 19, 29, 28, 14, 39, 12, 38, 41, 13, 37, 48, 7, 16, 24, 55, 40, 61,
  26, 17, 0, 1, 60, 51, 30, 4, 22, 25, 54, 21, 56, 59, 6, 63, 57, 62, 11, 36,
  20, 34, 44, 52,
];

let wbiCache: { mixinKey: string; expires: number } | null = null;

function extractWbiKey(url: string): string {
  const filename = url.split("/").pop() ?? "";
  return filename.replace(/\.(png|gif|jpe?g|webp)$/i, "");
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

    const mixinKey = MIXIN_KEY_ENC_TAB.map((i) => raw[i])
      .join("")
      .slice(0, 32);
    wbiCache = { mixinKey, expires: now + 60 * 60 * 1000 };
    return mixinKey;
  } catch {
    return null;
  }
}

function signWbiQuery(params: URLSearchParams, mixinKey: string): void {
  params.set("wts", String(Math.floor(Date.now() / 1000)));

  const sorted = [...params.entries()].sort(([a], [b]) =>
    a < b ? -1 : a > b ? 1 : 0,
  );
  const query = sorted
    .map(([key, value]) => {
      const cleaned = value.replace(/[!'()*]/g, "");
      return `${encodeURIComponent(key)}=${encodeURIComponent(cleaned)}`;
    })
    .join("&");

  params.set(
    "w_rid",
    createHash("md5")
      .update(query + mixinKey, "utf8")
      .digest("hex"),
  );
}

// ---------------------------------------------------------------------------
// 上游转发 + jar 回写
// ---------------------------------------------------------------------------

function isBilibiliCookie(setCookie: string): boolean {
  const lower = setCookie.toLowerCase();
  return BILIBILI_COOKIE_DOMAINS.some((domain) =>
    lower.includes(`domain=${domain}`),
  );
}

async function fetchAndTrack(
  targetUrl: URL,
  request: Request,
  sid: string,
  jar: string[],
): Promise<Response> {
  /** 单次转发；返回上游响应，风控 HTML / 412 由外层判定后决定是否重试 */
  const attempt = async (cookies: string[]) =>
    fetch(targetUrl, {
      method: "GET",
      headers: buildUpstreamHeaders(request, cookies),
      redirect: "follow",
    });

  // 第一次：用现有 jar（含已引导的 buvid）
  let upstream = await attempt(jar);
  let contentType = upstream.headers.get("content-type") ?? "";
  let blocked =
    upstream.status === 412 ||
    contentType.includes("text/html");

  // 被风控：清空 buvid 缓存并重新引导匿名身份，短暂等待后重试一次。
  // Cloudflare 出口 IP 常被 B 站标记，重新握手有时能拿到干净的会话，
  // 救不回就如实报错（不塞假数据、不干等）。
  if (blocked) {
    try {
      bootCache = null; // 强制下次重新拉 finger/spi
      await new Promise((r) => setTimeout(r, 350));
      const fresh = await getBuvidCookies(request);
      const retryJar = fresh.length > 0 ? mergeCookies(jar, fresh) : jar;
      upstream = await attempt(retryJar);
      contentType = upstream.headers.get("content-type") ?? "";
      blocked = upstream.status === 412 || contentType.includes("text/html");
    } catch {
      /* 重试失败：沿用第一次的 blocked 判定往下走 */
    }
  }

  // 两次都被风控：转成明确的 JSON 错误，并提示可行的解决办法
  if (blocked) {
    return new Response(
      JSON.stringify({
        error: `B站风控拦截（HTTP ${upstream.status}），当前网络出口可能被限制，请开加速器或稍后重试`,
      }),
      { status: 502, headers: JSON_HEADERS },
    );
  }

  const setCookies = upstream.headers.getSetCookie?.() ?? [];
  const bilibiliCookies = setCookies.filter((sc) => isBilibiliCookie(sc));
  if (bilibiliCookies.length > 0) {
    await writeJar(sid, mergeCookies(jar, bilibiliCookies));
  }

  const responseHeaders = new Headers();
  upstream.headers.forEach((value, key) => {
    const lower = key.toLowerCase();
    if (
      ["content-length", "transfer-encoding", "content-encoding", "set-cookie"].includes(
        lower,
      )
    ) {
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
// 视频流代理（/api/bilibili/stream?url=...）
// B 站 CDN（bilivideo / akamaized / mcdn 等）强制校验 Referer，
// 浏览器直接挂 <video src> 会 403，必须在 Worker 侧带 Referer 转发。
// 支持 Range（音视频 seek 必需），响应体不缓冲直接透传。
// ---------------------------------------------------------------------------

function isBilibiliMediaHost(host: string): boolean {
  const h = host.toLowerCase();
  return (
    h.includes("bilivideo") ||
    h.includes("akamaized.net") ||
    h.includes("hdslb.com") ||
    h.includes("bilibili.com") ||
    h.includes("mcbbs.net")
  );
}

async function handleStream(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const target = url.searchParams.get("url");
  if (!target) {
    return new Response(JSON.stringify({ error: "缺少 url 参数" }), {
      status: 400,
      headers: JSON_HEADERS,
    });
  }

  let targetUrl: URL;
  try {
    targetUrl = new URL(target);
  } catch {
    return new Response(JSON.stringify({ error: "url 参数不合法" }), {
      status: 400,
      headers: JSON_HEADERS,
    });
  }

  if (targetUrl.protocol !== "https:" || !isBilibiliMediaHost(targetUrl.host)) {
    return new Response(JSON.stringify({ error: "目标域名不在白名单" }), {
      status: 403,
      headers: JSON_HEADERS,
    });
  }

  const headers = new Headers();
  headers.set(
    "user-agent",
    request.headers.get("user-agent") ??
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
  );
  headers.set("referer", SITE_REFERER);
  const range = request.headers.get("range");
  if (range) headers.set("range", range);

  let upstream: Response;
  try {
    upstream = await fetch(targetUrl, { headers, redirect: "follow" });
  } catch {
    return new Response(JSON.stringify({ error: "上游请求失败" }), {
      status: 502,
      headers: JSON_HEADERS,
    });
  }

  const responseHeaders = new Headers();
  for (const key of [
    "content-type",
    "content-length",
    "content-range",
    "accept-ranges",
    "etag",
    "last-modified",
  ]) {
    const value = upstream.headers.get(key);
    if (value) responseHeaders.set(key, value);
  }
  // 允许浏览器侧 <video> 跨域消费
  responseHeaders.set("access-control-allow-origin", "*");

  return new Response(upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers: responseHeaders,
  });
}

// ---------------------------------------------------------------------------
// /api/bilibili/* 处理
// ---------------------------------------------------------------------------

async function handleBilibili(
  request: Request,
  sid: string,
): Promise<Response> {
  const url = new URL(request.url);
  const rawSlug = url.pathname.slice(PROXY_PREFIX.length).replace(/^\/+/, "");
  const slug = rawSlug ? rawSlug.split("/") : [];

  const jar = await readJar(sid);
  if (!jar.some((cookie) => cookie.startsWith("buvid3="))) {
    const buvid = await getBuvidCookies(request);
    if (buvid.length > 0) {
      await writeJar(sid, mergeCookies(jar, buvid));
      jar.push(
        ...buvid.filter(
          (cookie) =>
            !jar.some(
              (existing) => existing.split("=")[0] === cookie.split("=")[0],
            ),
        ),
      );
    }
  }

  if (slug[0] === "stream") {
    return handleStream(request);
  }

  if (slug[0] === "dm") {
    const cid = url.searchParams.get("cid");
    if (!cid) {
      return new Response(JSON.stringify({ error: "缺少 cid 参数" }), {
        status: 400,
        headers: JSON_HEADERS,
      });
    }

    // 弹幕源是 XML，解析成 JSON 再下发，前端直接消费
    const dmUrl = new URL(
      `https://comment.bilibili.com/${encodeURIComponent(cid)}.xml`,
    );
    const upstream = await fetch(dmUrl, {
      headers: buildUpstreamHeaders(request, jar),
      redirect: "follow",
    });
    if (!upstream.ok) {
      return new Response(JSON.stringify({ items: [] }), {
        headers: JSON_HEADERS,
      });
    }
    const xml = await upstream.text();
    return new Response(JSON.stringify({ items: buildDmPayload(xml) }), {
      headers: JSON_HEADERS,
    });
  }

  const isPassport = slug[0] === "passport";
  const base = isPassport ? PASSPORT_BASE : API_BASE;
  const rest = (isPassport ? slug.slice(1) : slug).join("/");
  const safePath = rest.replace(/^\/+/, "");

  if (!safePath) {
    return new Response(JSON.stringify({ error: "空路径" }), {
      status: 400,
      headers: JSON_HEADERS,
    });
  }

  const targetUrl = new URL(
    `${safePath}${url.search ? `${url.search}` : ""}`,
    `${base}/`,
  );

  // 搜索接口需要 WBI 签名；带 w_rid 的请求不重复签
  if (safePath.includes("/search") && !targetUrl.searchParams.has("w_rid")) {
    const mixinKey = await getWbiMixinKey(request);
    if (mixinKey) {
      signWbiQuery(targetUrl.searchParams, mixinKey);
    }
  }

  return fetchAndTrack(targetUrl, request, sid, jar);
}

/**
 * 网易云歌曲评论代理。
 *
 * 官方 /api/v1/resource/comments/R_SO_4_<歌曲ID> 读取的是公开评论，
 * 不需要登录，但响应不带 CORS 头，浏览器直连会被拦，所以在 Worker 里转发。
 * 隐私边界：只读取公开数据——不透传浏览器的任何 Cookie 给上游，
 * 也不把上游下发的 Cookie 返回给浏览器。
 */
async function handleNeteaseComment(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const songId = (url.searchParams.get("id") ?? "").trim();
  if (!/^\d{1,20}$/.test(songId)) {
    return new Response(JSON.stringify({ error: "缺少合法的歌曲 ID" }), {
      status: 400,
      headers: JSON_HEADERS,
    });
  }

  const limitRaw = Number(url.searchParams.get("limit") ?? 20);
  const offsetRaw = Number(url.searchParams.get("offset") ?? 0);
  const limit = Number.isFinite(limitRaw)
    ? Math.min(50, Math.max(1, Math.floor(limitRaw)))
    : 20;
  const offset = Number.isFinite(offsetRaw) ? Math.max(0, Math.floor(offsetRaw)) : 0;

  const upstream = new URL(
    `${NETEASE_ORIGIN}/api/v1/resource/comments/R_SO_4_${songId}`,
  );
  upstream.searchParams.set("limit", String(limit));
  upstream.searchParams.set("offset", String(offset));

  let upstreamResponse: Response;
  try {
    upstreamResponse = await ncmFetchTimeout(upstream.toString(), {
      headers: {
        Referer: `${NETEASE_ORIGIN}/`,
        Origin: NETEASE_ORIGIN,
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
        Accept: "application/json, text/plain, */*",
        "Accept-Language": "zh-CN,zh;q=0.9",
      },
      credentials: "omit",
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: String((e as Error)?.message ?? e) }), {
      status: 504,
      headers: JSON_HEADERS,
    });
  }

  const body = await upstreamResponse.text();
  if (!upstreamResponse.ok) {
    return new Response(
      JSON.stringify({ error: `网易云评论接口返回 HTTP ${upstreamResponse.status}` }),
      { status: 502, headers: JSON_HEADERS },
    );
  }

  // 上游 Content-Type 是 text/plain，但 body 实际是 JSON，这里手动解析
  let data: unknown;
  try {
    data = JSON.parse(body);
  } catch {
    return new Response(JSON.stringify({ error: "评论接口返回内容不是 JSON" }), {
      status: 502,
      headers: JSON_HEADERS,
    });
  }

  return new Response(JSON.stringify(data), {
    headers: {
      ...JSON_HEADERS,
      "cache-control": "public, max-age=60",
      "access-control-allow-origin": "*",
    },
  });
}

// ---------------------------------------------------------------------------
// 网易云官方扫码登录（weapi 加密 + 服务端 Cookie jar）
//
// 安全边界：MUSIC_U / __csrf 只存在 Worker 侧的 Cache API 里，
// 浏览器只拿到一个无意义的 ncm_sid，登录凭证绝不下发、绝不写进日志，
// 也绝不会发给 GD Studio 等任何第三方网关。
// ---------------------------------------------------------------------------

const NCM_LOGIN_PREFIX = "/api/netease/login";
const NCM_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";
const NCM_PRESET_KEY = new TextEncoder().encode("0CoJUm6Qyw8W8jud");
const NCM_IV = new TextEncoder().encode("0102030405060708");
const NCM_BASE62 = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
const NCM_PUB_KEY = 0x10001n;
const NCM_MODULUS = BigInt(
  "0x00e0b509f6259df8642dbc35662901477df22677ec152b5ff68ace615bb7b725152b3ab17a876aea8a5aa76d2e417629ec4ee341f56135fccf695280104e0312ecbda92557c93870114af6c9d05c4f7f0c3685b7a46bee255932575cce10b424d813cfe4875d3e82047b97ddef52741d546b8e289dc6935b3ece0462db0a22b8e7",
);
const NCM_JAR_TTL = 60 * 60 * 24 * 30;

interface NcmSession {
  musicU: string;
  csrf: string;
  savedAt: number;
}

interface NcmProfile {
  userId: number;
  nickname: string;
  avatarUrl: string;
  vipType: number;
}

interface NcmApiResult {
  json: Record<string, unknown> & { code?: number; message?: string };
  setCookies: string[];
}

function ncmBase64(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}

async function ncmAesCbc(data: Uint8Array, key: Uint8Array): Promise<Uint8Array> {
  // Web Crypto 的 BufferSource 要求 ArrayBuffer，显式拷贝规避
  // Uint8Array<ArrayBufferLike> 的泛型不兼容（TS 5.7+）
  const toBuffer = (u: Uint8Array): ArrayBuffer => {
    const b = new ArrayBuffer(u.byteLength);
    new Uint8Array(b).set(u);
    return b;
  };
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    toBuffer(key),
    { name: "AES-CBC" },
    false,
    ["encrypt"],
  );
  const buf = await crypto.subtle.encrypt(
    { name: "AES-CBC", iv: toBuffer(NCM_IV) },
    cryptoKey,
    toBuffer(data),
  );
  return new Uint8Array(buf);
}

/** 无填充 RSA：m^e mod n，密钥只有 16 字节，BigInt 直接算即可 */
function ncmModPow(base: bigint, exp: bigint, mod: bigint): bigint {
  let result = 1n;
  let b = base % mod;
  let e = exp;
  while (e > 0n) {
    if (e & 1n) result = (result * b) % mod;
    b = (b * b) % mod;
    e >>= 1n;
  }
  return result;
}

function ncmRsaHex(reversedKey: Uint8Array): string {
  let hex = "";
  for (const b of reversedKey) hex += b.toString(16).padStart(2, "0");
  return ncmModPow(BigInt("0x" + hex), NCM_PUB_KEY, NCM_MODULUS)
    .toString(16)
    .padStart(256, "0");
}

/** 生成 weapi 的 params / encSecKey（与官方网页端一致） */
async function ncmWeapi(
  payload: Record<string, unknown>,
  csrf = "",
): Promise<{ params: string; encSecKey: string }> {
  const text = JSON.stringify({ ...payload, csrf_token: csrf });
  const secret = new Uint8Array(16);
  const rand = crypto.getRandomValues(new Uint8Array(16));
  for (let i = 0; i < 16; i++) secret[i] = NCM_BASE62.charCodeAt(rand[i] % 62);
  const first = ncmBase64(
    await ncmAesCbc(new TextEncoder().encode(text), NCM_PRESET_KEY),
  );
  const params = ncmBase64(
    await ncmAesCbc(new TextEncoder().encode(first), secret),
  );
  const encSecKey = ncmRsaHex(secret.slice().reverse());
  return { params, encSecKey };
}

/**
 * 带超时的官方请求：Cloudflare 海外节点偶尔到 music.163.com 的连接会被挂起，
 * 裸 fetch 会一直等到平台级 30s+ 超时，前端表现为「点了没反应」。
 * 这里 8 秒主动掐断并抛明确错误，前端能立刻显示重试提示。
 * 纯网络层保护，不改动任何登录 / 加密 / Cookie 逻辑。
 */
const NCM_FETCH_TIMEOUT_MS = 8000;

async function ncmFetchTimeout(url: string, init: RequestInit): Promise<Response> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), NCM_FETCH_TIMEOUT_MS);
  try {
    return await fetch(url, { ...init, signal: ctl.signal });
  } catch (e) {
    if ((e as Error)?.name === "AbortError") {
      throw new Error(`官方接口连接超时（${NCM_FETCH_TIMEOUT_MS / 1000}s），当前网络可能不通，请稍后重试或换网络`);
    }
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

async function ncmWeapiRequest(
  path: string,
  payload: Record<string, unknown>,
  session: NcmSession | null,
): Promise<NcmApiResult> {
  const csrf = session?.csrf ?? "";
  const { params, encSecKey } = await ncmWeapi(payload, csrf);
  // os=pc / appver 必须带，否则官方返回 -462「网络环境存在风险」
  const cookie = session?.musicU
    ? `os=pc; appver=2.10.13; MUSIC_U=${session.musicU}; __csrf=${csrf}`
    : "os=pc; appver=2.10.13; MUSIC_U=; __csrf=";
  const res = await ncmFetchTimeout(
    `${NETEASE_ORIGIN}/weapi${path}?csrf_token=${encodeURIComponent(csrf)}`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Referer: `${NETEASE_ORIGIN}/`,
        Origin: NETEASE_ORIGIN,
        "User-Agent": NCM_UA,
        Cookie: cookie,
      },
      body: new URLSearchParams({ params, encSecKey }).toString(),
      credentials: "omit",
    },
  );
  const text = await res.text();
  let json: NcmApiResult["json"];
  try {
    json = JSON.parse(text) as NcmApiResult["json"];
  } catch {
    json = { code: -1, message: `上游返回非 JSON (HTTP ${res.status})` };
  }
  const headers = res.headers as Headers & { getSetCookie?: () => string[] };
  const setCookies =
    typeof headers.getSetCookie === "function" ? headers.getSetCookie() : [];
  return { json, setCookies };
}

function pickLoginCookies(lines: string[]): { musicU: string; csrf: string } | null {
  const picked: Record<string, string> = {};
  for (const line of lines) {
    const m = /^(MUSIC_U|__csrf)=([^;]*)/.exec(line.trim());
    if (m && m[2]) picked[m[1]] = m[2];
  }
  if (!picked.MUSIC_U) return null;
  return { musicU: picked.MUSIC_U, csrf: picked.__csrf ?? "" };
}

/* ---- 登录态 jar：按 ncm_sid 分桶，凭证只留在服务端 ---- */

function ncmJarKey(sid: string): URL {
  return new URL(`https://jar.internal/ncm/${encodeURIComponent(sid)}`);
}

async function readNcmJar(sid: string): Promise<NcmSession | null> {
  if (!sid) return null;
  try {
    const hit = await jarCache.match(ncmJarKey(sid));
    if (!hit) return null;
    const data = (await hit.json()) as NcmSession | null;
    return data?.musicU ? data : null;
  } catch {
    return null;
  }
}

async function writeNcmJar(sid: string, session: NcmSession): Promise<void> {
  await jarCache.put(
    ncmJarKey(sid),
    new Response(JSON.stringify(session), {
      headers: {
        "content-type": "application/json",
        "cache-control": `public, max-age=${NCM_JAR_TTL}`,
      },
    }),
  );
}

async function clearNcmJar(sid: string): Promise<void> {
  try {
    await jarCache.delete(ncmJarKey(sid));
  } catch {
    /* 已经不存在 */
  }
}

function getOrCreateNcmSid(request: Request): { sid: string; isNew: boolean } {
  const raw = request.headers.get("cookie") ?? "";
  const m = /(?:^|;\s*)ncm_sid=([a-f0-9]{32})/.exec(raw);
  if (m) return { sid: m[1], isNew: false };
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  let sid = "";
  for (const b of bytes) sid += b.toString(16).padStart(2, "0");
  return { sid, isNew: true };
}

async function ncmFetchProfile(session: NcmSession): Promise<NcmProfile | null> {
  const { json } = await ncmWeapiRequest("/w/nuser/account/get", {}, session);
  const profile = json.profile as Record<string, unknown> | null | undefined;
  const account = json.account as Record<string, unknown> | null | undefined;
  if (!profile?.userId) return null;
  return {
    userId: Number(profile.userId),
    nickname: String(profile.nickname ?? "云村村民"),
    avatarUrl: String(profile.avatarUrl ?? "").replace(/^http:\/\//, "https://"),
    vipType: Number(account?.vipType ?? profile.vipType ?? 0),
  };
}

async function handleNeteaseLogin(request: Request, sid: string): Promise<Response> {
  const url = new URL(request.url);
  const path = url.pathname.slice(NCM_LOGIN_PREFIX.length);
  const jsonOk = (data: unknown, status = 200) =>
    new Response(JSON.stringify(data), {
      status,
      headers: { ...JSON_HEADERS, "cache-control": "no-store" },
    });

  try {
    if (path === "/qr/key") {
      const { json } = await ncmWeapiRequest("/login/qrcode/unikey", { type: 1 }, null);
      const unikey = typeof json.unikey === "string" ? json.unikey : "";
      if (json.code !== 200 || !unikey) {
        return jsonOk(
          { error: `获取登录二维码失败：code ${json.code ?? "?"} ${json.message ?? ""}` },
          502,
        );
      }
      return jsonOk({ unikey, url: `${NETEASE_ORIGIN}/login?codekey=${unikey}` });
    }

    if (path === "/qr/check") {
      const key = (url.searchParams.get("key") ?? "").trim();
      if (!key) return jsonOk({ error: "缺少 key" }, 400);
      const { json, setCookies } = await ncmWeapiRequest(
        "/login/qrcode/client/login",
        { key, type: 1 },
        null,
      );
      const code = Number(json.code ?? -1);
      if (code === 803) {
        const picked = pickLoginCookies(setCookies);
        if (!picked) {
          return jsonOk({ error: "登录成功但未拿到 MUSIC_U，请重新扫码" }, 502);
        }
        const session: NcmSession = { ...picked, savedAt: Date.now() };
        await writeNcmJar(sid, session);
        const profile = await ncmFetchProfile(session);
        return jsonOk({ code: 803, loggedIn: true, profile });
      }
      return jsonOk({
        code,
        message: String(json.message ?? ""),
        nickname: typeof json.nickname === "string" ? json.nickname : undefined,
      });
    }

    if (path === "/status") {
      const session = await readNcmJar(sid);
      if (!session) return jsonOk({ loggedIn: false, profile: null });
      const profile = await ncmFetchProfile(session);
      if (!profile) {
        await clearNcmJar(sid);
        return jsonOk({ loggedIn: false, profile: null, expired: true });
      }
      return jsonOk({ loggedIn: true, profile });
    }

    if (path === "/logout") {
      await clearNcmJar(sid);
      return jsonOk({ loggedIn: false });
    }

    if (path === "/playlists") {
      const session = await readNcmJar(sid);
      if (!session) return jsonOk({ error: "未登录" }, 401);
      const profile = await ncmFetchProfile(session);
      if (!profile) return jsonOk({ error: "登录态已失效" }, 401);
      const { json } = await ncmWeapiRequest(
        "/user/playlist",
        { uid: profile.userId, limit: 100, offset: 0, includeVideo: false },
        session,
      );
      const raw = Array.isArray(json.playlist) ? json.playlist : [];
      const playlists = raw.map((entry) => {
        const p = entry as Record<string, unknown>;
        const creator = p.creator as Record<string, unknown> | undefined;
        return {
          id: String(p.id ?? ""),
          name: String(p.name ?? "未命名歌单"),
          cover: String(p.coverImgUrl ?? "").replace(/^http:\/\//, "https://"),
          count: Number(p.trackCount ?? 0),
          creator: String(creator?.nickname ?? ""),
          specialType: Number(p.specialType ?? 0),
        };
      });
      return jsonOk({ playlists });
    }

    if (path === "/playlist") {
      const id = (url.searchParams.get("id") ?? "").trim();
      if (!/^\d{1,20}$/.test(id)) return jsonOk({ error: "缺少合法的歌单 ID" }, 400);
      const session = await readNcmJar(sid);
      if (!session) return jsonOk({ error: "未登录" }, 401);
      const { json } = await ncmWeapiRequest(
        "/v3/playlist/detail",
        { id, n: 1000, s: 8 },
        session,
      );
      const p = json.playlist as Record<string, unknown> | null | undefined;
      if (!p) return jsonOk({ error: "歌单不存在或当前账号无权访问" }, 404);
      const raw = Array.isArray(p.tracks) ? p.tracks : [];
      const tracks = raw.map((entry) => {
        const t = entry as Record<string, unknown>;
        const ar = Array.isArray(t.ar) ? (t.ar as Record<string, unknown>[]) : [];
        const al = (t.al ?? {}) as Record<string, unknown>;
        return {
          id: String(t.id ?? ""),
          name: String(t.name ?? "未知歌曲"),
          artist:
            ar.map((a) => String(a.name ?? "")).filter(Boolean).join(" / ") ||
            "未知艺人",
          album: String(al.name ?? ""),
          pic: String(al.picUrl ?? "").replace(/^http:\/\//, "https://"),
          duration: Number(t.dt ?? 0) / 1000,
          vip: Number(t.fee ?? 0) !== 0,
        };
      });
      return jsonOk({
        playlist: {
          id,
          name: String(p.name ?? `歌单 #${id}`),
          cover: String(p.coverImgUrl ?? "").replace(/^http:\/\//, "https://"),
          desc: String(p.description ?? ""),
          tracks,
        },
      });
    }

    return jsonOk({ error: "未知的登录接口" }, 404);
  } catch (e) {
    return jsonOk(
      { error: `登录代理请求失败：${String((e as Error)?.message ?? e)}` },
      502,
    );
  }
}

// ---------------------------------------------------------------------------
// 通用 weapi 读取网关
//
// 前端的每日推荐 / 歌单分类 / 搜索分类 / 专辑/歌手/用户详情 都走这里。
// 安全：路径白名单精确匹配，只允许只读接口，绝不当任意 URL 的免费代理；
// 需要登录态的接口（每日推荐 / 红心）会带上服务端 jar 里的 MUSIC_U，
// 凭证依旧不下发浏览器。
// ---------------------------------------------------------------------------

const NCM_WEAPI_PATH = "/api/netease/weapi";

/** 允许的官方 weapi 路径（只读，不含任何写操作 / 登录操作） */
const NCM_ALLOWED = new Set([
  "/v2/discovery/recommend/songs", // 每日推荐歌曲（需登录）
  "/v1/discovery/recommend/resource", // 每日推荐歌单（需登录）
  "/playlist/catalogue", // 歌单分类
  "/playlist/list", // 分类歌单列表
  "/search/get", // 搜索（单曲/专辑/歌手/歌单/用户）
  "/song/like/get", // 我喜欢的音乐 id 列表（需登录）
  "/v3/song/detail", // 歌曲详情（批量补封面/艺人）
  "/song/lyric", // 歌词（游客可读，替代慢速公共网关）
]);

/** 形如 /v1/album/123 /v1/artist/456 /v1/user/detail/789 的路径 */
function isAllowedNcmRoute(path: string): boolean {
  if (NCM_ALLOWED.has(path)) return true;
  return /^\/v1\/(album|artist|radio\/get)\/\d+$/.test(path) ||
    /^\/v1\/user\/detail\/\d+$/.test(path) ||
    /^\/v3\/playlist\/detail$/.test(path) ||
    /^\/user\/playlist$/.test(path) ||
    path === "/v1/radio/get" ||
    path === "/v1/discovery/recommend/resource";
}

async function handleNcmWeapi(request: Request, sid: string): Promise<Response> {
  const fail = (msg: string, status = 400) =>
    new Response(JSON.stringify({ error: msg }), {
      status,
      headers: JSON_HEADERS,
    });

  if (request.method !== "POST") return fail("仅支持 POST", 405);

  let body: { path?: unknown; payload?: unknown; auth?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return fail("请求体不是合法 JSON");
  }

  const path = typeof body.path === "string" ? body.path : "";
  if (!path.startsWith("/") || !isAllowedNcmRoute(path)) {
    return fail("接口不在白名单内", 403);
  }
  // 防止路径里夹带 query 造成越权
  if (path.includes("?") || path.includes("//")) return fail("非法路径", 403);

  const payload =
    body.payload && typeof body.payload === "object" && !Array.isArray(body.payload)
      ? (body.payload as Record<string, unknown>)
      : {};

  const needAuth = body.auth === true;
  const session = needAuth ? await readNcmJar(sid) : null;
  if (needAuth && !session) {
    return fail("需要登录才能访问该接口", 401);
  }

  try {
    const { json } = await ncmWeapiRequest(path, payload, session);
    return new Response(JSON.stringify(json), {
      headers: { ...JSON_HEADERS, "cache-control": "no-store" },
    });
  } catch (e) {
    return fail(`官方接口请求失败：${String((e as Error)?.message ?? e)}`, 502);
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (
      url.pathname === PROXY_PREFIX ||
      url.pathname.startsWith(`${PROXY_PREFIX}/`)
    ) {
      const { sid, isNew } = getOrCreateSid(request);
      try {
        const response = await handleBilibili(request, sid);
        if (isNew) {
          response.headers.append(
            "set-cookie",
            `bili_sid=${sid}; Path=/; Max-Age=31536000; SameSite=Lax; HttpOnly`,
          );
        }
        return response;
      } catch {
        return new Response(JSON.stringify({ error: "代理请求失败" }), {
          status: 502,
          headers: JSON_HEADERS,
        });
      }
    }

    if (url.pathname === NETEASE_COMMENT_PATH) {
      try {
        return await handleNeteaseComment(request);
      } catch {
        return new Response(JSON.stringify({ error: "评论代理请求失败" }), {
          status: 502,
          headers: JSON_HEADERS,
        });
      }
    }

    if (url.pathname.startsWith(`${NCM_LOGIN_PREFIX}/`)) {
      const { sid, isNew } = getOrCreateNcmSid(request);
      const response = await handleNeteaseLogin(request, sid);
      if (isNew) {
        // 本地 wrangler dev 是 http，不能下发 Secure，否则浏览器会丢掉 sid
        const secure = url.protocol === "https:" ? "; Secure" : "";
        response.headers.append(
          "set-cookie",
          `ncm_sid=${sid}; Path=/; Max-Age=${NCM_JAR_TTL}; SameSite=Lax; HttpOnly${secure}`,
        );
      }
      return response;
    }

    if (url.pathname === NCM_WEAPI_PATH) {
      const { sid, isNew } = getOrCreateNcmSid(request);
      const response = await handleNcmWeapi(request, sid);
      if (isNew) {
        const secure = url.protocol === "https:" ? "; Secure" : "";
        response.headers.append(
          "set-cookie",
          `ncm_sid=${sid}; Path=/; Max-Age=${NCM_JAR_TTL}; SameSite=Lax; HttpOnly${secure}`,
        );
      }
      return response;
    }

    return env.ASSETS.fetch(request);
  },
};
