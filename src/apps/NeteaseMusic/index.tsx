import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertCircle,
  Check,
  ChevronRight,
  Disc3,
  ExternalLink,
  Heart,
  ListMusic,
  Loader2,
  Music,
  Pause,
  Play,
  Radio,
  Search,
  Settings as SettingsIcon,
  SkipBack,
  SkipForward,
  Volume2,
  VolumeX,
  X,
} from 'lucide-react';
import type { AppProps } from '@/shell/types';
import { cn } from '@/lib/cn';

/* ============================================================
 * Meting / 多源音乐 API 客户端
 * ============================================================
 *
 * 三种协议自动适配，按用户配置 + 探测结果择优：
 *
 * 1. Meting API（默认，Firefly 同款）
 *    URL: ?server=netease&type={playlist|song|album|search|artist}&id=...&r=...
 *    主网关: i-meto.com  备用: gdstudio.xyz
 *
 * 2. GD Studio 公共 API
 *    URL: ?types={search|url|lyric|...}&source=...&id=...
 *
 * 3. NeteaseCloudMusicApi 自建
 *    REST: /search /song/url /lyric /playlist/detail 等
 *
 * 三个协议都返回 mp3 URL，前端 <audio src=url> 即可播放。
 * ============================================================ */

const STORAGE_KEY = 'arch-web-netease:config';

type Source = 'netease' | 'tencent' | 'kuwo' | 'bilibili';
type LoadMode = 'search' | 'playlist' | 'song' | 'album' | 'artist';
type GatewayKind = 'meting' | 'gdstudio' | 'netease-api';

interface Config {
  /** 当前生效的协议 */
  gateway: string;
  kind: GatewayKind;
  source: Source;
  /** Meting auth (可选) */
  auth?: string;
}

const DEFAULT_CONFIG: Config = {
  gateway: 'https://api.i-meto.com/meting/api',
  kind: 'meting',
  source: 'netease',
};

const FALLBACK_GATEWAYS: { url: string; kind: GatewayKind; label: string }[] = [
  { url: 'https://api.i-meto.com/meting/api', kind: 'meting', label: 'Meting · i-meto（默认，国内可访问）' },
  { url: 'https://music-api.gdstudio.xyz/api.php', kind: 'gdstudio', label: 'GD Studio · 多源网关' },
  { url: '', kind: 'meting', label: '自建 NeteaseCloudMusicApi（填根 URL）' },
];

const SOURCES: { id: Source; label: string }[] = [
  { id: 'netease', label: '网易云' },
  { id: 'tencent', label: 'QQ' },
  { id: 'kuwo', label: '酷我' },
  { id: 'bilibili', label: 'B 站' },
];

/* ------------- 网易云推荐 / 排行榜 ID ------------- */
const HOT_PLAYLISTS = [
  { id: '8820482645', name: '我喜欢的音乐（默认）', icon: Heart },
  { id: '3778678', name: '热歌榜', icon: Radio },
  { id: '3779629', name: '新歌榜', icon: ListMusic },
  { id: '4395559', name: '华语金曲榜', icon: Disc3 },
  { id: '71385707', name: '飙升榜', icon: ChevronRight },
  { id: '19723756', name: '云音乐飙升榜', icon: ChevronRight },
];

interface Track {
  id: string;
  name: string;
  artist: string;
  album: string;
  /** 来自 meting / gdstudio 直接可播放 mp3 URL */
  url: string;
  /** 封面直链（gdstudio / 自建会展开，meting 也会展开） */
  pic: string;
  /** LRC 歌词原文（gdstudio 才有，meting 需要二次拉） */
  lyric?: string;
  source: Source;
  /** 时长秒 */
  duration?: number;
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
    /* ignore */
  }
}

/* --------------------- API 实现 --------------------- */

interface RawMeting {
  title: string;
  author: string;
  url: string;
  pic: string;
  lrc?: string;
}

interface RawGDStudioSearch {
  id: string;
  name: string;
  artist: string[];
  album: string;
  pic_id: string;
  lyric_id: string;
  source: string;
}

interface RawNCMSearch {
  id: number;
  name: string;
  ar: { name: string }[];
  al: { name: string; picUrl?: string };
}

function buildUrl(cfg: Config, params: Record<string, string | number>): string {
  const u = new URL(cfg.gateway);
  for (const [k, v] of Object.entries(params)) u.searchParams.set(k, String(v));
  return u.toString();
}

async function fetchJson<T>(url: string, timeout = 12_000): Promise<T> {
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

async function fetchText(url: string, timeout = 12_000): Promise<string> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeout);
  try {
    const r = await fetch(url, { signal: ctl.signal, credentials: 'omit' });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return await r.text();
  } finally {
    clearTimeout(timer);
  }
}

/* ===== 协议 1: Meting API ===== */

async function metingLoad(
  cfg: Config,
  mode: LoadMode,
  id: string,
): Promise<Track[]> {
  const u = buildUrl(cfg, {
    server: cfg.source,
    type: mode,
    id,
    r: Math.random().toString(36).slice(2, 10),
    ...(cfg.auth ? { auth: cfg.auth } : {}),
  });
  const arr = await fetchJson<RawMeting[]>(u);
  if (!Array.isArray(arr) || arr.length === 0) return [];
  return arr.map((m) => ({
    id: String(m.url.match(/id=(\d+)/)?.[1] ?? m.title),
    name: m.title ?? '未知歌曲',
    artist: m.author ?? '未知艺人',
    album: '',
    url: m.url,
    pic: m.pic,
    lyric: m.lrc,
    source: cfg.source,
  }));
}

async function metingSong(cfg: Config, id: string): Promise<Track | null> {
  const arr = await metingLoad(cfg, 'song', id);
  return arr[0] ?? null;
}

async function metingSearch(cfg: Config, kw: string): Promise<Track[]> {
  return metingLoad(cfg, 'search', encodeURIComponent(kw));
}

/* ===== 协议 2: GD Studio ===== */

async function gdSearch(cfg: Config, kw: string): Promise<Track[]> {
  const u = buildUrl(cfg, { types: 'search', source: cfg.source, name: kw, count: 30, pages: 1 });
  const arr = await fetchJson<RawGDStudioSearch[]>(u);
  if (!Array.isArray(arr)) return [];
  return arr.map((s) => ({
    id: s.id,
    name: s.name,
    artist: (s.artist ?? []).join(' / '),
    album: s.album,
    url: '', // 后面单独拉
    pic: '',
    lyric: '',
    source: (s.source as Source) ?? cfg.source,
  }));
}

async function gdGetUrl(cfg: Config, track: Track): Promise<string | null> {
  const u = buildUrl(cfg, { types: 'url', source: track.source, id: track.id, br: 320 });
  const r = await fetchJson<{ url: string }>(u);
  return r?.url || null;
}

async function gdGetPic(cfg: Config, track: Track): Promise<string | null> {
  if (!track.id) return null;
  try {
    const u = buildUrl(cfg, { types: 'pic', source: track.source, id: track.id, size: 300 });
    const r = await fetchJson<{ url: string }>(u);
    return r?.url || null;
  } catch {
    return null;
  }
}

async function gdGetLyric(cfg: Config, track: Track): Promise<string> {
  try {
    const u = buildUrl(cfg, { types: 'lyric', source: track.source, id: track.id });
    const r = await fetchJson<{ lyric: string }>(u);
    return r?.lyric ?? '';
  } catch {
    return '';
  }
}

/* ===== 协议 3: NeteaseCloudMusicApi ===== */

function ncmBase(cfg: Config): string {
  return cfg.gateway.replace(/\/+$/, '');
}

async function ncmSearch(cfg: Config, kw: string): Promise<Track[]> {
  const u = `${ncmBase(cfg)}/search?keywords=${encodeURIComponent(kw)}&limit=30`;
  const r = await fetchJson<{ result?: { songs?: RawNCMSearch[] } }>(u);
  const songs = r?.result?.songs ?? [];
  return songs.map((s) => ({
    id: String(s.id),
    name: s.name,
    artist: (s.ar ?? []).map((a) => a.name).join(' / '),
    album: s.al?.name ?? '',
    url: '',
    pic: s.al?.picUrl ?? '',
    lyric: '',
    source: 'netease' as Source,
  }));
}

async function ncmPlaylist(cfg: Config, id: string): Promise<Track[]> {
  const u = `${ncmBase(cfg)}/playlist/detail?id=${id}`;
  const r = await fetchJson<{ playlist?: { tracks?: RawNCMSearch[] } }>(u);
  const tracks = r?.playlist?.tracks ?? [];
  return tracks.map((s) => ({
    id: String(s.id),
    name: s.name,
    artist: (s.ar ?? []).map((a) => a.name).join(' / '),
    album: s.al?.name ?? '',
    url: '',
    pic: s.al?.picUrl ?? '',
    lyric: '',
    source: 'netease' as Source,
  }));
}

async function ncmGetUrl(cfg: Config, id: string): Promise<string | null> {
  const u = `${ncmBase(cfg)}/song/url?id=${id}&br=320000`;
  const r = await fetchJson<{ data?: { url: string }[] }>(u);
  return r?.data?.[0]?.url || null;
}

async function ncmGetLyric(cfg: Config, id: string): Promise<string> {
  try {
    const u = `${ncmBase(cfg)}/lyric?id=${id}`;
    const r = await fetchJson<{ lrc?: { lyric: string } }>(u);
    return r?.lrc?.lyric ?? '';
  } catch {
    return '';
  }
}

/* ===================== 多协议主客户端 ===================== */

class MusicClient {
  constructor(private cfg: Config) {}

  /** 加载歌单 / 专辑 / 搜索结果 / 艺术家代表作 */
  async load(mode: LoadMode, target: string): Promise<Track[]> {
    if (this.cfg.kind === 'meting') {
      // Meting 的 playlist / album / artist / search 都用同一个端点
      return metingLoad(this.cfg, mode, target);
    }
    if (this.cfg.kind === 'gdstudio') {
      if (mode === 'search') return gdSearch(this.cfg, target);
      // gdstudio 也支持 playlist / album 单个端点
      const u = buildUrl(this.cfg, { types: mode, source: this.cfg.source, id: target });
      const arr = await fetchJson<RawGDStudioSearch[]>(u);
      return (arr ?? []).map((s) => ({
        id: s.id,
        name: s.name,
        artist: (s.artist ?? []).join(' / '),
        album: s.album,
        url: '',
        pic: '',
        lyric: '',
        source: (s.source as Source) ?? this.cfg.source,
      }));
    }
    // netease-api
    if (mode === 'search') return ncmSearch(this.cfg, target);
    if (mode === 'playlist') return ncmPlaylist(this.cfg, target);
    // song / album / artist: 取列表后过滤
    const all = await ncmSearch(this.cfg, target);
    return all;
  }

  /** 获取单首 mp3 URL */
  async getUrl(track: Track): Promise<string | null> {
    if (track.url && !track.url.includes('types=url')) return track.url;
    if (this.cfg.kind === 'meting') return track.url || null;
    if (this.cfg.kind === 'gdstudio') return gdGetUrl(this.cfg, track);
    return ncmGetUrl(this.cfg, track.id);
  }

  /** 异步补封面 */
  async getPic(track: Track): Promise<string | null> {
    if (track.pic && !track.pic.includes('types=pic')) return track.pic;
    if (this.cfg.kind === 'meting') return track.pic || null;
    if (this.cfg.kind === 'gdstudio') return gdGetPic(this.cfg, track);
    return track.pic || null;
  }

  /** 异步拉歌词 */
  async getLyric(track: Track): Promise<string> {
    if (track.lyric) return track.lyric;
    if (this.cfg.kind === 'meting') {
      // meting 的 lrc 字段已在初次加载中拿到
      try {
        const u = buildUrl(this.cfg, {
          server: track.source,
          type: 'lrc',
          id: track.id,
          r: Math.random().toString(36).slice(2, 8),
        });
        return await fetchText(u);
      } catch {
        return '';
      }
    }
    if (this.cfg.kind === 'gdstudio') return gdGetLyric(this.cfg, track);
    return ncmGetLyric(this.cfg, track.id);
  }
}

/* ===================== LRC 解析 ===================== */

interface LyricLine {
  t: number;
  text: string;
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
    if (!text) continue;
    out.push({ t, text });
  }
  return out.sort((a, b) => a.t - b.t);
}

/* ===================== 多 API fallback 包装 ===================== */

async function tryWithFallback<T>(
  cfg: Config,
  fn: (c: Config) => Promise<T>,
): Promise<{ value: T; cfg: Config }> {
  let lastErr: unknown = null;
  // 当前 cfg 优先
  for (const url of uniqueGateways(cfg)) {
    const probe: Config = { ...cfg, gateway: url.url, kind: url.kind };
    try {
      const v = await fn(probe);
      // 成功 → 更新 cfg 记忆
      if (probe.gateway !== cfg.gateway || probe.kind !== cfg.kind) {
        persistConfig(probe);
      }
      return { value: v, cfg: probe };
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr ?? new Error('所有 API 均不可用');
}

function uniqueGateways(cfg: Config): { url: string; kind: GatewayKind }[] {
  const list: { url: string; kind: GatewayKind }[] = [];
  // 用户当前用的最优先
  list.push({ url: cfg.gateway, kind: cfg.kind });
  for (const f of FALLBACK_GATEWAYS) {
    if (!f.url) continue; // 自建占位
    if (list.some((x) => x.url === f.url && x.kind === f.kind)) continue;
    list.push({ url: f.url, kind: f.kind });
  }
  return list;
}

/* ===================== 主组件 ===================== */

export default function NeteaseMusic(_: AppProps) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [config, setConfig] = useState<Config>(loadConfig);
  const [showSettings, setShowSettings] = useState(false);

  /** 输入面板：mode + target */
  const [loadMode, setLoadMode] = useState<LoadMode>('playlist');
  const [target, setTarget] = useState('8820482645');
  const [loading, setLoading] = useState(false);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [tracks, setTracks] = useState<Track[]>([]);
  const [playlistName, setPlaylistName] = useState<string>('');

  const [currentIdx, setCurrentIdx] = useState(-1);
  const [playUrl, setPlayUrl] = useState<string | null>(null);
  const [loadingTrack, setLoadingTrack] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [position, setPosition] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(0.8);
  const [muted, setMuted] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [lyrics, setLyrics] = useState<LyricLine[]>([]);
  const [activeLyricIdx, setActiveLyricIdx] = useState(-1);
  const lyricScrollRef = useRef<HTMLDivElement>(null);

  const clientCfgRef = useRef<Config>(config);
  useEffect(() => {
    clientCfgRef.current = config;
  }, [config]);

  const current = currentIdx >= 0 && currentIdx < tracks.length ? tracks[currentIdx] : null;

  /* ----------------------- 加载歌曲列表 ----------------------- */
  const doLoad = useCallback(
    async (mode: LoadMode, id: string) => {
      const trimmed = id.trim();
      if (!trimmed) return;
      setLoading(true);
      setLoadErr(null);
      setTracks([]);
      setCurrentIdx(-1);
      setPlayUrl(null);
      setLyrics([]);
      try {
        const { value, cfg } = await tryWithFallback(config, (c) =>
          new MusicClient(c).load(mode, trimmed),
        );
        setConfig(cfg);
        setTracks(value);
        setPlaylistName(
          mode === 'search'
            ? `搜索：${trimmed}`
            : mode === 'playlist'
              ? `歌单 #${trimmed}`
              : mode === 'song'
                ? `单曲 #${trimmed}`
                : `${mode} #${trimmed}`,
        );
        if (value.length === 0) setLoadErr('没有获取到任何歌曲（资源可能为空）。');
      } catch (e: any) {
        setLoadErr(`加载失败：${String(e?.message ?? e)}。所有公共 API 都不可达，请检查网络或自建 API。`);
      } finally {
        setLoading(false);
      }
    },
    [config],
  );

  // 启动时默认加载默认歌单
  useEffect(() => {
    void doLoad('playlist', '8820482645');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* ----------------------- 播放某首 ----------------------- */
  const playAt = useCallback(
    async (idx: number) => {
      const track = tracks[idx];
      if (!track) return;
      setError(null);
      setCurrentIdx(idx);
      setPlayUrl(null);
      setLoadingTrack(true);
      setLyrics([]);
      setActiveLyricIdx(-1);
      try {
        const cfg = clientCfgRef.current;
        const mc = new MusicClient(cfg);
        const [url, pic, lyric] = await Promise.all([
          mc.getUrl(track),
          mc.getPic(track),
          mc.getLyric(track),
        ]);
        if (url) {
          setPlayUrl(url);
          // 回填 pic / lyric
          if (pic && !track.pic) {
            setTracks((prev) => {
              const next = prev.slice();
              next[idx] = { ...next[idx], pic };
              return next;
            });
          }
          if (lyric) setLyrics(parseLrc(lyric));
        } else {
          setError('该歌曲没有可用播放链接（可能是 VIP 独占 / 版权下架 / API 网关未开放 URL 接口）。');
        }
      } catch (e: any) {
        setError(String(e?.message ?? e));
      } finally {
        setLoadingTrack(false);
      }
    },
    [tracks],
  );

  const playPrev = useCallback(() => {
    if (tracks.length === 0) return;
    const i = currentIdx <= 0 ? tracks.length - 1 : currentIdx - 1;
    void playAt(i);
  }, [tracks, currentIdx, playAt]);

  const playNext = useCallback(() => {
    if (tracks.length === 0) return;
    const i = currentIdx >= tracks.length - 1 ? 0 : currentIdx + 1;
    void playAt(i);
  }, [tracks, currentIdx, playAt]);

  /* ----------------------- audio 同步 ----------------------- */
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
      a.play().catch((err) => {
        console.warn('[netease] play failed:', err);
        setPlaying(false);
      });
    } else {
      a.pause();
    }
  }, [playing, playUrl]);

  useEffect(() => {
    const a = audioRef.current;
    if (a) a.volume = muted ? 0 : volume;
  }, [volume, muted]);

  /* 切下一首 */
  useEffect(() => {
    const a = audioRef.current;
    if (!a) return;
    const onEnded = () => playNext();
    a.addEventListener('ended', onEnded);
    return () => a.removeEventListener('ended', onEnded);
  }, [playNext]);

  /* ----------------------- 歌词滚动 ----------------------- */
  useEffect(() => {
    if (lyrics.length === 0) return;
    const a = audioRef.current;
    if (!a) return;
    const idx = lyrics.findIndex((ln, i) => {
      const next = lyrics[i + 1];
      return a.currentTime >= ln.t && (!next || a.currentTime < next.t);
    });
    setActiveLyricIdx(idx);
    const el = lyricScrollRef.current;
    if (el && idx >= 0) {
      const lineEl = el.children[idx] as HTMLElement | undefined;
      if (lineEl) {
        const top = lineEl.offsetTop - el.clientHeight / 2 + lineEl.clientHeight / 2;
        el.scrollTo({ top, behavior: 'smooth' });
      }
    }
  }, [position, lyrics]);

  /* ----------------------- 快捷键 ----------------------- */
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

  /* ----------------------- 持久化 config ----------------------- */
  const updateConfig = (patch: Partial<Config>) => {
    setConfig((prev) => {
      const next = { ...prev, ...patch };
      persistConfig(next);
      return next;
    });
  };

  /* ----------------------- UI helpers ----------------------- */
  const fmtTime = (sec: number) => {
    if (!isFinite(sec) || sec < 0) return '0:00';
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60);
    return `${m}:${String(s).padStart(2, '0')}`;
  };

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    void doLoad(loadMode, target);
  };

  const playlistHeader = useMemo(
    () =>
      `${playlistName || '未加载'}  ·  ${tracks.length} 首`,
    [playlistName, tracks.length],
  );

  return (
    <div className="flex h-full bg-zinc-950 text-zinc-100">
      <audio
        ref={audioRef}
        onLoadedMetadata={(e) => setDuration(e.currentTarget.duration)}
        onTimeUpdate={(e) => setPosition(e.currentTarget.currentTime)}
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onError={() => {
          setError('播放失败，链接可能已失效 / 浏览器拒绝解码（CORS / Codec） / 歌曲下架。');
          setPlaying(false);
        }}
      />

      {/* 左侧：加载 + 列表 */}
      <aside className="flex w-80 shrink-0 flex-col border-r border-zinc-800">
        <div className="flex items-center gap-2 border-b border-zinc-800 px-3 py-2.5">
          <Music size={16} className="text-rose-400" />
          <span className="text-sm font-medium">Meting 音乐</span>
          <span className="ml-1 truncate text-[10px] text-zinc-500">
            {SOURCES.find((s) => s.id === config.source)?.label}
            {' · '}
            {config.kind}
          </span>
          <button
            onClick={() => setShowSettings((v) => !v)}
            className={cn(
              'ml-auto rounded p-1.5 hover:bg-zinc-800',
              showSettings && 'bg-indigo-600/30 text-indigo-300',
            )}
            title="API 设置"
          >
            <SettingsIcon size={14} />
          </button>
        </div>

        {showSettings && (
          <ConfigPanel
            config={config}
            onChange={updateConfig}
            onClose={() => setShowSettings(false)}
          />
        )}

        {/* 输入区 */}
        <form onSubmit={submit} className="space-y-1.5 border-b border-zinc-800 p-2.5">
          <div className="flex gap-1">
            {(['playlist', 'song', 'search'] as LoadMode[]).map((m) => (
              <button
                type="button"
                key={m}
                onClick={() => setLoadMode(m)}
                className={cn(
                  'flex-1 rounded border px-2 py-1 text-[11px]',
                  loadMode === m
                    ? 'border-indigo-500 bg-indigo-600/20 text-indigo-200'
                    : 'border-zinc-700 hover:bg-zinc-800',
                )}
              >
                {m === 'playlist' ? '歌单' : m === 'song' ? '单曲' : '搜索'}
              </button>
            ))}
          </div>
          <div className="flex gap-1.5">
            <input
              value={target}
              onChange={(e) => setTarget(e.target.value)}
              placeholder={
                loadMode === 'search'
                  ? '搜歌曲 / 歌手'
                  : loadMode === 'playlist'
                    ? '网易云歌单 ID'
                    : '单曲 ID'
              }
              className="min-w-0 flex-1 rounded border border-zinc-700 bg-zinc-900 px-2.5 py-1.5 text-xs outline-none focus:border-indigo-500"
            />
            <button
              type="submit"
              disabled={loading}
              className="flex items-center gap-1 rounded bg-indigo-600 px-3 py-1.5 text-xs hover:bg-indigo-500 disabled:opacity-50"
            >
              {loading ? (
                <Loader2 size={13} className="animate-spin" />
              ) : (
                <Search size={13} />
              )}
              加载
            </button>
          </div>
          {loadErr && (
            <div className="flex items-start gap-1 rounded bg-rose-950/40 px-2 py-1 text-[10.5px] text-rose-200">
              <AlertCircle size={11} className="mt-0.5 shrink-0" />
              <span>{loadErr}</span>
            </div>
          )}
        </form>

        {/* 快捷歌单 */}
        <div className="border-b border-zinc-800 px-2 py-1.5">
          <div className="mb-1 text-[10px] uppercase tracking-wider text-zinc-500">
            网易云 · 快捷
          </div>
          <div className="flex flex-wrap gap-1">
            {HOT_PLAYLISTS.map((p) => {
              const Icon = p.icon;
              return (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => {
                    setLoadMode('playlist');
                    setTarget(p.id);
                    void doLoad('playlist', p.id);
                  }}
                  className="flex items-center gap-1 rounded-full border border-zinc-700 bg-zinc-900/60 px-2 py-0.5 text-[10.5px] hover:border-indigo-500 hover:text-indigo-200"
                  title={`ID: ${p.id}`}
                >
                  <Icon size={10} />
                  {p.name}
                </button>
              );
            })}
          </div>
        </div>

        {/* 歌曲列表 */}
        <div className="flex items-center justify-between px-3 py-1.5 text-[10px] text-zinc-500">
          <span className="truncate">{playlistHeader}</span>
          {tracks.length > 0 && (
            <button
              type="button"
              onClick={() => tracks.length > 0 && playAt(0)}
              className="rounded p-1 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200"
              title="从头播放"
            >
              <Play size={11} />
            </button>
          )}
        </div>
        <div className="flex-1 overflow-y-auto">
          {tracks.length === 0 && !loading && (
            <div className="px-4 py-10 text-center text-xs text-zinc-500">
              <Disc3 size={36} className="mx-auto mb-2 opacity-30" />
              <p>歌单为空</p>
              <p className="mt-1 text-[10px] text-zinc-600">
                输入歌单 ID 或点上方快捷歌单
              </p>
            </div>
          )}
          {tracks.map((t, i) => (
            <TrackRow
              key={`${t.source}-${t.id}-${i}`}
              index={i}
              track={t}
              active={i === currentIdx}
              loading={loadingTrack && i === currentIdx}
              onClick={() => void playAt(i)}
            />
          ))}
        </div>
      </aside>

      {/* 右侧：播放器 + 歌词 */}
      <main className="flex min-w-0 flex-1 flex-col bg-gradient-to-br from-zinc-950 via-zinc-900 to-zinc-950">
        {current ? (
          <NowPlaying
            track={current}
            playUrl={playUrl}
            loading={loadingTrack}
            playing={playing}
            position={position}
            duration={duration}
            volume={volume}
            muted={muted}
            error={error}
            onTogglePlay={() => setPlaying((p) => !p)}
            onPrev={playPrev}
            onNext={playNext}
            onSeek={(t) => {
              const a = audioRef.current;
              if (a) a.currentTime = t;
              setPosition(t);
            }}
            onVolumeChange={setVolume}
            onToggleMute={() => setMuted((m) => !m)}
            fmtTime={fmtTime}
          />
        ) : (
          <EmptyState />
        )}

        {current && lyrics.length > 0 && (
          <div
            ref={lyricScrollRef}
            className="h-44 overflow-y-auto border-t border-zinc-800/60 bg-black/30 px-6 py-3 text-center text-[13px] leading-7"
          >
            {lyrics.map((ln, i) => (
              <p
                key={i}
                className={cn(
                  'transition-all',
                  i === activeLyricIdx
                    ? 'scale-105 font-medium text-rose-300'
                    : 'text-zinc-500',
                )}
              >
                {ln.text}
              </p>
            ))}
          </div>
        )}
        {current && lyrics.length === 0 && (
          <div className="h-12 border-t border-zinc-800/60 bg-black/30 text-center text-[11px] leading-[3rem] text-zinc-600">
            暂无歌词
          </div>
        )}
      </main>
    </div>
  );
}

/* ===================== 子组件 ===================== */

function TrackRow({
  index,
  track,
  active,
  loading,
  onClick,
}: {
  index: number;
  track: Track;
  active: boolean;
  loading?: boolean;
  onClick: () => void;
}) {
  return (
    <div
      onClick={onClick}
      className={cn(
        'group flex cursor-pointer items-center gap-2 border-b border-zinc-900 px-3 py-1.5 hover:bg-zinc-900/70',
        active && 'bg-indigo-600/15',
      )}
    >
      <span className="w-5 shrink-0 text-center text-[10px] tabular-nums text-zinc-600">
        {active && loading ? (
          <Loader2 size={11} className="mx-auto animate-spin text-indigo-300" />
        ) : active ? (
          <Disc3 size={12} className="mx-auto animate-spin-slow text-rose-400" />
        ) : (
          index + 1
        )}
      </span>
      <div className="min-w-0 flex-1">
        <div className="truncate text-[12.5px]">{track.name}</div>
        <div className="truncate text-[10.5px] text-zinc-500">{track.artist}</div>
      </div>
      <ChevronRight
        size={12}
        className="shrink-0 text-zinc-700 opacity-0 transition group-hover:opacity-100"
      />
    </div>
  );
}

function NowPlaying(props: {
  track: Track;
  playUrl: string | null;
  loading: boolean;
  playing: boolean;
  position: number;
  duration: number;
  volume: number;
  muted: boolean;
  error: string | null;
  onTogglePlay: () => void;
  onPrev: () => void;
  onNext: () => void;
  onSeek: (t: number) => void;
  onVolumeChange: (v: number) => void;
  onToggleMute: () => void;
  fmtTime: (s: number) => string;
}) {
  const {
    track,
    playUrl,
    loading,
    playing,
    position,
    duration,
    volume,
    muted,
    error,
    onTogglePlay,
    onPrev,
    onNext,
    onSeek,
    onVolumeChange,
    onToggleMute,
    fmtTime,
  } = props;

  const ratio = duration > 0 ? Math.min(1, position / duration) : 0;
  const seekBarRef = useRef<HTMLDivElement>(null);

  const onSeekPointerDown = (e: React.PointerEvent) => {
    const bar = seekBarRef.current;
    if (!bar || duration <= 0) return;
    const rect = bar.getBoundingClientRect();
    const r = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    onSeek(r * duration);
    const move = (ev: PointerEvent) => {
      const rr = bar.getBoundingClientRect();
      const x = Math.max(0, Math.min(rr.width, ev.clientX - rr.left));
      onSeek((x / rr.width) * duration);
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  return (
    <div className="flex flex-1 items-center justify-center p-8">
      <div className="flex w-full max-w-2xl gap-8">
        {/* 封面 */}
        <div className="relative aspect-square w-60 shrink-0 overflow-hidden rounded-xl bg-gradient-to-br from-rose-500 via-pink-500 to-fuchsia-600 shadow-2xl shadow-rose-900/40">
          {track.pic ? (
            <img src={track.pic} alt={track.album} className="h-full w-full object-cover" />
          ) : (
            <div className="flex h-full items-center justify-center text-white/90">
              <Disc3 size={84} className={cn(playing && 'animate-spin-slow')} />
            </div>
          )}
        </div>

        {/* 信息 + 控件 */}
        <div className="flex min-w-0 flex-1 flex-col justify-between">
          <div className="min-w-0">
            <div className="truncate text-xl font-semibold" title={track.name}>
              {track.name}
            </div>
            <div className="mt-1 truncate text-sm text-zinc-400">{track.artist}</div>
            {track.album && (
              <div className="mt-0.5 truncate text-xs text-zinc-500">{track.album}</div>
            )}
          </div>

          {error && (
            <div className="mt-3 flex items-start gap-1.5 rounded border border-rose-700/60 bg-rose-950/40 p-2 text-[11px] text-rose-200">
              <AlertCircle size={12} className="mt-0.5 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          <div className="mt-4">
            <div
              ref={seekBarRef}
              onPointerDown={onSeekPointerDown}
              className="group relative h-1.5 cursor-pointer rounded-full bg-zinc-800"
            >
              <div
                className="absolute inset-y-0 left-0 rounded-full bg-rose-500"
                style={{ width: `${ratio * 100}%` }}
              />
            </div>
            <div className="mt-1 flex justify-between text-[10px] tabular-nums text-zinc-500">
              <span>{fmtTime(position)}</span>
              <span>{fmtTime(duration)}</span>
            </div>
          </div>

          <div className="mt-3 flex items-center gap-3 text-zinc-300">
            <button
              onClick={onPrev}
              className="rounded p-2 hover:bg-zinc-800"
              title="上一首"
            >
              <SkipBack size={18} />
            </button>
            <button
              onClick={onTogglePlay}
              disabled={!playUrl || loading}
              className="flex size-12 items-center justify-center rounded-full bg-white text-black hover:scale-105 active:scale-95 disabled:opacity-50"
              title="播放/暂停"
            >
              {loading ? (
                <Loader2 size={20} className="animate-spin" />
              ) : playing ? (
                <Pause size={20} fill="currentColor" />
              ) : (
                <Play size={20} fill="currentColor" className="ml-0.5" />
              )}
            </button>
            <button
              onClick={onNext}
              className="rounded p-2 hover:bg-zinc-800"
              title="下一首"
            >
              <SkipForward size={18} />
            </button>
            <button
              onClick={onToggleMute}
              className="ml-2 rounded p-2 hover:bg-zinc-800"
              title="静音"
            >
              {muted || volume === 0 ? <VolumeX size={18} /> : <Volume2 size={18} />}
            </button>
            <input
              type="range"
              min={0}
              max={1}
              step={0.01}
              value={muted ? 0 : volume}
              onChange={(e) => onVolumeChange(Number(e.target.value))}
              className="h-1 w-24 accent-rose-500"
            />
            {playUrl && (
              <a
                href={playUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="ml-auto rounded p-1.5 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200"
                title="新窗口打开播放链接"
              >
                <ExternalLink size={14} />
              </a>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function EmptyState() {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-3 text-zinc-500">
      <Disc3 size={80} className="opacity-30" />
      <p className="text-base">还没有选歌</p>
      <p className="max-w-sm text-center text-xs text-zinc-600">
        左侧输入歌单 ID / 搜索关键词 / 点击快捷歌单 → 选歌播放。
        全部走 Meting API，浏览器直接播放 mp3，零后端依赖。
      </p>
      <p className="mt-2 text-[10px] text-zinc-700">
        快捷键：← 上一首 · → 下一首 · 空格 播放/暂停
      </p>
    </div>
  );
}

function ConfigPanel({
  config,
  onChange,
  onClose,
}: {
  config: Config;
  onChange: (patch: Partial<Config>) => void;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState(config.gateway);
  const [draftKind, setDraftKind] = useState<GatewayKind>(config.kind);
  useEffect(() => {
    setDraft(config.gateway);
    setDraftKind(config.kind);
  }, [config.gateway, config.kind]);

  const applyDraft = () => {
    const v = draft.trim();
    if (!v) return;
    onChange({ gateway: v, kind: draftKind });
  };

  return (
    <div className="border-b border-zinc-800 bg-zinc-900/70 p-3 text-xs">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-[11px] font-medium uppercase tracking-wider text-zinc-400">
          API 设置
        </span>
        <button onClick={onClose} className="rounded p-1 hover:bg-zinc-800" title="关闭">
          <X size={12} />
        </button>
      </div>

      <label className="mb-1 block text-[11px] text-zinc-500">协议</label>
      <div className="mb-2 grid grid-cols-3 gap-1">
        {(
          [
            { k: 'meting', label: 'Meting' },
            { k: 'gdstudio', label: 'GD Studio' },
            { k: 'netease-api', label: 'NCM API' },
          ] as const
        ).map((opt) => (
          <button
            key={opt.k}
            onClick={() => setDraftKind(opt.k)}
            className={cn(
              'flex items-center justify-center gap-1 rounded border px-2 py-1 text-[11px]',
              draftKind === opt.k
                ? 'border-indigo-500 bg-indigo-600/20 text-indigo-200'
                : 'border-zinc-700 hover:bg-zinc-800',
            )}
          >
            {draftKind === opt.k && <Check size={10} />}
            {opt.label}
          </button>
        ))}
      </div>

      <label className="mb-1 block text-[11px] text-zinc-500">网关地址</label>
      <input
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={applyDraft}
        onKeyDown={(e) => {
          if (e.key === 'Enter') applyDraft();
        }}
        placeholder={
          draftKind === 'meting'
            ? 'https://api.i-meto.com/meting/api'
            : draftKind === 'gdstudio'
              ? 'https://music-api.gdstudio.xyz/api.php'
              : 'https://your-ncm-api.vercel.app'
        }
        className="mb-1 w-full rounded border border-zinc-700 bg-zinc-950 px-2 py-1 text-[11px] outline-none focus:border-indigo-500"
      />
      <p className="mb-2 text-[10px] text-zinc-600">
        应用启动时会自动用 tryWithFallback 探测主 + 备用网关，第一个成功的被记忆到 localStorage。
      </p>

      <label className="mb-1 block text-[11px] text-zinc-500">音乐源</label>
      <div className="mb-2 grid grid-cols-4 gap-1">
        {SOURCES.map((s) => (
          <button
            key={s.id}
            onClick={() => onChange({ source: s.id })}
            className={cn(
              'rounded border px-2 py-1 text-[11px]',
              config.source === s.id
                ? 'border-indigo-500 bg-indigo-600/20 text-indigo-200'
                : 'border-zinc-700 hover:bg-zinc-800',
            )}
          >
            {s.label}
          </button>
        ))}
      </div>
    </div>
  );
}