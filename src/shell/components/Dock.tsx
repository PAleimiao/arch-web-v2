import { useWindowStore } from '@/stores/useWindowStore';
import { useOSStore } from '@/stores/useOSStore';
import { APPS, getApp } from '@/apps/registry';
import { cn } from '@/lib/cn';

const PINNED_IDS = ['terminal', 'files', 'browser', 'music', 'settings'] as const;

/** 底部 Dock：常驻应用 + 已打开窗口指示（含多窗口徽章） */
export default function Dock() {
  const windows = useWindowStore((s) => s.windows);
  const activeId = useWindowStore((s) => s.activeId);
  const open = useWindowStore((s) => s.open);
  const focus = useWindowStore((s) => s.focus);
  const close = useWindowStore((s) => s.close);
  const restore = useWindowStore((s) => s.restore);
  const toggleLauncher = useOSStore((s) => s.toggleLauncher);
  const launcherOpen = useOSStore((s) => s.launcherOpen);

  // 计算每个 app 当前的窗口数（用于徽章）
  const windowCount = new Map<string, number>();
  for (const w of windows) {
    windowCount.set(w.appId, (windowCount.get(w.appId) ?? 0) + 1);
  }

  // 显示顺序：pinned 在前；pinned 里没开的去掉；
  // pinned 后 = 已开但不在 pinned 里的（按打开顺序）
  const runningExtras = windows
    .filter((w) => !PINNED_IDS.includes(w.appId as (typeof PINNED_IDS)[number]))
    .reduce<{ id: string; first: typeof windows[number] }[]>((acc, w) => {
      if (!acc.some((a) => a.id === w.appId)) acc.push({ id: w.appId, first: w });
      return acc;
    }, []);

  const orderedItems: { appId: string; pinned: boolean }[] = [
    ...PINNED_IDS.filter((id) => getApp(id)).map((id) => ({ appId: id, pinned: true })),
    ...runningExtras.map((e) => ({ appId: e.id, pinned: false })),
  ];

  const click = (appId: string, name: string) => {
    const all = windows.filter((w) => w.appId === appId);
    if (all.length === 0) {
      open({ appId, title: name });
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
    if (all[lastIdx].minimized) {
      restore(all[lastIdx].id);
      focus(all[lastIdx].id);
    } else {
      // 全部已展开 → 聚焦最后一个
      focus(all[lastIdx].id);
    }
  };

  return (
    <div className="pointer-events-none absolute bottom-2 left-1/2 z-[7000] -translate-x-1/2">
      <div className="pointer-events-auto flex items-end gap-1.5 rounded-2xl border border-white/10 bg-black/45 px-2 py-1.5 shadow-2xl backdrop-blur-md">
        {orderedItems.map(({ appId, pinned }) => {
          const app = getApp(appId);
          if (!app) return null;
          const Icon = app.icon;
          const count = windowCount.get(appId) ?? 0;
          const active = windows.some(
            (w) => w.appId === appId && w.id === activeId && !w.minimized,
          );
          return (
            <button
              key={appId}
              type="button"
              title={app.description}
              onClick={() => click(appId, app.name)}
              className={cn(
                'group relative flex h-11 w-11 items-center justify-center rounded-xl transition-all duration-150 hover:-translate-y-1 hover:bg-white/10',
                active && 'bg-white/12',
              )}
            >
              <Icon
                size={21}
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
              {count >= 1 && count <= 1 && (
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
                    // 关闭该 app 的所有窗口
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
          );
        })}

        <div className="mx-1 h-8 w-px bg-white/10" />

        <button
          type="button"
          onClick={() => toggleLauncher()}
          title="应用启动器"
          className={cn(
            'flex h-11 w-11 items-center justify-center rounded-xl transition hover:-translate-y-1 hover:bg-white/10',
            launcherOpen && 'bg-arch-accent/25',
          )}
        >
          <div className="grid grid-cols-2 gap-[3px]">
            {Array.from({ length: 4 }).map((_, i) => (
              <span
                key={i}
                className="h-1.5 w-1.5 rounded-[1px] bg-arch-text/70"
              />
            ))}
          </div>
        </button>
      </div>
    </div>
  );
}
