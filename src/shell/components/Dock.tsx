import { useWindowStore } from '@/stores/useWindowStore';
import { useOSStore } from '@/stores/useOSStore';
import { APPS } from '@/apps/registry';
import { cn } from '@/lib/cn';

/** 底部 Dock：常驻应用 + 已打开窗口指示 */
export default function Dock() {
  const windows = useWindowStore((s) => s.windows);
  const activeId = useWindowStore((s) => s.activeId);
  const open = useWindowStore((s) => s.open);
  const focus = useWindowStore((s) => s.focus);
  const toggleLauncher = useOSStore((s) => s.toggleLauncher);
  const launcherOpen = useOSStore((s) => s.launcherOpen);

  const pinned = APPS.slice(0, 6);

  const click = (appId: string, name: string) => {
    const existing = windows.find((w) => w.appId === appId);
    if (existing) {
      if (existing.minimized) useWindowStore.getState().restore(existing.id);
      focus(existing.id);
    } else {
      open({ appId, title: name });
    }
  };

  return (
    <div className="pointer-events-none absolute bottom-2 left-1/2 z-[7000] -translate-x-1/2">
      <div className="pointer-events-auto flex items-end gap-1.5 rounded-2xl border border-white/10 bg-black/45 px-2 py-1.5 shadow-2xl backdrop-blur-md">
        {pinned.map((app) => {
          const Icon = app.icon;
          const running = windows.some((w) => w.appId === app.id);
          const active = windows.some(
            (w) => w.appId === app.id && w.id === activeId && !w.minimized,
          );
          return (
            <button
              key={app.id}
              type="button"
              title={app.description}
              onClick={() => click(app.id, app.name)}
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
              <span
                className={cn(
                  'absolute -bottom-0.5 h-1 w-1 rounded-full transition',
                  running ? 'bg-arch-accent' : 'bg-transparent',
                )}
              />
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
