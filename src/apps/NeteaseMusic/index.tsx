import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertCircle,
  Disc3,
  ListMusic,
  Loader2,
  Music,
  Pause,
  Play,
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
 * 音乐数据层：Meting / GD Studio / 自建 NCM API 三协议
 * ============================================================
 *
 * 网易云官方接口有 Cookie + 风控限制，浏览器侧不可直连，
 * 这里统一走聚合网关拿 mp3 直链，前端 <audio> 直接播放：
 *
 * - Meting  : ?server=netease&type={search|playlist|song|lrc}&id=...
 * - GDStudio: ?types={search|url|pic|lyric}&source=netease&id=...
 * - NCM API : /search /song/url /lyric /playlist/detail（自建）
 *
 * 内置公共网关随时可能失效，设置面板里可换成自己的地址，
 * 换过之后成功的选择会记到 localStorage。
 * ============================================================ */

const STORAGE_KEY = 'arch-web-netease:config';

type Source = 'netease' | 'tencent' | 'kuwo' | 'bilibili';
type LoadMode = 'search' | 'playlist' | 'song';
type GatewayKind = 'meting' | 'gdstudio' | 'netease-api';

interface Config {
  gateway: string;
  kind: GatewayKind;
  source: Source;
  auth?: string;
}

const DEFAULT_CONFIG: Config = {
  gateway: '',
  kind: 'netease-api',
  source: 'netease',
};

const FALLBACK_GATEWAYS: { url: string; kind: GatewayKind; label: string }[] = [
  { url: 'https://api.i-meto.com/meting/api', kind: 'meting', label: 'Meting · i-meto' },
  { url: 'https://music-api.gdstudio.xyz/api.php', kind: 'gdstudio', label: 'GD Studio' },
];

const SOURCES: { id: Source; label: string }[] = [
  { id: 'netease', label: '网易云' },
  { id: 'tencent', label: 'QQ' },
  { id: 'kuwo', label: '酷我' },
  { id: 'bilibili', label: 'B 站' },
];

const HOT_PLAYLISTS = [
  { id: '8820482645', name: '我喜欢的音乐' },
  { id: '3778678', name: '热歌榜' },
  { id: '3779629', name: '新歌榜' },
  { id: '4395559', name: '华语金曲' },
  { id: '19723756', name: '飙升榜' },
];

interface Track {
  id: string;
  name: string;
  artist: string;
  album: string;
  url: string;
  pic: string;
  lyric?: string;
  source: Source;
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

/* ------------------------- API 实现 ------------------------- */

interface RawMeting {
  title?: string;
  author?: string;
  url?: string;
  pic?: string;
  lrc?: string;
}

interface RawGDItem {
  id: string;
  name: string;
  artist?: string[];
  album?: string;
  source?: string;
}

interface RawNCMSong {
  id: number;
  name: string;
  ar?: { name: string }[];
  al?: { name?: string; picUrl?: string };
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

/* Meting：搜索 / 歌单 / 单曲共用一个端点 */

async function metingLoad(cfg: Config, mode: LoadMode, id: string): Promise<Track[]> {
  const type = mode === 'song' ? 'song' : mode;
  const u = buildUrl(cfg, {
    server: cfg.source,
    type,
    id,
    r: Math.random().toString(36).slice(2, 10),
    ...(cfg.auth ? { auth: cfg.auth } : {}),
  });
  const arr = await fetchJson<RawMeting[]>(u);
  if (!Array.isArray(arr)) return [];
  return arr
    .filter((m) => m.url)
    .map((m) => ({
      id: String(m.url?.match(/id=(\d+)/)?.[1] ?? m.title ?? ''),
      name: m.title ?? '未知歌曲',
      artist: m.author ?? '未知艺人',
      album: '',
      url: m.url ?? '',
      pic: m.pic ?? '',
      lyric: m.lrc,
      source: cfg.source,
    }));
}

/* GD Studio：分步取 url / pic / lyric */

async function gdSearch(cfg: Config, kw: string): Promise<Track[]> {
  const u = buildUrl(cfg, { types: 'search', source: cfg.source, name: kw, count: 30, pages: 1 });
  const arr = await fetchJson<RawGDItem[]>(u);
  if (!Array.isArray(arr)) return [];
  return arr.map((s) => ({
    id: s.id,
    name: s.name,
    artist: (s.artist ?? []).join(' / '),
    album: s.album ?? '',
    url: '',
    pic: '',
    lyric: '',
    source: (s.source as Source) ?? cfg.source,
  }));
}

async function gdGetUrl(cfg: Config, track: Track): Promise<string | null> {
  const u = buildUrl(cfg, { types: 'url', source: track.source, id: track.id, br: 320 });
  const r = await fetchJson<{ url?: string }>(u);
  return r?.url || null;
}

async function gdGetPic(cfg: Config, track: Track): Promise<string | null> {
  try {
    const u = buildUrl(cfg, { types: 'pic', source: track.source, id: track.id, size: 300 });
    const r = await fetchJson<{ url?: string }>(u);
    return r?.url || null;
  } catch {
    return null;
  }
}

async function gdGetLyric(cfg: Config, track: Track): Promise<string> {
  try {
    const u = buildUrl(cfg, { types: 'lyric', source: track.source, id: track.id });
    const r = await fetchJson<{ lyric?: string }>(u);
    return r?.lyric ?? '';
  } catch {
    return '';
  }
}

/* 自建 NCM API */

function ncmBase(cfg: Config): string {
  return cfg.gateway.replace(/\/+$/, '');
}

function ncmMap(songs: RawNCMSong[]): Track[] {
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

async function ncmSearch(cfg: Config, kw: string): Promise<Track[]> {
  const u = `${ncmBase(cfg)}/search?keywords=${encodeURIComponent(kw)}&limit=30`;
  const r = await fetchJson<{ result?: { songs?: RawNCMSong[] } }>(u);
  return ncmMap(r?.result?.songs ?? []);
}

async function ncmPlaylist(cfg: Config, id: string): Promise<Track[]> {
  const u = `${ncmBase(cfg)}/playlist/detail?id=${id}`;
  const r = await fetchJson<{ playlist?: { tracks?: RawNCMSong[] } }>(u);
  return ncmMap(r?.playlist?.tracks ?? []);
}

async function ncmGetUrl(cfg: Config, id: string): Promise<string | null> {
  const u = `${ncmBase(cfg)}/song/url?id=${id}&br=320000`;
  const r = await fetchJson<{ data?: { url?: string }[] }>(u);
  return r?.data?.[0]?.url || null;
}

async function ncmGetLyric(cfg: Config, id: string): Promise<string> {
  try {
    const u = `${ncmBase(cfg)}/lyric?id=${id}`;
    const r = await fetchJson<{ lrc?: { lyric?: string } }>(u);
    return r?.lrc?.lyric ?? '';
  } catch {
    return '';
  }
}

/* B 站源：直接搜视频当音频听 */

async function bilibiliSearch(_: Config, kw: string): Promise<Track[]> {
  const u = `https://api.bilibili.com/x/web-interface/search/type?search_type=video&keyword=${encodeURIComponent(kw)}&page=1&pagesize=20`;
  const r = await fetchJson<{ code?: number; data?: { result?: Array<{ bvid?: string; title?: string; owner?: { name?: string }; pic?: string }> } }>(u);
  if (r?.code !== 0) throw new Error(r ? 'B 站搜索失败' : 'B 站搜索失败');
  return (r.data?.result ?? []).map((item) => ({
    id: item.bvid ?? '',
    name: item.title?.replace(/<[^>]+>/g, '') ?? 'B站视频',
    artist: item.owner?.name ?? '未知UP主',
    album: 'B 站',
    url: '',
    pic: item.pic ?? '',
    lyric: '',
    source: 'bilibili' as Source,
  }));
}

async function bilibiliGetUrl(track: Track): Promise<string | null> {
  const view = await fetchJson<{ code?: number; data?: { cid?: number; pages?: Array<{ cid?: number }> } }>(
    `https://api.bilibili.com/x/web-interface/view?bvid=${encodeURIComponent(track.id)}`,
  );
  const cid = view.data?.cid ?? view.data?.pages?.[0]?.cid;
  if (!cid) return null;
  const play = await fetchJson<{
    code?: number;
    data?: { durl?: Array<{ url?: string }>; dash?: { audio?: Array<{ base_url?: string }> } };
  }>(
    `https://api.bilibili.com/x/player/playurl?bvid=${encodeURIComponent(track.id)}&cid=${cid}&qn=80&platform=html5&high_quality=1`,
  );
  return play.data?.durl?.[0]?.url ?? play.data?.dash?.audio?.[0]?.base_url ?? null;
}

/* ------------------------- 客户端 + fallback ------------------------- */

class MusicClient {
  constructor(private cfg: Config) {}

  async load(mode: LoadMode, target: string): Promise<Track[]> {
    if (this.cfg.source === 'bilibili') return bilibiliSearch(this.cfg, target);
    if (this.cfg.kind === 'meting') return metingLoad(this.cfg, mode, target);
    if (this.cfg.kind === 'gdstudio') {
      if (mode === 'search') return gdSearch(this.cfg, target);
      const u = buildUrl(this.cfg, { types: mode, source: this.cfg.source, id: target });
      const arr = await fetchJson<RawGDItem[]>(u);
      return (Array.isArray(arr) ? arr : []).map((s) => ({
        id: s.id,
        name: s.name,
        artist: (s.artist ?? []).join(' / '),
        album: s.album ?? '',
        url: '',
        pic: '',
        lyric: '',
        source: (s.source as Source) ?? this.cfg.source,
      }));
    }
    if (mode === 'search') return ncmSearch(this.cfg, target);
    if (mode === 'playlist') return ncmPlaylist(this.cfg, target);
    return ncmSearch(this.cfg, target);
  }

  async getUrl(track: Track): Promise<string | null> {
    if (this.cfg.source === 'bilibili') return bilibiliGetUrl(track);
    if (track.url) return track.url;
    if (this.cfg.kind === 'meting') return null;
    if (this.cfg.kind === 'gdstudio') return gdGetUrl(this.cfg, track);
    return ncmGetUrl(this.cfg, track.id);
  }

  async getPic(track: Track): Promise<string | null> {
    if (this.cfg.source === 'bilibili') return track.pic || null;
    if (track.pic) return track.pic;
    if (this.cfg.kind === 'gdstudio') return gdGetPic(this.cfg, track);
    return track.pic || null;
  }

  async getLyric(track: Track): Promise<string> {
    if (this.cfg.source === 'bilibili') return '';
    if (track.lyric) return track.lyric;
    if (this.cfg.kind === 'meting') {
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

function uniqueGateways(cfg: Config): { url: string; kind: GatewayKind }[] {
  const list: { url: string; kind: GatewayKind }[] = [];
  if (cfg.gateway.trim()) list.push({ url: cfg.gateway.trim(), kind: cfg.kind });
  for (const f of FALLBACK_GATEWAYS) {
    if (!f.url) continue;
    if (list.some((x) => x.url === f.url && x.kind === f.kind)) continue;
    list.push({ url: f.url, kind: f.kind });
  }
  return list;
}

async function tryWithFallback<T>(
  cfg: Config,
  fn: (c: Config) => Promise<T>,
): Promise<{ value: T; cfg: Config }> {
  const candidates = uniqueGateways(cfg).filter((g) => g.url.length > 0);
  if (candidates.length === 0) {
    throw new Error('未配置可用网关，请在设置里填写自建 API 地址');
  }

  let lastErr: unknown = null;
  for (const g of candidates) {
    const probe: Config = { ...cfg, gateway: g.url, kind: g.kind };
    try {
      const value = await fn(probe);
      if (probe.gateway !== cfg.gateway || probe.kind !== cfg.kind) persistConfig(probe);
      return { value, cfg: probe };
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr ?? new Error('所有网关均不可用');
}

/* ------------------------- LRC ------------------------- */

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
    const text = m[3].trim();
    if (!text) continue;
    out.push({ t: Number(m[1]) * 60 + Number(m[2]), text });
  }
  return out.sort((a, b) => a.t - b.t);
}

/* ------------------------- 主组件 ------------------------- */

export default function NeteaseMusic(_: AppProps) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [config, setConfig] = useState<Config>(loadConfig);
  const [showSettings, setShowSettings] = useState(false);

  const [loadMode, setLoadMode] = useState<LoadMode>('search');
  const [target, setTarget] = useState('');
  const [loading, setLoading] = useState(false);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [tracks, setTracks] = useState<Track[]>([]);
  const [listName, setListName] = useState('');

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

  const cfgRef = useRef(config);
  useEffect(() => {
    cfgRef.current = config;
  }, [config]);

  /* 异步取播放链接时用户可能已点别的歌：令牌过期即丢弃 */
  const playTokenRef = useRef(0);
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const current = currentIdx >= 0 && currentIdx < tracks.length ? tracks[currentIdx] : null;

  const doLoad = useCallback(
    async (mode: LoadMode, id: string) => {
      const kw = id.trim();
      if (!kw) return;
      setLoading(true);
      setLoadErr(null);
      setTracks([]);
      setCurrentIdx(-1);
      setPlayUrl(null);
      setLyrics([]);
      try {
        const { value, cfg } = await tryWithFallback(cfgRef.current, (c) =>
          new MusicClient(c).load(mode, kw),
        );
        setConfig(cfg);
        setTracks(value);
        setListName(mode === 'search' ? `搜索 ${kw}` : mode === 'playlist' ? `歌单 ${kw}` : `单曲 ${kw}`);
        if (value.length === 0) setLoadErr('没有取到歌曲，可能列表为空或版权受限');
      } catch (e) {
        setLoadErr(e instanceof Error ? e.message : '加载失败');
      } finally {
        setLoading(false);
      }
    },
    [],
  );

  const playAt = useCallback(
    async (idx: number) => {
      const track = tracks[idx];
      if (!track) return;
      const token = ++playTokenRef.current;
      const stale = () => token !== playTokenRef.current || !mountedRef.current;
      setError(null);
      setCurrentIdx(idx);
      setPlayUrl(null);
      setLoadingTrack(true);
      setLyrics([]);
      setActiveLyricIdx(-1);
      try {
        const mc = new MusicClient(cfgRef.current);
        const [url, pic, lyric] = await Promise.all([
          mc.getUrl(track),
          mc.getPic(track),
          mc.getLyric(track),
        ]);
        if (stale()) return;
        if (url) {
          setPlayUrl(url);
          if (pic && !track.pic) {
            setTracks((prev) => {
              if (prev[idx]?.id !== track.id) return prev;
              const next = prev.slice();
              next[idx] = { ...next[idx], pic };
              return next;
            });
          }
          if (lyric) setLyrics(parseLrc(lyric));
        } else {
          setError('没有可用播放链接（VIP / 版权 / 网关不支持）');
        }
      } catch (e) {
        if (!stale()) setError(e instanceof Error ? e.message : '获取播放链接失败');
      } finally {
        if (!stale()) setLoadingTrack(false);
      }
    },
    [tracks],
  );

  const playPrev = useCallback(() => {
    if (tracks.length === 0) return;
    void playAt(currentIdx <= 0 ? tracks.length - 1 : currentIdx - 1);
  }, [tracks, currentIdx, playAt]);

  const playNext = useCallback(() => {
    if (tracks.length === 0) return;
    void playAt(currentIdx >= tracks.length - 1 ? 0 : currentIdx + 1);
  }, [tracks, currentIdx, playAt]);

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
    const onEnded = () => playNext();
    a.addEventListener('ended', onEnded);
    return () => a.removeEventListener('ended', onEnded);
  }, [playNext]);

  /* 歌词跟随滚动 */
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
        el.scrollTo({ top: lineEl.offsetTop - el.clientHeight / 2, behavior: 'smooth' });
      }
    }
  }, [position, lyrics]);

  /* 快捷键 */
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

  const fmtTime = (sec: number) => {
    if (!isFinite(sec) || sec < 0) return '0:00';
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60);
    return `${m}:${String(s).padStart(2, '0')}`;
  };

  const updateConfig = (patch: Partial<Config>) => {
    setConfig((prev) => {
      const next = { ...prev, ...patch };
      persistConfig(next);
      return next;
    });
  };

  const ratio = duration > 0 ? Math.min(1, position / duration) : 0;
  const seekBarRef = useRef<HTMLDivElement>(null);

  const onSeekPointerDown = (e: React.PointerEvent) => {
    const bar = seekBarRef.current;
    if (!bar || duration <= 0) return;
    const rect = bar.getBoundingClientRect();
    onSeek(Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width)) * duration);
    const move = (ev: PointerEvent) => {
      const r = bar.getBoundingClientRect();
      onSeek(Math.max(0, Math.min(r.width, ev.clientX - r.left)) / r.width * duration);
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  const onSeek = (t: number) => {
    const a = audioRef.current;
    if (a) a.currentTime = t;
    setPosition(t);
  };

  const sourceLabel = useMemo(
    () => SOURCES.find((s) => s.id === config.source)?.label ?? '',
    [config.source],
  );

  return (
    <div className="flex h-full bg-arch-bg text-arch-text">
      <audio
        ref={audioRef}
        onLoadedMetadata={(e) => setDuration(e.currentTarget.duration)}
        onTimeUpdate={(e) => setPosition(e.currentTarget.currentTime)}
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onError={() => {
          setError('播放失败：链接失效或浏览器不支持该格式');
          setPlaying(false);
        }}
      />

      {/* 左：列表 */}
      <aside className="flex w-72 shrink-0 flex-col border-r border-arch-border">
        <div className="flex items-center gap-2 border-b border-arch-border px-3 py-2">
          <Music size={14} className="text-arch-accent" />
          <span className="text-xs font-medium">音乐</span>
          <span className="text-[10px] text-arch-muted">{sourceLabel}</span>
          <button
            onClick={() => setShowSettings((v) => !v)}
            className={cn('ml-auto rounded p-1.5 hover:bg-white/5', showSettings && 'bg-arch-accent/15 text-arch-accent')}
            title="API 设置"
          >
            <SettingsIcon size={13} />
          </button>
        </div>

        {showSettings && (
          <ConfigPanel config={config} onChange={updateConfig} onClose={() => setShowSettings(false)} />
        )}

        {/* 搜索 / 加载 */}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void doLoad(loadMode, target);
          }}
          className="space-y-1.5 border-b border-arch-border p-2.5"
        >
          <div className="flex gap-1">
            {(['search', 'playlist', 'song'] as LoadMode[]).map((m) => (
              <button
                type="button"
                key={m}
                onClick={() => setLoadMode(m)}
                className={cn(
                  'flex-1 rounded border px-2 py-1 text-[11px] transition',
                  loadMode === m
                    ? 'border-arch-accent bg-arch-accent/15 text-arch-accent'
                    : 'border-arch-border text-arch-muted hover:bg-white/5',
                )}
              >
                {m === 'search' ? '搜索' : m === 'playlist' ? '歌单 ID' : '单曲 ID'}
              </button>
            ))}
          </div>
          <div className="flex gap-1.5">
            <input
              value={target}
              onChange={(e) => setTarget(e.target.value)}
              placeholder={loadMode === 'search' ? '歌曲 / 歌手' : '数字 ID'}
              className="min-w-0 flex-1 rounded border border-arch-border bg-black/30 px-2.5 py-1.5 text-xs outline-none focus:border-arch-accent"
            />
            <button
              type="submit"
              disabled={loading}
              className="flex items-center gap-1 rounded border border-arch-accent bg-arch-accent/15 px-3 py-1.5 text-xs text-arch-accent hover:bg-arch-accent/25 disabled:opacity-50"
            >
              {loading ? <Loader2 size={12} className="animate-spin" /> : <Search size={12} />}
            </button>
          </div>
          {loadErr && (
            <div className="flex items-start gap-1 rounded border border-arch-red/40 bg-arch-red/10 px-2 py-1 text-[10.5px] text-arch-red">
              <AlertCircle size={11} className="mt-0.5 shrink-0" />
              <span>{loadErr}</span>
            </div>
          )}
        </form>

        {/* 快捷歌单 */}
        <div className="border-b border-arch-border px-2.5 py-1.5">
          <div className="mb-1 flex items-center gap-1 text-[10px] uppercase tracking-wider text-arch-muted">
            <ListMusic size={10} /> 歌单
          </div>
          <div className="flex flex-wrap gap-1">
            {HOT_PLAYLISTS.map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => {
                  setLoadMode('playlist');
                  setTarget(p.id);
                  void doLoad('playlist', p.id);
                }}
                className="rounded-full border border-arch-border px-2 py-0.5 text-[10.5px] text-arch-muted hover:border-arch-accent hover:text-arch-accent"
              >
                {p.name}
              </button>
            ))}
          </div>
        </div>

        {/* 曲目 */}
        <div className="flex items-center justify-between border-b border-arch-border px-3 py-1.5 text-[10px] text-arch-muted">
          <span className="truncate">{listName || '未加载'} · {tracks.length} 首</span>
          {tracks.length > 0 && currentIdx < 0 && (
            <button
              type="button"
              onClick={() => void playAt(0)}
              className="rounded p-0.5 hover:bg-white/5"
              title="从第一首播放"
            >
              <Play size={11} />
            </button>
          )}
        </div>
        <div className="flex-1 overflow-y-auto">
          {tracks.length === 0 && !loading && (
            <div className="px-4 py-10 text-center text-xs text-arch-muted">
              <Disc3 size={32} className="mx-auto mb-2 opacity-30" />
              <p>{listName ? '列表为空' : '搜索歌曲或点上方歌单'}</p>
            </div>
          )}
          {tracks.map((t, i) => (
            <button
              type="button"
              key={`${t.source}-${t.id}-${i}`}
              onClick={() => void playAt(i)}
              className={cn(
                'flex w-full items-center gap-2 border-b border-arch-border/30 px-3 py-1.5 text-left transition hover:bg-white/5',
                i === currentIdx && 'bg-arch-accent/10',
              )}
            >
              <span className="w-5 shrink-0 text-center text-[10px] tabular-nums text-arch-muted">
                {i === currentIdx && loadingTrack ? (
                  <Loader2 size={11} className="mx-auto animate-spin text-arch-accent" />
                ) : (
                  i + 1
                )}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[12px]">{t.name}</span>
                <span className="block truncate text-[10px] text-arch-muted">{t.artist}</span>
              </span>
              {i === currentIdx && playing && (
                <Disc3 size={12} className="shrink-0 animate-spin text-arch-accent" />
              )}
            </button>
          ))}
        </div>
      </aside>

      {/* 右：播放 + 歌词 */}
      <main className="flex min-w-0 flex-1 flex-col">
        {!current ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-2 text-arch-muted">
            <Disc3 size={64} className="opacity-25" />
            <p className="text-sm">未选择歌曲</p>
            <p className="text-[11px]">左侧搜索，或点快捷歌单</p>
          </div>
        ) : (
          <>
            <div className="flex flex-1 items-center justify-center p-6">
              <div className="flex w-full max-w-xl gap-6">
                <div className="aspect-square w-44 shrink-0 overflow-hidden rounded-lg border border-arch-border bg-black/40">
                  {current.pic ? (
                    <img src={current.pic} alt="" className="h-full w-full object-cover" />
                  ) : (
                    <div className="flex h-full items-center justify-center text-arch-muted">
                      <Disc3 size={56} className={cn(playing && 'animate-spin')} />
                    </div>
                  )}
                </div>

                <div className="flex min-w-0 flex-1 flex-col justify-between py-1">
                  <div className="min-w-0">
                    <div className="truncate text-lg font-medium" title={current.name}>{current.name}</div>
                    <div className="mt-0.5 truncate text-xs text-arch-muted">{current.artist}</div>
                    {current.album && (
                      <div className="mt-0.5 truncate text-[11px] text-arch-muted">{current.album}</div>
                    )}
                  </div>

                  {error && (
                    <div className="flex items-start gap-1.5 rounded border border-arch-red/40 bg-arch-red/10 p-2 text-[11px] text-arch-red">
                      <AlertCircle size={12} className="mt-0.5 shrink-0" />
                      <span>{error}</span>
                      <button onClick={() => setError(null)} className="ml-auto shrink-0 hover:opacity-70">
                        <X size={11} />
                      </button>
                    </div>
                  )}

                  <div>
                    <div
                      ref={seekBarRef}
                      onPointerDown={onSeekPointerDown}
                      className="group relative h-1.5 cursor-pointer rounded-full bg-white/10"
                    >
                      <div
                        className="absolute inset-y-0 left-0 rounded-full bg-arch-accent"
                        style={{ width: `${ratio * 100}%` }}
                      />
                    </div>
                    <div className="mt-1 flex justify-between text-[10px] tabular-nums text-arch-muted">
                      <span>{fmtTime(position)}</span>
                      <span>{fmtTime(duration)}</span>
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    <button onClick={playPrev} className="rounded p-1.5 hover:bg-white/5" title="上一首">
                      <SkipBack size={16} />
                    </button>
                    <button
                      onClick={() => setPlaying((p) => !p)}
                      disabled={!playUrl || loadingTrack}
                      className="flex size-10 items-center justify-center rounded-full bg-arch-accent text-black hover:opacity-90 disabled:opacity-40"
                      title="播放 / 暂停（空格）"
                    >
                      {loadingTrack ? (
                        <Loader2 size={17} className="animate-spin" />
                      ) : playing ? (
                        <Pause size={17} fill="currentColor" />
                      ) : (
                        <Play size={17} fill="currentColor" className="ml-0.5" />
                      )}
                    </button>
                    <button onClick={playNext} className="rounded p-1.5 hover:bg-white/5" title="下一首">
                      <SkipForward size={16} />
                    </button>
                    <button
                      onClick={() => setMuted((m) => !m)}
                      className="ml-1 rounded p-1.5 hover:bg-white/5"
                      title="静音"
                    >
                      {muted || volume === 0 ? <VolumeX size={15} /> : <Volume2 size={15} />}
                    </button>
                    <input
                      type="range"
                      min={0}
                      max={1}
                      step={0.01}
                      value={muted ? 0 : volume}
                      onChange={(e) => setVolume(Number(e.target.value))}
                      className="h-1 w-20 accent-[var(--color-arch-accent)]"
                    />
                  </div>
                </div>
              </div>
            </div>

            <div
              ref={lyricScrollRef}
              className="h-40 overflow-y-auto border-t border-arch-border bg-black/20 px-6 py-3 text-center text-[12.5px] leading-7"
            >
              {lyrics.length === 0 ? (
                <p className="text-[11px] leading-[9rem] text-arch-muted">暂无歌词</p>
              ) : (
                lyrics.map((ln, i) => (
                  <p
                    key={i}
                    className={cn(
                      'transition-colors',
                      i === activeLyricIdx ? 'font-medium text-arch-accent' : 'text-arch-muted',
                    )}
                  >
                    {ln.text}
                  </p>
                ))
              )}
            </div>
          </>
        )}
      </main>
    </div>
  );
}

/* ------------------------- 设置面板 ------------------------- */

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
    if (v) onChange({ gateway: v, kind: draftKind });
  };

  return (
    <div className="border-b border-arch-border bg-arch-panel/60 p-3 text-xs">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-[11px] font-medium text-arch-muted">API 设置</span>
        <button onClick={onClose} className="rounded p-1 hover:bg-white/5">
          <X size={12} />
        </button>
      </div>

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
              'rounded border px-2 py-1 text-[11px] transition',
              draftKind === opt.k
                ? 'border-arch-accent bg-arch-accent/15 text-arch-accent'
                : 'border-arch-border text-arch-muted hover:bg-white/5',
            )}
          >
            {opt.label}
          </button>
        ))}
      </div>

      <input
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={applyDraft}
        onKeyDown={(e) => {
          if (e.key === 'Enter') applyDraft();
        }}
        placeholder="网关根地址（留空用内置公共网关）"
        className="mb-1.5 w-full rounded border border-arch-border bg-black/30 px-2 py-1 text-[11px] outline-none focus:border-arch-accent"
      />
      <p className="mb-2 text-[10px] leading-relaxed text-arch-muted">
        内置公共网关随时可能失效，建议部署自己的 NCM API / Meting 后填在这里。
      </p>

      <div className="grid grid-cols-4 gap-1">
        {SOURCES.map((s) => (
          <button
            key={s.id}
            onClick={() => onChange({ source: s.id })}
            className={cn(
              'rounded border px-2 py-1 text-[11px] transition',
              config.source === s.id
                ? 'border-arch-accent bg-arch-accent/15 text-arch-accent'
                : 'border-arch-border text-arch-muted hover:bg-white/5',
            )}
          >
            {s.label}
          </button>
        ))}
      </div>
    </div>
  );
}
