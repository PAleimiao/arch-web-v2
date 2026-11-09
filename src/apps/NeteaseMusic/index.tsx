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
  X,
} from 'lucide-react';
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

type View = 'home' | 'playlist' | 'search';
type RepeatMode = 'list' | 'one' | 'shuffle';

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

/** 首页顶部 7 个入口卡，点击都会加载一个真实歌单 */
const ENTRY_CARDS = [
  { title: '每日推荐', desc: '根据你的口味生成', gid: '3778678', tone: '#ececf0', ink: '#333' },
  { title: '私人漫游', desc: '从熟悉的声音出发', gid: '3779629', tone: '#7b5cf0', ink: '#fff' },
  { title: '私人雷达', desc: '今天也要听点新的', gid: '19723756', tone: '#9dc3cf', ink: '#333' },
  { title: '音乐播客', desc: '用耳朵去旅行', gid: '4395559', tone: '#3f4a3c', ink: '#fff' },
  { title: '心动模式', desc: '跟着感觉走', gid: '71385707', tone: '#b4526b', ink: '#fff' },
  { title: '相似歌曲', desc: '从这首延伸出去', gid: '991319590', tone: '#d98b4a', ink: '#fff' },
  { title: '每日播客', desc: '每天一点新鲜事', gid: '3778678', tone: '#2d4a63', ink: '#fff' },
];

/** 推荐歌单 / 榜单，ID 都是网易云真实歌单 */
const RECOMMEND_PLAYLISTS = [
  { id: '3778678', name: '热歌榜 · 大家都在听', count: '1634.7万' },
  { id: '3779629', name: '新歌榜 · 本周上新', count: '981.2万' },
  { id: '19723756', name: '飙升榜 · 涨势最猛', count: '742.6万' },
  { id: '4395559', name: '华语金曲 · 回忆杀', count: '513.9万' },
  { id: '71385707', name: '说唱现场 · 节奏拉满', count: '288.4万' },
  { id: '991319590', name: '二次元日推 · 术力口', count: '196.3万' },
  { id: '2829816518', name: '深夜 emo · 一个人听', count: '128.7万' },
  { id: '2884035', name: '原创榜 · 独立音乐', count: '96.1万' },
];

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
}: {
  index: number;
  track: Track;
  active: boolean;
  liked: boolean;
  onPlay: () => void;
  onLike: () => void;
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
      <span style={{ width: 44, textAlign: 'right', color: 'var(--nm-muted)' }}>
        {track.duration ? fmtTime(track.duration) : '--:--'}
      </span>
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

  /* 启动先拉热歌榜：既填首页封面，也让播放器立刻有歌可点 */
  useEffect(() => {
    void loadPlaylist('3778678', true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* ---------------------- 播放 ---------------------- */
  const playAt = useCallback(
    async (idx: number) => {
      const track = activeTracks[idx];
      if (!track?.id) return;
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
          <span
            className="flex items-center justify-center"
            style={{
              width: 26,
              height: 26,
              borderRadius: '50%',
              background: 'var(--nm-red-soft)',
              color: 'var(--nm-red)',
              fontSize: 11,
            }}
            title="未登录（登录功能待接入）"
          >
            <Music2 size={13} />
          </span>
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
            {NAV_MAIN.map((n) =>
              navItem(
                n.label,
                <n.icon size={14} />,
                view === 'home' && n.id === 'home',
                () => {
                  setShowPlayer(false);
                  if (n.id === 'home') setView('home');
                  else void loadPlaylist(ENTRY_CARDS.find((c) => c.title.includes('推荐'))?.gid ?? '3778678');
                },
              ),
            )}
          </div>

          <div style={{ fontSize: 10, color: 'var(--nm-muted)', padding: '16px 10px 6px' }}>我的音乐</div>
          <div className="flex flex-col gap-0.5">
            {NAV_MY.map((n) =>
              navItem(n.label, <n.icon size={14} />, false, () => {
                setShowPlayer(false);
                void loadPlaylist('8820482645');
              }),
            )}
          </div>

          <div style={{ fontSize: 10, color: 'var(--nm-muted)', padding: '16px 10px 6px' }}>创建的歌单 1</div>
          {navItem('学习学到发癫', <ListMusic size={14} />, false, () => void loadPlaylist('3778678'))}

          <div style={{ fontSize: 10, color: 'var(--nm-muted)', padding: '16px 10px 6px' }}>收藏的歌单</div>
          <div className="flex flex-col gap-0.5">
            {RECOMMEND_PLAYLISTS.slice(0, 5).map((p) =>
              navItem(p.name.split(' · ')[0], <span style={{ width: 14 }}>♪</span>, false, () =>
                void loadPlaylist(p.id),
              ),
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
                  专辑：{current?.album || '—'} &nbsp;/&nbsp; 歌手：{current?.artist || '—'} &nbsp;/&nbsp; 来源：推荐
                </div>
                <div className="mt-3 flex gap-2">
                  {['歌词', '百科', '相似推荐'].map((t, i) => (
                    <span
                      key={t}
                      style={{
                        fontSize: 10,
                        padding: '3px 8px',
                        borderRadius: 4,
                        background: i === 0 ? 'var(--nm-hover)' : 'transparent',
                        color: i === 0 ? 'var(--nm-text)' : 'var(--nm-muted)',
                        border: '1px solid var(--nm-border)',
                      }}
                    >
                      {t}
                    </span>
                  ))}
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
                        onClick={() => void loadPlaylist(c.gid)}
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
                        <IconButton title="换一批" onClick={() => void loadPlaylist('3779629', true)}>
                          <Repeat size={14} />
                        </IconButton>
                      }
                    />
                    <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(118px, 1fr))' }}>
                      {RECOMMEND_PLAYLISTS.map((p, i) => (
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
                          {(playlist?.tracks ?? []).slice(0, 3).map((t, i) => (
                            <div key={`${t.id}-${i}`} className="mt-2 flex items-center gap-2 truncate" style={{ fontSize: 11 }}>
                              <span style={{ color: 'var(--nm-red)', width: 14 }}>{i + 1}</span>
                              <span className="truncate" style={{ color: 'var(--nm-sub)' }}>{t.name}</span>
                            </div>
                          ))}
                        </button>
                      ))}
                    </div>
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
    </div>
  );
}
