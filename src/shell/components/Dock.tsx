import { useEffect, useRef, useState } from 'react';
import { useWindowStore } from '@/stores/useWindowStore';
import { useOSStore } from '@/stores/useOSStore';
import { usePackageStore } from '@/stores/usePackageStore';
import { notify } from '@/stores/useNotifyStore';
import { getApp } from '@/apps/registry';
import { cn } from '@/lib/cn';

const PINNED_IDS = ['terminal', 'files', 'browser', 'music', 'settings'] as const;

interface DockMenu {
  appId: string;
  /** 菜单相对 dock 的坐标（px，left/bottom 定位） */
  x: number;
  y: number;
}

/** 底部 Dock：常驻应用 + 已打开窗口指示（含多窗口徽章），右键有菜单 */
export default function Dock() {
  const windows = useWindowStore((s) => s.windows);
  const activeId = useWindowStore((s) => s.activeId);
  const open = useWindowStore((s) => s.open);
  const focus = useWindowStore((s) => s.focus);
  const close = useWindowStore((s) => s.close);
  const restore = useWindowStore((s) => s.restore);
  const toggleLauncher = useOSStore((s) => s.toggleLauncher);
  const launcherOpen = useOSStore((s) => s.launcherOpen);
  const dockSize = useOSStore((s) => s.settings.dockSize);
  const disabled = usePackageStore((s) => s.disabled);
  const removePkg = usePackageStore((s) => s.remove);

  const [menu, setMenu] = useState<DockMenu | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menu) return;
    const onDown = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setMenu(null);
    };
    window.addEventListener('mousedown', onDown);
    return () => window.removeEventListener('mousedown', onDown);
  }, [menu]);

  // 计算每个 app 当前的窗口数（用于徽章）
  const windowCount = new Map<string, number>();
  for (const w of windows) {
    windowCount.set(w.appId, (windowCount.get(w.appId) ?? 0) + 1);
  }

  // pinned 后 = 已开但不在 pinned 里的（按打开顺序）
  const runningExtras = windows
    .filter((w) => !PINNED_IDS.includes(w.appId as (typeof PINNED_IDS)[number]))
    .reduce<string[]>((acc, w) => {
      if (!acc.includes(w.appId)) acc.push(w.appId);
      return acc;
    }, []);

  // 常驻应用 + 额外运行中的应用；被卸载的不显示
  const orderedItems: string[] = [
    ...PINNED_IDS.filter((id) => getApp(id) && !disabled.includes(id)),
    ...runningExtras.filter((id) => !disabled.includes(id)),
  ];

  const click = (appId: string, name: string) => {
    const all = windows.filter((w) => w.appId === appId);
    if (all.length === 0) {
      open({ appId, title: name, singleton: getApp(appId)?.singleton });
      return;
    }
    const visible = all.find((w) => !w.minimized);
    if (all.length === 1) {
      if (visible) {
        // 唯一窗口可见 → 最小化（Mac 风格）
        useWindowStore.getState().minimize(all[0].id);
      } else {
        restore(all[0].id);
        focus(all[0].id);
      }
      return;
    }
    // 多窗口：在最新的最小化窗口上切换
    const lastIdx = all.length - 1;
    const last = all[lastIdx];
    if (last && last.minimized) {
      restore(last.id);
      focus(last.id);
    } else if (last) {
      focus(last.id);
    }
  };

  const menuApp = menu ? getApp(menu.appId) : null;
  const menuWins = menu ? windows.filter((w) => w.appId === menu.appId) : [];
  const itemSize = Math.max(36, Math.min(80, dockSize));

  return (
    <div className="pointer-events-none absolute bottom-2 left-1/2 z-[7000] -translate-x-1/2">
      <div
        ref={wrapRef}
        className="pointer-events-auto relative flex items-end gap-1.5 rounded-2xl border border-white/10 bg-black/45 px-2 py-1.5 shadow-2xl backdrop-blur-md"
      >
        {menu && menuApp && (
          <div
            className="animate-pop-in absolute z-[7100] w-40 overflow-hidden rounded-lg border border-arch-border bg-arch-panel/97 py-1 text-[11px] shadow-2xl backdrop-blur"
            style={{
              left: Math.max(4, Math.min(menu.x - 80, window.innerWidth - 200)),
              bottom: '100%',
              marginBottom: 8,
            }}
          >
            <p className="truncate px-3 py-1 text-[10px] uppercase tracking-wider text-arch-muted">
              {menuApp.name}
            </p>
            <button
              type="button"
              className="block w-full px-3 py-1.5 text-left hover:bg-white/10"
              onClick={() => {
                open({
                  appId: menuApp.id,
                  title: menuApp.name,
                  width: menuApp.defaultWidth,
                  height: menuApp.defaultHeight,
                  singleton: menuApp.singleton,
                });
                setMenu(null);
              }}
            >
              打开新窗口
            </button>
            {menuWins.length > 0 && (
              <>
                <button
                  type="button"
                  className="block w-full px-3 py-1.5 text-left hover:bg-white/10"
                  onClick={() => {
                    menuWins.forEach((w) => restore(w.id));
                    const first = menuWins[0];
                    if (first) focus(first.id);
                    setMenu(null);
                  }}
                >
                  全部还原
                </button>
                <button
                  type="button"
                  className="block w-full px-3 py-1.5 text-left hover:bg-white/10"
                  onClick={() => {
                    menuWins.forEach((w) => useWindowStore.getState().minimize(w.id));
                    setMenu(null);
                  }}
                >
                  全部最小化
                </button>
                <button
                  type="button"
                  className="block w-full px-3 py-1.5 text-left text-arch-red hover:bg-white/10"
                  onClick={() => {
                    menuWins.forEach((w) => close(w.id));
                    setMenu(null);
                  }}
                >
                  关闭 {menuWins.length} 个窗口
                </button>
              </>
            )}
            <button
              type="button"
              className="block w-full border-t border-arch-border px-3 py-1.5 text-left text-arch-red hover:bg-white/10"
              onClick={() => {
                removePkg(menuApp.id);
                notify('已从 Dock 卸载', menuApp.name, 'warn');
                setMenu(null);
              }}
            >
              卸载并隐藏
            </button>
          </div>
        )}

        {orderedItems.map((appId) => {
          const app = getApp(appId);
          if (!app) return null;
          const Icon = app.icon;
          const count = windowCount.get(appId) ?? 0;
          const active = windows.some(
            (w) => w.appId === appId && w.id === activeId && !w.minimized,
          );
          return (
            <div key={appId} className="relative">
              <button
                type="button"
                title={app.description}
                onClick={() => click(appId, app.name)}
                onContextMenu={(e) => {
                  e.preventDefault();
                  const rect = wrapRef.current?.getBoundingClientRect();
                  const baseX = rect ? e.clientX - rect.left : e.clientX;
                  setMenu({ appId, x: baseX, y: 0 });
                }}
                style={{ width: itemSize, height: itemSize }}
                className={cn(
                  'group relative flex items-center justify-center rounded-xl transition-all duration-150 hover:-translate-y-1 hover:bg-white/10',
                  active && 'bg-white/12',
                )}
              >
                <Icon
                  size={Math.round(itemSize * 0.46)}
                  style={{ color: app.accent ?? '#1793d1' }}
                  className="drop-shadow"
                />
                {/* 多窗口徽章（>1 才显示） */}
                {count > 1 && (
                  <span className="absolute right-0.5 top-0.5 min-w-[16px] rounded-full bg-rose-500 px-1 text-[9px] font-bold leading-[14px] text-white shadow ring-1 ring-black/40">
                    {count}
                  </span>
                )}
                {/* 运行指示（≤1 个时显示小圆点） */}
                {count === 1 && (
                  <span
                    className={cn(
                      'absolute -bottom-0.5 h-1 w-1 rounded-full transition',
                      active ? 'bg-arch-accent' : 'bg-white/60',
                    )}
                  />
                )}
                {/* 多窗口时下面显示小横条 */}
                {count > 1 && (
                  <div className="absolute -bottom-0.5 flex gap-0.5">
                    {Array.from({ length: Math.min(count, 4) }).map((_, i) => (
                      <span
                        key={i}
                        className={cn(
                          'h-0.5 w-1 rounded-full',
                          active ? 'bg-arch-accent' : 'bg-white/50',
                        )}
                      />
                    ))}
                  </div>
                )}
                {/* hover 才显示的关闭按钮 */}
                {count >= 1 && (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      for (const w of windows.filter((x) => x.appId === appId)) {
                        close(w.id);
                      }
                    }}
                    className="absolute -right-1 -top-1 hidden h-4 w-4 items-center justify-center rounded-full bg-rose-500 text-[10px] text-white shadow group-hover:flex"
                    title="关闭该应用所有窗口"
                  >
                    ×
                  </button>
                )}
              </button>
            </div>
          );
        })}

        <div className="mx-1 h-8 w-px bg-white/10" />

        <button
          type="button"
          onClick={() => toggleLauncher()}
          title="应用启动器"
          style={{ width: itemSize, height: itemSize }}
          className={cn(
            'flex items-center justify-center rounded-xl transition hover:-translate-y-1 hover:bg-white/10',
            launcherOpen && 'bg-arch-accent/25',
          )}
        >
          <div className="grid grid-cols-2 gap-[3px]">
            {Array.from({ length: 4 }).map((_, i) => (
              <span key={i} className="h-1.5 w-1.5 rounded-[1px] bg-arch-text/70" />
            ))}
          </div>
        </button>
      </div>
    </div>
  );
}
