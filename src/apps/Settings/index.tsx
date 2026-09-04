import { Monitor, Palette, Shield } from 'lucide-react';
import { useOSStore } from '@/stores/useOSStore';
import type { AppProps } from '@/shell/types';

const WALLPAPERS = [
  { id: 'grid', label: '默认网格', url: '/wallpapers/grid.svg' },
  { id: 'arch', label: 'Arch Blue', url: '/wallpapers/arch.svg' },
  { id: 'dots', label: '暗夜点阵', url: '/wallpapers/dots.svg' },
  { id: 'aurora', label: '极光', url: '/wallpapers/aurora.svg' },
];

export default function Settings({ context }: AppProps) {
  const settings = useOSStore((s) => s.settings);
  const update = useOSStore((s) => s.updateSettings);

  return (
    <div className="flex h-full bg-arch-bg text-arch-text">
      <nav className="w-44 border-r border-arch-border bg-arch-panel/60 p-2 text-sm">
        {[
          { Icon: Monitor, label: '桌面' },
          { Icon: Palette, label: '外观' },
          { Icon: Shield, label: '系统' },
        ].map(({ Icon, label }, i) => (
          <div
            key={label}
            className={`flex items-center gap-2 rounded px-3 py-2 ${
              i === 0 ? 'bg-arch-accent/15 text-arch-accent' : 'hover:bg-white/5'
            }`}
          >
            <Icon size={14} /> {label}
          </div>
        ))}
      </nav>

      <div className="flex-1 space-y-6 overflow-auto p-5 text-sm">
        <section>
          <h3 className="mb-2 text-xs uppercase tracking-wider text-arch-muted">
            壁纸
          </h3>
          <div className="grid grid-cols-4 gap-2">
            {WALLPAPERS.map((w) => {
              const active = settings.wallpaper === w.url;
              return (
                <button
                  key={w.id}
                  type="button"
                  onClick={() => update({ wallpaper: w.url })}
                  className={`overflow-hidden rounded-lg border-2 transition ${
                    active
                      ? 'border-arch-accent'
                      : 'border-transparent hover:border-arch-border'
                  }`}
                >
                  <div
                    className="h-16 w-full bg-cover bg-center"
                    style={{ backgroundImage: `url(${w.url})` }}
                  />
                  <div className="bg-black/40 py-1 text-[11px]">{w.label}</div>
                </button>
              );
            })}
          </div>
        </section>

        <section>
          <h3 className="mb-2 text-xs uppercase tracking-wider text-arch-muted">
            窗口
          </h3>
          <label className="mb-1 block text-xs">背景不透明度</label>
          <input
            type="range"
            min={0.5}
            max={1}
            step={0.02}
            value={settings.windowOpacity}
            onChange={(e) =>
              update({ windowOpacity: Number(e.target.value) })
            }
            className="w-full"
          />
          <div className="text-[11px] text-arch-muted">
            {(settings.windowOpacity * 100).toFixed(0)}%
          </div>
        </section>

        <section>
          <h3 className="mb-2 text-xs uppercase tracking-wider text-arch-muted">
            安全
          </h3>
          <label className="mb-1 block text-xs">无操作自动锁屏（分钟）</label>
          <input
            type="number"
            min={0}
            max={60}
            value={settings.autoLockMinutes}
            onChange={(e) =>
              update({ autoLockMinutes: Math.max(0, Number(e.target.value)) })
            }
            className="w-24 rounded border border-arch-border bg-black/30 px-2 py-1 text-xs"
          />
          <div className="mt-1 text-[11px] text-arch-muted">
            设置为 0 表示不自动锁屏
          </div>
        </section>

        <section className="border-t border-arch-border pt-3 text-[11px] text-arch-muted">
          Arch Web OS v2 · 在浏览器里运行 Arch Linux
          <br />
          窗口 ID: {context.windowId}
        </section>
      </div>
    </div>
  );
}
