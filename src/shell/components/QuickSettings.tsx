import { useEffect, useState } from 'react';
import {
  Gauge,
  Monitor,
  Moon,
  Sparkles,
  Sun,
  Volume2,
  VolumeX,
} from 'lucide-react';
import { cn } from '@/lib/cn';
import { useOSStore } from '@/stores/useOSStore';
import { useMediaStore } from '@/stores/useMediaStore';
import { usePackageStore } from '@/stores/usePackageStore';

const WALLPAPERS: Array<{ path: string; label: string }> = [
  { path: `${import.meta.env.BASE_URL}/wallpapers/grid.svg`, label: '网格' },
  { path: `${import.meta.env.BASE_URL}/wallpapers/arch.svg`, label: 'Arch' },
  { path: `${import.meta.env.BASE_URL}/wallpapers/aurora.svg`, label: '极光' },
  { path: `${import.meta.env.BASE_URL}/wallpapers/dots.svg`, label: '圆点' },
];

const ACCENTS = ['#1793d1', '#4ec9b0', '#e06c75', '#c678dd', '#d19a66', '#61afef', '#e84393'];

function useStorageUsage(open: boolean) {
  const [text, setText] = useState<string | null>(null);
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    void (async () => {
      try {
        const est = await navigator.storage?.estimate?.();
        if (cancelled || !est) return;
        const used = (est.usage ?? 0) / 1024 / 1024;
        const quota = (est.quota ?? 0) / 1024 / 1024;
        setText(
          `${used.toFixed(1)} MB 已用 / ${quota >= 1024 ? `${(quota / 1024).toFixed(1)} GB` : `${quota.toFixed(0)} MB`}`,
        );
      } catch {
        if (!cancelled) setText(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open]);
  return text;
}

export default function QuickSettings() {
  const [open, setOpen] = useState(false);
  const settings = useOSStore((s) => s.settings);
  const update = useOSStore((s) => s.updateSettings);
  const lock = useOSStore((s) => s.lock);
  const volume = useMediaStore((s) => s.volume);
  const muted = useMediaStore((s) => s.muted);
  const setVolume = useMediaStore((s) => s.setVolume);
  const toggleMute = useMediaStore((s) => s.toggleMute);
  const installedCount = usePackageStore(
    (s) => s.disabled.length,
  );
  const storage = useStorageUsage(open);

  const hasMedia = useMediaStore((s) => Boolean(s.current));

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        title="快速设置"
        className={cn(
          'flex items-center gap-1.5 rounded px-2 py-0.5 transition',
          open ? 'bg-white/15' : 'hover:bg-white/10',
        )}
      >
        {muted ? (
          <VolumeX size={12} className="text-arch-muted" />
        ) : (
          <Volume2 size={12} className="text-arch-muted" />
        )}
        <Gauge size={12} className="text-arch-muted" />
      </button>

      {open && (
        <>
          <button
            type="button"
            aria-label="关闭快速设置"
            className="fixed inset-0 z-[6000] cursor-default"
            onClick={() => setOpen(false)}
          />
          <div className="animate-pop-in absolute right-0 top-8 z-[6001] w-72 rounded-lg border border-arch-border bg-arch-panel/97 p-3 text-[11px] shadow-2xl backdrop-blur">
            {/* 音量 */}
            <div className="mb-3">
              <div className="mb-1.5 flex items-center justify-between text-arch-muted">
                <span>音量</span>
                <span className="tabular-nums">{Math.round((muted ? 0 : volume) * 100)}%</span>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={toggleMute}
                  className="rounded p-1 transition hover:bg-white/10"
                  title={muted ? '取消静音' : '静音'}
                >
                  {muted ? <VolumeX size={13} /> : <Volume2 size={13} />}
                </button>
                <input
                  type="range"
                  min={0}
                  max={1}
                  step={0.01}
                  value={muted ? 0 : volume}
                  onChange={(e) => {
                    setVolume(Number(e.target.value));
                    if (muted && Number(e.target.value) > 0) toggleMute();
                  }}
                  className="h-1 w-full accent-[var(--color-arch-accent)]"
                />
              </div>
              {!hasMedia && (
                <p className="mt-1 text-[10px] text-arch-muted/70">
                  当前没有正在播放的音频
                </p>
              )}
            </div>

            {/* 主题 */}
            <div className="mb-3 flex gap-1.5">
              <button
                type="button"
                onClick={() => update({ darkMode: true })}
                className={cn(
                  'flex flex-1 items-center justify-center gap-1 rounded border px-2 py-1.5 transition',
                  settings.darkMode
                    ? 'border-arch-accent bg-arch-accent/20 text-arch-text'
                    : 'border-arch-border text-arch-muted hover:bg-white/5',
                )}
              >
                <Moon size={12} /> 暗色
              </button>
              <button
                type="button"
                onClick={() => update({ darkMode: false })}
                className={cn(
                  'flex flex-1 items-center justify-center gap-1 rounded border px-2 py-1.5 transition',
                  !settings.darkMode
                    ? 'border-arch-accent bg-arch-accent/20 text-arch-text'
                    : 'border-arch-border text-arch-muted hover:bg-white/5',
                )}
              >
                <Sun size={12} /> 亮色
              </button>
            </div>

            {/* 强调色 */}
            <div className="mb-3">
              <p className="mb-1.5 text-arch-muted">强调色</p>
              <div className="flex gap-1.5">
                {ACCENTS.map((c) => (
                  <button
                    key={c}
                    type="button"
                    onClick={() => update({ accentColor: c })}
                    title={c}
                    className={cn(
                      'h-5 w-5 rounded-full border-2 transition',
                      settings.accentColor.toLowerCase() === c.toLowerCase()
                        ? 'border-white scale-110'
                        : 'border-transparent hover:scale-105',
                    )}
                    style={{ background: c }}
                  />
                ))}
              </div>
            </div>

            {/* 壁纸 */}
            <div className="mb-3">
              <p className="mb-1.5 text-arch-muted">壁纸</p>
              <div className="grid grid-cols-4 gap-1.5">
                {WALLPAPERS.map((w) => (
                  <button
                    key={w.path}
                    type="button"
                    onClick={() => update({ wallpaper: w.path })}
                    title={w.label}
                    className={cn(
                      'h-9 overflow-hidden rounded border-2 bg-cover bg-center transition',
                      settings.wallpaper === w.path
                        ? 'border-arch-accent'
                        : 'border-arch-border hover:border-arch-muted',
                    )}
                    style={{ backgroundImage: `url(${w.path})` }}
                  />
                ))}
              </div>
            </div>

            {/* 开关 */}
            <div className="mb-3 space-y-1.5">
              <label className="flex cursor-pointer items-center justify-between">
                <span className="flex items-center gap-1.5 text-arch-muted">
                  <Sparkles size={11} /> 动画效果
                </span>
                <input
                  type="checkbox"
                  checked={settings.animations}
                  onChange={(e) => update({ animations: e.target.checked })}
                  className="accent-[var(--color-arch-accent)]"
                />
              </label>
              <label className="flex cursor-pointer items-center justify-between">
                <span className="flex items-center gap-1.5 text-arch-muted">
                  <Monitor size={11} /> 顶栏显示秒
                </span>
                <input
                  type="checkbox"
                  checked={settings.clockSeconds}
                  onChange={(e) => update({ clockSeconds: e.target.checked })}
                  className="accent-[var(--color-arch-accent)]"
                />
              </label>
              <label className="flex cursor-pointer items-center justify-between">
                <span className="flex items-center gap-1.5 text-arch-muted">
                  <Monitor size={11} /> 桌面平铺全部应用
                </span>
                <input
                  type="checkbox"
                  checked={settings.desktopAllApps}
                  onChange={(e) => update({ desktopAllApps: e.target.checked })}
                  className="accent-[var(--color-arch-accent)]"
                />
              </label>
            </div>

            {/* 窗口透明度 */}
            <div className="mb-3">
              <div className="mb-1 flex items-center justify-between text-arch-muted">
                <span>窗口不透明度</span>
                <span className="tabular-nums">
                  {Math.round(settings.windowOpacity * 100)}%
                </span>
              </div>
              <input
                type="range"
                min={0.5}
                max={1}
                step={0.02}
                value={settings.windowOpacity}
                onChange={(e) => update({ windowOpacity: Number(e.target.value) })}
                className="h-1 w-full accent-[var(--color-arch-accent)]"
              />
            </div>

            <div className="flex items-center justify-between border-t border-arch-border pt-2">
              <span className="text-[10px] text-arch-muted">
                {storage ?? '存储用量不可读'}
                {installedCount > 0 && ` · 已卸载 ${installedCount} 个`}
              </span>
              <button
                type="button"
                onClick={() => {
                  setOpen(false);
                  lock();
                }}
                className="rounded border border-arch-border px-2 py-1 transition hover:bg-white/10"
              >
                锁屏
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
