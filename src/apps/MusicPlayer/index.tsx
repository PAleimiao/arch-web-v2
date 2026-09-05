import { useEffect, useRef, useState } from 'react';
import {
  Music,
  Pause,
  Play,
  Plus,
  Repeat,
  Repeat1,
  SkipBack,
  SkipForward,
  Trash2,
  Volume2,
  VolumeX,
  ListMusic,
} from 'lucide-react';
import type { AppProps } from '@/shell/types';
import { cn } from '@/lib/cn';
import { useMediaStore } from '@/stores/useMediaStore';

/**
 * 本地音频播放器
 *
 * 设计约束：
 * - 音乐文件以 blob URL 形式加载，关闭页面后会失效（不做 IndexedDB 二进制持久化，避免 GB 级容量爆炸）
 * - 播放队列元数据（id / 名称 / 大小）写入 VFS /home/arch/Music/playlist.json，下次打开能看到列表，点击会提示重新加载文件
 * - 单实例即可（singleton）
 */

interface Track {
  /** uuid，用于队列关联 */
  id: string;
  /** 显示名（去掉扩展名） */
  name: string;
  /** 原始文件名（带扩展名） */
  fileName: string;
  /** 字节数 */
  size: number;
  /** blob:xxx 引用（每会话重新生成） */
  url: string;
  /** 时长（秒），0 表示未加载 */
  duration: number;
}

type LoopMode = 'off' | 'all' | 'one';

const META_PATH = '/home/arch/Music/playlist.json';
const LOOP_NEXT: Record<LoopMode, LoopMode> = { off: 'all', all: 'one', one: 'off' };
const LOOP_ICON: Record<LoopMode, typeof Repeat> = { off: Repeat, all: Repeat, one: Repeat1 };

const fmtTime = (sec: number) => {
  if (!isFinite(sec) || sec < 0) return '0:00';
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
};

const fmtSize = (bytes: number) => {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
};

const stripExt = (name: string) => name.replace(/\.[^/.]+$/, '');

interface PlaylistMeta {
  /** 上次保存的队列（不含 blob URL） */
  items: { id: string; fileName: string; name: string; size: number }[];
}

export default function MusicPlayer(_: AppProps) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const seekBarRef = useRef<HTMLDivElement>(null);
  const [tracks, setTracks] = useState<Track[]>([]);
  const [currentIdx, setCurrentIdx] = useState(-1);
  const [playing, setPlaying] = useState(false);
  const [position, setPosition] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(0.8);
  const [muted, setMuted] = useState(false);
  const [loop, setLoop] = useState<LoopMode>('off');
  const [loadingMeta, setLoadingMeta] = useState(true);

  const current = currentIdx >= 0 && currentIdx < tracks.length ? tracks[currentIdx] : null;

  /* --------------------------- 启动期：尝试恢复队列 --------------------------- */
  useEffect(() => {
    (async () => {
      try {
        const { vfs } = await import('@/services/filesystem');
        const raw = await vfs.readFile(META_PATH);
        if (raw) {
          const meta = JSON.parse(raw) as PlaylistMeta;
          // 重建占位 tracks：URL 留空，等待用户重新加载同名文件
          setTracks(
            meta.items.map((it) => ({
              id: it.id,
              name: it.name,
              fileName: it.fileName,
              size: it.size,
              url: '',
              duration: 0,
            })),
          );
        }
      } catch {
        // 忽略：首次启动没保存过
      } finally {
        setLoadingMeta(false);
      }
    })();
  }, []);

  /* ------------ 桥接：让全局（媒体键 / Dock mini）能调用本播放器 ------------ */
  const apiRef = useRef({
    hasTrack: () => false as boolean,
    togglePlay: () => undefined as void,
    next: () => undefined as void,
    prev: () => undefined as void,
    seek: (_sec: number) => undefined as void,
    setVolume: (_v: number) => undefined as void,
    toggleMute: () => undefined as void,
    getCurrentTitle: () => null as string | null,
  });

  // 每次 render 同步最新 closure（避免 stale closure）
  apiRef.current.hasTrack = () => current !== null;
  apiRef.current.togglePlay = () => {
    if (currentIdx < 0) {
      if (tracks.length > 0) playAt(0);
      return;
    }
    setPlaying((p) => !p);
  };
  apiRef.current.next = () => gotoNext();
  apiRef.current.prev = () => gotoPrev();
  apiRef.current.seek = (sec: number) => seekTo(sec);
  apiRef.current.setVolume = (v: number) => {
    const clamped = Math.max(0, Math.min(1, v));
    setVolume(clamped);
    setMuted(clamped === 0);
  };
  apiRef.current.toggleMute = () => setMuted((m) => !m);
  apiRef.current.getCurrentTitle = () => current?.name ?? null;

  useEffect(() => {
    useMediaStore.getState().setBridge({
      hasTrack: () => apiRef.current.hasTrack(),
      togglePlay: () => apiRef.current.togglePlay(),
      next: () => apiRef.current.next(),
      prev: () => apiRef.current.prev(),
      seek: (s) => apiRef.current.seek(s),
      setVolume: (v) => apiRef.current.setVolume(v),
      toggleMute: () => apiRef.current.toggleMute(),
      getCurrentTitle: () => apiRef.current.getCurrentTitle(),
    });
    return () => useMediaStore.getState().setBridge(null);
  }, []);

  /* ------------------------------- 同步 audio ------------------------------ */
  useEffect(() => {
    const a = audioRef.current;
    if (!a) return;
    if (current && current.url) {
      if (a.src !== current.url) {
        a.src = current.url;
        a.load();
      }
    } else {
      a.removeAttribute('src');
    }
  }, [current?.id, current?.url]);

  useEffect(() => {
    const a = audioRef.current;
    if (!a) return;
    if (playing && current?.url) {
      a.play().catch(() => setPlaying(false));
    } else {
      a.pause();
    }
  }, [playing, current?.url]);

  useEffect(() => {
    const a = audioRef.current;
    if (a) a.volume = muted ? 0 : volume;
  }, [volume, muted]);

  /* --------------------------- 状态镜像到全局 store -------------------------- */
  // 用 ref 缓冲 position，250ms 才推送一次，避免别处订阅时频繁重渲染
  const lastSyncRef = useRef(0);
  const positionRef = useRef(0);
  positionRef.current = position;

  useEffect(() => {
    const tick = () => {
      const now = performance.now();
      if (now - lastSyncRef.current > 250) {
        lastSyncRef.current = now;
        const title = current?.name ?? null;
        if (title) {
          useMediaStore.setState({
            current: {
              name: title,
              url: current?.url ?? '',
              size: current?.size,
              duration: current?.duration,
            },
            playing,
            position: positionRef.current,
            duration,
          });
        } else {
          useMediaStore.setState({
            current: null,
            playing: false,
            position: 0,
            duration: 0,
          });
        }
      }
    };
    const id = setInterval(tick, 250);
    tick();
    return () => clearInterval(id);
  }, [playing, duration, current?.name, current?.url, current?.size, current?.duration]);

  /* ----------------------------- 操作方法 ----------------------------- */
  const persistMeta = async (next: Track[]) => {
    try {
      const { vfs } = await import('@/services/filesystem');
      const meta: PlaylistMeta = {
        items: next.map(({ id, fileName, name, size }) => ({ id, fileName, name, size })),
      };
      await vfs.writeFile(META_PATH, JSON.stringify(meta, null, 2));
    } catch {
      // 持久化失败不重要，主功能能用就行
    }
  };

  const playAt = (idx: number) => {
    if (idx < 0 || idx >= tracks.length) return;
    if (!tracks[idx].url) {
      fileInputRef.current?.click();
      return;
    }
    setCurrentIdx(idx);
    setPosition(0);
    setPlaying(true);
  };

  const togglePlay = () => {
    if (currentIdx < 0) {
      if (tracks.length > 0) playAt(0);
      return;
    }
    setPlaying((p) => !p);
  };

  const gotoNext = () => {
    if (tracks.length === 0) return;
    if (loop === 'one') {
      // 单曲循环：重新播放
      const a = audioRef.current;
      if (a) a.currentTime = 0;
      if (!playing) setPlaying(true);
      return;
    }
    const next = currentIdx + 1;
    if (next >= tracks.length) {
      if (loop === 'all') {
        playAt(0);
      } else {
        setPlaying(false);
        setPosition(0);
      }
      return;
    }
    playAt(next);
  };

  const gotoPrev = () => {
    if (tracks.length === 0) return;
    // 距离歌曲开始 >3s，回到开头；否则上一首
    const a = audioRef.current;
    if (a && a.currentTime > 3 && current?.url) {
      a.currentTime = 0;
      return;
    }
    playAt(currentIdx - 1 < 0 ? tracks.length - 1 : currentIdx - 1);
  };

  const seekTo = (t: number) => {
    const a = audioRef.current;
    if (a) a.currentTime = t;
    setPosition(t);
  };

  const pickFiles = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    const additions: Track[] = [];
    for (let i = 0; i < files.length; i++) {
      const f = files[i];
      if (!f.type.startsWith('audio/')) continue;
      const url = URL.createObjectURL(f);
      // 探测时长
      const dur = await new Promise<number>((resolve) => {
        const a = document.createElement('audio');
        a.preload = 'metadata';
        a.src = url;
        a.onloadedmetadata = () => {
          resolve(a.duration || 0);
          a.remove();
        };
        a.onerror = () => {
          resolve(0);
          a.remove();
        };
      });
      const id = crypto.randomUUID();
      additions.push({
        id,
        name: stripExt(f.name),
        fileName: f.name,
        size: f.size,
        url,
        duration: dur,
      });
    }
    if (additions.length === 0) return;
    // 如果有"占位项"（URL 为空、文件名匹配）→ 替换它
    setTracks((prev) => {
      const merged = [...prev];
      for (const a of additions) {
        const matchIdx = merged.findIndex(
          (t) => !t.url && t.fileName === a.fileName && t.size === a.size,
        );
        if (matchIdx >= 0) merged[matchIdx] = a;
        else merged.push(a);
      }
      persistMeta(merged);
      return merged;
    });
  };

  const removeTrack = (id: string) => {
    setTracks((prev) => {
      const t = prev.find((x) => x.id === id);
      if (t?.url) URL.revokeObjectURL(t.url);
      const next = prev.filter((x) => x.id !== id);
      persistMeta(next);
      if (currentIdx >= next.length) {
        setCurrentIdx(next.length - 1);
        setPlaying(false);
      }
      return next;
    });
  };

  const clearAll = () => {
    tracks.forEach((t) => t.url && URL.revokeObjectURL(t.url));
    setTracks([]);
    setCurrentIdx(-1);
    setPlaying(false);
    persistMeta([]);
  };

  /* -------------------------- 进度条拖拽支持 -------------------------- */
  const onSeekBarPointerDown = (e: React.PointerEvent) => {
    const bar = seekBarRef.current;
    if (!bar) return;
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

  /* ------------------------------- 渲染 ------------------------------- */
  const hasMissing = tracks.some((t) => !t.url);

  return (
    <div className="flex h-full bg-zinc-950 text-zinc-100">
      <input
        ref={fileInputRef}
        type="file"
        accept="audio/*"
        multiple
        onChange={(e) => {
          pickFiles(e.target.files);
          e.target.value = '';
        }}
        className="hidden"
      />
      <audio
        ref={audioRef}
        onLoadedMetadata={(e) => setDuration(e.currentTarget.duration)}
        onTimeUpdate={(e) => setPosition(e.currentTarget.currentTime)}
        onEnded={gotoNext}
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onError={() => {
          // 资源丢失（关闭页面后复活的 blob）
          setPlaying(false);
        }}
      />

      {/* 左：列表 */}
      <aside className="flex w-72 flex-col border-r border-zinc-800">
        <div className="flex items-center justify-between border-b border-zinc-800 px-3 py-2.5">
          <div className="flex items-center gap-2 text-[11px] uppercase tracking-wider text-zinc-400">
            <ListMusic size={13} />
            <span>队列 · {tracks.length}</span>
          </div>
          <div className="flex gap-1">
            <button
              onClick={() => fileInputRef.current?.click()}
              className="rounded p-1.5 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200"
              title="添加音乐"
            >
              <Plus size={14} />
            </button>
            <button
              onClick={clearAll}
              disabled={tracks.length === 0}
              className="rounded p-1.5 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200 disabled:opacity-30"
              title="清空"
            >
              <Trash2 size={14} />
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto py-1">
          {loadingMeta && (
            <div className="px-3 py-2 text-xs text-zinc-500">读取保存的列表...</div>
          )}
          {!loadingMeta && tracks.length === 0 && (
            <div className="px-4 py-8 text-center text-xs text-zinc-500">
              <Music size={28} className="mx-auto mb-2 opacity-40" />
              <p>还没有音乐</p>
              <button
                onClick={() => fileInputRef.current?.click()}
                className="mt-3 rounded bg-indigo-600 px-3 py-1 text-xs text-white hover:bg-indigo-500"
              >
                添加本地音乐
              </button>
            </div>
          )}
          {tracks.map((t, i) => (
            <div
              key={t.id}
              onDoubleClick={() => playAt(i)}
              className={cn(
                'flex cursor-pointer items-center justify-between gap-2 px-3 py-2 hover:bg-zinc-900',
                i === currentIdx && 'bg-indigo-600/10',
              )}
            >
              <div className="flex min-w-0 items-center gap-2">
                {i === currentIdx && playing ? (
                  <PlayingBars />
                ) : (
                  <Music size={13} className="shrink-0 text-zinc-500" />
                )}
                <div className="min-w-0">
                  <div className="truncate text-sm">{t.name}</div>
                  {!t.url && (
                    <div className="text-[10px] text-amber-400">文件已丢失，点击重选</div>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-2 shrink-0 text-xs text-zinc-500">
                <span className="tabular-nums">{fmtTime(t.duration)}</span>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    removeTrack(t.id);
                  }}
                  className="rounded p-1 text-zinc-600 hover:bg-zinc-800 hover:text-zinc-300"
                  title="移除"
                >
                  <Trash2 size={12} />
                </button>
              </div>
            </div>
          ))}
        </div>

        {hasMissing && (
          <div className="border-t border-amber-900/40 bg-amber-950/30 px-3 py-2 text-[11px] text-amber-300">
            有些曲目源文件已失效，重选同名文件即可恢复
            <button
              onClick={() => fileInputRef.current?.click()}
              className="ml-2 rounded border border-amber-700 px-2 py-0.5 hover:bg-amber-900/40"
            >
              添加文件
            </button>
          </div>
        )}
      </aside>

      {/* 右：播放器主区 */}
      <main className="flex flex-1 flex-col">
        {current ? (
          <NowPlaying
            track={current}
            position={position}
            duration={duration}
            playing={playing}
            volume={volume}
            muted={muted}
            loop={loop}
            onPlay={togglePlay}
            onNext={gotoNext}
            onPrev={gotoPrev}
            onSeekBarRef={seekBarRef}
            onSeekPointerDown={onSeekBarPointerDown}
            onVolumeChange={setVolume}
            onToggleMute={() => setMuted((m) => !m)}
            onCycleLoop={() => setLoop((l) => LOOP_NEXT[l])}
          />
        ) : (
          <EmptyPlayer onAdd={() => fileInputRef.current?.click()} />
        )}
      </main>
    </div>
  );
}

function NowPlaying(props: {
  track: Track;
  position: number;
  duration: number;
  playing: boolean;
  volume: number;
  muted: boolean;
  loop: LoopMode;
  onPlay: () => void;
  onNext: () => void;
  onPrev: () => void;
  onSeekBarRef: React.RefObject<HTMLDivElement>;
  onSeekPointerDown: (e: React.PointerEvent) => void;
  onVolumeChange: (v: number) => void;
  onToggleMute: () => void;
  onCycleLoop: () => void;
}) {
  const {
    track,
    position,
    duration,
    playing,
    volume,
    muted,
    loop,
    onPlay,
    onNext,
    onPrev,
    onSeekBarRef,
    onSeekPointerDown,
    onVolumeChange,
    onToggleMute,
    onCycleLoop,
  } = props;
  const ratio = duration > 0 ? position / duration : 0;
  const LoopIcon = LOOP_ICON[loop];
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-6 p-8">
      {/* 封面占位 */}
      <div className="relative aspect-square w-56 overflow-hidden rounded-xl bg-gradient-to-br from-indigo-600 via-fuchsia-600 to-emerald-500 shadow-2xl shadow-indigo-900/40">
        <div className="absolute inset-0 flex items-center justify-center text-white/90">
          <Music size={80} />
        </div>
        {playing && (
          <div className="absolute inset-x-0 bottom-0 flex items-end justify-center gap-1 bg-gradient-to-t from-black/40 to-transparent p-3">
            <PlayingBars large />
          </div>
        )}
      </div>

      {/* 元信息 */}
      <div className="w-full max-w-md text-center">
        <div className="truncate text-lg font-medium" title={track.name}>
          {track.name}
        </div>
        <div className="mt-0.5 text-xs text-zinc-500">
          {fmtSize(track.size)} · {track.fileName}
        </div>
      </div>

      {/* 进度条 */}
      <div className="w-full max-w-md">
        <div
          ref={onSeekBarRef}
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
        <div className="mt-1 flex justify-between text-[11px] tabular-nums text-zinc-500">
          <span>{fmtTime(position)}</span>
          <span>{fmtTime(duration)}</span>
        </div>
      </div>

      {/* 主控件 */}
      <div className="flex items-center gap-3 text-zinc-300">
        <button
          onClick={onCycleLoop}
          className={cn(
            'rounded p-2 hover:bg-zinc-800',
            loop !== 'off' && 'text-indigo-400',
          )}
          title={`循环：${loop}`}
        >
          <LoopIcon size={18} />
        </button>
        <button
          onClick={onPrev}
          className="rounded p-2 hover:bg-zinc-800"
          title="上一首"
        >
          <SkipBack size={20} fill="currentColor" />
        </button>
        <button
          onClick={onPlay}
          className="flex size-12 items-center justify-center rounded-full bg-white text-black hover:scale-105 active:scale-95"
          title={playing ? '暂停' : '播放'}
        >
          {playing ? <Pause size={22} fill="currentColor" /> : <Play size={22} fill="currentColor" className="ml-0.5" />}
        </button>
        <button
          onClick={onNext}
          className="rounded p-2 hover:bg-zinc-800"
          title="下一首"
        >
          <SkipForward size={20} fill="currentColor" />
        </button>
        {/* 音量 */}
        <div className="flex items-center gap-2 pl-2">
          <button
            onClick={onToggleMute}
            className="rounded p-2 hover:bg-zinc-800"
            title={muted ? '取消静音' : '静音'}
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
            className="h-1 w-20 accent-indigo-500"
          />
        </div>
      </div>
    </div>
  );
}

function EmptyPlayer({ onAdd }: { onAdd: () => void }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-4 p-8 text-center text-zinc-500">
      <Music size={64} className="opacity-30" />
      <div>
        <p className="text-base">还没有在播放</p>
        <p className="mt-1 text-xs text-zinc-600">
          点击"+ 添加音乐"选几个 mp3 / wav / flac / ogg 进来
        </p>
      </div>
      <button
        onClick={onAdd}
        className="rounded bg-indigo-600 px-4 py-2 text-sm font-medium text-white shadow hover:bg-indigo-500"
      >
        添加本地音乐
      </button>
    </div>
  );
}

function PlayingBars({ large = false }: { large?: boolean }) {
  const cls = large ? 'h-8 w-1.5' : 'h-4 w-0.5';
  return (
    <span className="inline-flex items-end gap-0.5 text-indigo-400">
      <span className={cn(cls, 'animate-eq-1')} />
      <span className={cn(cls, 'animate-eq-2')} />
      <span className={cn(cls, 'animate-eq-3')} />
    </span>
  );
}
