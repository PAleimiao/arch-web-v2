import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Film,
  Link2,
  Maximize2,
  Minimize2,
  Pause,
  Play,
  Plus,
  SkipBack,
  SkipForward,
  Trash2,
  Volume2,
  VolumeX,
  Gauge,
  AlertCircle,
} from 'lucide-react';
import type { AppProps } from '@/shell/types';
import { cn } from '@/lib/cn';

/* ----------------------------- hls.js CDN 动态加载 ----------------------------- */

const HLS_CDN = 'https://cdn.jsdelivr.net/npm/hls.js@1.5.17/dist/hls.min.js';

declare global {
  interface Window {
    Hls?: typeof import('hls.js').default;
  }
}

async function ensureHlsJs(): Promise<boolean> {
  if (typeof window === 'undefined') return false;
  if (window.Hls) return true;
  // 原生支持（HLS 直接给 video）
  if (videoCanPlay('application/vnd.apple.mpegurl')) return false;
  return new Promise((resolve) => {
    const s = document.createElement('script');
    s.src = HLS_CDN;
    s.async = true;
    s.onload = () => resolve(!!window.Hls);
    s.onerror = () => resolve(false);
    document.head.appendChild(s);
  });
}

function videoCanPlay(mime: string): boolean {
  const v = document.createElement('video');
  return !!v.canPlayType(mime);
}

/* -------------------------------- 类型 -------------------------------- */

interface VideoItem {
  id: string;
  /** 显示标题 */
  name: string;
  /** blob: 引用 或 http(s) URL */
  url: string;
  /** 是否是 m3u8 / hls */
  isHls: boolean;
  /** 原始文件名 / URL */
  origin: string;
}

/* ------------------------------ 主组件 ------------------------------ */

export default function VideoPlayer(_: AppProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const seekBarRef = useRef<HTMLDivElement>(null);

  const [items, setItems] = useState<VideoItem[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [urlDraft, setUrlDraft] = useState('');
  const [showUrlInput, setShowUrlInput] = useState(false);

  const [playing, setPlaying] = useState(false);
  const [position, setPosition] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(0.9);
  const [muted, setMuted] = useState(false);
  const [rate, setRate] = useState(1);
  const [error, setError] = useState<string | null>(null);
  const [loadingHls, setLoadingHls] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);

  const active = useMemo(
    () => items.find((i) => i.id === activeId) ?? null,
    [items, activeId],
  );

  /* --------------------------- 文件选择 --------------------------- */
  const pickLocalFiles = (files: FileList | null) => {
    if (!files || files.length === 0) return;
    const additions: VideoItem[] = [];
    for (let i = 0; i < files.length; i++) {
      const f = files[i];
      if (!f.type.startsWith('video/')) continue;
      const url = URL.createObjectURL(f);
      additions.push({
        id: crypto.randomUUID(),
        name: f.name.replace(/\.[^/.]+$/, ''),
        url,
        isHls: false,
        origin: f.name,
      });
    }
    if (additions.length === 0) return;
    setItems((prev) => {
      const next = [...prev, ...additions];
      if (!activeId) setActiveId(additions[0].id);
      return next;
    });
    setError(null);
  };

  /* --------------------------- URL 输入 --------------------------- */
  const submitUrl = () => {
    const raw = urlDraft.trim();
    if (!raw) return;
    // 自动加 https://
    const url = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
    const isHls = /\.m3u8(\?|$|#)/i.test(url);
    const name = url.split('/').pop()?.split('?')[0] ?? '在线视频';
    const id = crypto.randomUUID();
    setItems((prev) => {
      const next = [...prev, { id, name, url, isHls, origin: url }];
      setActiveId(id);
      return next;
    });
    setUrlDraft('');
    setShowUrlInput(false);
    setError(null);
  };

  /* --------------------------- 切源后挂载 src --------------------------- */
  useEffect(() => {
    const video = videoRef.current;
    if (!video || !active) return;
    let hls: any = null;
    let cancelled = false;

    const attach = async () => {
      setError(null);
      // 先清掉
      video.removeAttribute('src');
      video.load();

      if (!active.isHls) {
        video.src = active.url;
        video.load();
        return;
      }

      // HLS 分支
      if (window.Hls && window.Hls.isSupported()) {
        try {
          hls = new window.Hls({ enableWorker: true });
          hls.loadSource(active.url);
          hls.attachMedia(video);
          hls.on(window.Hls.Events.ERROR, (_e: any, data: any) => {
            if (data?.fatal) {
              setError(
                `HLS 播放失败：${data.type ?? '未知'} - ${data.details ?? ''}。若该 m3u8 有 CORS / Referer 限制，可能无法直接播放。`,
              );
            }
          });
        } catch (e) {
          setError(`hls.js 初始化失败：${String(e)}`);
        }
        return;
      }

      if (videoCanPlay('application/vnd.apple.mpegurl')) {
        // Safari 原生
        video.src = active.url;
        video.load();
        return;
      }

      // 走到这里说明既不是 Safari、也加载失败了 hls.js
      setLoadingHls(true);
      const ok = await ensureHlsJs();
      setLoadingHls(false);
      if (cancelled) return;
      if (ok && window.Hls && window.Hls.isSupported()) {
        try {
          hls = new window.Hls();
          hls.loadSource(active.url);
          hls.attachMedia(video);
        } catch (e) {
          setError(`hls.js 加载后仍无法播放：${String(e)}`);
        }
      } else {
        setError('当前浏览器无法播放 HLS / m3u8 流。Chrome / Edge 用户建议改用 Safari 或打开实验性 HLS 标志。');
      }
    };

    void attach();
    return () => {
      cancelled = true;
      if (hls) {
        try {
          hls.destroy();
        } catch {
          // ignore
        }
      }
    };
  }, [active?.id, active?.url, active?.isHls]);

  /* --------------------------- 同步播放状态 --------------------------- */
  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    if (playing) v.play().catch(() => setPlaying(false));
    else v.pause();
  }, [playing, active?.id]);

  useEffect(() => {
    const v = videoRef.current;
    if (v) v.volume = muted ? 0 : volume;
  }, [volume, muted]);

  useEffect(() => {
    const v = videoRef.current;
    if (v) v.playbackRate = rate;
  }, [rate, active?.id]);

  /* --------------------------- 全屏 --------------------------- */
  const toggleFullscreen = async () => {
    const el = containerRef.current;
    if (!el) return;
    try {
      if (!document.fullscreenElement) await el.requestFullscreen();
      else await document.exitFullscreen();
    } catch {
      // ignore
    }
  };

  useEffect(() => {
    const onChange = () => setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', onChange);
    return () => document.removeEventListener('fullscreenchange', onChange);
  }, []);

  /* --------------------------- 键盘快捷键 --------------------------- */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // 焦点不在可编辑元素才响应
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA')) return;
      if (!active) return;
      if (e.code === 'Space') {
        e.preventDefault();
        setPlaying((p) => !p);
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        if (videoRef.current) videoRef.current.currentTime += 5;
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault();
        if (videoRef.current) videoRef.current.currentTime -= 5;
      } else if (e.key === 'f' || e.key === 'F') {
        e.preventDefault();
        void toggleFullscreen();
      } else if (e.key === 'm' || e.key === 'M') {
        e.preventDefault();
        setMuted((m) => !m);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active?.id]);

  /* --------------------------- 操作 --------------------------- */
  const playById = (id: string) => {
    setActiveId(id);
    setPlaying(true);
    setError(null);
  };

  const removeItem = (id: string) => {
    setItems((prev) => {
      const target = prev.find((x) => x.id === id);
      if (target && target.url.startsWith('blob:')) URL.revokeObjectURL(target.url);
      const next = prev.filter((x) => x.id !== id);
      if (activeId === id) {
        setActiveId(next[0]?.id ?? null);
        setPlaying(false);
      }
      return next;
    });
  };

  const clearAll = () => {
    items.forEach((it) => {
      if (it.url.startsWith('blob:')) URL.revokeObjectURL(it.url);
    });
    setItems([]);
    setActiveId(null);
    setPlaying(false);
    setPosition(0);
    setDuration(0);
  };

  const seekTo = (t: number) => {
    const v = videoRef.current;
    if (v) v.currentTime = t;
    setPosition(t);
  };

  const onSeekPointerDown = (e: React.PointerEvent) => {
    const bar = seekBarRef.current;
    if (!bar || duration <= 0) return;
    const rect = bar.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    seekTo(ratio * duration);
    const move = (ev: PointerEvent) => {
      const r = bar.getBoundingClientRect();
      const x = Math.max(0, Math.min(r.width, ev.clientX - r.left));
      seekTo((x / r.width) * duration);
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  const fmtTime = (sec: number) => {
    if (!isFinite(sec) || sec < 0) return '0:00';
    const h = Math.floor(sec / 3600);
    const m = Math.floor((sec % 3600) / 60);
    const s = Math.floor(sec % 60);
    if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
    return `${m}:${String(s).padStart(2, '0')}`;
  };

  const RATES = [0.5, 0.75, 1, 1.25, 1.5, 2];
  const ratio = duration > 0 ? position / duration : 0;

  return (
    <div className="flex h-full bg-zinc-950 text-zinc-100">
      <input
        ref={fileInputRef}
        type="file"
        accept="video/*"
        multiple
        className="hidden"
        onChange={(e) => {
          pickLocalFiles(e.target.files);
          e.target.value = '';
        }}
      />

      {/* 左：播放列表 */}
      <aside className="flex w-64 shrink-0 flex-col border-r border-zinc-800">
        <div className="flex items-center justify-between border-b border-zinc-800 px-3 py-2.5">
          <div className="flex items-center gap-2 text-[11px] uppercase tracking-wider text-zinc-400">
            <Film size={13} />
            <span>列表 · {items.length}</span>
          </div>
          <div className="flex gap-1">
            <button
              onClick={() => fileInputRef.current?.click()}
              className="rounded p-1.5 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200"
              title="导入本地视频"
            >
              <Plus size={14} />
            </button>
            <button
              onClick={() => setShowUrlInput((v) => !v)}
              className={cn(
                'rounded p-1.5 hover:bg-zinc-800',
                showUrlInput ? 'bg-indigo-600/30 text-indigo-300' : 'text-zinc-400 hover:text-zinc-200',
              )}
              title="输入在线 URL（含 m3u8）"
            >
              <Link2 size={14} />
            </button>
            <button
              onClick={clearAll}
              disabled={items.length === 0}
              className="rounded p-1.5 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200 disabled:opacity-30"
              title="清空"
            >
              <Trash2 size={14} />
            </button>
          </div>
        </div>

        {showUrlInput && (
          <div className="border-b border-zinc-800 bg-zinc-900/60 p-2">
            <input
              autoFocus
              value={urlDraft}
              onChange={(e) => setUrlDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') submitUrl();
                if (e.key === 'Escape') setShowUrlInput(false);
              }}
              placeholder="https://...m3u8 / mp4 / webm"
              className="w-full rounded border border-zinc-700 bg-zinc-950 px-2 py-1 text-xs outline-none focus:border-indigo-500"
            />
            <p className="mt-1 text-[10px] text-zinc-500">
              支持 .m3u8 / .mp4 / .webm / .mov 等。直接 m3u8 会自动加载 hls.js。
            </p>
          </div>
        )}

        <div className="flex-1 overflow-y-auto py-1">
          {items.length === 0 && (
            <div className="px-4 py-8 text-center text-xs text-zinc-500">
              <Film size={28} className="mx-auto mb-2 opacity-40" />
              <p>还没有视频</p>
              <div className="mt-3 flex justify-center gap-2">
                <button
                  onClick={() => fileInputRef.current?.click()}
                  className="rounded bg-indigo-600 px-2.5 py-1 text-[11px] text-white hover:bg-indigo-500"
                >
                  本地文件
                </button>
                <button
                  onClick={() => setShowUrlInput(true)}
                  className="rounded border border-zinc-700 px-2.5 py-1 text-[11px] hover:bg-zinc-800"
                >
                  在线 URL
                </button>
              </div>
            </div>
          )}
          {items.map((it) => (
            <div
              key={it.id}
              onClick={() => playById(it.id)}
              className={cn(
                'flex cursor-pointer items-center justify-between gap-2 px-3 py-2 hover:bg-zinc-900',
                activeId === it.id && 'bg-indigo-600/10',
              )}
            >
              <div className="flex min-w-0 items-center gap-2">
                {activeId === it.id && playing ? (
                  <PlayingIcon />
                ) : (
                  <Film size={13} className="shrink-0 text-zinc-500" />
                )}
                <div className="min-w-0">
                  <div className="truncate text-sm">{it.name}</div>
                  <div className="text-[10px] text-zinc-500">
                    {it.isHls ? 'HLS / m3u8' : it.url.startsWith('blob:') ? '本地文件' : '在线'}
                  </div>
                </div>
              </div>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  removeItem(it.id);
                }}
                className="shrink-0 rounded p-1 text-zinc-600 hover:bg-zinc-800 hover:text-zinc-300"
                title="移除"
              >
                <Trash2 size={12} />
              </button>
            </div>
          ))}
        </div>
      </aside>

      {/* 右：播放器 */}
      <main ref={containerRef} className="flex min-w-0 flex-1 flex-col bg-black">
        {active ? (
          <>
            <div className="relative flex flex-1 items-center justify-center">
              <video
                ref={videoRef}
                className="max-h-full max-w-full"
                playsInline
                onLoadedMetadata={(e) => setDuration(e.currentTarget.duration)}
                onTimeUpdate={(e) => setPosition(e.currentTarget.currentTime)}
                onPlay={() => setPlaying(true)}
                onPause={() => setPlaying(false)}
                onEnded={() => {
                  // 自动播下一个
                  setItems((prev) => {
                    const idx = prev.findIndex((x) => x.id === activeId);
                    if (idx < 0) return prev;
                    const next = prev[idx + 1];
                    if (next) {
                      setActiveId(next.id);
                      setPlaying(true);
                    } else {
                      setPlaying(false);
                    }
                    return prev;
                  });
                }}
                onError={() =>
                  setError('视频加载失败。可能是不支持的格式、CORS / Referer 限制，或源已失效。')
                }
              />

              {loadingHls && (
                <div className="absolute inset-0 flex items-center justify-center bg-black/60 text-xs text-zinc-300">
                  正在加载 hls.js 播放器…
                </div>
              )}
              {error && (
                <div className="absolute inset-x-3 top-3 flex items-start gap-2 rounded border border-red-700/60 bg-red-950/85 p-2.5 text-[11px] text-red-200">
                  <AlertCircle size={14} className="mt-0.5 shrink-0" />
                  <div className="flex-1">{error}</div>
                  <button
                    onClick={() => setError(null)}
                    className="shrink-0 rounded px-2 hover:bg-red-900/60"
                  >
                    ×
                  </button>
                </div>
              )}
            </div>

            {/* 控制条 */}
            <div className="border-t border-zinc-800 bg-zinc-900/80 px-4 py-2.5">
              <div className="mb-1.5 truncate text-sm font-medium">{active.name}</div>
              <div
                ref={seekBarRef}
                onPointerDown={onSeekPointerDown}
                className="group relative h-1.5 cursor-pointer rounded-full bg-zinc-800"
              >
                <div
                  className="absolute inset-y-0 left-0 rounded-full bg-indigo-500"
                  style={{ width: `${ratio * 100}%` }}
                />
                <div
                  className="absolute top-1/2 size-3 -translate-y-1/2 -translate-x-1/2 rounded-full bg-white opacity-0 shadow group-hover:opacity-100"
                  style={{ left: `${ratio * 100}%` }}
                />
              </div>
              <div className="mt-1 flex justify-between text-[10px] tabular-nums text-zinc-500">
                <span>{fmtTime(position)}</span>
                <span>{fmtTime(duration)}</span>
              </div>

              <div className="mt-2 flex flex-wrap items-center gap-2 text-zinc-300">
                <button
                  onClick={() => {
                    setItems((prev) => {
                      const idx = prev.findIndex((x) => x.id === activeId);
                      if (idx <= 0) {
                        setActiveId(prev[prev.length - 1]?.id ?? null);
                      } else {
                        setActiveId(prev[idx - 1].id);
                      }
                      setPlaying(true);
                      return prev;
                    });
                  }}
                  className="rounded p-1.5 hover:bg-zinc-800"
                  title="上一段"
                  disabled={items.length <= 1}
                >
                  <SkipBack size={16} fill="currentColor" />
                </button>
                <button
                  onClick={() => setPlaying((p) => !p)}
                  className="flex size-9 items-center justify-center rounded-full bg-white text-black hover:scale-105 active:scale-95"
                  title={playing ? '暂停（空格）' : '播放（空格）'}
                >
                  {playing ? (
                    <Pause size={16} fill="currentColor" />
                  ) : (
                    <Play size={16} fill="currentColor" className="ml-0.5" />
                  )}
                </button>
                <button
                  onClick={() => {
                    setItems((prev) => {
                      const idx = prev.findIndex((x) => x.id === activeId);
                      if (idx < 0) {
                        setActiveId(prev[0]?.id ?? null);
                      } else if (idx >= prev.length - 1) {
                        setActiveId(prev[0]?.id ?? null);
                      } else {
                        setActiveId(prev[idx + 1].id);
                      }
                      setPlaying(true);
                      return prev;
                    });
                  }}
                  className="rounded p-1.5 hover:bg-zinc-800"
                  title="下一段"
                  disabled={items.length <= 1}
                >
                  <SkipForward size={16} fill="currentColor" />
                </button>

                <div className="mx-2 h-5 w-px bg-zinc-700" />

                <button
                  onClick={() => setMuted((m) => !m)}
                  className="rounded p-1.5 hover:bg-zinc-800"
                  title="静音（M）"
                >
                  {muted || volume === 0 ? <VolumeX size={16} /> : <Volume2 size={16} />}
                </button>
                <input
                  type="range"
                  min={0}
                  max={1}
                  step={0.01}
                  value={muted ? 0 : volume}
                  onChange={(e) => setVolume(Number(e.target.value))}
                  className="h-1 w-20 accent-indigo-500"
                />

                <div className="mx-2 h-5 w-px bg-zinc-700" />

                <Gauge size={14} className="text-zinc-400" />
                <div className="flex gap-1">
                  {RATES.map((r) => (
                    <button
                      key={r}
                      onClick={() => setRate(r)}
                      className={cn(
                        'rounded px-1.5 py-0.5 text-[11px] hover:bg-zinc-800',
                        rate === r ? 'bg-indigo-600/30 text-indigo-300' : 'text-zinc-400',
                      )}
                    >
                      {r}x
                    </button>
                  ))}
                </div>

                <div className="ml-auto">
                  <button
                    onClick={() => void toggleFullscreen()}
                    className="rounded p-1.5 hover:bg-zinc-800"
                    title="全屏（F）"
                  >
                    {isFullscreen ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
                  </button>
                </div>
              </div>
            </div>
          </>
        ) : (
          <div className="flex flex-1 flex-col items-center justify-center gap-3 text-zinc-500">
            <Film size={64} className="opacity-30" />
            <p className="text-sm">还没有在播放</p>
            <p className="max-w-xs text-center text-[11px] text-zinc-600">
              从左侧点 <Plus /> 导入本地视频，或点 <Link2 /> 粘贴在线 URL
              （支持 m3u8，会自动加载 hls.js）
            </p>
            <p className="mt-2 text-[10px] text-zinc-700">
              快捷键：空格 播放/暂停 · ← → 跳 5 秒 · M 静音
            </p>
          </div>
        )}
      </main>
    </div>
  );
}

function PlayingIcon() {
  return (
    <span className="inline-flex h-3 w-3 items-end justify-center gap-0.5">
      <span className="block w-0.5 animate-eq-1 bg-indigo-400" style={{ height: '60%' }} />
      <span className="block w-0.5 animate-eq-2 bg-indigo-400" style={{ height: '100%' }} />
      <span className="block w-0.5 animate-eq-3 bg-indigo-400" style={{ height: '50%' }} />
    </span>
  );
}