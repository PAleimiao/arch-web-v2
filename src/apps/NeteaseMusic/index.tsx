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
  ChevronRight,
  Disc3,
  Heart,
  ListMusic,
  Loader2,
  MessageCircle,
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
  SkipBack,
  SkipForward,
  Sun,
  Volume2,
  VolumeX,
  UserRound,
  ThumbsUp,
  X,
} from 'lucide-react';
import qrcode from 'qrcode-generator';
import type { AppProps } from '@/shell/types';
import { useOSStore } from '@/stores/useOSStore';

/* ============================ 配置与类型 ============================ */

const STORAGE_KEY = 'arch-web-netease:config';
const GD_STUDIO = 'https://music-api.gdstudio.xyz/api.php';

type GatewayKind = 'gdstudio' | 'netease-api';
interface Config {
  gateway: string;
  kind: GatewayKind;
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
}

type View = 'home' | 'playlist' | 'search' | 'channel';
type RepeatMode = 'list' | 'one' | 'shuffle';

/**
 * 栏目页：左侧导航与首页入口点进去后的独立内容。
 * 以前所有入口都指向同一个歌单，看着像「点哪儿都是热播榜」，
 * 现在每个栏目有自己的标题、说明和一组不同的公共歌单。
 */
interface ChannelInfo {
  id: string;
  title: string;
  desc: string;
  /** 属于登录后才有的个性化内容，页面顶部会明确标注未登录 */
  needsLogin?: boolean;
  /** 本地功能视图：红心 / 最近播放 / 桌面版不支持 */
  local?: 'liked' | 'recent' | 'unsupported';
  /** 栏目下可点的公共歌单，各栏目组合不同 */
  items?: { id: string; name: string }[];
}

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
  const timer = setTimeout(() => ctl.abort(), timeout);
  try {
    const r = await fetch(url, { signal: ctl.signal, credentials: 'omit' });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return (await r.json()) as T;
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

async function gdUrl(cfg: Config, id: string): Promise<string | null> {
  const r = await fetchJson<{ url?: string }>(
    buildUrl(cfg, { types: 'url', source: 'netease', id, br: 320 }),
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

async function ncmUrl(cfg: Config, id: string): Promise<string | null> {
  const r = await fetchJson<{ data?: { url?: string }[] }>(`${ncmBase(cfg)}/song/url?id=${id}`);
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

  async url(id: string): Promise<string | null> {
    return this.cfg.kind === 'gdstudio' ? gdUrl(this.cfg, id) : ncmUrl(this.cfg, id);
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

/* ============================ 主组件 ============================ */

export default function NeteaseMusic(_: AppProps) {
  /* ---- 全局明暗主题（改一处全站变） ---- */
  const dark = useOSStore((s) => s.settings.darkMode);
  const updateSettings = useOSStore((s) => s.updateSettings);
  const toggleTheme = useCallback(() => updateSettings({ darkMode: !dark }), [dark, updateSettings]);

  /* ---- 配置 ---- */
  const [config, setConfig] = useState<Config>(loadConfig);
  const [showSettings, setShowSettings] = useState(false);
  const [gatewayInput, setGatewayInput] = useState(config.gateway);
  const clientCfgRef = useRef<Config>(config);
  useEffect(() => {
    clientCfgRef.current = config;
  }, [config]);

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

  /* ---- 播放状态 ---- */
  const audioRef = useRef<HTMLAudioElement>(null);
  const [currentIdx, setCurrentIdx] = useState(-1);
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

  const current = currentIdx >= 0 && currentIdx < activeTracks.length ? activeTracks[currentIdx] : null;

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
        if (mountedRef.current) setError(`加载失败：${String((e as Error)?.message ?? e)}`);
      } finally {
        if (mountedRef.current) setLoading(false);
      }
    },
    [config],
  );

  const doSearch = useCallback(
    async (kw: string) => {
      const trimmed = kw.trim();
      if (!trimmed) return;
      setLoading(true);
      setError(null);
      try {
        const { value, cfg } = await withFallback(config, (c) => new MusicClient(c).search(trimmed));
        if (!mountedRef.current) return;
        setConfig(cfg);
        setResults(value);
        setActiveTracks(value);
        setTrackIndex((prev) => {
          const next = { ...prev };
          for (const t of value) next[t.id] = t;
          return next;
        });
        setView('search');
        setShowPlayer(false);
        if (value.length === 0) setError('没有搜到相关歌曲，换个关键词试试。');
      } catch (e) {
        if (mountedRef.current) setError(`搜索失败：${String((e as Error)?.message ?? e)}`);
      } finally {
        if (mountedRef.current) setLoading(false);
      }
    },
    [config],
  );

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
    async (idx: number, list?: Track[]) => {
      /* 允许栏目页（红心 / 最近播放）自带一份播放列表，否则会读到旧的 activeTracks */
      if (list) setActiveTracks(list);
      const source = list ?? activeTracks;
      const track = source[idx];
      if (!track?.id) return;
      setRecentTracks((prev) => [track, ...prev.filter((t) => t.id !== track.id)].slice(0, 50));
      const token = ++playTokenRef.current;
      const stale = () => token !== playTokenRef.current || !mountedRef.current;
      setError(null);
      setCurrentIdx(idx);
      setPlayUrl(null);
      setLoadingTrack(true);
      setLyrics([]);
      setActiveLyricIdx(-1);
      try {
        const mc = new MusicClient(clientCfgRef.current);
        const [url, lyric, pic] = await Promise.all([
          mc.url(track.id),
          mc.lyric(track.id),
          track.pic ? Promise.resolve(track.pic) : mc.pic(track.id),
        ]);
        if (stale()) return;
        if (pic && !track.pic) {
          const patch = (list: Track[]) => {
            const next = list.slice();
            if (next[idx]?.id === track.id) next[idx] = { ...next[idx], pic };
            return next;
          };
          setActiveTracks(patch);
          setResults((prev) => (prev.length ? patch(prev) : prev));
          setPlaylist((prev) => (prev ? { ...prev, tracks: patch(prev.tracks) } : prev));
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
    if (activeTracks.length === 0) return;
    void playAt(currentIdx <= 0 ? activeTracks.length - 1 : currentIdx - 1);
  }, [activeTracks, currentIdx, playAt]);

  const playNext = useCallback(() => {
    if (activeTracks.length === 0) return;
    let i: number;
    if (repeatMode === 'shuffle') i = Math.floor(Math.random() * activeTracks.length);
    else i = currentIdx >= activeTracks.length - 1 ? 0 : currentIdx + 1;
    void playAt(i);
  }, [activeTracks, currentIdx, repeatMode, playAt]);

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
      if (['INPUT', 'TEXTAREA'].includes((e.target as HTMLElement)?.tagName)) return;
      if (e.code === 'Space') {
        e.preventDefault();
        setPlaying((p) => !p);
      } else if (e.key === 'ArrowLeft') {
        playPrev();
      } else if (e.key === 'ArrowRight') {
        playNext();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [playPrev, playNext]);

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
      setUserPlaylists(data.playlists ?? []);
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

  /** 登录后用官方接口读歌单（我的歌单 / 私人歌单），失败回退公共网关 */
  const loadOfficialPlaylist = useCallback(
    async (id: string) => {
      setLoading(true);
      setError(null);
      try {
        const data = await fetchOfficialPlaylist(id);
        if (!mountedRef.current) return;
        setPlaylist(data);
        setActiveTracks(data.tracks);
        setTrackIndex((prev) => {
          const next = { ...prev };
          for (const t of data.tracks) next[t.id] = t;
          return next;
        });
        setView('playlist');
        setShowPlayer(false);
        setLoading(false);
        if (data.tracks.length === 0) setError('这个歌单暂时没有可展示的歌曲。');
      } catch {
        void loadPlaylist(id);
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

  /** 打开独立栏目页：所有导航项 / 入口卡都走这里，不再挤到同一个歌单 */
  const openChannel = (info: ChannelInfo) => {
    setChannel(info);
    setActiveNav(info.id);
    setView('channel');
    setShowPlayer(false);
    setError(null);
  };

  const goHome = () => {
    setView('home');
    setActiveNav('home');
    setChannel(null);
    setShowPlayer(false);
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
        <div className="flex items-center gap-2" style={{ minWidth: 150 }}>
          <span
            className="flex items-center justify-center"
            style={{ width: 24, height: 24, borderRadius: '50%', background: 'var(--nm-red)', color: '#fff' }}
          >
            <Music2 size={14} />
          </span>
          <span style={{ fontSize: 14, fontWeight: 600 }}>网易云音乐</span>
        </div>

        <IconButton title="返回" onClick={() => { setView('home'); setShowPlayer(false); }} size={26}>
          <ArrowLeft size={15} />
        </IconButton>

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
                  ? { id: n.id, title: '精选 · 歌单广场', desc: '按风格挑一张歌单，下面全部是网易云真实公共歌单。', items: channelItems(PUBLIC_PLAYLISTS.map((p) => p.id)) }
                  : n.id === 'podcast'
                    ? { id: n.id, title: '播客', desc: '公共网关只提供音乐歌单，暂不支持播客音频流；这里先给你几张适合当背景声的歌单。', items: channelItems(['71385707', '4395559', '2884035']) }
                    : n.id === 'roam'
                      ? { id: n.id, title: '私人漫游', desc: '从你熟悉的声音出发，一路延伸。', needsLogin: true, items: channelItems(['4395559', '2884035', '71385707']) }
                      : { id: n.id, title: '关注', desc: '关注的人的动态与最新发布。', needsLogin: true, items: channelItems(['3779629', '19723756', '991319590']) };
              return navItem(n.label, <n.icon size={14} />, activeNav === n.id, () =>
                n.id === 'home' ? goHome() : openChannel(ch),
              );
            })}
          </div>

          <div style={{ fontSize: 10, color: 'var(--nm-muted)', padding: '16px 10px 6px' }}>
            我的音乐 · 未登录
          </div>
          <div className="flex flex-col gap-0.5">
            {NAV_MY.map((n) =>
              navItem(n.label, <n.icon size={14} />, activeNav === n.id, () =>
                openChannel({
                  id: n.id,
                  title: n.label,
                  desc:
                    n.id === 'download' || n.id === 'local'
                      ? '桌面版不提供下载与本地文件扫描，用顶部搜索框可以直接在线收听。'
                      : '这部分数据只记在这台设备本地，不会与网易云账号同步。',
                  local: n.id === 'liked' ? 'liked' : n.id === 'recent' ? 'recent' : 'unsupported',
                }),
              ),
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
                  userPlaylists.slice(0, 8).map((p) =>
                    navItem(p.name, <ListMusic size={14} />, activeNav === `mine-${p.id}`, () => {
                      setActiveNav(`mine-${p.id}`);
                      void loadOfficialPlaylist(p.id);
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
            /* ---------------------- 播放页 ---------------------- */
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
                  {/* 顶部入口卡 */}
                  <div
                    className="grid gap-3"
                    style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(104px, 1fr))' }}
                  >
                    {ENTRY_CARDS.map((c) => (
                      <button
                        type="button"
                        key={c.title}
                        onClick={() =>
                          openChannel({
                            id: `entry-${c.title}`,
                            title: c.title,
                            desc: c.desc,
                            needsLogin: true,
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
                            background: c.tone,
                            color: c.ink,
                            padding: 9,
                            display: 'flex',
                            alignItems: 'flex-start',
                            fontSize: 12,
                            fontWeight: 600,
                            lineHeight: 1.35,
                          }}
                        >
                          {c.title}
                        </div>
                        <span style={{ fontSize: 10, color: 'var(--nm-muted)', marginTop: 6 }} className="truncate">
                          {c.desc}
                        </span>
                      </button>
                    ))}
                  </div>

                  {/* 推荐歌单 */}
                  <div className="mt-7">
                    <SectionTitle
                      title="推荐歌单"
                      extra={
                        <IconButton
                          title="换一批"
                          onClick={() => setRecommendOffset((o) => (o + 3) % RECOMMEND_PLAYLISTS.length)}
                        >
                          <Repeat size={14} />
                        </IconButton>
                      }
                    />
                    <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(118px, 1fr))' }}>
                      {rotatedPlaylists.map((p, i) => (
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

                  {channel.needsLogin && (
                    <div
                      className="mt-4 flex items-center gap-2 px-3 py-2.5"
                      style={{ borderRadius: 8, background: 'var(--nm-red-soft)', color: 'var(--nm-red)', fontSize: 12 }}
                    >
                      <AlertCircle size={14} />
                      <span className="flex-1">未登录：个性化推荐暂不可用，下面这些是可以立即收听的公共歌单。</span>
                      <button
                        type="button"
                        onClick={() => void openLogin()}
                        style={{ height: 24, padding: '0 12px', borderRadius: 12, border: 'none', background: 'var(--nm-red)', color: '#fff', fontSize: 11, cursor: 'pointer' }}
                      >
                        登录
                      </button>
                    </div>
                  )}

                  {(channel.local === 'liked' || channel.local === 'recent') && (
                    <div className="mt-6">
                      <SectionTitle title={`${channel.title} · ${channelTracks.length} 首`} />
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

                  {(channel.items ?? []).length > 0 && (
                    <div className="mt-6 mb-4">
                      <SectionTitle title="可以立即收听" />
                      <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))' }}>
                        {(channel.items ?? []).map((item) => (
                          <button
                            type="button"
                            key={item.id}
                            onClick={() => {
                              setActiveNav(`pl-${item.id}`);
                              void loadPlaylist(item.id);
                            }}
                            style={{ border: '1px solid var(--nm-border)', background: 'var(--nm-card)', borderRadius: 10, padding: 14, textAlign: 'left', cursor: 'pointer', color: 'var(--nm-text)' }}
                          >
                            <div style={{ fontSize: 13, fontWeight: 600 }}>{item.name}</div>
                            <div style={{ fontSize: 10, color: 'var(--nm-muted)', marginTop: 6 }}>
                              歌单 #{item.id} · 点击进入
                            </div>
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
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
                  <div className="flex items-center gap-3" style={{ borderBottom: '1px solid var(--nm-border)', paddingBottom: 12 }}>
                    {['单曲', '专辑', '歌手', '歌单', '用户'].map((t, i) => (
                      <button
                        type="button"
                        key={t}
                        style={{
                          border: 'none',
                          background: 'transparent',
                          color: i === 0 ? 'var(--nm-red)' : 'var(--nm-muted)',
                          fontSize: 13,
                          fontWeight: i === 0 ? 600 : 400,
                          cursor: 'pointer',
                        }}
                      >
                        {t}
                      </button>
                    ))}
                  </div>
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
                    {results.length === 0 && !loading && (
                      <p style={{ color: 'var(--nm-muted)', fontSize: 12 }}>输入关键词回车即可搜索网易云曲库。</p>
                    )}
                  </div>
                </>
              )}
            </div>
          )}
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
