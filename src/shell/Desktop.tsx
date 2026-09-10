import TopBar from './components/TopBar';
import Dock from './components/Dock';
import AppLauncher from './components/AppLauncher';
import ContextMenu from './components/ContextMenu';
import CommandPalette from './components/CommandPalette';
import { NotificationToasts } from './components/NotificationCenter';
import WindowManager from './window/WindowManager';
import { useOSStore } from '@/stores/useOSStore';
import { useWindowStore } from '@/stores/useWindowStore';
import { usePackageStore } from '@/stores/usePackageStore';
import { APPS } from '@/apps/registry';

/** 桌面只放「应用」类里比较像桌面快捷方式的那些，其余走启动器 */
const DESKTOP_FALLBACK_LIMIT = 6;

export default function Desktop() {
  const wallpaper = useOSStore((s) => s.settings.wallpaper);
  const allApps = useOSStore((s) => s.settings.desktopAllApps);
  const iconSize = useOSStore((s) => s.settings.desktopIconSize);
  const open = useWindowStore((s) => s.open);
  const windows = useWindowStore((s) => s.windows);
  const disabled = usePackageStore((s) => s.disabled);

  const installed = APPS.filter((a) => !disabled.includes(a.id));
  const desktopApps = allApps ? installed : installed.slice(0, DESKTOP_FALLBACK_LIMIT);

  return (
    <div className="relative h-full w-full overflow-hidden bg-arch-bg">
      {/* 壁纸 */}
      <div
        className="absolute inset-0 bg-cover bg-center"
        style={{ backgroundImage: `url(${wallpaper})` }}
      />
      <div className="absolute inset-0 bg-gradient-to-b from-black/25 via-transparent to-black/40" />

      <TopBar />

      {/* 桌面图标：多了就滚动，别溢出屏幕 */}
      <div className="absolute bottom-24 left-3 top-10 w-[104px] overflow-y-auto overflow-x-hidden pr-1">
        <div className="grid gap-3">
          {desktopApps.map((app) => {
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
                    singleton: app.singleton,
                  })
                }
                className="group flex flex-col items-center gap-1 rounded-lg p-2 transition hover:bg-white/10"
              >
                <div
                  className="flex items-center justify-center rounded-xl shadow-lg"
                  style={{
                    width: iconSize,
                    height: iconSize,
                    background: `${app.accent ?? '#1793d1'}33`,
                  }}
                >
                  <Icon
                    size={Math.round(iconSize * 0.5)}
                    style={{ color: app.accent ?? '#1793d1' }}
                  />
                </div>
                <span className="desktop-icon-label w-full truncate text-center text-[11px] text-white/90">
                  {app.name}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {/* 空状态提示 */}
      {windows.length === 0 && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <div className="text-center text-white/25">
            <p className="text-sm">双击图标或按 Super 键打开应用</p>
            <p className="mt-1 text-[11px]">
              Ctrl+Shift+P 命令面板 · Ctrl+Alt+T 终端 · Ctrl+L 锁屏
            </p>
            <p className="mt-0.5 text-[11px]">
              右键桌面有菜单 · 窗口拖到屏幕边缘会贴边
            </p>
          </div>
        </div>
      )}

      <WindowManager />
      <AppLauncher />
      <CommandPalette />
      <NotificationToasts />
      <ContextMenu />
      <Dock />
    </div>
  );
}
