import TopBar from './components/TopBar';
import Dock from './components/Dock';
import AppLauncher from './components/AppLauncher';
import ContextMenu from './components/ContextMenu';
import WindowManager from './window/WindowManager';
import { useOSStore } from '@/stores/useOSStore';
import { useWindowStore } from '@/stores/useWindowStore';
import { APPS } from '@/apps/registry';

export default function Desktop() {
  const wallpaper = useOSStore((s) => s.settings.wallpaper);
  const open = useWindowStore((s) => s.open);
  const windows = useWindowStore((s) => s.windows);

  return (
    <div className="relative h-full w-full overflow-hidden bg-arch-bg">
      {/* 壁纸 */}
      <div
        className="absolute inset-0 bg-cover bg-center"
        style={{ backgroundImage: `url(${wallpaper})` }}
      />
      <div className="absolute inset-0 bg-gradient-to-b from-black/25 via-transparent to-black/40" />

      <TopBar />

      {/* 桌面图标 */}
      <div className="absolute left-3 top-10 grid w-[92px] gap-3">
        {APPS.slice(0, 6).map((app) => {
          const Icon = app.icon;
          return (
            <button
              key={app.id}
              type="button"
              onDoubleClick={() =>
                open({
                  appId: app.id,
                  title: app.name,
                  width: app.defaultWidth,
                  height: app.defaultHeight,
                })
              }
              className="group flex flex-col items-center gap-1 rounded-lg p-2 transition hover:bg-white/10"
            >
              <div
                className="flex h-11 w-11 items-center justify-center rounded-xl shadow-lg"
                style={{ background: `${app.accent ?? '#1793d1'}33` }}
              >
                <Icon size={22} style={{ color: app.accent ?? '#1793d1' }} />
              </div>
              <span className="desktop-icon-label w-full truncate text-center text-[11px] text-white/90">
                {app.name}
              </span>
            </button>
          );
        })}
      </div>

      {/* 空状态提示 */}
      {windows.length === 0 && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <div className="text-center text-white/25">
            <p className="text-sm">双击图标或按 Super 键打开应用</p>
            <p className="mt-1 text-[11px]">Ctrl+Alt+T 终端 · Ctrl+L 锁屏</p>
          </div>
        </div>
      )}

      <WindowManager />
      <AppLauncher />
      <ContextMenu />
      <Dock />
    </div>
  );
}
