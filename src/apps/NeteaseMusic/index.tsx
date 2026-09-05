import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Disc3,
  ExternalLink,
  Loader2,
  Music,
  Pause,
  Play,
  Search,
  Settings as SettingsIcon,
  Volume2,
  VolumeX,
  AlertCircle,
  X,
} from 'lucide-react';
import type { AppProps } from '@/shell/types';
import { cn } from '@/lib/cn';

/* --------------------------- API 客户端 --------------------------- */

/**
 * 网易云 / 多源音乐 API 客户端
 *
 * 默认走 GD Studio 公共网关（music-api.gdstudio.xyz）：
 * - 国内可访问
 * - 单一 CORS 友好的 PHP 入口
 * - 支持多音乐源（netease / tencent / kuwo / tidal / spotify / bilibili / apple ...）
 *
 * 接口：
 *   ?types=search&source=netease&name=关键词&count=20&pages=1
 *   ?types=url&source=netease&id=track_id&br=320
 *   ?types=pic&source=netease&id=pic_id&size=300
 *   ?types=lyric&source=netease&id=lyric_id
 *
 * 用户也可在面板里切换为自己的 NeteaseCloudMusicApi 部署地址，
 * 那样能拿到登录态、VIP 音质、歌单等更多接口。
 */

const STORAGE_KEY = 'arch-web-netease:config';

type Source = 'netease' | 'tencent' | 'kuwo' | 'bilibili' | 'tidal' | 'spotify';

const SOURCES: { id: Source; label: string; hint?: string }[] = [
  { id: 'netease', label: '网易云', hint: '默认 / 曲库最全' },
  { id: 'tencent', label: 'QQ 音乐' },
  { id: 'kuwo', label: '酷我' },
  { id: 'bilibili', label: 'B 站' },
  { id: 'tidal', label: 'Tidal' },
  { id: 'spotify', label: 'Spotify', hint: '需自建 API' },
];

const BITRATES = [128, 192, 320, 740, 999] as const;

type Bitrate = (typeof BITRATES)[number];

interface Track {
  id: string;
  name: string;
  artist: string;
  album: string;
  pic_id?: string;
  lyric_id?: string;
  source: Source;
  /** 封面图直接 URL（解析后填上） */
  picUrl?: string;
}

interface SearchResp {
  id: string;
  name: string;
  artist: string[];
  album: string;
  pic_id: string;
  url_id?: string;
  lyric_id: string;
  source: string;
}

interface UrlResp {
  url: string;
  br?: number;
  size?: number;
}

interface PicResp {
  url: string;
}

interface LyricLine {
  /** 秒 */
  t: number;
  text: string;
}

interface Config {
  gateway: string;
  source: Source;
  bitrate: Bitrate;
}

const DEFAULT_CONFIG: Config = {
  gateway: 'https://music-api.gdstudio.xyz/api.php',
  source: 'netease',
  bitrate: 320,
};

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

class MusicClient {
  constructor(private cfg: Config) {}

  private urlWith(params: Record<string, string | number>): string {
    const u = new URL(this.cfg.gateway);
    for (const [k, v] of Object.entries(params)) {
      u.searchParams.set(k, String(v));
    }
    return u.toString();
  }

  async search(keyword: string, count = 20): Promise<Track[]> {
    if (!keyword.trim()) return [];
    // GD Studio 接口
    if (this.cfg.gateway.includes('gdstudio.xyz')) {
      const u = this.urlWith({
        types: 'search',
        source: this.cfg.source,
        name: keyword,
        count,
        pages: 1,
      });
      const r = await fetch(u);
      if (!r.ok) throw new Error(`搜索失败 HTTP ${r.status}`);
      const arr = (await r.json()) as SearchResp[];
      return arr.map((it) => ({
        id: it.id,
        name: it.name,
        artist: (it.artist ?? []).join(' / '),
        album: it.album,
        pic_id: it.pic_id,
        lyric_id: it.lyric_id,
        source: (it.source as Source) ?? this.cfg.source,
      }));
    }

    // NeteaseCloudMusicApi 兼容（/cloudsearch 或 /search?keywords=）
    const u = `${this.cfg.gateway.replace(/\/+$/, '')}/search?keywords=${encodeURIComponent(
      keyword,
    )}&limit=${count}`;
    const r = await fetch(u);
    if (!r.ok) throw new Error(`搜索失败 HTTP ${r.status}`);
    const json = await r.json();
    const songs = json?.result?.songs ?? json?.body?.result?.songs ?? [];
    return songs.map((s: any) => ({
      id: String(s.id),
      name: s.name,
      artist: (s.ar ?? s.artists ?? []).map((a: any) => a.name).join(' / '),
      album: s.al?.name ?? s.album?.name ?? '',
      pic_id: String(s.al?.pic_str ?? s.al?.picUrl ?? s.album?.picUrl ?? ''),
      lyric_id: String(s.id),
      source: 'netease' as Source,
    }));
  }

  async getUrl(track: Track): Promise<string | null> {
    if (this.cfg.gateway.includes('gdstudio.xyz')) {
      const u = this.urlWith({
        types: 'url',
        source: track.source,
        id: track.id,
        br: this.cfg.bitrate,
      });
      const r = await fetch(u);
      if (!r.ok) throw new Error(`获取播放链接失败 HTTP ${r.status}`);
      const json = (await r.json()) as UrlResp;
      return json?.url ?? null;
    }
    // NeteaseCloudMusicApi
    const u = `${this.cfg.gateway.replace(/\/+$/, '')}/song/url/v1?id=${track.id}&level=${
      this.cfg.bitrate >= 999 ? 'lossless' : this.cfg.bitrate >= 740 ? 'hires' : 'standard'
    }`;
    const r = await fetch(u);
    if (!r.ok) throw new Error(`获取播放链接失败 HTTP ${r.status}`);
    const json = await r.json();
    const item = json?.data?.[0] ?? json?.body?.data?.[0];
    return item?.url ?? null;
  }

  async getPic(track: Track): Promise<string | null> {
    if (!track.pic_id) return null;
    if (this.cfg.gateway.includes('gdstudio.xyz')) {
      try {
        const u = this.urlWith({
          types: 'pic',
          source: track.source,
          id: track.pic_id,
          size: 300,
        });
        const r = await fetch(u);
        if (!r.ok) return null;
        const json = (await r.json()) as PicResp;
        return json.url ?? null;
      } catch {
        return null;
      }
    }
    // NeteaseCloudMusicApi 直接拼
    return null;
  }

  async getLyric(track: Track): Promise<LyricLine[]> {
    if (!track.lyric_id) return [];
    if (this.cfg.gateway.includes('gdstudio.xyz')) {
      try {
        const u = this.urlWith({
          types: 'lyric',
          source: track.source,
          id: track.lyric_id,
        });
        const r = await fetch(u);
        if (!r.ok) return [];
        const json = await r.json();
        const raw = json?.lyric ?? '';
        return parseLrc(raw);
      } catch {
        return [];
      }
    }
    return [];
  }
}

function parseLrc(raw: string): LyricLine[] {
  if (!raw) return [];
  const lines: LyricLine[] = [];
  const re = /\[(\d+):(\d+(?:\.\d+)?)\](.*)/;
  for (const ln of raw.split(/\r?\n/)) {
    const m = re.exec(ln);
    if (!m) continue;
    const t = Number(m[1]) * 60 + Number(m[2]);
    const text = m[3].trim();
    if (!text) continue;
    lines.push({ t, text });
  }
  return lines.sort((a, b) => a.t - b.t);
}

/* --------------------------- 主组件 --------------------------- */

export default function NeteaseMusic(_: AppProps) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [config, setConfig] = useState<Config>(loadConfig);
  const [showSettings, setShowSettings] = useState(false);
  const [keyword, setKeyword] = useState('');
  const [tracks, setTracks] = useState<Track[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchErr, setSearchErr] = useState<string | null>(null);

  const [current, setCurrent] = useState<Track | null>(null);
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

  const client = useRef(new MusicClient(config));
  useEffect(() => {
    client.current = new MusicClient(config);
  }, [config]);

  /* --------------------------- 搜索 --------------------------- */
  const doSearch = useCallback(async () => {
    const kw = keyword.trim();
    if (!kw) return;
    setSearching(true);
    setSearchErr(null);
    try {
      const list = await client.current.search(kw);
      setTracks(list);
      if (list.length === 0) setSearchErr(`没有找到「${kw}」的相关歌曲`);
    } catch (e: any) {
      setSearchErr(String(e?.message ?? e));
      setTracks([]);
    } finally {
      setSearching(false);
    }
  }, [keyword]);

  /* --------------------------- 播放 --------------------------- */
  const playTrack = useCallback(async (track: Track) => {
    setError(null);
    setCurrent(track);
    setPlayUrl(null);
    setLoadingTrack(true);
    setLyrics([]);
    setActiveLyricIdx(-1);
    try {
      const [url, pic, lyric] = await Promise.all([
        client.current.getUrl(track),
        client.current.getPic(track),
        client.current.getLyric(track),
      ]);
      if (url) {
        setPlayUrl(url);
        // 异步拉封面，拿到再回填
        if (pic) setCurrent((c) => (c?.id === track.id ? { ...c!, picUrl: pic } : c));
        if (lyric.length > 0) setLyrics(lyric);
      } else {
        setError('该歌曲没有可用播放链接（可能是版权限制或 VIP 独占）。');
      }
    } catch (e: any) {
      setError(String(e?.message ?? e));
    } finally {
      setLoadingTrack(false);
    }
  }, []);

  /* --------------------------- audio 同步 --------------------------- */
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
    if (playing && playUrl) a.play().catch(() => setPlaying(false));
    else a.pause();
  }, [playing, playUrl]);

  useEffect(() => {
    const a = audioRef.current;
    if (a) a.volume = muted ? 0 : volume;
  }, [volume, muted]);

  /* --------------------------- 歌词滚动 --------------------------- */
  useEffect(() => {
    if (lyrics.length === 0) return;
    const a = audioRef.current;
    if (!a) return;
    const idx = lyrics.findIndex((ln, i) => {
      const next = lyrics[i + 1];
      return a.currentTime >= ln.t && (!next || a.currentTime < next.t);
    });
    setActiveLyricIdx(idx);
    // 滚动到中间
    const el = lyricScrollRef.current;
    if (el && idx >= 0) {
      const lineEl = el.children[idx] as HTMLElement | undefined;
      if (lineEl) {
        const top = lineEl.offsetTop - el.clientHeight / 2 + lineEl.clientHeight / 2;
        el.scrollTo({ top, behavior: 'smooth' });
      }
    }
  }, [position, lyrics]);

  /* --------------------------- 设置面板保存 --------------------------- */
  const updateConfig = (patch: Partial<Config>) => {
    setConfig((prev) => {
      const next = { ...prev, ...patch };
      persistConfig(next);
      return next;
    });
  };

  /* --------------------------- UI --------------------------- */
  const fmtTime = (sec: number) => {
    if (!isFinite(sec) || sec < 0) return '0:00';
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60);
    return `${m}:${String(s).padStart(2, '0')}`;
  };

  return (
    <div className="flex h-full bg-zinc-950 text-zinc-100">
      <audio
        ref={audioRef}
        onLoadedMetadata={(e) => setDuration(e.currentTarget.duration)}
        onTimeUpdate={(e) => setPosition(e.currentTarget.currentTime)}
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => setPlaying(false)}
        onError={() => {
          setError('播放失败，链接可能已失效或浏览器拒绝解码（CORS / Codec）。');
          setPlaying(false);
        }}
      />

      {/* 左侧：搜索 + 结果 */}
      <aside className="flex w-80 shrink-0 flex-col border-r border-zinc-800">
        <div className="flex items-center gap-2 border-b border-zinc-800 px-3 py-2.5">
          <Music size={16} className="text-rose-400" />
          <span className="text-sm font-medium">音乐搜索</span>
          <span className="ml-1 text-[10px] text-zinc-500">
            {SOURCES.find((s) => s.id === config.source)?.label}
          </span>
          <button
            onClick={() => setShowSettings((v) => !v)}
            className={cn(
              'ml-auto rounded p-1.5 hover:bg-zinc-800',
              showSettings && 'bg-indigo-600/30 text-indigo-300',
            )}
            title="设置 API 网关 / 音乐源 / 音质"
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

        <div className="border-b border-zinc-800 p-2">
          <div className="flex gap-1.5">
            <input
              value={keyword}
              onChange={(e) => setKeyword(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void doSearch();
              }}
              placeholder="搜歌曲 / 歌手 / 专辑"
              className="min-w-0 flex-1 rounded border border-zinc-700 bg-zinc-900 px-2.5 py-1.5 text-xs outline-none focus:border-indigo-500"
            />
            <button
              onClick={() => void doSearch()}
              disabled={searching}
              className="flex items-center gap-1 rounded bg-indigo-600 px-3 py-1.5 text-xs hover:bg-indigo-500 disabled:opacity-50"
            >
              {searching ? <Loader2 size={13} className="animate-spin" /> : <Search size={13} />}
              搜索
            </button>
          </div>
          {searchErr && (
            <div className="mt-1.5 flex items-start gap-1 text-[11px] text-rose-300">
              <AlertCircle size={11} className="mt-0.5 shrink-0" />
              <span>{searchErr}</span>
            </div>
          )}
        </div>

        <div className="flex-1 overflow-y-auto">
          {tracks.length === 0 && !searching && (
            <div className="px-4 py-10 text-center text-xs text-zinc-500">
              <Disc3 size={36} className="mx-auto mb-2 opacity-30" />
              <p>输入关键词开始搜索</p>
              <p className="mt-1 text-[10px] text-zinc-600">
                热门：周杰伦 · 邓紫棋 · 陈奕迅 · 五月天 · 告五人
              </p>
            </div>
          )}
          {tracks.map((t, i) => (
            <TrackRow
              key={`${t.source}-${t.id}-${i}`}
              track={t}
              active={current?.id === t.id && current.source === t.source}
              loading={loadingTrack && current?.id === t.id}
              onClick={() => void playTrack(t)}
            />
          ))}
        </div>
      </aside>

      {/* 右侧：播放 + 歌词 */}
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

        {/* 歌词区 */}
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
      </main>
    </div>
  );
}

/* --------------------------- 子组件 --------------------------- */

function TrackRow({
  track,
  active,
  loading,
  onClick,
}: {
  track: Track;
  active: boolean;
  loading?: boolean;
  onClick: () => void;
}) {
  return (
    <div
      onClick={onClick}
      className={cn(
        'flex cursor-pointer items-center gap-2 border-b border-zinc-900 px-3 py-2 hover:bg-zinc-900/70',
        active && 'bg-indigo-600/10',
      )}
    >
      {active ? loading ? (
        <Loader2 size={14} className="shrink-0 animate-spin text-indigo-300" />
      ) : (
        <Disc3 size={14} className="shrink-0 animate-spin-slow text-rose-400" />
      ) : (
        <Music size={14} className="shrink-0 text-zinc-600" />
      )}
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm">{track.name}</div>
        <div className="truncate text-[11px] text-zinc-500">
          {track.artist} · {track.album}
        </div>
      </div>
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
          {track.picUrl ? (
            <img src={track.picUrl} alt={track.album} className="h-full w-full object-cover" />
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
            <div className="mt-0.5 truncate text-xs text-zinc-500">{track.album}</div>
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
            <button onClick={onToggleMute} className="rounded p-2 hover:bg-zinc-800" title="静音">
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
        左侧搜索关键词即可从所选音乐源查找歌曲，点击进入播放。封面 / 歌词会按歌曲 ID 自动拉取。
      </p>
      <p className="mt-2 text-[10px] text-zinc-700">
        默认走 GD Studio 公共网关，无需自己部署。也可在右上角「设置」换成自建的 NeteaseCloudMusicApi。
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
  useEffect(() => setDraft(config.gateway), [config.gateway]);

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

      <label className="mb-1 block text-[11px] text-zinc-500">API 网关地址</label>
      <input
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => {
          const v = draft.trim();
          if (v && v !== config.gateway) onChange({ gateway: v });
        }}
        placeholder="https://music-api.gdstudio.xyz/api.php"
        className="mb-1 w-full rounded border border-zinc-700 bg-zinc-950 px-2 py-1 text-[11px] outline-none focus:border-indigo-500"
      />
      <p className="mb-2 text-[10px] text-zinc-600">
        GD Studio 默认开箱即用；自建 NeteaseCloudMusicApi 一般填根 URL（如 https://xxx.vercel.app）
      </p>

      <label className="mb-1 block text-[11px] text-zinc-500">音乐源</label>
      <div className="mb-2 grid grid-cols-3 gap-1">
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
            title={s.hint}
          >
            {s.label}
          </button>
        ))}
      </div>

      <label className="mb-1 block text-[11px] text-zinc-500">音质</label>
      <div className="flex gap-1">
        {BITRATES.map((b) => (
          <button
            key={b}
            onClick={() => onChange({ bitrate: b })}
            className={cn(
              'rounded border px-2 py-0.5 text-[11px]',
              config.bitrate === b
                ? 'border-indigo-500 bg-indigo-600/20 text-indigo-200'
                : 'border-zinc-700 hover:bg-zinc-800',
            )}
          >
            {b >= 999 ? 'Hi-Res' : b >= 740 ? '无损' : `${b}k`}
          </button>
        ))}
      </div>
    </div>
  );
}