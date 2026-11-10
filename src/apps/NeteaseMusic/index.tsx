/* ==========================================================================
 * 网易云音乐 · arch-web-v2 应用
 *
 * 数据层：只走网易云（默认 GD Studio 公共网关，可换自建 NeteaseCloudMusicApi）。
 *   - 歌单：types=playlist&id=... → { playlist: { name, coverImgUrl, tracks } }
 *   - 搜索：types=search&name=... → 歌曲数组
 *   - 播放链接 / 歌词 / 封面：types=url | lyric | pic&id=...
 *   任何一步失败都会自动回退到默认网关，公共接口挂了也能自愈。
 *
 * UI 层：按网易云 PC 客户端（深色）+ webplayer（浅色）重做，
 *   首页 / 歌单详情 / 搜索结果 / 播放页 + 底部常驻播放条。
 *   明暗主题接全局 useOSStore.settings.darkMode（改一处全站变），
 *   应用内颜色全部走 --nm-* CSS 变量，两套值在 NM_THEME 里集中定义。
 * ========================================================================== */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties, MouseEvent, ReactNode } from 'react';
import {
  AlertCircle,
  ArrowLeft,
  ArrowRight,
  RotateCw,
  ChevronRight,
  Disc3,
  Heart,
  ListMusic,
  Loader2,
  Maximize2,
  MessageCircle,
  Minimize2,
  Moon,
  MoreHorizontal,
  Music2,
  Pause,
  Play,
  Radio,
  Repeat,
  Search,
  Settings as SettingsIcon,
  Share2,
  Shuffle,
  SkipBack,
  SkipForward,
  SlidersHorizontal,
  Sun,
  Volume2,
  VolumeX,
  UserRound,
  ThumbsUp,
  X,
} from 'lucide-react';
import qrcode from 'qrcode-generator';
import type { AppProps } from '@/shell/types';
import { isWindowActive } from '@/shell/window/windowKeys';
import { useOSStore } from '@/stores/useOSStore';

/* ============================ 配置与类型 ============================ */

const STORAGE_KEY = 'arch-web-netease:config';
const PLAYER_STYLE_KEY = 'arch-web-netease:player-style';
const GD_STUDIO = 'https://music-api.gdstudio.xyz/api.php';

type GatewayKind = 'gdstudio' | 'netease-api';
interface Config {
  gateway: string;
  kind: GatewayKind;
}

/** 播放页样式 */
type PlayerTheme = 'immersive' | 'classic';
/** 沉浸页背景来源 */
type BgSource = 'cover' | 'random' | 'custom';
/** 请求播放地址时的音质（GD Studio 的 br 参数） */
type Quality = 128 | 320 | 999;

/**
 * 播放器外观 / 播放设置。与网关 Config 分开存，互不干扰。
 * 参考 YinXue Milayer 的播放页与设置项设计。
 */
interface PlayerStyle {
  theme: PlayerTheme;
  quality: Quality;
  bgSource: BgSource;
  accent: string;
  /** 背景模糊半径 px */
  blur: number;
  /** 黑色遮罩不透明度 0~1 */
  dim: number;
  /** 歌词 3D 倾斜效果 */
  lyric3d: boolean;
  /** 歌词字体大小 px */
  lyricSize: number;
  /** 歌词行间距倍率 */
  lyricGap: number;
  /** 当前行高亮放大倍率 */
  lyricHighlight: number;
  /** 自定义背景图（data URL 或外链），bgSource=custom 时生效 */
  customBg: string;
}

const ACCENTS = ['#ffffff', '#ff9f43', '#ff5e6c', '#2ed8a0', '#4a9eff', '#a55cff', '#ff7eb6'];
const QUALITY_LABEL: Record<Quality, string> = {
  128: '标准 · 128K',
  320: '极高 · 320K',
  999: '无损 · 尝试最高',
};

const DEFAULT_PLAYER_STYLE: PlayerStyle = {
  theme: 'immersive',
  quality: 320,
  bgSource: 'cover',
  accent: '#ffffff',
  blur: 50,
  dim: 0.25,
  lyric3d: true,
  lyricSize: 32,
  lyricGap: 1.5,
  lyricHighlight: 1.05,
  customBg: '',
};

function loadPlayerStyle(): PlayerStyle {
  if (typeof localStorage === 'undefined') return DEFAULT_PLAYER_STYLE;
  try {
    const raw = localStorage.getItem(PLAYER_STYLE_KEY);
    return raw ? { ...DEFAULT_PLAYER_STYLE, ...JSON.parse(raw) } : DEFAULT_PLAYER_STYLE;
  } catch {
    return DEFAULT_PLAYER_STYLE;
  }
}

function persistPlayerStyle(s: PlayerStyle): void {
  try {
    localStorage.setItem(PLAYER_STYLE_KEY, JSON.stringify(s));
  } catch {
    /* 隐私模式等场景下存储不可用，忽略即可 */
  }
}

const DEFAULT_CONFIG: Config = { gateway: GD_STUDIO, kind: 'gdstudio' };

interface Track {
  id: string;
  name: string;
  artist: string;
  album: string;
  /** 专辑封面直链（歌单接口直接返回，搜索结果需异步补） */
  pic: string;
  /** 时长（秒） */
  duration: number;
  /** VIP / 付费标识 */
  vip: boolean;
}

interface PlaylistData {
  id: string;
  name: string;
  cover: string;
  desc: string;
  tracks: Track[];
}

interface LyricLine {
  t: number;
  text: string;
}

/* ---- 歌曲评论（网易云官方公开接口） ---- */
interface CommentUser {
  nickname?: string;
  avatarUrl?: string;
  userId?: number;
}
interface BeRepliedItem {
  user?: CommentUser;
  content?: string;
}
interface SongComment {
  commentId: number | string;
  content?: string;
  time?: number;
  timeStr?: string;
  likedCount?: number;
  user?: CommentUser;
  beReplied?: BeRepliedItem[];
}
interface CommentPayload {
  total?: number;
  hotComments?: SongComment[];
  comments?: SongComment[];
  more?: boolean;
  error?: string;
}

/* ---- 官方扫码登录（凭证只留在 Worker 侧） ---- */
interface NcmProfile {
  userId: number;
  nickname: string;
  avatarUrl: string;
  vipType: number;
}
interface QrKeyResponse {
  unikey?: string;
  url?: string;
  error?: string;
}
interface QrCheckResponse {
  code?: number;
  message?: string;
  nickname?: string;
  loggedIn?: boolean;
  profile?: NcmProfile | null;
  error?: string;
}
interface LoginStatusResponse {
  loggedIn?: boolean;
  profile?: NcmProfile | null;
  expired?: boolean;
  error?: string;
}
interface UserPlaylist {
  id: string;
  name: string;
  cover: string;
  count: number;
  creator: string;
  /** 5 = 「我喜欢的音乐」特殊歌单 */
  specialType?: number;
}

type View = 'home' | 'playlist' | 'search' | 'channel' | 'album' | 'artist' | 'user';
type RepeatMode = 'list' | 'one' | 'shuffle';
/** 搜索分类：1 单曲 / 10 专辑 / 100 歌手 / 1000 歌单 / 1002 用户 */
type SearchTab = '1' | '10' | '100' | '1000' | '1002';

/** 一张导航快照，前进/后退就是在这条栈上移动 */
interface NavEntry {
  view: View;
  title?: string;
  playlistId?: string;
  playlistName?: string;
  channel?: ChannelInfo;
  searchKw?: string;
  searchTab?: SearchTab;
  albumId?: string;
  artistId?: string;
  userId?: string;
}

/** 搜索结果里除歌曲外的通用条目 */
interface SearchItem {
  id: string;
  name: string;
  pic: string;
  sub: string;
  extra?: string;
}

/** 歌单分类里的一类 */
interface PlaylistCategory {
  name: string;
  category: number;
  hot?: boolean;
}

/**
 * 栏目页：左侧导航与首页入口点进去后的独立内容。
 * kind 决定渲染哪种数据：
 *   - links      一组可点的公共歌单（未登录兜底）
 *   - dailySongs 每日推荐歌曲（登录，官方每日刷新）
 *   - dailyPl    每日推荐歌单（登录）
 *   - categories 歌单分类广场（官方 catalogue）
 *   - catList    某个分类下的歌单列表
 *   - local      本机功能（红心 / 最近播放）
 */
interface ChannelInfo {
  id: string;
  title: string;
  desc: string;
  kind?: 'links' | 'dailySongs' | 'dailyPl' | 'categories' | 'catList';
  needsLogin?: boolean;
  local?: 'liked' | 'recent' | 'unsupported';
  items?: { id: string; name: string; pic?: string }[];
  catName?: string;
}

/** 官方通用的原始数据包装（网关原样透传，字段用可选兜底） */
type WeapiRaw = Record<string, any>;

function loadConfig(): Config {
  if (typeof localStorage === 'undefined') return DEFAULT_CONFIG;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? { ...DEFAULT_CONFIG, ...JSON.parse(raw) } : DEFAULT_CONFIG;
  } catch {
    return DEFAULT_CONFIG;
  }
}

function persistConfig(c: Config) {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(c));
  } catch {
    /* 隐私模式下忽略 */
  }
}

/* ============================ 双主题配色 ============================
 * 所有组件只用 var(--nm-*)，切换主题时只需替换根节点上这一组变量。
 * ================================================================== */

const NM_THEME: Record<'dark' | 'light', Record<string, string>> = {
  dark: {
    '--nm-bg': '#1b1b1d',
    '--nm-top': '#202022',
    '--nm-side': '#171719',
    '--nm-panel': '#242426',
    '--nm-card': '#2b2b2e',
    '--nm-text': '#f2f2f4',
    '--nm-sub': '#b9b9bf',
    '--nm-muted': '#85858c',
    '--nm-border': '#313134',
    '--nm-hover': 'rgba(255,255,255,0.06)',
    '--nm-red': '#ec4141',
    '--nm-red-dim': '#c83131',
    '--nm-red-soft': 'rgba(236,65,65,0.15)',
    '--nm-player-bg': '#3a3f3b',
    '--nm-scroll': '#414146',
  },
  light: {
    '--nm-bg': '#ffffff',
    '--nm-top': '#ffffff',
    '--nm-side': '#fafafa',
    '--nm-panel': '#f7f7f9',
    '--nm-card': '#ffffff',
    '--nm-text': '#1c1c1e',
    '--nm-sub': '#55555c',
    '--nm-muted': '#90909a',
    '--nm-border': '#ececf0',
    '--nm-hover': 'rgba(0,0,0,0.045)',
    '--nm-red': '#ec4141',
    '--nm-red-dim': '#d33636',
    '--nm-red-soft': 'rgba(236,65,65,0.10)',
    '--nm-player-bg': '#f2f3f5',
    '--nm-scroll': '#d3d5dc',
  },
};

/* ============================ 接口数据 ============================ */

interface RawSong {
  id: number | string;
  name: string;
  ar?: { name: string }[];
  artists?: { name: string }[];
  al?: { name?: string; picUrl?: string };
  album?: { name?: string; picUrl?: string };
  dt?: number;
  fee?: number;
}

interface RawSearchItem {
  id: number | string;
  name: string;
  artist?: string | string[];
  album?: string;
  pic_id?: string;
}

interface RawPlaylistResponse {
  playlist?: {
    id?: number;
    name?: string;
    coverImgUrl?: string;
    description?: string;
    tracks?: RawSong[];
  };
}

interface RawNCMSearchResponse {
  result?: { songs?: RawSong[] };
}

function mapSong(s: RawSong): Track {
  const ar = s.ar ?? s.artists ?? [];
  const al = s.al ?? s.album ?? {};
  return {
    id: String(s.id ?? ''),
    name: s.name ?? '未知歌曲',
    artist: ar.map((a) => a.name).filter(Boolean).join(' / ') || '未知艺人',
    album: al.name ?? '',
    pic: al.picUrl ?? '',
    duration: s.dt ? Math.round(s.dt / 1000) : 0,
    vip: s.fee === 1 || s.fee === 8,
  };
}

function buildUrl(cfg: Config, params: Record<string, string | number>): string {
  const u = new URL(cfg.gateway);
  for (const [k, v] of Object.entries(params)) u.searchParams.set(k, String(v));
  return u.toString();
}

async function fetchJson<T>(url: string, timeout = 20_000): Promise<T> {
  const ctl = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    ctl.abort();
  }, timeout);
  try {
    const r = await fetch(url, { signal: ctl.signal, credentials: 'omit' });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return (await r.json()) as T;
  } catch (e) {
    // 公共网关慢时应给明确中文提示，而不是抛英文 AbortError
    if (timedOut) throw new Error('音乐网关响应超时，请稍后重试或换个网络');
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

/* ---- 歌曲评论：走自己的 Worker 代理，绕开官方接口的 CORS ---- */
const COMMENT_ENDPOINT = '/api/netease/comment';

async function fetchSongComments(id: string, offset = 0, limit = 20): Promise<CommentPayload> {
  const r = await fetch(
    `${COMMENT_ENDPOINT}?id=${encodeURIComponent(id)}&limit=${limit}&offset=${offset}`,
    { credentials: 'omit' },
  );
  if (!r.ok) {
    let msg = `HTTP ${r.status}`;
    if (r.status === 404) msg = '评论代理不可用（请用 wrangler dev 或 Cloudflare 打开）';
    else {
      try {
        const j = (await r.json()) as { error?: string };
        if (j.error) msg = j.error;
      } catch {
        /* 保留 HTTP 状态作为错误信息 */
      }
    }
    throw new Error(msg);
  }
  return (await r.json()) as CommentPayload;
}

/** 官方头像常写成 http://，https 页面下会被混合内容拦截 */
function safeAvatar(url?: string): string {
  return url ? url.replace(/^http:\/\//, 'https://') : '';
}

/* ---- 官方扫码登录接口（同源 Worker，凭证由服务端保管） ---- */
const LOGIN_ENDPOINT = '/api/netease/login';

type NcmResult<T> = T & { error?: string };

async function ncmApi<T>(path: string, init?: RequestInit): Promise<T> {
  const r = await fetch(`${LOGIN_ENDPOINT}${path}`, {
    credentials: 'same-origin',
    ...init,
  });
  const data = (await r.json().catch(() => ({}))) as NcmResult<T>;
  if (!r.ok || data.error) throw new Error(data.error || `HTTP ${r.status}`);
  return data;
}

/** 用登录态读歌单详情（我的歌单 / 私人歌单），失败时上层回退公共网关 */
async function fetchOfficialPlaylist(id: string): Promise<PlaylistData> {
  const data = await ncmApi<{ playlist: PlaylistData }>(`/playlist?id=${encodeURIComponent(id)}`);
  return data.playlist;
}

function makeQrDataUrl(text: string): string {
  const qr = qrcode(0, 'M');
  qr.addData(text);
  qr.make();
  return qr.createDataURL(8, 0);
}

/* ---- 官方 weapi 通用读取网关（白名单在 Worker 侧） ---- */

const WEAPI_ENDPOINT = '/api/netease/weapi';

/**
 * 走 Worker 转发读取官方接口。
 * auth=true 时自动带服务端 cookie jar 里的登录态（凭证不下发浏览器）。
 */
async function ncmWeapi(
  path: string,
  payload: Record<string, unknown> = {},
  auth = false,
): Promise<WeapiRaw> {
  const r = await fetch(WEAPI_ENDPOINT, {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ path, payload, auth }),
  });
  const data = (await r.json().catch(() => ({}))) as WeapiRaw & { error?: string };
  if (!r.ok || data.error) throw new Error(data.error || `HTTP ${r.status}`);
  return data;
}

/** 官方歌曲对象（每日推荐 / 专辑 / 歌手热门都长这样）→ 内部 Track */
function mapOfficialSong(s: WeapiRaw): Track {
  const album = (s.album ?? s.al ?? {}) as WeapiRaw;
  const artists = (s.artists ?? s.ar ?? []) as WeapiRaw[];
  const pic = safeAvatar(String(album.pic ?? album.picUrl ?? ''));
  return {
    id: String(s.id ?? ''),
    name: String(s.name ?? '未知歌曲'),
    artist: artists.map((a) => String(a.name ?? '')).filter(Boolean).join(' / ') || '未知艺人',
    album: String(album.name ?? ''),
    pic,
    duration: Number(s.dt ?? s.duration ?? 0) / 1000,
    vip: Number(s.fee ?? s.feeType ?? 0) !== 0,
  };
}

/** 官方歌单对象 → 卡片条目 */
function mapOfficialPlaylist(p: WeapiRaw): { id: string; name: string; pic: string; sub: string } {
  const creator = (p.creator ?? {}) as WeapiRaw;
  return {
    id: String(p.id ?? ''),
    name: String(p.name ?? '未命名歌单'),
    pic: safeAvatar(String(p.picUrl ?? p.coverImgUrl ?? '')),
    sub: creator.nickname ? `by ${creator.nickname}` : `${p.playCount ?? p.playcount ?? 0} 次播放`,
  };
}

/** 搜索结果按分类映射成卡片；type=1 单曲特殊走 Track */
function mapSearchItems(kind: SearchTab, result: WeapiRaw): SearchItem[] {
  const safe = (u: unknown) => safeAvatar(String(u ?? ''));
  if (kind === '1') {
    return ((result.songs ?? []) as WeapiRaw[]).map((s) => {
      const al = (s.album ?? {}) as WeapiRaw;
      const ar = (s.artists ?? s.ar ?? []) as WeapiRaw[];
      return {
        id: String(s.id ?? ''),
        name: String(s.name ?? ''),
        pic: safe(al.pic ?? al.picUrl),
        sub: ar.map((a) => String(a.name ?? '')).join(' / ') || '未知艺人',
        extra: String(al.name ?? ''),
      };
    });
  }
  if (kind === '10') {
    return ((result.albums ?? []) as WeapiRaw[]).map((a) => ({
      id: String(a.id ?? ''),
      name: String(a.name ?? ''),
      pic: safe(a.picUrl),
      sub: String((a.artist as WeapiRaw)?.name ?? a.artists?.[0]?.name ?? '未知艺人'),
      extra: a.publishTime ? new Date(Number(a.publishTime)).getFullYear().toString() : '',
    }));
  }
  if (kind === '100') {
    return ((result.artists ?? []) as WeapiRaw[]).map((a) => ({
      id: String(a.id ?? ''),
      name: String(a.name ?? ''),
      pic: safe(a.picUrl),
      sub: String(a.briefDesc ?? '歌手'),
    }));
  }
  if (kind === '1000') {
    return ((result.playlists ?? []) as WeapiRaw[]).map((p) => ({
      id: String(p.id ?? ''),
      name: String(p.name ?? ''),
      pic: safe(p.coverImgUrl),
      sub: `by ${String((p.creator as WeapiRaw)?.nickname ?? '云村')}`,
      extra: String(p.playCount ?? ''),
    }));
  }
  return ((result.userprofiles ?? []) as WeapiRaw[]).map((u) => ({
    id: String(u.userId ?? ''),
    name: String(u.nickname ?? ''),
    pic: safe(u.avatarUrl),
    sub: String(u.signature ?? '这位云村村民很低调'),
  }));
}

/* ---- GD Studio 公共网关 ---- */

async function gdPlaylist(cfg: Config, id: string): Promise<PlaylistData> {
  const u = buildUrl(cfg, { types: 'playlist', source: 'netease', id });
  const r = await fetchJson<RawPlaylistResponse>(u);
  const p = r?.playlist;
  if (!p) throw new Error('歌单接口返回为空');
  return {
    id,
    name: p.name ?? `歌单 #${id}`,
    cover: p.coverImgUrl ?? '',
    desc: p.description ?? '',
    tracks: (p.tracks ?? []).map(mapSong),
  };
}

async function gdSearch(cfg: Config, kw: string): Promise<Track[]> {
  const u = buildUrl(cfg, { types: 'search', source: 'netease', name: kw, count: 30, pages: 1 });
  const arr = await fetchJson<RawSearchItem[]>(u);
  if (!Array.isArray(arr)) throw new Error('搜索接口返回异常');
  return arr.map((s) => ({
    id: String(s.id ?? ''),
    name: s.name ?? '未知歌曲',
    artist: Array.isArray(s.artist) ? s.artist.join(' / ') : s.artist ?? '未知艺人',
    album: s.album ?? '',
    pic: '',
    duration: 0,
    vip: false,
  }));
}

async function gdUrl(cfg: Config, id: string, br = 320): Promise<string | null> {
  const r = await fetchJson<{ url?: string }>(
    buildUrl(cfg, { types: 'url', source: 'netease', id, br }),
  );
  return r?.url || null;
}

async function gdLyric(cfg: Config, id: string): Promise<string> {
  try {
    const r = await fetchJson<{ lyric?: string }>(
      buildUrl(cfg, { types: 'lyric', source: 'netease', id }),
    );
    return r?.lyric ?? '';
  } catch {
    return '';
  }
}

async function gdPic(cfg: Config, id: string): Promise<string> {
  try {
    const r = await fetchJson<{ url?: string }>(
      buildUrl(cfg, { types: 'pic', source: 'netease', id, size: 300 }),
    );
    return r?.url ?? '';
  } catch {
    return '';
  }
}

/* ---- 自建 NeteaseCloudMusicApi 兜底 ---- */

function ncmBase(cfg: Config): string {
  return cfg.gateway.replace(/\/+$/, '');
}

async function ncmPlaylist(cfg: Config, id: string): Promise<PlaylistData> {
  const r = await fetchJson<RawPlaylistResponse>(`${ncmBase(cfg)}/playlist/detail?id=${id}`);
  const p = r?.playlist;
  if (!p) throw new Error('自建 API 歌单返回为空');
  return {
    id,
    name: p.name ?? `歌单 #${id}`,
    cover: p.coverImgUrl ?? '',
    desc: p.description ?? '',
    tracks: (p.tracks ?? []).map(mapSong),
  };
}

async function ncmSearch(cfg: Config, kw: string): Promise<Track[]> {
  const r = await fetchJson<RawNCMSearchResponse>(
    `${ncmBase(cfg)}/search?keywords=${encodeURIComponent(kw)}&limit=30`,
  );
  return (r?.result?.songs ?? []).map(mapSong);
}

async function ncmUrl(cfg: Config, id: string, br = 320): Promise<string | null> {
  const r = await fetchJson<{ data?: { url?: string }[] }>(
    `${ncmBase(cfg)}/song/url?id=${id}&br=${br}`,
  );
  return r?.data?.[0]?.url || null;
}

async function ncmLyric(cfg: Config, id: string): Promise<string> {
  try {
    const r = await fetchJson<{ lrc?: { lyric?: string } }>(`${ncmBase(cfg)}/lyric?id=${id}`);
    return r?.lrc?.lyric ?? '';
  } catch {
    return '';
  }
}

class MusicClient {
  constructor(private cfg: Config) {}

  playlist(id: string) {
    return this.cfg.kind === 'gdstudio' ? gdPlaylist(this.cfg, id) : ncmPlaylist(this.cfg, id);
  }

  search(kw: string) {
    return this.cfg.kind === 'gdstudio' ? gdSearch(this.cfg, kw) : ncmSearch(this.cfg, kw);
  }

  async url(id: string, br = 320): Promise<string | null> {
    return this.cfg.kind === 'gdstudio'
      ? gdUrl(this.cfg, id, br)
      : ncmUrl(this.cfg, id, br);
  }

  async lyric(id: string): Promise<string> {
    return this.cfg.kind === 'gdstudio' ? gdLyric(this.cfg, id) : ncmLyric(this.cfg, id);
  }

  async pic(id: string): Promise<string> {
    return this.cfg.kind === 'gdstudio' ? gdPic(this.cfg, id) : '';
  }
}

/** 当前网关失败时自动回退到默认公共网关，并把可用的那个记下来 */
async function withFallback<T>(
  cfg: Config,
  fn: (c: Config) => Promise<T>,
): Promise<{ value: T; cfg: Config }> {
  const candidates: Config[] = [cfg];
  if (cfg.gateway !== GD_STUDIO) candidates.push(DEFAULT_CONFIG);
  let lastErr: unknown = null;
  for (const c of candidates) {
    try {
      const value = await fn(c);
      if (c.gateway !== cfg.gateway || c.kind !== cfg.kind) persistConfig(c);
      return { value, cfg: c };
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr ?? new Error('所有音乐网关都不可用');
}

function parseLrc(raw: string): LyricLine[] {
  if (!raw) return [];
  const out: LyricLine[] = [];
  const re = /\[(\d+):(\d+(?:\.\d+)?)\](.*)/;
  for (const ln of raw.split(/\r?\n/)) {
    const m = re.exec(ln);
    if (!m) continue;
    const t = Number(m[1]) * 60 + Number(m[2]);
    const text = m[3].trim();
    if (text) out.push({ t, text });
  }
  return out.sort((a, b) => a.t - b.t);
}

function fmtTime(sec: number): string {
  if (!isFinite(sec) || sec < 0) return '0:00';
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

/* ============================ 静态展示数据 ============================ */

const NAV_MAIN = [
  { id: 'home', label: '推荐', icon: Music2 },
  { id: 'featured', label: '精选', icon: Radio },
  { id: 'podcast', label: '播客', icon: Disc3 },
  { id: 'roam', label: '漫游', icon: Share2 },
  { id: 'follow', label: '关注', icon: Heart },
];

const NAV_MY = [
  { id: 'liked', label: '我喜欢的音乐', icon: Heart },
  { id: 'recent', label: '最近播放', icon: ListMusic },
  { id: 'download', label: '下载管理', icon: ArrowRight },
  { id: 'local', label: '本地音乐', icon: Disc3 },
];

/** 真实公共歌单：全部实测可用，且不含任何个人账号歌单 */
const PUBLIC_PLAYLISTS = [
  { id: '3778678', name: '热歌榜', count: '1634.7万' },
  { id: '3779629', name: '新歌榜', count: '981.2万' },
  { id: '19723756', name: '飙升榜', count: '742.6万' },
  { id: '4395559', name: '华语金曲榜', count: '513.9万' },
  { id: '991319590', name: '中文说唱榜', count: '196.3万' },
  { id: '2884035', name: '原创榜', count: '96.1万' },
  { id: '71385707', name: '电影原声 · 冷门精选', count: '88.2万' },
];

/** 把歌单 ID 列表转成栏目里的可点条目 */
function channelItems(ids: string[]): { id: string; name: string }[] {
  return ids.map((id) => ({
    id,
    name: PUBLIC_PLAYLISTS.find((p) => p.id === id)?.name ?? `歌单 #${id}`,
  }));
}

/** 首页顶部 7 个入口卡：各自打开独立栏目，歌单组合互不重复 */
const ENTRY_CARDS = [
  { title: '每日推荐', desc: '根据你的口味生成', tone: '#ececf0', ink: '#333', ids: ['3778678', '3779629', '19723756'] },
  { title: '私人漫游', desc: '从熟悉的声音出发', tone: '#7b5cf0', ink: '#fff', ids: ['4395559', '2884035', '71385707'] },
  { title: '私人雷达', desc: '今天也要听点新的', tone: '#9dc3cf', ink: '#333', ids: ['3779629', '19723756', '991319590'] },
  { title: '音乐播客', desc: '用耳朵去旅行', tone: '#3f4a3c', ink: '#fff', ids: ['71385707', '4395559', '2884035'] },
  { title: '心动模式', desc: '跟着感觉走', tone: '#b4526b', ink: '#fff', ids: ['3778678', '4395559', '991319590'] },
  { title: '相似歌曲', desc: '从这首延伸出去', tone: '#d98b4a', ink: '#fff', ids: ['19723756', '2884035', '3779629'] },
  { title: '每日播客', desc: '每天一点新鲜事', tone: '#2d4a63', ink: '#fff', ids: ['991319590', '71385707', '3778678'] },
];

const RECOMMEND_PLAYLISTS = PUBLIC_PLAYLISTS;

const CHARTS = [
  { title: '飙升榜', gid: '19723756', hint: '每天更新' },
  { title: '新歌榜', gid: '3779629', hint: '每天更新' },
  { title: '热歌榜', gid: '3778678', hint: '每天更新' },
];

const BANNERS = [
  { title: '心鬼', sub: '新客首充', tone: 'linear-gradient(120deg,#2b3040,#4a5166)' },
  { title: '蕾丝彼点', sub: '副研活动', tone: 'linear-gradient(120deg,#f3d9dd,#e9b8c4)' },
  { title: 'GEEKBOI RAVE', sub: '新番连载', tone: 'linear-gradient(120deg,#c9d94a,#8fae33)' },
  { title: '无意', sub: '让天空为我们翻转', tone: 'linear-gradient(120deg,#353535,#1f1f1f)' },
];

/* ============================ 小组件 ============================ */

function IconButton({
  children,
  onClick,
  title,
  size = 30,
  active = false,
}: {
  children: ReactNode;
  onClick?: () => void;
  title?: string;
  size?: number;
  active?: boolean;
}) {
  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      style={{
        width: size,
        height: size,
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        borderRadius: 8,
        border: 'none',
        background: active ? 'var(--nm-red-soft)' : 'transparent',
        color: active ? 'var(--nm-red)' : 'var(--nm-muted)',
        cursor: 'pointer',
      }}
    >
      {children}
    </button>
  );
}

function SectionTitle({ title, extra }: { title: string; extra?: ReactNode }) {
  return (
    <div className="mb-3 flex items-center gap-1" style={{ color: 'var(--nm-text)' }}>
      <span style={{ fontSize: 17, fontWeight: 600 }}>{title}</span>
      <ChevronRight size={16} style={{ color: 'var(--nm-muted)' }} />
      {extra && <div className="ml-auto">{extra}</div>}
    </div>
  );
}

function PlaylistCard({
  title,
  cover,
  count,
  onClick,
}: {
  title: string;
  cover: string;
  count: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="group flex flex-col text-left"
      style={{ background: 'transparent', border: 'none', padding: 0, cursor: 'pointer', minWidth: 0 }}
    >
      <div
        style={{
          position: 'relative',
          width: '100%',
          aspectRatio: '1 / 1',
          borderRadius: 10,
          overflow: 'hidden',
          background: cover
            ? `url(${cover}) center / cover no-repeat, var(--nm-card)`
            : 'var(--nm-card)',
          border: '1px solid var(--nm-border)',
        }}
      >
        <span
          style={{
            position: 'absolute',
            top: 6,
            right: 8,
            fontSize: 10,
            color: '#fff',
            textShadow: '0 1px 3px rgba(0,0,0,.8)',
          }}
        >
          ▶ {count}
        </span>
        <span
          style={{
            position: 'absolute',
            right: 10,
            bottom: 10,
            width: 30,
            height: 30,
            borderRadius: '50%',
            background: 'rgba(255,255,255,.9)',
            color: 'var(--nm-red)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            transition: 'opacity .15s',
          }}
          className="opacity-0 group-hover:opacity-100"
        >
          <Play size={14} fill="currentColor" />
        </span>
      </div>
      <span
        className="mt-2 line-clamp-2"
        style={{ fontSize: 12, lineHeight: 1.45, color: 'var(--nm-text)' }}
      >
        {title}
      </span>
    </button>
  );
}

function TrackRow({
  index,
  track,
  active,
  liked,
  onPlay,
  onLike,
  onComment,
}: {
  index: number;
  track: Track;
  active: boolean;
  liked: boolean;
  onPlay: () => void;
  onLike: () => void;
  onComment?: () => void;
}) {
  return (
    <div
      onDoubleClick={onPlay}
      className="flex items-center gap-3 px-3"
      style={{
        height: 46,
        borderRadius: 6,
        background: active ? 'var(--nm-red-soft)' : 'transparent',
        color: active ? 'var(--nm-red)' : 'var(--nm-text)',
        fontSize: 12,
      }}
    >
      <span style={{ width: 26, textAlign: 'center', color: 'var(--nm-muted)', fontSize: 11 }}>
        {active ? (
          <span className="inline-flex gap-[2px]">
            <i style={{ width: 2, height: 9, background: 'var(--nm-red)' }} />
            <i style={{ width: 2, height: 13, background: 'var(--nm-red)' }} />
            <i style={{ width: 2, height: 7, background: 'var(--nm-red)' }} />
          </span>
        ) : (
          String(index + 1).padStart(2, '0')
        )}
      </span>
      <button
        type="button"
        onClick={onPlay}
        title="播放"
        style={{
          border: 'none',
          background: 'transparent',
          padding: 0,
          cursor: 'pointer',
          textAlign: 'left',
          minWidth: 0,
          flex: '1 1 40%',
          color: 'inherit',
        }}
      >
        <span className="flex items-center gap-2 truncate">
          <span className="truncate">{track.name}</span>
          {track.vip && (
            <span
              style={{
                fontSize: 9,
                border: '1px solid var(--nm-red)',
                color: 'var(--nm-red)',
                borderRadius: 3,
                padding: '0 3px',
                flexShrink: 0,
              }}
            >
              VIP
            </span>
          )}
        </span>
        <span className="truncate" style={{ fontSize: 11, color: 'var(--nm-muted)' }}>
          {track.artist}
        </span>
      </button>
      <span className="truncate" style={{ flex: '1 1 28%', color: 'var(--nm-sub)' }}>
        {track.album || '—'}
      </span>
      <button
        type="button"
        onClick={onLike}
        title="喜欢"
        style={{ border: 'none', background: 'transparent', cursor: 'pointer', padding: 4 }}
      >
        <Heart
          size={14}
          fill={liked ? 'var(--nm-red)' : 'none'}
          color={liked ? 'var(--nm-red)' : 'var(--nm-muted)'}
        />
      </button>
      {onComment && (
        <button
          type="button"
          onClick={onComment}
          title="查看这首歌的评论"
          style={{ border: 'none', background: 'transparent', cursor: 'pointer', padding: 4 }}
        >
          <MessageCircle size={14} color="var(--nm-muted)" />
        </button>
      )}
      <span style={{ width: 44, textAlign: 'right', color: 'var(--nm-muted)' }}>
        {track.duration ? fmtTime(track.duration) : '--:--'}
      </span>
    </div>
  );
}

/* ---------------------- 评论区 ---------------------- */

function CommentItem({ c }: { c: SongComment }) {
  const avatar = safeAvatar(c.user?.avatarUrl);
  const replied = c.beReplied?.[0];
  return (
    <div style={{ display: 'flex', gap: 10, padding: '12px 0', borderBottom: '1px solid var(--nm-border)' }}>
      <div
        style={{
          width: 32,
          height: 32,
          borderRadius: '50%',
          flexShrink: 0,
          background: avatar
            ? `url(${avatar}) center / cover no-repeat, var(--nm-card)`
            : 'var(--nm-card)',
          border: '1px solid var(--nm-border)',
        }}
      />
      <div style={{ minWidth: 0, flex: 1 }}>
        <div className="flex items-center gap-2" style={{ fontSize: 11 }}>
          <span className="truncate" style={{ color: 'var(--nm-sub)', fontWeight: 600 }}>
            {c.user?.nickname ?? '云村村民'}
          </span>
          <span style={{ marginLeft: 'auto', color: 'var(--nm-muted)', fontSize: 10, flexShrink: 0 }}>
            {c.timeStr ?? (c.time ? new Date(c.time).toLocaleDateString('zh-CN') : '')}
          </span>
        </div>
        {replied?.content && (
          <div style={{ marginTop: 6, padding: '5px 8px', borderRadius: 4, background: 'var(--nm-panel)', fontSize: 10, color: 'var(--nm-muted)', lineHeight: 1.5 }}>
            @{replied.user?.nickname ?? '某用户'}：{replied.content}
          </div>
        )}
        <p style={{ fontSize: 12, lineHeight: 1.7, color: 'var(--nm-text)', margin: '6px 0 0', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
          {c.content ?? ''}
        </p>
        <div className="flex items-center gap-1" style={{ marginTop: 8, fontSize: 10, color: 'var(--nm-muted)' }}>
          <ThumbsUp size={11} /> {c.likedCount ?? 0}
        </div>
      </div>
    </div>
  );
}

interface CommentDrawerProps {
  track: Track;
  tab: 'hot' | 'new';
  hot: SongComment[];
  latest: SongComment[];
  total: number;
  loading: boolean;
  error: string | null;
  more: boolean;
  onTab: (t: 'hot' | 'new') => void;
  onClose: () => void;
  onMore: () => void;
  onRetry: () => void;
  onLogin: () => void;
  loggedIn: boolean;
}

function CommentDrawer({
  track, tab, hot, latest, total, loading, error, more,
  onTab, onClose, onMore, onRetry, onLogin, loggedIn,
}: CommentDrawerProps) {
  const list = tab === 'hot' ? hot : latest;
  return (
    <div
      style={{
        position: 'absolute',
        top: 52,
        right: 0,
        bottom: 80,
        width: 380,
        maxWidth: '72%',
        zIndex: 35,
        background: 'var(--nm-bg)',
        borderLeft: '1px solid var(--nm-border)',
        boxShadow: '-12px 0 32px rgba(0,0,0,.25)',
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      <div style={{ padding: '14px 16px 10px', borderBottom: '1px solid var(--nm-border)' }}>
        <div className="flex items-center" style={{ fontSize: 14, fontWeight: 600 }}>
          <MessageCircle size={15} style={{ color: 'var(--nm-red)', marginRight: 7 }} />
          评论
          <span style={{ marginLeft: 6, fontSize: 11, fontWeight: 400, color: 'var(--nm-muted)' }}>
            {total > 0 ? `${total} 条` : ''}
          </span>
          <button
            type="button"
            onClick={onClose}
            title="关闭评论区"
            style={{ marginLeft: 'auto', border: 'none', background: 'transparent', color: 'var(--nm-muted)', cursor: 'pointer' }}
          >
            <X size={15} />
          </button>
        </div>
        <div className="truncate" style={{ fontSize: 11, color: 'var(--nm-sub)', marginTop: 6 }}>
          {track.name} · {track.artist}
        </div>
      </div>

      <div className="flex gap-2" style={{ padding: '10px 16px 0' }}>
        {([['hot', '精彩评论'], ['new', '最新评论']] as const).map(([key, label]) => (
          <button
            type="button"
            key={key}
            onClick={() => onTab(key)}
            style={{
              height: 26,
              padding: '0 12px',
              borderRadius: 13,
              border: '1px solid var(--nm-border)',
              background: tab === key ? 'var(--nm-red)' : 'transparent',
              color: tab === key ? '#fff' : 'var(--nm-sub)',
              fontSize: 11,
              cursor: 'pointer',
            }}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto" style={{ padding: '4px 16px 12px' }}>
        {loading && (
          <div className="flex items-center gap-2" style={{ color: 'var(--nm-muted)', fontSize: 12, padding: '16px 0' }}>
            <Loader2 size={14} className="animate-spin" /> 正在加载评论…
          </div>
        )}
        {!loading && error && (
          <div style={{ padding: '16px 0', fontSize: 12, color: 'var(--nm-red)' }}>
            <div>评论加载失败：{error}</div>
            <button
              type="button"
              onClick={onRetry}
              style={{ marginTop: 10, height: 28, padding: '0 12px', borderRadius: 14, border: '1px solid var(--nm-border)', background: 'transparent', color: 'var(--nm-sub)', fontSize: 11, cursor: 'pointer' }}
            >
              重试
            </button>
          </div>
        )}
        {!loading && !error && list.length === 0 && (
          <p style={{ color: 'var(--nm-muted)', fontSize: 12, padding: '16px 0' }}>
            {tab === 'hot' ? '这首歌暂时没有精彩评论，去「最新评论」看看。' : '这首歌还没有评论。'}
          </p>
        )}
        {list.map((c) => (
          <CommentItem key={String(c.commentId)} c={c} />
        ))}
        {tab === 'new' && more && !loading && (
          <button
            type="button"
            onClick={onMore}
            style={{ width: '100%', height: 32, marginTop: 12, borderRadius: 6, border: '1px solid var(--nm-border)', background: 'transparent', color: 'var(--nm-sub)', fontSize: 11, cursor: 'pointer' }}
          >
            加载更多评论
          </button>
        )}
      </div>

      {/* 当前版本只开放评论浏览，不做写操作，避免误发到你的账号 */}
      <div style={{ borderTop: '1px solid var(--nm-border)', padding: 12 }}>
        <div className="flex gap-2">
          <input
            disabled
            placeholder={loggedIn ? '评论发布暂未开放（避免误发到你的账号）' : '登录后才能发表评论'}
            style={{ flex: 1, minWidth: 0, height: 32, borderRadius: 16, border: '1px solid var(--nm-border)', background: 'var(--nm-panel)', color: 'var(--nm-text)', fontSize: 11, padding: '0 12px' }}
          />
          {!loggedIn && (
            <button
              type="button"
              onClick={onLogin}
              style={{ height: 32, padding: '0 14px', borderRadius: 16, border: 'none', background: 'var(--nm-red)', color: '#fff', fontSize: 11, cursor: 'pointer' }}
            >
              登录
            </button>
          )}
        </div>
        <div style={{ fontSize: 10, color: 'var(--nm-muted)', marginTop: 8, lineHeight: 1.6 }}>
          评论读取自网易云官方公开接口；发布 / 点赞等写操作未接入，避免误发到你的账号。
        </div>
      </div>
    </div>
  );
}

/** 黑胶唱片 + 唱针 */
function Vinyl({ cover, playing }: { cover: string; playing: boolean }) {
  return (
    <div style={{ position: 'relative', width: 300, height: 300, flexShrink: 0 }}>
      <div
        style={{
          position: 'absolute',
          inset: 0,
          borderRadius: '50%',
          background: 'repeating-radial-gradient(circle at 50% 50%, #111 0 3px, #1c1c1c 3px 6px)',
          boxShadow: '0 0 0 10px rgba(0,0,0,.18)',
          animation: playing ? 'spin-slow 12s linear infinite' : 'none',
          animationPlayState: playing ? 'running' : 'paused',
        }}
      >
        <div
          style={{
            position: 'absolute',
            inset: '22%',
            borderRadius: '50%',
            background: cover
              ? `url(${cover}) center / cover no-repeat, #444`
              : 'radial-gradient(circle,#666,#222)',
            border: '6px solid #0d0d0d',
          }}
        />
        <div
          style={{
            position: 'absolute',
            inset: '47%',
            borderRadius: '50%',
            background: '#111',
            border: '2px solid #2a2a2a',
          }}
        />
      </div>
      <div
        style={{
          position: 'absolute',
          top: -54,
          left: '50%',
          width: 12,
          height: 12,
          marginLeft: -6,
          borderRadius: '50%',
          background: '#f2f2f2',
          boxShadow: '0 0 0 4px #d9d9d9',
          zIndex: 2,
        }}
      />
      <div
        style={{
          position: 'absolute',
          top: -46,
          left: '50%',
          width: 6,
          height: 132,
          marginLeft: 0,
          borderRadius: 3,
          background: '#e8e8e8',
          transformOrigin: 'top center',
          transform: playing ? 'rotate(28deg)' : 'rotate(12deg)',
          transition: 'transform .5s ease',
          zIndex: 1,
        }}
      >
        <div
          style={{
            position: 'absolute',
            bottom: -6,
            left: -6,
            width: 18,
            height: 26,
            borderRadius: 5,
            background: '#f5f5f5',
          }}
        />
      </div>
    </div>
  );
}

/* ============================ 专辑 / 歌手 详情页 ============================ */

interface DetailPageData {
  kind: 'album' | 'artist' | 'user';
  title: string;
  pic: string;
  sub: string;
  desc?: string;
}

function DetailPage({
  data, tracks, activeId, liked, onPlay, onLike, onComment,
}: {
  data: DetailPageData;
  tracks: Track[];
  activeId?: string;
  liked: Set<string>;
  onPlay: (i: number) => void;
  onLike: (id: string) => void;
  onComment: (t: Track) => void;
  onOpenPlaylist: (id: string, name: string) => void;
}) {
  return (
    <>
      <div className="flex gap-6">
        <div
          style={{
            width: 176, height: 176, borderRadius: data.kind === 'artist' ? '50%' : 10,
            flexShrink: 0,
            background: data.pic ? `url(${data.pic}) center / cover no-repeat, var(--nm-card)` : 'var(--nm-card)',
            border: '1px solid var(--nm-border)',
          }}
        />
        <div className="min-w-0 flex-1">
          <div style={{ fontSize: 12, color: 'var(--nm-red)' }}>
            {data.kind === 'album' ? '专辑' : '歌手'}
          </div>
          <h1 style={{ fontSize: 24, fontWeight: 600, margin: '6px 0 10px' }}>{data.title}</h1>
          <div style={{ fontSize: 11, color: 'var(--nm-muted)' }}>{data.sub} · {tracks.length} 首</div>
          {data.desc && (
            <p className="line-clamp-3" style={{ fontSize: 11, color: 'var(--nm-sub)', marginTop: 10, lineHeight: 1.6 }}>
              {data.desc}
            </p>
          )}
          {tracks.length > 0 && (
            <button
              type="button"
              onClick={() => onPlay(0)}
              className="mt-4 flex items-center gap-2"
              style={{ height: 34, padding: '0 18px', borderRadius: 17, border: 'none', background: 'var(--nm-red)', color: '#fff', fontSize: 12, cursor: 'pointer' }}
            >
              <Play size={13} fill="currentColor" /> 播放全部
            </button>
          )}
        </div>
      </div>
      {tracks.length > 0 && (
        <div className="mt-6">
          <div className="flex items-center gap-3 px-3 pb-2" style={{ fontSize: 11, color: 'var(--nm-muted)', borderBottom: '1px solid var(--nm-border)' }}>
            <span style={{ width: 26 }}>#</span>
            <span style={{ flex: '1 1 40%' }}>标题</span>
            <span style={{ flex: '1 1 28%' }}>专辑</span>
            <span style={{ width: 26 }} />
            <span style={{ width: 44, textAlign: 'right' }}>时长</span>
          </div>
          <div className="mt-1">
            {tracks.map((t, i) => (
              <TrackRow
                key={`${t.id}-${i}`}
                index={i}
                track={t}
                active={activeId === t.id}
                liked={liked.has(t.id)}
                onPlay={() => onPlay(i)}
                onLike={() => onLike(t.id)}
                onComment={() => onComment(t)}
              />
            ))}
          </div>
        </div>
      )}
    </>
  );
}

/* ============================ 主组件 ============================ */

export default function NeteaseMusic({ context }: AppProps) {
  /* ---- 全局明暗主题（改一处全站变） ---- */
  const dark = useOSStore((s) => s.settings.darkMode);
  const updateSettings = useOSStore((s) => s.updateSettings);
  const toggleTheme = useCallback(() => updateSettings({ darkMode: !dark }), [dark, updateSettings]);

  /* ---- 配置 ---- */
  const [config, setConfig] = useState<Config>(loadConfig);
  const [showSettings, setShowSettings] = useState(false);
  const [showPlayerSettings, setShowPlayerSettings] = useState(false);
  const [gatewayInput, setGatewayInput] = useState(config.gateway);
  const clientCfgRef = useRef<Config>(config);
  useEffect(() => {
    clientCfgRef.current = config;
  }, [config]);

  /* ---- 播放器样式 / 播放设置（独立持久化） ---- */
  const [playerStyle, setPlayerStyle] = useState<PlayerStyle>(loadPlayerStyle);
  const styleRef = useRef<PlayerStyle>(playerStyle);
  useEffect(() => {
    styleRef.current = playerStyle;
    persistPlayerStyle(playerStyle);
  }, [playerStyle]);
  /** 局部更新样式，改完立即生效并落盘 */
  const patchPlayerStyle = (patch: Partial<PlayerStyle>) =>
    setPlayerStyle((s) => ({ ...s, ...patch }));
  /** 播放队列抽屉（沉浸页右上角图标） */
  const [showQueue, setShowQueue] = useState(false);
  /** 沉浸页全屏 */
  const immersiveRef = useRef<HTMLDivElement>(null);
  const [immersiveFull, setImmersiveFull] = useState(false);
  const toggleImmersiveFull = () => {
    const el = immersiveRef.current;
    if (!el) return;
    if (document.fullscreenElement) {
      void document.exitFullscreen().then(() => setImmersiveFull(false)).catch(() => {});
    } else {
      void el.requestFullscreen().then(() => setImmersiveFull(true)).catch(() => {});
    }
  };

  /* ---- 视图与数据 ---- */
  const [view, setView] = useState<View>('home');
  const [channel, setChannel] = useState<ChannelInfo | null>(null);
  const [activeNav, setActiveNav] = useState('home');
  const [showLogin, setShowLogin] = useState(false);
  const [chartPreviews, setChartPreviews] = useState<Record<string, string[]>>({});
  const [recentTracks, setRecentTracks] = useState<Track[]>([]);
  /** 见过的歌曲按 id 索引，供「我喜欢的音乐」栏目还原歌曲信息 */
  const [trackIndex, setTrackIndex] = useState<Record<string, Track>>({});
  const [recommendOffset, setRecommendOffset] = useState(0);
  /* ---- 评论区状态 ---- */
  const [commentTrack, setCommentTrack] = useState<Track | null>(null);
  const [commentTab, setCommentTab] = useState<'hot' | 'new'>('hot');
  const [hotComments, setHotComments] = useState<SongComment[]>([]);
  const [latestComments, setLatestComments] = useState<SongComment[]>([]);
  const [commentTotal, setCommentTotal] = useState(0);
  const [commentLoading, setCommentLoading] = useState(false);
  const [commentError, setCommentError] = useState<string | null>(null);
  const [commentOffset, setCommentOffset] = useState(0);
  const [commentMore, setCommentMore] = useState(false);
  /** 切歌时丢弃上一次的异步评论结果 */
  const commentTokenRef = useRef(0);
  /* ---- 官方扫码登录状态 ---- */
  const [profile, setProfile] = useState<NcmProfile | null>(null);
  const [userPlaylists, setUserPlaylists] = useState<UserPlaylist[]>([]);
  const [loginPhase, setLoginPhase] = useState<
    'idle' | 'loading' | 'qr' | 'scanned' | 'expired' | 'success' | 'error' | 'account'
  >('idle');
  const [qrDataUrl, setQrDataUrl] = useState('');
  const [qrKey, setQrKey] = useState('');
  const [loginMsg, setLoginMsg] = useState('');
  const [loginErr, setLoginErr] = useState<string | null>(null);
  const loginPollRef = useRef<number | null>(null);
  const loginAliveRef = useRef(false);
  const [playlist, setPlaylist] = useState<PlaylistData | null>(null);
  const [results, setResults] = useState<Track[]>([]);
  const [searchKw, setSearchKw] = useState('');
  const [activeTracks, setActiveTracks] = useState<Track[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /* ---- 导航历史栈（前进 / 后退 / logo 回首页） ---- */
  const [navStack, setNavStack] = useState<NavEntry[]>([{ view: 'home' }]);
  const [navIdx, setNavIdx] = useState(0);
  const canGoBack = navIdx > 0;
  const canGoForward = navIdx < navStack.length - 1;

  /* ---- 搜索分类 ---- */
  const [searchTab, setSearchTab] = useState<SearchTab>('1');
  const [searchItems, setSearchItems] = useState<SearchItem[]>([]);
  const [searchCounts, setSearchCounts] = useState<Partial<Record<SearchTab, number>>>({});

  /* ---- 官方每日推荐 / 歌单分类 ---- */
  const [dailySongs, setDailySongs] = useState<Track[]>([]);
  const [dailyPlaylists, setDailyPlaylists] = useState<SearchItem[]>([]);
  const [categories, setCategories] = useState<PlaylistCategory[]>([]);
  const [categoryTracks, setCategoryTracks] = useState<SearchItem[]>([]);
  const [detailView, setDetailView] = useState<{
    kind: 'album' | 'artist' | 'user';
    id: string;
    title: string;
    pic: string;
    sub: string;
    tracks: Track[];
    desc?: string;
  } | null>(null);
  /** 登录态下「我喜欢的音乐」对应的官方歌单 id（specialType=5） */
  const [likedPlaylistId, setLikedPlaylistId] = useState('');

  /* ---- 播放状态 ---- */
  const audioRef = useRef<HTMLAudioElement>(null);
  /**
   * 播放真相源：正在播的那一份列表快照 + 其中的下标。
   * 与「当前浏览的列表 activeTracks / currentIdx」刻意分离——
   * 切歌单 / 搜索 / 打开专辑时 activeTracks 会被覆盖，但正在播的歌不应受影响
   * （官方行为：切页面不打断播放，播放信息始终对应当前这首歌）。
   */
  const [playQueue, setPlayQueue] = useState<Track[]>([]);
  const [playIdx, setPlayIdx] = useState(-1);
  const [playUrl, setPlayUrl] = useState<string | null>(null);
  const [loadingTrack, setLoadingTrack] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [position, setPosition] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(0.8);
  const [muted, setMuted] = useState(false);
  const [repeatMode, setRepeatMode] = useState<RepeatMode>('list');
  const [liked, setLiked] = useState<Set<string>>(new Set());
  const [showPlayer, setShowPlayer] = useState(false);
  const [lyrics, setLyrics] = useState<LyricLine[]>([]);
  const [activeLyricIdx, setActiveLyricIdx] = useState(-1);
  const lyricScrollRef = useRef<HTMLDivElement>(null);

  /* 异步取播放链接时用户可能又点了别的歌，用令牌丢掉过期结果 */
  const playTokenRef = useRef(0);
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  // 播放信息只认「播放快照」，切浏览列表不会让正在播的歌信息丢失 / 串台
  const current = playIdx >= 0 && playIdx < playQueue.length ? playQueue[playIdx] : null;

  /* ---------------------- 加载歌单 / 搜索 ---------------------- */
  const loadPlaylist = useCallback(
    async (id: string, keepView = false, override?: Config) => {
      setLoading(true);
      setError(null);
      try {
        const { value, cfg } = await withFallback(override ?? config, (c) =>
          new MusicClient(c).playlist(id),
        );
        if (!mountedRef.current) return;
        setConfig(cfg);
        setPlaylist(value);
        setActiveTracks(value.tracks);
        setTrackIndex((prev) => {
          const next = { ...prev };
          for (const t of value.tracks) next[t.id] = t;
          return next;
        });
        if (!keepView) {
          setView('playlist');
          setShowPlayer(false);
        }
        if (value.tracks.length === 0) setError('这个歌单暂时没有可展示的歌曲。');
      } catch (e) {
        // 公共网关偶发连接抖动，自动重试一次
        try {
          const { value, cfg } = await withFallback(override ?? config, (c) =>
            new MusicClient(c).playlist(id),
          );
          if (!mountedRef.current) return;
          setConfig(cfg);
          setPlaylist(value);
          setActiveTracks(value.tracks);
          setTrackIndex((prev) => {
            const next = { ...prev };
            for (const t of value.tracks) next[t.id] = t;
            return next;
          });
          if (!keepView) { setView('playlist'); setShowPlayer(false); }
          if (value.tracks.length === 0) setError('这个歌单暂时没有可展示的歌曲。');
        } catch (e2) {
          if (mountedRef.current) setError(`加载失败：${String((e2 as Error)?.message ?? e)}`);
        }
      } finally {
        if (mountedRef.current) setLoading(false);
      }
    },
    [config],
  );

  /*
   * 下面这一组导航 / 官方数据加载函数刻意用「普通箭头函数」而非 useCallback：
   * 它们互相引用（runSearch↔restoreNav、openSearchItem→playAt 等），
   * 用 useCallback 的依赖数组会在渲染期求值后置变量而触发 TDZ。
   * 普通函数只在事件 / effect 里被调用（渲染完成后），函数体延迟执行，天然安全。
   */

  /** 按分类搜索（官方 weapi），失败时单曲类回退 GD Studio */
  async function runSearch(kw: string, tab: SearchTab, onBeforeLoad?: () => void) {
    const trimmed = kw.trim();
    if (!trimmed) return;
    setLoading(true);
    setError(null);
    onBeforeLoad?.();
    try {
      const data = await ncmWeapi('/search/get', {
        s: trimmed,
        type: Number(tab),
        offset: 0,
        total: true,
        limit: 30,
      });
      if (!mountedRef.current) return;
      const result = (data.result ?? {}) as WeapiRaw;
      setSearchItems(mapSearchItems(tab, result));
      setSearchCounts({
        '1': Number(result.songCount ?? 0),
        '10': Number(result.albumCount ?? 0),
        '100': Number(result.artistCount ?? 0),
        '1000': Number(result.playlistCount ?? 0),
        '1002': Number(result.userprofileCount ?? 0),
      });
      if (tab === '1') {
        const tracks = ((result.songs ?? []) as WeapiRaw[]).map(mapOfficialSong);
        setResults(tracks);
        setActiveTracks(tracks);
        setTrackIndex((prev) => {
          const next = { ...prev };
          for (const t of tracks) next[t.id] = t;
          return next;
        });
      }
      setView('search');
      setShowPlayer(false);
      if ((result.songs?.length ?? result.albums?.length ?? result.artists?.length ?? result.playlists?.length ?? result.userprofiles?.length ?? 0) === 0) {
        setError('没有搜到相关内容，换个关键词或分类试试。');
      }
    } catch (e) {
      if (!mountedRef.current) return;
      if (tab === '1') {
        try {
          const { value, cfg } = await withFallback(config, (c) => new MusicClient(c).search(trimmed));
          if (!mountedRef.current) return;
          setConfig(cfg);
          setResults(value);
          setActiveTracks(value);
          setSearchItems(value.map((t) => ({ id: t.id, name: t.name, pic: t.pic, sub: t.artist })));
          setView('search');
          setError(null);
        } catch {
          setError(`搜索失败：${String((e as Error)?.message ?? e)}`);
        }
      } else {
        setError(`搜索失败：${String((e as Error)?.message ?? e)}`);
      }
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  }

  /** 搜索框回车：默认搜单曲 */
  async function doSearch(kw: string) {
    const trimmed = kw.trim();
    if (!trimmed) return;
    setSearchKw(trimmed);
    setSearchTab('1');
    await runSearch(trimmed, '1', () => pushNav({ view: 'search', searchKw: trimmed, searchTab: '1' }));
  }

  /* ==================== 导航历史栈 ==================== */

  function pushNav(entry: NavEntry) {
    setNavStack((prev) => [...prev.slice(0, navIdx + 1), entry]);
    setNavIdx((i) => i + 1);
  }

  /** 恢复某个历史快照 */
  function restoreNav(entry: NavEntry) {
    setView(entry.view);
    setShowPlayer(false);
    setChannel(entry.channel ?? null);
    setActiveNav(entry.channel?.id ?? (entry.view === 'home' ? 'home' : ''));
    if (entry.view === 'search') {
      setSearchKw(entry.searchKw ?? '');
      setSearchTab(entry.searchTab ?? '1');
      if (entry.searchKw) void runSearch(entry.searchKw, entry.searchTab ?? '1');
    } else if (entry.view === 'playlist' && entry.playlistId) {
      setActiveNav(`pl-${entry.playlistId}`);
      // 自己歌单用官方接口，公共榜单用公共网关
      const mine = userPlaylists.some((p) => p.id === entry.playlistId);
      if (mine && profile) void loadOfficialPlaylist(entry.playlistId, entry.playlistName);
      else void loadPlaylist(entry.playlistId, false);
    } else if (entry.view === 'album' && entry.albumId) {
      void openAlbum(entry.albumId, entry.title ?? '专辑', false);
    } else if (entry.view === 'artist' && entry.artistId) {
      void openArtist(entry.artistId, entry.title ?? '歌手', false);
    } else if (entry.view === 'user' && entry.userId) {
      void openUser(entry.userId, entry.title ?? '用户', false);
    } else if (entry.view === 'channel' && entry.channel) {
      const kind = entry.channel.kind;
      if (kind === 'categories') void loadCategories();
      if (kind === 'dailySongs' || kind === 'dailyPl') void loadDailyData();
      if (kind === 'catList' && entry.channel.catName) void loadCategoryPlaylists(entry.channel.catName);
    }
  }

  function goBack() {
    if (!canGoBack) return;
    const next = navIdx - 1;
    setNavIdx(next);
    restoreNav(navStack[next]);
  }

  function goForward() {
    if (!canGoForward) return;
    const next = navIdx + 1;
    setNavIdx(next);
    restoreNav(navStack[next]);
  }

  /** logo：刷新首页数据并回到首页 */
  function goHome() {
    setView('home');
    setActiveNav('home');
    setChannel(null);
    setShowPlayer(false);
    setError(null);
    setRecommendOffset(0);
    if (navStack[navIdx]?.view !== 'home') pushNav({ view: 'home' });
    void loadPlaylist('3778678', true);
    void loadDailyData();
  }

  /* ==================== 官方数据加载 ==================== */

  /** 每日推荐歌曲 + 每日推荐歌单（登录态），供首页入口卡与栏目用 */
  async function loadDailyData() {
    if (!profile) return;
    try {
      const [songsRes, plRes] = await Promise.all([
        ncmWeapi('/v2/discovery/recommend/songs', { limit: 30 }, true),
        ncmWeapi('/v1/discovery/recommend/resource', {}, true),
      ]);
      if (!mountedRef.current) return;
      setDailySongs(((songsRes.data?.dailySongs ?? []) as WeapiRaw[]).map(mapOfficialSong));
      setDailyPlaylists(((plRes.recommend ?? []) as WeapiRaw[]).map(mapOfficialPlaylist));
    } catch {
      /* 每日推荐失败不影响其它功能，入口卡继续用兜底封面 */
    }
  }

  /** 歌单分类广场 */
  async function loadCategories() {
    try {
      const data = await ncmWeapi('/playlist/catalogue');
      if (!mountedRef.current) return;
      const subs = (data.sub ?? []) as WeapiRaw[];
      setCategories(subs.map((s) => ({ name: String(s.name ?? ''), category: Number(s.category ?? 0), hot: !!s.hot })));
    } catch (e) {
      if (mountedRef.current) setError(`分类加载失败：${String((e as Error)?.message ?? e)}`);
    }
  }

  /** 某个分类下的歌单列表 */
  async function loadCategoryPlaylists(cat: string) {
    setLoading(true);
    setError(null);
    try {
      const data = await ncmWeapi('/playlist/list', { cat, order: 'hot', limit: 30, offset: 0, total: true });
      if (!mountedRef.current) return;
      setCategoryTracks(((data.playlists ?? []) as WeapiRaw[]).map(mapOfficialPlaylist));
      setView('channel');
      setShowPlayer(false);
    } catch (e) {
      if (mountedRef.current) setError(`歌单列表加载失败：${String((e as Error)?.message ?? e)}`);
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  }

  /** 打开专辑：把专辑歌曲当成一个歌单展示 */
  async function openAlbum(id: string, title: string, record = true) {
    setLoading(true);
    setError(null);
    if (record) pushNav({ view: 'album', albumId: id, title });
    try {
      const data = await ncmWeapi(`/v1/album/${id}`);
      if (!mountedRef.current) return;
      const alb = (data.album ?? {}) as WeapiRaw;
      const tracks = ((data.songs ?? []) as WeapiRaw[]).map(mapOfficialSong);
      setDetailView({
        kind: 'album', id, title: String(alb.name ?? title),
        pic: safeAvatar(String(alb.picUrl ?? '')),
        sub: `专辑 · ${String((alb.artist as WeapiRaw)?.name ?? alb.artists?.[0]?.name ?? '群星')}`,
        tracks, desc: String(alb.description ?? ''),
      });
      setActiveTracks(tracks);
      setView('album');
      setShowPlayer(false);
    } catch (e) {
      if (mountedRef.current) setError(`专辑加载失败：${String((e as Error)?.message ?? e)}`);
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  }

  /** 打开歌手：简介 + 热门歌曲 */
  async function openArtist(id: string, title: string, record = true) {
    setLoading(true);
    setError(null);
    if (record) pushNav({ view: 'artist', artistId: id, title });
    try {
      const data = await ncmWeapi(`/v1/artist/${id}`);
      if (!mountedRef.current) return;
      const art = (data.artist ?? {}) as WeapiRaw;
      const tracks = ((data.hotSongs ?? []) as WeapiRaw[]).map(mapOfficialSong);
      setDetailView({
        kind: 'artist', id, title: String(art.name ?? title),
        pic: safeAvatar(String(art.picUrl ?? '')), sub: '歌手 · 热门歌曲',
        tracks, desc: String(art.briefDesc ?? ''),
      });
      setActiveTracks(tracks);
      setView('artist');
      setShowPlayer(false);
    } catch (e) {
      if (mountedRef.current) setError(`歌手加载失败：${String((e as Error)?.message ?? e)}`);
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  }

  /** 打开用户：简介 + 该用户歌单 */
  async function openUser(id: string, title: string, record = true) {
    setLoading(true);
    setError(null);
    if (record) pushNav({ view: 'user', userId: id, title });
    try {
      const [detail, pl] = await Promise.all([
        ncmWeapi(`/v1/user/detail/${id}`),
        ncmWeapi('/user/playlist', { uid: id, limit: 30, offset: 0 }),
      ]);
      if (!mountedRef.current) return;
      const pf = (detail.profile ?? {}) as WeapiRaw;
      const plays = ((pl.playlist ?? []) as WeapiRaw[]).slice(0, 12).map(mapOfficialPlaylist);
      setDetailView({
        kind: 'user', id, title: String(pf.nickname ?? title),
        pic: safeAvatar(String(pf.avatarUrl ?? '')),
        sub: `Lv.${detail.level ?? '?'} · ${plays.length} 张歌单`,
        tracks: [], desc: String(pf.signature ?? ''),
      });
      setSearchItems(plays);
      setView('user');
      setShowPlayer(false);
    } catch (e) {
      if (mountedRef.current) setError(`用户加载失败：${String((e as Error)?.message ?? e)}`);
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  }

  /** 搜索结果卡片点击分发 */
  function openSearchItem(tab: SearchTab, item: SearchItem) {
    if (tab === '1') {
      const idx = results.findIndex((t) => t.id === item.id);
      if (idx >= 0) void playAt(idx);
    } else if (tab === '10') {
      void openAlbum(item.id, item.name);
    } else if (tab === '100') {
      void openArtist(item.id, item.name);
    } else if (tab === '1000') {
      setActiveNav(`pl-${item.id}`);
      pushNav({ view: 'playlist', playlistId: item.id, playlistName: item.name });
      // 公开歌单：登录时优先官方接口，失败回退公共网关
      if (profile) void loadOfficialPlaylist(item.id, item.name, true);
      else void loadPlaylist(item.id, false);
    } else {
      void openUser(item.id, item.name);
    }
  }

  /* 启动：拉一份默认歌单让播放条有歌可点；同时分别预取三个榜单的前几首，
     否则首页三张榜单卡会共用同一组歌（都截自默认歌单），看着像没换内容。 */
  useEffect(() => {
    void loadPlaylist('3778678', true);
    let alive = true;
    void (async () => {
      const entries = await Promise.all(
        CHARTS.map(async (c) => {
          try {
            const p = await new MusicClient(clientCfgRef.current).playlist(c.gid);
            return [c.gid, p.tracks.slice(0, 3).map((t) => t.name)] as const;
          } catch {
            return [c.gid, [] as string[]] as const;
          }
        }),
      );
      if (alive) setChartPreviews(Object.fromEntries(entries));
    })();
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* ---------------------- 播放 ---------------------- */
  const playAt = useCallback(
    async (idx: number, list?: Track[], internal = false) => {
      /* 允许栏目页（红心 / 最近播放）自带一份播放列表，否则会读到旧的 activeTracks。
       * internal=true 表示「上一首/下一首/点队列」这类基于播放快照的内部切歌，
       * 此时不要把用户正在浏览的列表 activeTracks 也改掉。 */
      if (list && !internal) setActiveTracks(list);
      const source = list ?? activeTracks;
      const track = source[idx];
      if (!track?.id) return;
      setRecentTracks((prev) => [track, ...prev.filter((t) => t.id !== track.id)].slice(0, 50));
      const token = ++playTokenRef.current;
      const stale = () => token !== playTokenRef.current || !mountedRef.current;
      setError(null);
      // 快照这一份列表作为播放队列，之后切浏览列表不会污染正在播的歌
      setPlayQueue(source);
      setPlayIdx(idx);
      setPlayUrl(null);
      setLoadingTrack(true);
      setLyrics([]);
      setActiveLyricIdx(-1);
      try {
        const mc = new MusicClient(clientCfgRef.current);
        let [url, lyric, pic] = await Promise.all([
          mc.url(track.id, styleRef.current.quality),
          mc.lyric(track.id),
          track.pic ? Promise.resolve(track.pic) : mc.pic(track.id),
        ]);
        // 所选音质无可用地址时，自动降级到极高 320K 再试（对齐参考站行为）
        if (!url && styleRef.current.quality !== 320) {
          url = await mc.url(track.id, 320).catch(() => null);
        }
        if (stale()) return;
        if (pic && !track.pic) {
          // 按歌曲 id 补封面，不依赖下标（播放快照与浏览列表可能顺序不同）
          const patchById = (list: Track[]) =>
            list.map((t) => (t.id === track.id ? { ...t, pic } : t));
          // 播放快照总要更新；浏览列表仅在非内部切歌时同步，避免污染用户正在看的列表
          setPlayQueue((prev) => patchById(prev));
          if (!internal) {
            setActiveTracks((prev) => patchById(prev));
            setResults((prev) => (prev.length ? patchById(prev) : prev));
            setPlaylist((prev) => (prev ? { ...prev, tracks: patchById(prev.tracks) } : prev));
          }
        }
        if (!url) {
          setError('这首歌没有可用播放链接（VIP 独占 / 版权下架 / 网关未开放 URL 接口）。');
        } else {
          setPlayUrl(url);
          setPlaying(true);
          setLyrics(parseLrc(lyric));
        }
      } catch (e) {
        if (!stale()) setError(`播放失败：${String((e as Error)?.message ?? e)}`);
      } finally {
        if (!stale()) setLoadingTrack(false);
      }
    },
    [activeTracks],
  );

  const playPrev = useCallback(() => {
    if (playQueue.length === 0) return;
    // 按播放快照切歌，并把它作为列表传回，避免 playAt 误读被覆盖的 activeTracks
    const i = playIdx <= 0 ? playQueue.length - 1 : playIdx - 1;
    void playAt(i, playQueue, true);
  }, [playQueue, playIdx, playAt]);

  const playNext = useCallback(() => {
    if (playQueue.length === 0) return;
    let i: number;
    if (repeatMode === 'shuffle') i = Math.floor(Math.random() * playQueue.length);
    else i = playIdx >= playQueue.length - 1 ? 0 : playIdx + 1;
    void playAt(i, playQueue, true);
  }, [playQueue, playIdx, repeatMode, playAt]);

  /* ---------------------- audio 同步 ---------------------- */
  useEffect(() => {
    const a = audioRef.current;
    if (!a) return;
    if (playUrl && a.src !== playUrl) {
      a.src = playUrl;
      a.load();
    } else if (!playUrl) {
      a.removeAttribute('src');
    }
  }, [playUrl]);

  useEffect(() => {
    const a = audioRef.current;
    if (!a) return;
    if (playing && playUrl) {
      a.play().catch(() => setPlaying(false));
    } else {
      a.pause();
    }
  }, [playing, playUrl]);

  useEffect(() => {
    const a = audioRef.current;
    if (a) a.volume = muted ? 0 : volume;
  }, [volume, muted]);

  useEffect(() => {
    const a = audioRef.current;
    if (!a) return;
    const onEnded = () => {
      if (repeatMode === 'one') {
        a.currentTime = 0;
        void a.play();
      } else {
        playNext();
      }
    };
    a.addEventListener('ended', onEnded);
    return () => a.removeEventListener('ended', onEnded);
  }, [playNext, repeatMode]);

  /* ---------------------- 歌词滚动 ---------------------- */
  useEffect(() => {
    if (lyrics.length === 0) return;
    const a = audioRef.current;
    if (!a) return;
    const idx = lyrics.findIndex(
      (ln, i) => a.currentTime >= ln.t && (!lyrics[i + 1] || a.currentTime < lyrics[i + 1].t),
    );
    setActiveLyricIdx(idx);
    const el = lyricScrollRef.current;
    if (el && idx >= 0) {
      const lineEl = el.children[idx] as HTMLElement | undefined;
      if (lineEl) {
        el.scrollTo({
          top: lineEl.offsetTop - el.clientHeight / 2 + lineEl.clientHeight / 2,
          behavior: 'smooth',
        });
      }
    }
  }, [position, lyrics]);

  /* ---------------------- 快捷键 ---------------------- */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // 只有本应用窗口处于激活态才处理方向键，避免玩贪吃蛇等游戏时误切歌
      if (!isWindowActive(context.windowId)) return;
      if (['INPUT', 'TEXTAREA'].includes((e.target as HTMLElement)?.tagName)) return;
      if (e.code === 'Space') {
        e.preventDefault();
        setPlaying((p) => !p);
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault();
        playPrev();
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        playNext();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [playPrev, playNext, context.windowId]);

  const toggleLike = (id: string) =>
    setLiked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const seek = (e: MouseEvent<HTMLDivElement>) => {
    const a = audioRef.current;
    if (!a || !duration) return;
    const rect = e.currentTarget.getBoundingClientRect();
    a.currentTime = ((e.clientX - rect.left) / rect.width) * duration;
  };

  /* ---------------------- 官方扫码登录 ---------------------- */
  const stopLoginPoll = useCallback(() => {
    loginAliveRef.current = false;
    if (loginPollRef.current !== null) {
      window.clearInterval(loginPollRef.current);
      loginPollRef.current = null;
    }
  }, []);

  const loadUserPlaylists = useCallback(async () => {
    try {
      const data = await ncmApi<{ playlists?: UserPlaylist[] }>('/playlists');
      const list = data.playlists ?? [];
      setUserPlaylists(list);
      const liked = list.find((p) => p.specialType === 5) ?? list.find((p) => p.name.includes('喜欢的音乐'));
      setLikedPlaylistId(liked?.id ?? '');
    } catch {
      setUserPlaylists([]);
    }
  }, []);

  const startLoginQr = useCallback(async () => {
    stopLoginPoll();
    setLoginPhase('loading');
    setLoginErr(null);
    setQrDataUrl('');
    setQrKey('');
    setLoginMsg('正在向网易云申请登录二维码…');
    try {
      const data = await ncmApi<QrKeyResponse>('/qr/key');
      if (!data.url) throw new Error('接口没返回扫码链接');
      setQrDataUrl(makeQrDataUrl(data.url));
      setQrKey(data.unikey ?? '');
      setLoginPhase('qr');
      setLoginMsg('请用网易云音乐 App 扫码');
    } catch (e) {
      setLoginErr(String((e as Error)?.message ?? e));
      setLoginPhase('error');
      setLoginMsg('二维码获取失败');
    }
  }, [stopLoginPoll]);

  const openLogin = useCallback(async () => {
    setShowLogin(true);
    setLoginErr(null);
    setLoginPhase('idle');
    try {
      const st = await ncmApi<LoginStatusResponse>('/status');
      if (st.loggedIn && st.profile) {
        setProfile(st.profile);
        setLoginPhase('account');
        setLoginMsg('');
        void loadUserPlaylists();
      } else {
        setProfile(null);
        void startLoginQr();
      }
    } catch {
      setProfile(null);
      void startLoginQr();
    }
  }, [startLoginQr, loadUserPlaylists]);

  const doLogout = useCallback(async () => {
    stopLoginPoll();
    try {
      await ncmApi('/logout', { method: 'POST' });
    } catch {
      /* 本地仍按未登录处理 */
    }
    setProfile(null);
    setUserPlaylists([]);
    setQrDataUrl('');
    setQrKey('');
    setLoginPhase('idle');
    setLoginErr(null);
    setShowLogin(false);
  }, [stopLoginPoll]);

  /* 打开应用时静默恢复登录态（凭证在 Worker 侧，前端只拿到 profile） */
  useEffect(() => {
    void (async () => {
      try {
        const st = await ncmApi<LoginStatusResponse>('/status');
        if (st.loggedIn && st.profile) {
          setProfile(st.profile);
          void loadUserPlaylists();
        }
      } catch {
        /* 未登录，保持游客态 */
      }
    })();
  }, [loadUserPlaylists]);

  /* 一旦登录，自动拉每日推荐（首页入口卡封面 + 每日栏目数据） */
  useEffect(() => {
    if (profile) void loadDailyData();
  }, [profile]);

  /* 扫码轮询：801 继续等 / 802 待确认 / 803 成功 / 800 过期 */
  useEffect(() => {
    if (!showLogin || profile || !qrKey) return;
    loginAliveRef.current = true;
    const tick = async () => {
      if (!loginAliveRef.current) return;
      try {
        const data = await ncmApi<QrCheckResponse>(`/qr/check?key=${encodeURIComponent(qrKey)}`);
        if (!loginAliveRef.current) return;
        if (data.code === 803 || data.loggedIn) {
          stopLoginPoll();
          setProfile(data.profile ?? null);
          setLoginPhase('success');
          setLoginMsg(`登录成功${data.profile?.nickname ? `：${data.profile.nickname}` : ''}`);
          void loadUserPlaylists();
          return;
        }
        if (data.code === 800) {
          stopLoginPoll();
          setLoginPhase('expired');
          setLoginMsg('二维码已失效，点「刷新二维码」重新生成');
          return;
        }
        if (data.code === 802) {
          setLoginPhase('scanned');
          setLoginMsg(
            data.nickname
              ? `${data.nickname} 已扫码，请在手机上确认`
              : '扫描成功，请在手机上确认登录',
          );
          setLoginErr(null);
          return;
        }
        if (data.code === 801) {
          setLoginPhase('qr');
          setLoginMsg('等待扫码…');
          setLoginErr(null);
        }
      } catch (e) {
        if (loginAliveRef.current) {
          setLoginErr(`轮询失败：${String((e as Error)?.message ?? e)}`);
        }
      }
    };
    void tick();
    loginPollRef.current = window.setInterval(() => void tick(), 2200);
    return () => stopLoginPoll();
  }, [showLogin, profile, qrKey, stopLoginPoll, loadUserPlaylists]);

  /**
   * 登录后用官方接口读歌单。
   * 关键：失败时绝不静默回退 GD Studio 公共网关——公共网关对私人歌单
   * 会返回错误内容（曾导致「点自建歌单却显示我喜欢的音乐」的串台）。
   * 这里明确报错，让用户知道是这张歌单没读到，而不是偷偷换内容。
   */
  const loadOfficialPlaylist = useCallback(
    async (id: string, name?: string, allowPublicFallback = false) => {
      setLoading(true);
      setError(null);
      try {
        const data = await fetchOfficialPlaylist(id);
        if (!mountedRef.current) return;
        if (!data || data.tracks.length === 0) {
          if (allowPublicFallback) { setLoading(false); void loadPlaylist(id, false); return; }
          setError('这张歌单没有可展示的歌曲，或当前登录态无权访问。');
          setPlaylist({ id, name: name ?? `歌单 #${id}`, cover: '', desc: '', tracks: [] });
          return;
        }
        setPlaylist(data);
        setActiveTracks(data.tracks);
        setTrackIndex((prev) => {
          const next = { ...prev };
          for (const t of data.tracks) next[t.id] = t;
          return next;
        });
        setView('playlist');
        setShowPlayer(false);
      } catch (e) {
        if (!mountedRef.current) return;
        // 仅公开歌单（搜索 / 分类 / 每日推荐）允许回退公共网关；
        // 自建 / 收藏歌单绝不回退，避免串台。
        if (allowPublicFallback) { void loadPlaylist(id, false); return; }
        setError(`读取「${name ?? '这张歌单'}」失败：${String((e as Error)?.message ?? e)}`);
      } finally {
        if (mountedRef.current) setLoading(false);
      }
    },
    [loadPlaylist],
  );

  /** 打开某首歌的评论区：读官方公开热评 + 最新评论 */
  const openComments = useCallback(async (track: Track) => {
    if (!track?.id) return;
    const token = ++commentTokenRef.current;
    setCommentTrack(track);
    setCommentTab('hot');
    setHotComments([]);
    setLatestComments([]);
    setCommentTotal(0);
    setCommentOffset(0);
    setCommentMore(false);
    setCommentError(null);
    setCommentLoading(true);
    try {
      const data = await fetchSongComments(track.id, 0);
      if (token !== commentTokenRef.current) return;
      setHotComments(data.hotComments ?? []);
      setLatestComments(data.comments ?? []);
      setCommentTotal(data.total ?? 0);
      setCommentOffset((data.comments ?? []).length);
      setCommentMore(!!data.more);
    } catch (e) {
      if (token === commentTokenRef.current) setCommentError(String((e as Error)?.message ?? e));
    } finally {
      if (token === commentTokenRef.current) setCommentLoading(false);
    }
  }, []);

  const loadMoreComments = useCallback(async () => {
    const track = commentTrack;
    if (!track) return;
    const token = commentTokenRef.current;
    setCommentLoading(true);
    setCommentError(null);
    try {
      const data = await fetchSongComments(track.id, commentOffset);
      if (token !== commentTokenRef.current) return;
      const extra = data.comments ?? [];
      setLatestComments((prev) => [...prev, ...extra]);
      setCommentOffset((o) => o + extra.length);
      setCommentMore(!!data.more);
      if (data.total) setCommentTotal(data.total);
    } catch (e) {
      if (token === commentTokenRef.current) setCommentError(String((e as Error)?.message ?? e));
    } finally {
      if (token === commentTokenRef.current) setCommentLoading(false);
    }
  }, [commentTrack, commentOffset]);

  /** 打开独立栏目页：记录历史，登录态栏目顺带拉取真实数据 */
  const openChannel = (info: ChannelInfo) => {
    setChannel(info);
    setActiveNav(info.id);
    setView('channel');
    setShowPlayer(false);
    setError(null);
    pushNav({ view: 'channel', channel: info });
    if (info.kind === 'dailySongs' || info.kind === 'dailyPl') void loadDailyData();
    if (info.kind === 'categories') void loadCategories();
  };

  const submitSearch = () => {
    void doSearch(searchKw);
  };

  const saveGateway = () => {
    const url = gatewayInput.trim();
    const next: Config = url
      ? { gateway: url, kind: url === GD_STUDIO ? 'gdstudio' : 'netease-api' }
      : DEFAULT_CONFIG;
    persistConfig(next);
    setConfig(next);
    setShowSettings(false);
    void loadPlaylist(playlist?.id ?? '3778678', view === 'home', next);
  };

  const coverPalette = useMemo(
    () => (playlist?.tracks ?? []).slice(0, 8).map((t) => t.pic).filter(Boolean),
    [playlist],
  );

  /** 「换一批」真的把推荐歌单轮转，而不是偷偷再拉一次新歌榜 */
  const rotatedPlaylists = useMemo(
    () => [
      ...RECOMMEND_PLAYLISTS.slice(recommendOffset),
      ...RECOMMEND_PLAYLISTS.slice(0, recommendOffset),
    ],
    [recommendOffset],
  );

  /** 栏目页里的本地歌曲列表（红心 / 最近播放） */
  const channelTracks =
    channel?.local === 'liked'
      ? Object.values(trackIndex).filter((t) => liked.has(t.id))
      : channel?.local === 'recent'
        ? recentTracks
        : [];

  /* ============================ 渲染 ============================ */

  const rootStyle = {
    ...NM_THEME[dark ? 'dark' : 'light'],
    height: '100%',
    display: 'flex',
    flexDirection: 'column',
    background: 'var(--nm-bg)',
    color: 'var(--nm-text)',
    fontFamily:
      '-apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif',
    position: 'relative',
    overflow: 'hidden',
  } as CSSProperties;

  const navItem = (label: string, icon: ReactNode, active: boolean, onClick: () => void) => (
    <button
      type="button"
      key={label}
      onClick={onClick}
      className="flex w-full items-center gap-2.5"
      style={{
        height: 36,
        padding: '0 10px',
        borderRadius: 8,
        border: 'none',
        background: active ? 'var(--nm-red)' : 'transparent',
        color: active ? '#fff' : 'var(--nm-sub)',
        fontSize: 12,
        cursor: 'pointer',
        textAlign: 'left',
      }}
    >
      {icon}
      <span className="truncate">{label}</span>
    </button>
  );

  /* ---------------------- 沉浸式播放页（参考 YinXue Milayer） ---------------------- */
  const renderImmersivePlayer = () => {
    // 背景来源：跟随封面 / 自定义图 / 随机（从见过的封面里按曲目 id 稳定挑一张）
    let bg = current?.pic ?? '';
    if (playerStyle.bgSource === 'custom' && playerStyle.customBg) bg = playerStyle.customBg;
    if (playerStyle.bgSource === 'random') {
      const pool = Object.values(trackIndex).map((t) => t.pic).filter(Boolean);
      if (pool.length) bg = pool[Math.abs(String(current?.id ?? '').length * 7) % pool.length];
    }
    return (
      <div ref={immersiveRef} className="relative h-full min-h-0 overflow-hidden" style={{ isolation: 'isolate' }}>
        {/* 模糊背景层 */}
        <div
          aria-hidden
          style={{
            position: 'absolute', inset: -80, zIndex: -2,
            background: bg
              ? `url(${bg}) center / cover no-repeat`
              : 'linear-gradient(135deg,#2b3a67,#6a3b5a,#3a2b4f)',
            filter: `blur(${playerStyle.blur}px)`,
            transform: 'scale(1.15)',
          }}
        />
        <div
          aria-hidden
          style={{ position: 'absolute', inset: 0, zIndex: -1, background: `rgba(0,0,0,${playerStyle.dim})` }}
        />

        {/* 右上角工具：队列 / 全屏 / 外观设置 / 收起 */}
        <div className="absolute right-6 top-5 z-10 flex items-center gap-1.5">
          <IconButton title="播放队列" onClick={() => setShowQueue((v) => !v)} size={28} active={showQueue}>
            <ListMusic size={15} color="currentColor" />
          </IconButton>
          <IconButton title={immersiveFull ? '退出全屏' : '全屏播放'} onClick={toggleImmersiveFull} size={28} active={immersiveFull}>
            {immersiveFull ? <Minimize2 size={15} color="currentColor" /> : <Maximize2 size={15} color="currentColor" />}
          </IconButton>
          <IconButton title="外观与音质设置" onClick={() => setShowPlayerSettings((v) => !v)} size={28} active={showPlayerSettings}>
            <SlidersHorizontal size={15} color="currentColor" />
          </IconButton>
          <IconButton title="收起播放页" onClick={() => setShowPlayer(false)} size={28}>
            <ChevronRight size={17} color="currentColor" />
          </IconButton>
        </div>

        {/* 主体：左封面信息 + 右歌词 */}
        <div className="flex h-full" style={{ padding: '4% 6%' }}>
          {/* 左：封面 + 信息 + 控制 */}
          <div className="flex w-[42%] min-w-[280px] max-w-[420px] flex-col justify-center">
            <div
              style={{
                width: '100%', aspectRatio: '1 / 1', borderRadius: 16,
                background: current?.pic
                  ? `url(${safeAvatar(current.pic)}) center / cover no-repeat, #000`
                  : 'linear-gradient(135deg,#2b3a67,#6a3b5a)',
                boxShadow: '0 24px 60px rgba(0,0,0,.5)',
              }}
            />
            <div style={{ marginTop: 26, color: '#fff' }}>
              <div style={{ fontSize: 21, fontWeight: 700, letterSpacing: '.5px' }} className="truncate">
                {current?.name ?? '暂无播放'}
              </div>
              <div style={{ fontSize: 12, opacity: 0.72, marginTop: 7 }} className="truncate">
                {current?.artist || '未知艺人'} · {current?.album || '单曲'}
              </div>
            </div>
            {/* 极简进度条 */}
            <div className="flex items-center gap-2" style={{ marginTop: 22 }}>
              <span style={{ fontSize: 10, opacity: 0.7, width: 30 }}>{fmtTime(position)}</span>
              <div onClick={seek} style={{ flex: 1, height: 3, borderRadius: 2, background: 'rgba(255,255,255,.28)', cursor: 'pointer' }}>
                <div style={{ width: `${duration ? Math.min(100, (position / duration) * 100) : 0}%`, height: '100%', borderRadius: 2, background: playerStyle.accent }} />
              </div>
              <span style={{ fontSize: 10, opacity: 0.7, width: 30, textAlign: 'right' }}>{fmtTime(duration || current?.duration || 0)}</span>
            </div>
            {/* 控制条 */}
            <div className="flex items-center justify-center gap-6" style={{ marginTop: 18 }}>
              <button type="button" title={repeatMode === 'list' ? '列表循环' : repeatMode === 'one' ? '单曲循环' : '随机播放'} onClick={() => setRepeatMode((m) => (m === 'list' ? 'one' : m === 'one' ? 'shuffle' : 'list'))} style={{ border: 'none', background: 'transparent', color: '#fff', opacity: repeatMode !== 'list' ? 1 : 0.55, cursor: 'pointer', padding: 4 }}>
                {repeatMode === 'shuffle' ? <Shuffle size={16} /> : <Repeat size={16} />}
              </button>
              <button type="button" title="上一首" onClick={playPrev} style={{ border: 'none', background: 'transparent', color: '#fff', opacity: 0.85, cursor: 'pointer', padding: 4 }}>
                <SkipBack size={19} fill="currentColor" />
              </button>
              <button
                type="button"
                title={playing ? '暂停' : '播放'}
                onClick={() => (current ? setPlaying((p) => !p) : void playAt(0))}
                className="flex items-center justify-center"
                style={{ width: 50, height: 50, borderRadius: '50%', border: 'none', background: '#fff', color: '#111', cursor: 'pointer', boxShadow: '0 8px 24px rgba(0,0,0,.35)' }}
              >
                {loadingTrack ? <Loader2 size={20} className="animate-spin" /> : playing ? <Pause size={20} fill="currentColor" /> : <Play size={20} fill="currentColor" />}
              </button>
              <button type="button" title="下一首" onClick={playNext} style={{ border: 'none', background: 'transparent', color: '#fff', opacity: 0.85, cursor: 'pointer', padding: 4 }}>
                <SkipForward size={19} fill="currentColor" />
              </button>
              <button type="button" title={muted ? '取消静音' : '静音'} onClick={() => setMuted((v) => !v)} style={{ border: 'none', background: 'transparent', color: '#fff', opacity: 0.7, cursor: 'pointer', padding: 4 }}>
                {muted || volume === 0 ? <VolumeX size={16} /> : <Volume2 size={16} />}
              </button>
            </div>
          </div>

          {/* 右：大歌词 */}
          <div className="flex min-w-0 flex-1 items-center justify-center" style={{ paddingLeft: '6%' }}>
            <div
              ref={lyricScrollRef}
              className="w-full overflow-y-auto"
              style={{
                maxHeight: '80%', scrollbarWidth: 'none', textAlign: 'left',
                maskImage: 'linear-gradient(transparent,#000 18%,#000 82%,transparent)',
                perspective: '800px',
              }}
            >
              {lyrics.length === 0 ? (
                <div style={{ color: '#fff', opacity: 0.7, fontSize: 18 }}>
                  {current ? '暂无歌词，先听一会儿吧' : '点一首歌开始播放'}
                </div>
              ) : (
                lyrics.map((ln, i) => {
                  const active = i === activeLyricIdx;
                  return (
                    <div
                      key={`${ln.t}-${i}`}
                      style={{
                        fontSize: active ? playerStyle.lyricSize * playerStyle.lyricHighlight : playerStyle.lyricSize,
                        lineHeight: playerStyle.lyricGap,
                        margin: `${playerStyle.lyricSize * 0.3}px 0`,
                        color: playerStyle.accent,
                        fontWeight: active ? 700 : 500,
                        opacity: active ? 1 : 0.38,
                        transform: active && playerStyle.lyric3d ? 'rotateX(-8deg) translateX(6px)' : 'none',
                        transformOrigin: 'left center',
                        transition: 'font-size .25s, opacity .25s, transform .25s',
                        textShadow: active ? '0 2px 12px rgba(0,0,0,.4)' : 'none',
                        borderLeft: active ? `3px solid ${playerStyle.accent}` : '3px solid transparent',
                        paddingLeft: active ? 14 : 14,
                      }}
                    >
                      {ln.text || '\u00a0'}
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </div>

        {/* 播放队列抽屉 */}
        {showQueue && (
          <div className="absolute right-0 top-0 z-20 flex h-full flex-col" style={{ width: 320, background: 'rgba(12,14,22,.92)', backdropFilter: 'blur(20px)', borderLeft: '1px solid rgba(255,255,255,.12)' }}>
            <div className="flex items-center gap-2 px-4 py-3" style={{ borderBottom: '1px solid rgba(255,255,255,.1)', color: '#fff' }}>
              <ListMusic size={15} />
              <span style={{ fontSize: 13, fontWeight: 600 }}>播放队列 ({playQueue.length})</span>
              <button type="button" onClick={() => setShowQueue(false)} title="关闭队列" style={{ marginLeft: 'auto', border: 'none', background: 'transparent', color: '#fff', opacity: 0.7, cursor: 'pointer' }}><X size={16} /></button>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto" style={{ scrollbarWidth: 'none' }}>
              {playQueue.map((t, i) => (
                <button type="button" key={`${t.id}-${i}`} onClick={() => void playAt(i, playQueue, true)} className="flex w-full items-center gap-3 px-3 py-2 text-left" style={{ border: 'none', background: i === playIdx ? 'rgba(255,255,255,.1)' : 'transparent', cursor: 'pointer' }}>
                  <span style={{ fontSize: 11, opacity: 0.5, width: 18 }}>{i === playIdx ? '♪' : i + 1}</span>
                  <span style={{ flex: 1, minWidth: 0 }}>
                    <span className="block truncate" style={{ fontSize: 12, color: '#fff', fontWeight: i === playIdx ? 600 : 400 }}>{t.name}</span>
                    <span className="block truncate" style={{ fontSize: 10, opacity: 0.55, color: '#fff' }}>{t.artist}</span>
                  </span>
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    );
  };

  /* ---------------------- 播放外观 / 音质设置面板 ---------------------- */
  const sliderRow = (
    label: string, value: string, min: number, max: number, step: number,
    v: number, onChange: (n: number) => void,
  ) => (
    <div style={{ marginBottom: 16 }}>
      <div className="flex items-center justify-between" style={{ fontSize: 11, color: 'var(--nm-sub)', marginBottom: 7 }}>
        <span>{label}</span><span style={{ color: 'var(--nm-text)' }}>{value}</span>
      </div>
      <input type="range" min={min} max={max} step={step} value={v}
        onChange={(e) => onChange(Number(e.target.value))}
        style={{ width: '100%', accentColor: 'var(--nm-red)' }} />
    </div>
  );
  const segmentBtn = (on: boolean, children: ReactNode, onClick: () => void) => (
    <button type="button" onClick={onClick}
      style={{ flex: 1, height: 28, borderRadius: 6, border: 'none', fontSize: 11, cursor: 'pointer',
        background: on ? 'var(--nm-red)' : 'transparent', color: on ? '#fff' : 'var(--nm-muted)' }}>
      {children}
    </button>
  );
  const renderPlayerSettings = () => (
    <div className="absolute right-0 top-0 z-30 flex h-full flex-col" style={{ width: 300, background: 'var(--nm-side)', borderLeft: '1px solid var(--nm-border)', boxShadow: '-12px 0 32px rgba(0,0,0,.3)' }}>
      <div className="flex items-center px-4 py-3" style={{ borderBottom: '1px solid var(--nm-border)' }}>
        <span style={{ fontSize: 13, fontWeight: 600 }}>外观与音质</span>
        <button type="button" onClick={() => setShowPlayerSettings(false)} title="关闭设置" style={{ marginLeft: 'auto', border: 'none', background: 'transparent', color: 'var(--nm-muted)', cursor: 'pointer' }}><X size={16} /></button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4" style={{ scrollbarWidth: 'none' }}>
        {/* 播放样式 */}
        <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--nm-text)', marginBottom: 10 }}>播放样式</div>
        <div className="flex gap-1 mb-4" style={{ padding: 3, borderRadius: 8, background: 'var(--nm-hover)' }}>
          {segmentBtn(playerStyle.theme === 'immersive', '沉浸封面', () => patchPlayerStyle({ theme: 'immersive' }))}
          {segmentBtn(playerStyle.theme === 'classic', '经典黑胶', () => patchPlayerStyle({ theme: 'classic' }))}
        </div>

        {/* 音质 */}
        <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--nm-text)', marginBottom: 10 }}>播放音质</div>
        <select value={playerStyle.quality} onChange={(e) => patchPlayerStyle({ quality: Number(e.target.value) as Quality })}
          style={{ width: '100%', height: 32, marginBottom: 6, borderRadius: 6, border: '1px solid var(--nm-border)', background: 'var(--nm-card)', color: 'var(--nm-text)', fontSize: 11, padding: '0 8px' }}>
          {([128, 320, 999] as Quality[]).map((q) => <option key={q} value={q}>{QUALITY_LABEL[q]}</option>)}
        </select>
        <div style={{ fontSize: 10, color: 'var(--nm-muted)', lineHeight: 1.5, marginBottom: 18 }}>下次切歌时生效；所选音质无可用地址时会自动尝试较低码率。</div>

        {/* 外观：仅沉浸样式可调 */}
        {playerStyle.theme === 'immersive' && (
          <>
            <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--nm-text)', marginBottom: 10, paddingTop: 12, borderTop: '1px solid var(--nm-border)' }}>外观</div>
            <div style={{ fontSize: 10, color: 'var(--nm-muted)', marginBottom: 6 }}>背景来源</div>
            <div className="flex gap-1 mb-3" style={{ padding: 3, borderRadius: 8, background: 'var(--nm-hover)' }}>
              {segmentBtn(playerStyle.bgSource === 'cover', '跟随封面', () => patchPlayerStyle({ bgSource: 'cover' }))}
              {segmentBtn(playerStyle.bgSource === 'random', '随机图片', () => patchPlayerStyle({ bgSource: 'random' }))}
              {segmentBtn(playerStyle.bgSource === 'custom', '自定义', () => patchPlayerStyle({ bgSource: 'custom' }))}
            </div>
            {playerStyle.bgSource === 'custom' && (
              <label style={{ display: 'block', fontSize: 10, color: 'var(--nm-sub)', marginBottom: 12, cursor: 'pointer' }}>
                选择本地图片
                <input type="file" accept="image/*" onChange={(e) => {
                  const f = e.target.files?.[0]; if (!f) return;
                  const reader = new FileReader();
                  reader.onload = () => patchPlayerStyle({ customBg: String(reader.result ?? '') });
                  reader.readAsDataURL(f);
                }} style={{ width: '100%', marginTop: 6, fontSize: 10, color: 'var(--nm-muted)' }} />
              </label>
            )}
            <div style={{ fontSize: 10, color: 'var(--nm-muted)', marginBottom: 8 }}>主题色</div>
            <div className="flex items-center gap-2.5 mb-5" style={{ flexWrap: 'wrap' }}>
              {ACCENTS.map((c) => (
                <button key={c} type="button" title={c} onClick={() => patchPlayerStyle({ accent: c })}
                  style={{ width: 22, height: 22, borderRadius: '50%', border: playerStyle.accent === c ? `2px solid var(--nm-red)` : '2px solid transparent', background: c, cursor: 'pointer' }} />
              ))}
            </div>
            {sliderRow('背景模糊度', `${playerStyle.blur}px`, 0, 120, 2, playerStyle.blur, (n) => patchPlayerStyle({ blur: n }))}
            {sliderRow('黑色遮罩不透明度', `${Math.round(playerStyle.dim * 100)}%`, 0, 1, 0.05, playerStyle.dim, (n) => patchPlayerStyle({ dim: n }))}

            {/* 歌词 */}
            <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--nm-text)', marginBottom: 10, paddingTop: 12, borderTop: '1px solid var(--nm-border)' }}>歌词</div>
            <div className="flex items-center justify-between" style={{ fontSize: 11, color: 'var(--nm-sub)', marginBottom: 14 }}>
              <span>歌词 3D 倾斜效果</span>
              <button type="button" onClick={() => patchPlayerStyle({ lyric3d: !playerStyle.lyric3d })}
                style={{ width: 34, height: 18, borderRadius: 9, border: 'none', cursor: 'pointer', position: 'relative', background: playerStyle.lyric3d ? 'var(--nm-red)' : 'var(--nm-border)' }}>
                <span style={{ position: 'absolute', top: 2, left: playerStyle.lyric3d ? 18 : 2, width: 14, height: 14, borderRadius: '50%', background: '#fff', transition: 'left .15s' }} />
              </button>
            </div>
            {sliderRow('歌词字体大小', `${playerStyle.lyricSize}px`, 18, 56, 1, playerStyle.lyricSize, (n) => patchPlayerStyle({ lyricSize: n }))}
            {sliderRow('歌词行间距', playerStyle.lyricGap.toFixed(1), 1, 2.5, 0.1, playerStyle.lyricGap, (n) => patchPlayerStyle({ lyricGap: n }))}
            {sliderRow('歌词高亮放大度', playerStyle.lyricHighlight.toFixed(2), 1, 1.6, 0.05, playerStyle.lyricHighlight, (n) => patchPlayerStyle({ lyricHighlight: n }))}
          </>
        )}
      </div>
    </div>
  );

  return (
    <div style={rootStyle}>
      <audio
        ref={audioRef}
        onLoadedMetadata={(e) => setDuration(e.currentTarget.duration)}
        onTimeUpdate={(e) => setPosition(e.currentTarget.currentTime)}
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onError={() => {
          setError('播放失败：链接失效 / 浏览器拒绝解码 / 歌曲下架。');
          setPlaying(false);
        }}
      />

      {/* ---------------------------- 顶栏 ---------------------------- */}
      <header
        className="flex shrink-0 items-center gap-3 px-4"
        style={{ height: 52, background: 'var(--nm-top)', borderBottom: '1px solid var(--nm-border)' }}
      >
        {/* logo：点击刷新首页数据并跳回首页 */}
        <button
          type="button"
          onClick={goHome}
          title="点击刷新并回到首页"
          className="flex items-center gap-2"
          style={{ minWidth: 150, border: 'none', background: 'transparent', cursor: 'pointer', padding: 0, color: 'inherit' }}
        >
          <span
            className="flex items-center justify-center"
            style={{ width: 24, height: 24, borderRadius: '50%', background: 'var(--nm-red)', color: '#fff' }}
          >
            <Music2 size={14} />
          </span>
          <span style={{ fontSize: 14, fontWeight: 600 }}>网易云音乐</span>
          <RotateCw size={12} style={{ color: 'var(--nm-muted)' }} />
        </button>

        {/* 前进 / 后退（基于浏览历史） */}
        <div className="flex items-center gap-0.5">
          <IconButton title="返回上一级" onClick={goBack} size={26} active={canGoBack}>
            <span style={{ opacity: canGoBack ? 1 : 0.35 }}><ArrowLeft size={16} /></span>
          </IconButton>
          <IconButton title="前进下一级" onClick={goForward} size={26} active={canGoForward}>
            <span style={{ opacity: canGoForward ? 1 : 0.35 }}><ArrowRight size={16} /></span>
          </IconButton>
        </div>

        <form
          onSubmit={(e) => { e.preventDefault(); submitSearch(); }}
          className="relative"
          style={{ width: 260 }}
        >
          <Search
            size={14}
            style={{ position: 'absolute', left: 12, top: 9, color: 'var(--nm-muted)' }}
          />
          <input
            value={searchKw}
            onChange={(e) => setSearchKw(e.target.value)}
            placeholder="搜索音乐 / 歌手"
            style={{
              width: '100%',
              height: 32,
              borderRadius: 16,
              border: '1px solid var(--nm-border)',
              background: 'var(--nm-panel)',
              color: 'var(--nm-text)',
              fontSize: 12,
              padding: '0 14px 0 32px',
              outline: 'none',
            }}
          />
        </form>

        <div className="ml-auto flex items-center gap-1">
          {/* 首页也能直接切的明暗开关，改的是全站设置 */}
          <button
            type="button"
            onClick={toggleTheme}
            title={dark ? '切到亮色（全站生效）' : '切到暗色（全站生效）'}
            className="flex items-center gap-1.5"
            style={{
              height: 30,
              padding: '0 10px',
              borderRadius: 15,
              border: '1px solid var(--nm-border)',
              background: 'var(--nm-panel)',
              color: 'var(--nm-sub)',
              fontSize: 11,
              cursor: 'pointer',
            }}
          >
            {dark ? <Sun size={13} /> : <Moon size={13} />}
            {dark ? '亮色' : '暗色'}
          </button>
          <IconButton title="播放外观与音质" onClick={() => { setShowPlayerSettings((v) => !v); setShowPlayer(true); }} active={showPlayerSettings}>
            <SlidersHorizontal size={15} />
          </IconButton>
          <IconButton title="API 设置" onClick={() => setShowSettings((v) => !v)} active={showSettings}>
            <SettingsIcon size={15} />
          </IconButton>
          {/* 账号区：已登录显示真实头像 / 昵称，未登录给扫码登录入口 */}
          {profile ? (
            <button
              type="button"
              onClick={() => void openLogin()}
              title="查看我的账号"
              className="flex items-center gap-2"
              style={{ border: 'none', background: 'transparent', cursor: 'pointer', padding: 0 }}
            >
              <span
                className="flex items-center justify-center"
                style={{
                  width: 26,
                  height: 26,
                  borderRadius: '50%',
                  flexShrink: 0,
                  background: profile.avatarUrl
                    ? `url(${profile.avatarUrl}) center / cover no-repeat, var(--nm-red-soft)`
                    : 'var(--nm-red-soft)',
                  color: 'var(--nm-red)',
                  border: '1px solid var(--nm-border)',
                }}
              >
                {!profile.avatarUrl && <UserRound size={14} />}
              </span>
              <span className="truncate" style={{ fontSize: 11, color: 'var(--nm-sub)', maxWidth: 90 }}>
                {profile.nickname}
              </span>
              {profile.vipType > 0 && (
                <span style={{ fontSize: 9, color: 'var(--nm-red)', border: '1px solid var(--nm-red)', borderRadius: 3, padding: '0 3px' }}>
                  VIP
                </span>
              )}
            </button>
          ) : (
            <>
              <button
                type="button"
                onClick={() => void openLogin()}
                title="未登录 · 点击扫码登录"
                className="flex items-center gap-2"
                style={{ border: 'none', background: 'transparent', cursor: 'pointer', padding: 0 }}
              >
                <span
                  className="flex items-center justify-center"
                  style={{ width: 26, height: 26, borderRadius: '50%', background: 'var(--nm-red-soft)', color: 'var(--nm-red)' }}
                >
                  <UserRound size={14} />
                </span>
                <span style={{ fontSize: 11, color: 'var(--nm-sub)' }}>未登录</span>
              </button>
              <button
                type="button"
                onClick={() => void openLogin()}
                style={{ height: 28, padding: '0 14px', borderRadius: 14, border: 'none', background: 'var(--nm-red)', color: '#fff', fontSize: 11, cursor: 'pointer' }}
              >
                登录
              </button>
            </>
          )}
        </div>
      </header>

      {/* ---------------------------- 主体 ---------------------------- */}
      <div className="flex min-h-0 flex-1">
        {/* 左侧导航 */}
        <nav
          className="shrink-0 overflow-y-auto px-2 py-3"
          style={{ width: 168, background: 'var(--nm-side)', borderRight: '1px solid var(--nm-border)' }}
        >
          <div className="flex flex-col gap-0.5">
            {NAV_MAIN.map((n) => {
              const ch: ChannelInfo =
                n.id === 'featured'
                  ? { id: n.id, title: '歌单分类', desc: '按语种 / 风格 / 场景 / 情感 / 主题挑歌单，全部来自网易云官方分类。', kind: 'categories' }
                  : n.id === 'podcast'
                    ? { id: n.id, title: '播客', desc: '公共网关只提供音乐歌单，暂不支持播客音频流；这里先给你几张适合当背景声的歌单。', items: channelItems(['71385707', '4395559', '2884035']) }
                    : n.id === 'roam'
                      ? { id: n.id, title: '私人漫游', desc: '从你熟悉的声音出发，一路延伸。', needsLogin: !profile, kind: profile ? 'dailySongs' : 'links', items: channelItems(['4395559', '2884035', '71385707']) }
                      : { id: n.id, title: '关注', desc: '关注的人的动态与最新发布。', needsLogin: true, items: channelItems(['3779629', '19723756', '991319590']) };
              return navItem(n.label, <n.icon size={14} />, activeNav === n.id, () =>
                n.id === 'home' ? goHome() : openChannel(ch),
              );
            })}
          </div>

          <div style={{ fontSize: 10, color: 'var(--nm-muted)', padding: '16px 10px 6px' }}>
            我的音乐{profile ? '' : ' · 未登录'}
          </div>
          <div className="flex flex-col gap-0.5">
            {NAV_MY.map((n) =>
              navItem(n.label, <n.icon size={14} />, activeNav === n.id, () => {
                setActiveNav(n.id);
                // 已登录的「我喜欢的音乐」直接打开官方歌单（含全部红心）
                if (n.id === 'liked' && profile && likedPlaylistId) {
                  pushNav({ view: 'playlist', playlistId: likedPlaylistId, playlistName: '我喜欢的音乐' });
                  void loadOfficialPlaylist(likedPlaylistId, '我喜欢的音乐');
                  return;
                }
                openChannel({
                  id: n.id,
                  title: n.label,
                  desc:
                    n.id === 'download' || n.id === 'local'
                      ? '桌面版不提供下载与本地文件扫描，用顶部搜索框可以直接在线收听。'
                      : profile
                        ? '这部分是这台设备的本机记录，不与网易云账号同步。'
                        : '登录后可用全部红心；当前显示这台设备的本机记录。',
                  local: n.id === 'liked' ? 'liked' : n.id === 'recent' ? 'recent' : 'unsupported',
                });
              }),
            )}
          </div>

          {profile && (
            <>
              <div style={{ fontSize: 10, color: 'var(--nm-muted)', padding: '16px 10px 6px' }}>
                我的歌单 {userPlaylists.length > 0 ? `(${userPlaylists.length})` : ''}
              </div>
              <div className="flex flex-col gap-0.5">
                {userPlaylists.length === 0 ? (
                  <div style={{ fontSize: 10, color: 'var(--nm-muted)', padding: '0 10px' }}>
                    正在读取你的歌单…
                  </div>
                ) : (
                  userPlaylists.slice(0, 12).map((p) =>
                    navItem(p.name, <ListMusic size={14} />, activeNav === `mine-${p.id}`, () => {
                      setActiveNav(`mine-${p.id}`);
                      pushNav({ view: 'playlist', playlistId: p.id, playlistName: p.name });
                      void loadOfficialPlaylist(p.id, p.name);
                    }),
                  )
                )}
              </div>
            </>
          )}

          <div style={{ fontSize: 10, color: 'var(--nm-muted)', padding: '16px 10px 6px' }}>热门榜单</div>
          <div className="flex flex-col gap-0.5">
            {CHARTS.map((c) =>
              navItem(c.title, <span style={{ width: 14 }}>♪</span>, activeNav === `chart-${c.gid}`, () => {
                setActiveNav(`chart-${c.gid}`);
                void loadPlaylist(c.gid);
              }),
            )}
          </div>
        </nav>

        {/* 右侧内容 */}
        <main className="min-w-0 flex-1 overflow-y-auto" style={{ position: 'relative' }}>
          {showPlayer ? (
            /* ---------------------- 播放页（按样式分流） ---------------------- */
            playerStyle.theme === 'immersive' ? renderImmersivePlayer() : (
            <div
              className="flex h-full min-h-0"
              style={{ background: 'var(--nm-player-bg)', padding: '36px 6%' }}
            >
              <div className="flex flex-1 items-center justify-center" style={{ minWidth: 0 }}>
                <Vinyl cover={current?.pic ?? ''} playing={playing} />
              </div>
              <div className="flex flex-col" style={{ flex: '1 1 46%', minWidth: 0, paddingLeft: 32 }}>
                <div className="flex items-center gap-2">
                  <h2 style={{ fontSize: 22, fontWeight: 600, margin: 0 }}>{current?.name ?? '暂无播放'}</h2>
                  <button
                    type="button"
                    onClick={() => setShowPlayer(false)}
                    title="收起播放页"
                    style={{ marginLeft: 'auto', border: 'none', background: 'transparent', color: 'var(--nm-muted)', cursor: 'pointer' }}
                  >
                    <ChevronRight size={18} />
                  </button>
                </div>
                <div style={{ fontSize: 11, color: 'var(--nm-sub)', marginTop: 8 }}>
                  专辑：{current?.album || '—'} &nbsp;/&nbsp; 歌手：{current?.artist || '—'} &nbsp;/&nbsp; 来源：{playlist?.name ?? '在线播放'}
                </div>
                <div className="mt-3 flex gap-2">
                  <span style={{ fontSize: 10, padding: '3px 8px', borderRadius: 4, background: 'var(--nm-hover)', color: 'var(--nm-text)', border: '1px solid var(--nm-border)' }}>
                    歌词
                  </span>
                  <button
                    type="button"
                    onClick={() => current && void openComments(current)}
                    title="打开这首歌的评论区"
                    style={{ fontSize: 10, padding: '3px 8px', borderRadius: 4, background: 'transparent', color: 'var(--nm-sub)', border: '1px solid var(--nm-border)', cursor: 'pointer' }}
                  >
                    评论{commentTrack?.id === current?.id && commentTotal > 0 ? ` · ${commentTotal}` : ''}
                  </button>
                </div>
                <div
                  ref={lyricScrollRef}
                  className="mt-5 min-h-0 flex-1 overflow-y-auto"
                  style={{ scrollbarWidth: 'none', maskImage: 'linear-gradient(transparent,#000 12%,#000 88%,transparent)' }}
                >
                  {lyrics.length === 0 ? (
                    <p style={{ color: 'var(--nm-muted)', fontSize: 13 }}>
                      {current ? '暂无歌词，先听一会儿吧' : '点一首歌开始播放'}
                    </p>
                  ) : (
                    lyrics.map((ln, i) => (
                      <p
                        key={`${ln.t}-${i}`}
                        style={{
                          fontSize: i === activeLyricIdx ? 16 : 13,
                          lineHeight: 1.9,
                          margin: '10px 0',
                          color: i === activeLyricIdx ? 'var(--nm-text)' : 'var(--nm-muted)',
                          opacity: i === activeLyricIdx ? 1 : 0.65,
                          transition: 'font-size .2s',
                        }}
                      >
                        {ln.text}
                      </p>
                    ))
                  )}
                </div>
              </div>
            </div>
            )
          ) : (
            <div className="px-7 py-5">
              {/* 错误 / 加载提示 */}
              {error && (
                <div
                  className="mb-4 flex items-center gap-2 px-3 py-2"
                  style={{ borderRadius: 8, background: 'var(--nm-red-soft)', color: 'var(--nm-red)', fontSize: 12 }}
                >
                  <AlertCircle size={14} />
                  <span className="flex-1">{error}</span>
                  <button type="button" onClick={() => setError(null)} style={{ border: 'none', background: 'transparent', color: 'inherit', cursor: 'pointer' }}>
                    <X size={13} />
                  </button>
                </div>
              )}
              {loading && (
                <div className="mb-4 flex items-center gap-2" style={{ color: 'var(--nm-muted)', fontSize: 12 }}>
                  <Loader2 size={14} className="animate-spin" /> 正在加载…
                </div>
              )}

              {view === 'home' && (
                <>
                  {/* 顶部入口卡：登录后用每日推荐首图当封面（网易云惯例） */}
                  <div
                    className="grid gap-3"
                    style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(104px, 1fr))' }}
                  >
                    {ENTRY_CARDS.map((c, idx) => {
                      // 入口卡封面：优先每日推荐歌单，其次每日推荐歌曲首图
                      const cover = profile
                        ? (dailyPlaylists[idx]?.pic || dailySongs[idx]?.pic || '')
                        : (coverPalette[idx % Math.max(coverPalette.length, 1)] ?? '');
                      const isDaily = c.title === '每日推荐' || c.title === '私人雷达';
                      const kind: ChannelInfo['kind'] = isDaily ? 'dailySongs' : 'dailyPl';
                      return (
                        <button
                          type="button"
                          key={c.title}
                          onClick={() =>
                            openChannel({
                              id: `entry-${c.title}`,
                              title: c.title,
                              desc: c.desc,
                              needsLogin: !profile,
                              kind,
                              items: channelItems(c.ids),
                            })
                          }
                          className="flex flex-col text-left"
                          style={{ border: 'none', background: 'transparent', padding: 0, cursor: 'pointer', minWidth: 0 }}
                        >
                          <div
                            style={{
                              width: '100%',
                              aspectRatio: '1 / 1',
                              borderRadius: 10,
                              background: cover
                                ? `linear-gradient(rgba(0,0,0,.28),rgba(0,0,0,.5)), url(${cover}) center / cover no-repeat, ${c.tone}`
                                : c.tone,
                              color: cover ? '#fff' : c.ink,
                              padding: 9,
                              display: 'flex',
                              alignItems: 'flex-start',
                              fontSize: 12,
                              fontWeight: 600,
                              lineHeight: 1.35,
                              textShadow: cover ? '0 1px 4px rgba(0,0,0,.5)' : 'none',
                            }}
                          >
                            {c.title}
                          </div>
                          <span style={{ fontSize: 10, color: 'var(--nm-muted)', marginTop: 6 }} className="truncate">
                            {c.desc}
                          </span>
                        </button>
                      );
                    })}
                  </div>

                  {/* 推荐歌单：登录后用官方每日推荐歌单，可点进详情 */}
                  <div className="mt-7">
                    <SectionTitle
                      title="推荐歌单"
                      extra={
                        <div className="flex items-center gap-1">
                          <IconButton title="歌单分类广场" onClick={() =>
                            openChannel({ id: 'categories', title: '歌单分类', desc: '按语种 / 风格 / 场景 / 情感 / 主题挑歌单。', kind: 'categories' })
                          }>
                            <ListMusic size={14} />
                          </IconButton>
                          {!profile && (
                            <IconButton
                              title="换一批"
                              onClick={() => setRecommendOffset((o) => (o + 3) % RECOMMEND_PLAYLISTS.length)}
                            >
                              <Repeat size={14} />
                            </IconButton>
                          )}
                        </div>
                      }
                    />
                    <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(118px, 1fr))' }}>
                      {profile && dailyPlaylists.length > 0
                        ? dailyPlaylists.slice(0, 8).map((p) => (
                            <PlaylistCard
                              key={p.id}
                              title={p.name}
                              cover={p.pic}
                              count={p.sub}
                              onClick={() => { setActiveNav(`pl-${p.id}`); pushNav({ view: 'playlist', playlistId: p.id, playlistName: p.name }); if (profile) void loadOfficialPlaylist(p.id, p.name, true); else void loadPlaylist(p.id, false); }}
                            />
                          ))
                        : rotatedPlaylists.map((p, i) => (
                            <PlaylistCard
                              key={p.id}
                              title={p.name}
                              cover={coverPalette[i % Math.max(coverPalette.length, 1)] ?? ''}
                              count={p.count}
                              onClick={() => void loadPlaylist(p.id)}
                            />
                          ))}
                    </div>
                  </div>

                  {/* 精选活动 */}
                  <div className="mt-7">
                    <SectionTitle title="精选活动" />
                    <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))' }}>
                      {BANNERS.map((b) => (
                        <div
                          key={b.title}
                          style={{
                            height: 96,
                            borderRadius: 10,
                            background: b.tone,
                            padding: 12,
                            display: 'flex',
                            flexDirection: 'column',
                            justifyContent: 'center',
                            color: '#fff',
                          }}
                        >
                          <span style={{ fontSize: 15, fontWeight: 600, textShadow: '0 1px 4px rgba(0,0,0,.4)' }}>{b.title}</span>
                          <span style={{ fontSize: 10, marginTop: 8, opacity: 0.85, alignSelf: 'flex-end' }}>{b.sub}</span>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* 榜单 */}
                  <div className="mt-7 mb-4">
                    <SectionTitle title="榜单精选" />
                    <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))' }}>
                      {CHARTS.map((c) => (
                        <button
                          type="button"
                          key={c.title}
                          onClick={() => void loadPlaylist(c.gid)}
                          style={{
                            border: '1px solid var(--nm-border)',
                            background: 'var(--nm-card)',
                            borderRadius: 10,
                            padding: 12,
                            textAlign: 'left',
                            cursor: 'pointer',
                            color: 'var(--nm-text)',
                          }}
                        >
                          <div className="flex items-center">
                            <span style={{ fontSize: 14, fontWeight: 600 }}>{c.title}</span>
                            <span style={{ marginLeft: 'auto', fontSize: 10, color: 'var(--nm-muted)' }}>{c.hint}</span>
                          </div>
                          {(chartPreviews[c.gid] ?? []).slice(0, 3).map((name, i) => (
                            <div key={`${c.gid}-${i}`} className="mt-2 flex items-center gap-2 truncate" style={{ fontSize: 11 }}>
                              <span style={{ color: 'var(--nm-red)', width: 14 }}>{i + 1}</span>
                              <span className="truncate" style={{ color: 'var(--nm-sub)' }}>{name}</span>
                            </div>
                          ))}
                          {(chartPreviews[c.gid] ?? []).length === 0 && (
                            <div className="mt-2" style={{ fontSize: 10, color: 'var(--nm-muted)' }}>
                              榜单加载中或网关暂不可用…
                            </div>
                          )}
                        </button>
                      ))}
                    </div>
                  </div>
                </>
              )}

              {view === 'channel' && channel && (
                <>
                  <div className="flex items-start gap-3">
                    <div className="min-w-0 flex-1">
                      <h1 style={{ fontSize: 22, fontWeight: 600, margin: 0 }}>{channel.title}</h1>
                      <p style={{ fontSize: 12, color: 'var(--nm-sub)', margin: '8px 0 0', lineHeight: 1.6 }}>
                        {channel.desc}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={goHome}
                      style={{ height: 30, padding: '0 12px', borderRadius: 15, border: '1px solid var(--nm-border)', background: 'transparent', color: 'var(--nm-sub)', fontSize: 11, cursor: 'pointer', whiteSpace: 'nowrap' }}
                    >
                      返回推荐
                    </button>
                  </div>

                  {/* 未登录才提示；已登录不再显示「要登录」 */}
                  {channel.needsLogin && !profile && (
                    <div
                      className="mt-4 flex items-center gap-2 px-3 py-2.5"
                      style={{ borderRadius: 8, background: 'var(--nm-red-soft)', color: 'var(--nm-red)', fontSize: 12 }}
                    >
                      <AlertCircle size={14} />
                      <span className="flex-1">未登录：个性化推荐每天刷新，登录后即可看到专属内容。下面先给你可听的公共歌单。</span>
                      <button
                        type="button"
                        onClick={() => void openLogin()}
                        style={{ height: 24, padding: '0 12px', borderRadius: 12, border: 'none', background: 'var(--nm-red)', color: '#fff', fontSize: 11, cursor: 'pointer' }}
                      >
                        登录
                      </button>
                    </div>
                  )}

                  {/* 每日推荐歌曲（登录，官方每天刷新） */}
                  {channel.kind === 'dailySongs' && profile && (
                    <div className="mt-6 mb-4">
                      <SectionTitle title={`每日推荐 · ${dailySongs.length} 首`} extra={<span style={{ fontSize: 10, color: 'var(--nm-muted)' }}>每天更新</span>} />
                      {dailySongs.length === 0 ? (
                        <p style={{ fontSize: 12, color: 'var(--nm-muted)' }}>正在拉取今天的推荐…</p>
                      ) : (
                        dailySongs.map((t, i) => (
                          <TrackRow
                            key={`${t.id}-${i}`}
                            index={i}
                            track={t}
                            active={current?.id === t.id}
                            liked={liked.has(t.id)}
                            onPlay={() => void playAt(i, dailySongs)}
                            onLike={() => toggleLike(t.id)}
                            onComment={() => void openComments(t)}
                          />
                        ))
                      )}
                    </div>
                  )}

                  {/* 每日推荐歌单（登录） */}
                  {channel.kind === 'dailyPl' && profile && (
                    <div className="mt-6 mb-4">
                      <SectionTitle title={`每日推荐歌单 · ${dailyPlaylists.length} 张`} extra={<span style={{ fontSize: 10, color: 'var(--nm-muted)' }}>每天更新</span>} />
                      <div className="grid gap-4" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(148px, 1fr))' }}>
                        {dailyPlaylists.map((p) => (
                          <PlaylistCard
                            key={p.id}
                            title={p.name}
                            cover={p.pic}
                            count={p.sub}
                            onClick={() => { setActiveNav(`pl-${p.id}`); pushNav({ view: 'playlist', playlistId: p.id, playlistName: p.name }); if (profile) void loadOfficialPlaylist(p.id, p.name, true); else void loadPlaylist(p.id, false); }}
                          />
                        ))}
                      </div>
                    </div>
                  )}

                  {/* 歌单分类广场 */}
                  {channel.kind === 'categories' && (
                    <div className="mt-6 mb-4">
                      {(['热门', '语种', '风格', '场景', '情感', '主题'] as const).map((group) => {
                        const subs = categories.filter((c) =>
                          group === '热门' ? c.hot :
                          group === '语种' ? c.category === 0 :
                          group === '风格' ? c.category === 1 :
                          group === '场景' ? c.category === 2 :
                          group === '情感' ? c.category === 3 : c.category === 4,
                        );
                        if (subs.length === 0) return null;
                        return (
                          <div key={group} className="mb-5">
                            <SectionTitle title={group} />
                            <div className="flex flex-wrap gap-2">
                              {subs.map((s) => (
                                <button
                                  type="button"
                                  key={s.name}
                                  onClick={() => {
                                    const next: ChannelInfo = { id: `cat-${s.name}`, title: s.name, desc: `「${s.name}」分类下的热门歌单。`, kind: 'catList', catName: s.name };
                                    setChannel(next);
                                    pushNav({ view: 'channel', channel: next });
                                    void loadCategoryPlaylists(s.name);
                                  }}
                                  style={{ height: 30, padding: '0 14px', borderRadius: 15, border: '1px solid var(--nm-border)', background: 'var(--nm-card)', color: 'var(--nm-text)', fontSize: 12, cursor: 'pointer' }}
                                >
                                  {s.name}
                                </button>
                              ))}
                            </div>
                          </div>
                        );
                      })}
                      {categories.length === 0 && <p style={{ fontSize: 12, color: 'var(--nm-muted)' }}>正在加载分类…</p>}
                    </div>
                  )}

                  {/* 分类下的歌单列表 */}
                  {channel.kind === 'catList' && (
                    <div className="mt-6 mb-4">
                      <SectionTitle title={`${channel.catName ?? '分类'} · ${categoryTracks.length} 张`} />
                      <div className="grid gap-4" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(148px, 1fr))' }}>
                        {categoryTracks.map((p) => (
                          <PlaylistCard
                            key={p.id}
                            title={p.name}
                            cover={p.pic}
                            count={p.sub}
                            onClick={() => { setActiveNav(`pl-${p.id}`); pushNav({ view: 'playlist', playlistId: p.id, playlistName: p.name }); if (profile) void loadOfficialPlaylist(p.id, p.name, true); else void loadPlaylist(p.id, false); }}
                          />
                        ))}
                      </div>
                      {categoryTracks.length === 0 && !loading && (
                        <p style={{ fontSize: 12, color: 'var(--nm-muted)' }}>这个分类暂时没有歌单。</p>
                      )}
                    </div>
                  )}

                  {/* 本机栏目：我喜欢的音乐（登录后走官方红心）/ 最近播放 / 不支持 */}
                  {(channel.local === 'liked' || channel.local === 'recent') && (
                    <div className="mt-6">
                      <SectionTitle title={`${channel.title} · ${channelTracks.length} 首`} />
                      {channel.local === 'liked' && !profile && (
                        <p style={{ fontSize: 12, color: 'var(--nm-muted)', marginBottom: 8 }}>
                          登录后可同步你网易云账号里全部红心歌曲。当前显示本机记录。
                        </p>
                      )}
                      {channelTracks.length === 0 ? (
                        <p style={{ fontSize: 12, color: 'var(--nm-muted)' }}>
                          {channel.local === 'liked' ? '还没有点过红心，去歌单里点几首吧。' : '还没有播放记录，随便点一首试试。'}
                        </p>
                      ) : (
                        channelTracks.map((t, i) => (
                          <TrackRow
                            key={`${t.id}-${i}`}
                            index={i}
                            track={t}
                            active={current?.id === t.id}
                            liked={liked.has(t.id)}
                            onPlay={() => void playAt(i, channelTracks)}
                            onLike={() => toggleLike(t.id)}
                            onComment={() => void openComments(t)}
                          />
                        ))
                      )}
                    </div>
                  )}

                  {channel.local === 'unsupported' && (
                    <div
                      className="mt-6"
                      style={{ padding: 16, borderRadius: 10, border: '1px solid var(--nm-border)', background: 'var(--nm-card)', fontSize: 12, color: 'var(--nm-sub)', lineHeight: 1.7 }}
                    >
                      这个桌面应用只做在线播放，不落盘、不扫描本地文件。想听什么直接用顶部搜索框搜网易云曲库即可。
                    </div>
                  )}

                  {/* 兜底：未登录 / 普通栏目的一堆公共歌单 */}
                  {(!channel.kind || (channel.needsLogin && !profile)) && (channel.items ?? []).length > 0 && (
                    <div className="mt-6 mb-4">
                      <SectionTitle title="可以立即收听" />
                      <div className="grid gap-4" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(148px, 1fr))' }}>
                        {(channel.items ?? []).map((item) => (
                          <PlaylistCard
                            key={item.id}
                            title={item.name}
                            cover={item.pic ?? (coverPalette[0] ?? '')}
                            count="网易云歌单"
                            onClick={() => { setActiveNav(`pl-${item.id}`); void loadPlaylist(item.id); pushNav({ view: 'playlist', playlistId: item.id, playlistName: item.name }); }}
                          />
                        ))}
                      </div>
                    </div>
                  )}
                </>
              )}

              {/* 专辑 / 歌手 / 用户 详情页 */}
              {view === 'album' && detailView && (
                <DetailPage data={detailView} tracks={detailView.tracks} activeId={current?.id} liked={liked}
                  onPlay={(i) => void playAt(i, detailView.tracks)} onLike={(id) => toggleLike(id)}
                  onComment={(t) => void openComments(t)} onOpenPlaylist={(id, name) => { void loadPlaylist(id, false); pushNav({ view: 'playlist', playlistId: id, playlistName: name }); }} />
              )}
              {view === 'artist' && detailView && (
                <DetailPage data={detailView} tracks={detailView.tracks} activeId={current?.id} liked={liked}
                  onPlay={(i) => void playAt(i, detailView.tracks)} onLike={(id) => toggleLike(id)}
                  onComment={(t) => void openComments(t)} onOpenPlaylist={(id, name) => { void loadPlaylist(id, false); pushNav({ view: 'playlist', playlistId: id, playlistName: name }); }} />
              )}
              {view === 'user' && detailView && (
                <>
                  <div className="flex items-center gap-4 py-2">
                    <div style={{ width: 88, height: 88, borderRadius: '50%', background: detailView.pic ? `url(${detailView.pic}) center / cover no-repeat, var(--nm-card)` : 'var(--nm-card)', border: '1px solid var(--nm-border)', flexShrink: 0 }} />
                    <div>
                      <h1 style={{ fontSize: 22, fontWeight: 600, margin: 0 }}>{detailView.title}</h1>
                      <p style={{ fontSize: 12, color: 'var(--nm-muted)', margin: '8px 0 0' }}>{detailView.sub}</p>
                      {detailView.desc && <p style={{ fontSize: 11, color: 'var(--nm-sub)', margin: '6px 0 0', maxWidth: 420 }} className="line-clamp-2">{detailView.desc}</p>}
                    </div>
                  </div>
                  <div className="mt-5">
                    <SectionTitle title="Ta 的歌单" />
                    <div className="grid gap-4" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(148px, 1fr))' }}>
                      {searchItems.map((p) => (
                        <PlaylistCard key={p.id} title={p.name} cover={p.pic} count={p.sub}
                          onClick={() => { setActiveNav(`pl-${p.id}`); pushNav({ view: 'playlist', playlistId: p.id, playlistName: p.name }); if (profile) void loadOfficialPlaylist(p.id, p.name, true); else void loadPlaylist(p.id, false); }} />
                      ))}
                    </div>
                    {searchItems.length === 0 && <p style={{ fontSize: 12, color: 'var(--nm-muted)' }}>暂无公开歌单</p>}
                  </div>
                </>
              )}

              {view === 'playlist' && playlist && (
                <>
                  {/* 歌单头部 */}
                  <div className="flex gap-6">
                    <div
                      style={{
                        width: 176,
                        height: 176,
                        borderRadius: 10,
                        flexShrink: 0,
                        background: playlist.cover
                          ? `url(${playlist.cover}) center / cover no-repeat, var(--nm-card)`
                          : 'var(--nm-card)',
                        border: '1px solid var(--nm-border)',
                      }}
                    />
                    <div className="min-w-0 flex-1">
                      <div style={{ fontSize: 12, color: 'var(--nm-red)' }}>歌单</div>
                      <h1 style={{ fontSize: 24, fontWeight: 600, margin: '6px 0 10px' }}>{playlist.name}</h1>
                      <div style={{ fontSize: 11, color: 'var(--nm-muted)' }}>网易云音乐 · {playlist.tracks.length} 首</div>
                      <p className="line-clamp-2" style={{ fontSize: 11, color: 'var(--nm-sub)', marginTop: 10 }}>
                        {playlist.desc || '听得越多，推荐越准。'}
                      </p>
                      <div className="mt-4 flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => void playAt(0)}
                          className="flex items-center gap-2"
                          style={{
                            height: 34,
                            padding: '0 18px',
                            borderRadius: 17,
                            border: 'none',
                            background: 'var(--nm-red)',
                            color: '#fff',
                            fontSize: 12,
                            cursor: 'pointer',
                          }}
                        >
                          <Play size={13} fill="currentColor" /> 播放全部
                        </button>
                        <IconButton title="收藏" onClick={() => toggleLike(playlist.id)} active={liked.has(playlist.id)}>
                          <Heart size={15} fill={liked.has(playlist.id) ? 'currentColor' : 'none'} />
                        </IconButton>
                        <IconButton title="更多">
                          <MoreHorizontal size={15} />
                        </IconButton>
                      </div>
                    </div>
                  </div>

                  {/* 歌曲表格 */}
                  <div className="mt-6">
                    <div className="flex items-center gap-3 px-3 pb-2" style={{ fontSize: 11, color: 'var(--nm-muted)', borderBottom: '1px solid var(--nm-border)' }}>
                      <span style={{ width: 26 }}>#</span>
                      <span style={{ flex: '1 1 40%' }}>标题</span>
                      <span style={{ flex: '1 1 28%' }}>专辑</span>
                      <span style={{ width: 26 }} />
                      <span style={{ width: 44, textAlign: 'right' }}>时长</span>
                    </div>
                    <div className="mt-1">
                      {playlist.tracks.map((t, i) => (
                        <TrackRow
                          key={`${t.id}-${i}`}
                          index={i}
                          track={t}
                          active={current?.id === t.id}
                          liked={liked.has(t.id)}
                          onPlay={() => void playAt(i)}
                          onLike={() => toggleLike(t.id)}
                          onComment={() => void openComments(t)}
                        />
                      ))}
                    </div>
                  </div>
                </>
              )}

              {view === 'search' && (
                <>
                  <div className="flex items-center gap-4" style={{ borderBottom: '1px solid var(--nm-border)', paddingBottom: 12 }}>
                    {([
                      ['1', '单曲'], ['10', '专辑'], ['100', '歌手'],
                      ['1000', '歌单'], ['1002', '用户'],
                    ] as const).map(([key, label]) => (
                      <button
                        type="button"
                        key={key}
                        onClick={() => {
                          if (key === searchTab || !searchKw) return;
                          setSearchTab(key);
                          void runSearch(searchKw, key);
                        }}
                        style={{
                          border: 'none',
                          background: 'transparent',
                          color: key === searchTab ? 'var(--nm-red)' : 'var(--nm-muted)',
                          fontSize: 13,
                          fontWeight: key === searchTab ? 600 : 400,
                          cursor: searchKw ? 'pointer' : 'default',
                        }}
                      >
                        {label}
                        {searchCounts[key] ? (
                          <span style={{ fontSize: 10, opacity: 0.7, marginLeft: 3 }}>{searchCounts[key]}</span>
                        ) : null}
                      </button>
                    ))}
                  </div>

                  {/* 单曲用歌曲行，其余用可点卡片 */}
                  {searchTab === '1' ? (
                    <div className="mt-3">
                      {results.map((t, i) => (
                        <TrackRow
                          key={`${t.id}-${i}`}
                          index={i}
                          track={t}
                          active={current?.id === t.id}
                          liked={liked.has(t.id)}
                          onPlay={() => void playAt(i)}
                          onLike={() => toggleLike(t.id)}
                          onComment={() => void openComments(t)}
                        />
                      ))}
                      {results.length === 0 && !loading && !error && (
                        <p style={{ color: 'var(--nm-muted)', fontSize: 12 }}>输入关键词回车即可搜索网易云曲库。</p>
                      )}
                    </div>
                  ) : (
                    <div className="mt-4 grid gap-4" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))' }}>
                      {searchItems.map((item) => {
                        const round = searchTab === '100' || searchTab === '1002';
                        return (
                          <button
                            type="button"
                            key={item.id}
                            onClick={() => openSearchItem(searchTab, item)}
                            className="flex flex-col text-left"
                            style={{ border: 'none', background: 'transparent', padding: 0, cursor: 'pointer', minWidth: 0 }}
                          >
                            <div
                              style={{
                                width: '100%', aspectRatio: '1 / 1', borderRadius: round ? '50%' : 10,
                                background: item.pic ? `url(${item.pic}) center / cover no-repeat, var(--nm-card)` : 'var(--nm-card)',
                                border: '1px solid var(--nm-border)',
                              }}
                            />
                            <div className="truncate" style={{ fontSize: 12, fontWeight: 600, marginTop: 8 }}>{item.name}</div>
                            <div className="truncate" style={{ fontSize: 10, color: 'var(--nm-muted)', marginTop: 3 }}>{item.sub}</div>
                          </button>
                        );
                      })}
                      {searchItems.length === 0 && !loading && !error && (
                        <p style={{ color: 'var(--nm-muted)', fontSize: 12 }}>换个关键词或分类试试。</p>
                      )}
                    </div>
                  )}
                </>
              )}
            </div>
          )}

          {/* 播放外观 / 音质设置（浮层，可覆盖播放页） */}
          {showPlayerSettings && renderPlayerSettings()}
        </main>
      </div>

      {/* ---------------------------- 底部播放条 ---------------------------- */}
      <footer
        className="flex shrink-0 items-center gap-4 px-4"
        style={{ height: 80, background: 'var(--nm-panel)', borderTop: '1px solid var(--nm-border)' }}
      >
        {/* 左：封面 + 歌名 */}
        <div className="flex items-center gap-3" style={{ width: 240, minWidth: 0 }}>
          <button
            type="button"
            onClick={() => setShowPlayer((v) => !v)}
            title="打开播放页"
            style={{
              width: 48,
              height: 48,
              borderRadius: showPlayer ? '50%' : 6,
              flexShrink: 0,
              border: 'none',
              padding: 0,
              cursor: 'pointer',
              background: current?.pic
                ? `url(${current.pic}) center / cover no-repeat, var(--nm-card)`
                : 'var(--nm-card)',
            }}
          />
          <div style={{ minWidth: 0 }}>
            <div className="truncate" style={{ fontSize: 12, color: 'var(--nm-text)' }}>
              {current?.name ?? '还没有播放歌曲'}
            </div>
            <div className="truncate" style={{ fontSize: 10, color: 'var(--nm-muted)', marginTop: 3 }}>
              {current?.artist ?? '从歌单或搜索里点一首'}
            </div>
          </div>
          <IconButton title="喜欢" onClick={() => current && toggleLike(current.id)} active={!!current && liked.has(current.id)} size={24}>
            <Heart size={13} fill={current && liked.has(current.id) ? 'currentColor' : 'none'} />
          </IconButton>
          <IconButton title="这首歌的评论" onClick={() => current && void openComments(current)} size={24}>
            <MessageCircle size={13} />
          </IconButton>
        </div>

        {/* 中：控件 + 进度 */}
        <div className="flex min-w-0 flex-1 flex-col items-center gap-1.5">
          <div className="flex items-center gap-4">
            <IconButton
              title={repeatMode === 'list' ? '列表循环' : repeatMode === 'one' ? '单曲循环' : '随机播放'}
              onClick={() => setRepeatMode((m) => (m === 'list' ? 'one' : m === 'one' ? 'shuffle' : 'list'))}
              size={26}
              active={repeatMode !== 'list'}
            >
              <Repeat size={14} />
            </IconButton>
            <IconButton title="上一首" onClick={playPrev} size={26}>
              <SkipBack size={16} fill="currentColor" />
            </IconButton>
            <button
              type="button"
              onClick={() => (current ? setPlaying((p) => !p) : void playAt(0))}
              title={playing ? '暂停' : '播放'}
              className="flex items-center justify-center"
              style={{
                width: 34,
                height: 34,
                borderRadius: '50%',
                border: 'none',
                background: 'var(--nm-red)',
                color: '#fff',
                cursor: 'pointer',
              }}
            >
              {loadingTrack ? <Loader2 size={15} className="animate-spin" /> : playing ? <Pause size={15} fill="currentColor" /> : <Play size={15} fill="currentColor" />}
            </button>
            <IconButton title="下一首" onClick={playNext} size={26}>
              <SkipForward size={16} fill="currentColor" />
            </IconButton>
            <IconButton title="歌词" onClick={() => setShowPlayer((v) => !v)} size={26} active={showPlayer}>
              <span style={{ fontSize: 12 }}>词</span>
            </IconButton>
          </div>
          <div className="flex w-full items-center gap-2">
            <span style={{ fontSize: 10, color: 'var(--nm-muted)', width: 34 }}>{fmtTime(position)}</span>
            <div
              onClick={seek}
              style={{ flex: 1, height: 3, borderRadius: 2, background: 'var(--nm-border)', cursor: 'pointer' }}
            >
              <div
                style={{
                  width: `${duration ? Math.min(100, (position / duration) * 100) : 0}%`,
                  height: '100%',
                  borderRadius: 2,
                  background: 'var(--nm-red)',
                }}
              />
            </div>
            <span style={{ fontSize: 10, color: 'var(--nm-muted)', width: 34, textAlign: 'right' }}>
              {fmtTime(duration || current?.duration || 0)}
            </span>
          </div>
        </div>

        {/* 右：音量 / 列表 */}
        <div className="flex items-center gap-1" style={{ width: 150, justifyContent: 'flex-end' }}>
          <IconButton title={muted ? '取消静音' : '静音'} onClick={() => setMuted((v) => !v)} size={26}>
            {muted || volume === 0 ? <VolumeX size={14} /> : <Volume2 size={14} />}
          </IconButton>
          <input
            type="range"
            min={0}
            max={1}
            step={0.01}
            value={muted ? 0 : volume}
            onChange={(e) => {
              setVolume(Number(e.target.value));
              setMuted(false);
            }}
            style={{ width: 64, accentColor: 'var(--nm-red)' }}
          />
          <IconButton title="播放列表" onClick={() => { setShowPlayer(false); setView('playlist'); }} size={26}>
            <ListMusic size={14} />
          </IconButton>
        </div>
      </footer>

      {/* ---------------------------- 评论区（每首歌） ---------------------------- */}
      {commentTrack && (
        <CommentDrawer
          track={commentTrack}
          tab={commentTab}
          hot={hotComments}
          latest={latestComments}
          total={commentTotal}
          loading={commentLoading}
          error={commentError}
          more={commentMore}
          onTab={setCommentTab}
          onClose={() => {
            commentTokenRef.current += 1;
            setCommentTrack(null);
          }}
          onMore={() => void loadMoreComments()}
          onRetry={() => void openComments(commentTrack)}
          onLogin={() => void openLogin()}
          loggedIn={!!profile}
        />
      )}

      {/* ---------------------------- API 设置（二级页） ---------------------------- */}
      {showSettings && (
        <div
          style={{
            position: 'absolute',
            top: 56,
            right: 16,
            width: 320,
            zIndex: 30,
            background: 'var(--nm-card)',
            border: '1px solid var(--nm-border)',
            borderRadius: 12,
            padding: 16,
            boxShadow: '0 10px 30px rgba(0,0,0,.3)',
          }}
        >
          <div className="flex items-center" style={{ fontSize: 13, fontWeight: 600 }}>
            API 设置
            <button
              type="button"
              onClick={() => setShowSettings(false)}
              style={{ marginLeft: 'auto', border: 'none', background: 'transparent', color: 'var(--nm-muted)', cursor: 'pointer' }}
            >
              <X size={14} />
            </button>
          </div>
          <p style={{ fontSize: 11, color: 'var(--nm-muted)', lineHeight: 1.6 }}>
            默认使用 GD Studio 公共网关（只代理网易云）。若自建了 NeteaseCloudMusicApi，填根地址即可自动切换；接口失败时会回退到公共网关。
          </p>
          <form
            onSubmit={(e) => { e.preventDefault(); saveGateway(); }}
            className="mt-3 flex flex-col gap-2"
          >
            <input
              value={gatewayInput}
              onChange={(e) => setGatewayInput(e.target.value)}
              placeholder="https://你的域名 或留空恢复默认"
              style={{
                height: 32,
                borderRadius: 6,
                border: '1px solid var(--nm-border)',
                background: 'var(--nm-panel)',
                color: 'var(--nm-text)',
                fontSize: 11,
                padding: '0 10px',
                outline: 'none',
              }}
            />
            <div className="flex gap-2">
              <button
                type="submit"
                style={{
                  flex: 1,
                  height: 30,
                  borderRadius: 6,
                  border: 'none',
                  background: 'var(--nm-red)',
                  color: '#fff',
                  fontSize: 11,
                  cursor: 'pointer',
                }}
              >
                保存
              </button>
              <button
                type="button"
                onClick={() => setGatewayInput(GD_STUDIO)}
                style={{
                  height: 30,
                  padding: '0 10px',
                  borderRadius: 6,
                  border: '1px solid var(--nm-border)',
                  background: 'transparent',
                  color: 'var(--nm-sub)',
                  fontSize: 11,
                  cursor: 'pointer',
                }}
              >
                恢复默认
              </button>
            </div>
          </form>
        </div>
      )}

      {/* ---------------------------- 官方扫码登录面板 ---------------------------- */}
      {showLogin && (
        <div
          onClick={() => {
            stopLoginPoll();
            setShowLogin(false);
          }}
          style={{
            position: 'absolute',
            inset: 0,
            zIndex: 40,
            background: 'rgba(0,0,0,0.5)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 20,
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              width: 380,
              maxWidth: '100%',
              background: 'var(--nm-card)',
              border: '1px solid var(--nm-border)',
              borderRadius: 14,
              padding: 20,
              boxShadow: '0 16px 48px rgba(0,0,0,.35)',
            }}
          >
            <div className="flex items-center" style={{ fontSize: 14, fontWeight: 600 }}>
              <span
                className="flex items-center justify-center"
                style={{ width: 24, height: 24, borderRadius: '50%', background: 'var(--nm-red)', color: '#fff', marginRight: 8 }}
              >
                <Music2 size={13} />
              </span>
              {profile ? '我的账号' : '扫码登录网易云音乐'}
              <button
                type="button"
                onClick={() => {
                  stopLoginPoll();
                  setShowLogin(false);
                }}
                style={{ marginLeft: 'auto', border: 'none', background: 'transparent', color: 'var(--nm-muted)', cursor: 'pointer' }}
              >
                <X size={15} />
              </button>
            </div>

            {profile ? (
              <div className="mt-4">
                <div className="flex items-center gap-3">
                  <span
                    style={{
                      width: 52,
                      height: 52,
                      borderRadius: '50%',
                      flexShrink: 0,
                      background: profile.avatarUrl
                        ? `url(${profile.avatarUrl}) center / cover no-repeat, var(--nm-panel)`
                        : 'var(--nm-panel)',
                      border: '1px solid var(--nm-border)',
                    }}
                  />
                  <div style={{ minWidth: 0 }}>
                    <div className="truncate" style={{ fontSize: 14, fontWeight: 600 }}>
                      {profile.nickname}
                    </div>
                    <div style={{ fontSize: 11, color: 'var(--nm-muted)', marginTop: 4 }}>
                      UID {profile.userId}
                      {profile.vipType > 0 ? ' · 黑胶 VIP' : ' · 普通账号'}
                    </div>
                  </div>
                </div>
                <p style={{ fontSize: 11, color: 'var(--nm-sub)', lineHeight: 1.7, margin: '14px 0 0' }}>
                  已读取 {userPlaylists.length} 张你的歌单，左侧「我的歌单」可直接点开（走官方接口，失败自动回退公共网关）。
                </p>
                <div className="mt-4 flex gap-2">
                  <button
                    type="button"
                    onClick={() => void doLogout()}
                    style={{ flex: 1, height: 34, borderRadius: 17, border: '1px solid var(--nm-border)', background: 'transparent', color: 'var(--nm-sub)', fontSize: 12, cursor: 'pointer' }}
                  >
                    退出登录
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      stopLoginPoll();
                      setShowLogin(false);
                    }}
                    style={{ flex: 1, height: 34, borderRadius: 17, border: 'none', background: 'var(--nm-red)', color: '#fff', fontSize: 12, cursor: 'pointer' }}
                  >
                    完成
                  </button>
                </div>
              </div>
            ) : (
              <div className="mt-4">
                <div
                  className="flex flex-col items-center justify-center"
                  style={{
                    minHeight: 190,
                    borderRadius: 10,
                    border: '1px solid var(--nm-border)',
                    background: 'var(--nm-panel)',
                    padding: 12,
                    position: 'relative',
                  }}
                >
                  {qrDataUrl ? (
                    <img
                      src={qrDataUrl}
                      alt="网易云音乐扫码登录二维码"
                      style={{
                        width: 168,
                        height: 168,
                        imageRendering: 'pixelated',
                        opacity: loginPhase === 'expired' ? 0.25 : 1,
                      }}
                    />
                  ) : loginPhase === 'error' ? (
                    <button
                      type="button"
                      onClick={() => void startLoginQr()}
                      style={{ height: 32, padding: '0 16px', borderRadius: 16, border: 'none', background: 'var(--nm-red)', color: '#fff', fontSize: 12, cursor: 'pointer' }}
                    >
                      重新获取
                    </button>
                  ) : (
                    <Loader2 size={26} className="animate-spin" style={{ color: 'var(--nm-muted)' }} />
                  )}
                  {loginPhase === 'expired' && (
                    <button
                      type="button"
                      onClick={() => void startLoginQr()}
                      style={{ position: 'absolute', padding: '8px 16px', borderRadius: 16, border: 'none', background: 'var(--nm-red)', color: '#fff', fontSize: 12, cursor: 'pointer' }}
                    >
                      刷新二维码
                    </button>
                  )}
                </div>

                <div
                  style={{
                    textAlign: 'center',
                    fontSize: 12,
                    color: loginPhase === 'scanned' ? 'var(--nm-red)' : 'var(--nm-sub)',
                    marginTop: 12,
                    lineHeight: 1.6,
                  }}
                >
                  {loginMsg || '正在准备二维码…'}
                </div>
                {loginErr && (
                  <div style={{ fontSize: 11, color: 'var(--nm-red)', marginTop: 8, lineHeight: 1.6, textAlign: 'center' }}>
                    {loginErr}
                  </div>
                )}
                <div className="mt-3 flex justify-center">
                  <button
                    type="button"
                    onClick={() => void startLoginQr()}
                    style={{ height: 28, padding: '0 14px', borderRadius: 14, border: '1px solid var(--nm-border)', background: 'transparent', color: 'var(--nm-sub)', fontSize: 11, cursor: 'pointer' }}
                  >
                    重新生成二维码
                  </button>
                </div>
                <p style={{ fontSize: 10, color: 'var(--nm-muted)', lineHeight: 1.7, margin: '12px 0 0' }}>
                  二维码来自网易云官方接口，几分钟后失效。扫码后请在手机上点「确认登录」。
                </p>
              </div>
            )}

            <div
              style={{
                borderTop: '1px solid var(--nm-border)',
                marginTop: 16,
                paddingTop: 12,
                fontSize: 10,
                color: 'var(--nm-muted)',
                lineHeight: 1.7,
              }}
            >
              安全说明：MUSIC_U / __csrf 只保存在本站 Worker 服务端，浏览器只持有匿名会话 ID；
              登录凭证绝不下发前端、绝不写进日志，也绝不会发给任何第三方公共网关。
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
