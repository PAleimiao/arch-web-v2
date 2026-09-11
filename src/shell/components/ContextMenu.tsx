import { useEffect, useState } from 'react';
import {
  BookOpen,
  Command,
  Image,
  Lock,
  Package,
  Power,
  RefreshCw,
  RotateCcw,
  StickyNote,
  TerminalSquare,
} from 'lucide-react';
import { useOSStore } from '@/stores/useOSStore';
import { useWindowStore } from '@/stores/useWindowStore';
import { notify } from '@/stores/useNotifyStore';
import { getApp } from '@/apps/registry';

interface MenuState {
  x: number;
  y: number;
}

const WALLPAPERS = [
  `${import.meta.env.BASE_URL}/wallpapers/grid.svg`,
  `${import.meta.env.BASE_URL}/wallpapers/arch.svg`,
  `${import.meta.env.BASE_URL}/wallpapers/aurora.svg`,
  `${import.meta.env.BASE_URL}/wallpapers/dots.svg`,
];

const ITEMS: Array<{ key: string; label: string; icon: typeof Lock; group?: number }> = [
  { key: 'terminal', label: '打开终端', icon: TerminalSquare },
  { key: 'palette', label: '命令面板', icon: Command },
  { key: 'newnote', label: '新建便签', icon: StickyNote },
  { key: 'wallpaper', label: '换一张壁纸', icon: Image, group: 1 },
  { key: 'packages', label: '软件包管理', icon: Package },
  { key: 'help', label: '帮助手册', icon: BookOpen },
  { key: 'refresh', label: '刷新桌面', icon: RefreshCw, group: 1 },
  { key: 'lock', label: '锁定屏幕', icon: Lock },
  { key: 'poweroff', label: '关机', icon: Power, group: 1 },
];

export default function ContextMenu() {
  const [menu, setMenu] = useState<MenuState | null>(null);

  useEffect(() => {
    const onCtx = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      // 窗口内与输入框里的右键交给应用自己处理
      if (target.closest('[data-window]') || target.closest('input, textarea')) {
        return;
      }
      e.preventDefault();
      setMenu({ x: e.clientX, y: e.clientY });
    };
    const close = () => setMenu(null);

    window.addEventListener('contextmenu', onCtx);
    window.addEventListener('mousedown', close);
    window.addEventListener('blur', close);
    return () => {
      window.removeEventListener('contextmenu', onCtx);
      window.removeEventListener('mousedown', close);
      window.removeEventListener('blur', close);
    };
  }, []);

  if (!menu) return null;

  const os = useOSStore.getState();
  const win = useWindowStore.getState();

  const launch = (appId: string, titleOverride?: string) => {
    const app = getApp(appId);
    if (!app) {
      notify('打不开', `没有找到应用 ${appId}`, 'warn');
      return;
    }
    win.open({
      appId: app.id,
      title: titleOverride ?? app.name,
      width: app.defaultWidth,
      height: app.defaultHeight,
      singleton: app.singleton,
    });
  };

  const run = (key: string) => {
    switch (key) {
      case 'terminal':
        launch('terminal');
        break;
      case 'palette':
        os.togglePalette(true);
        break;
      case 'newnote':
        launch('sticky-notes');
        break;
      case 'wallpaper': {
        const i = WALLPAPERS.indexOf(os.settings.wallpaper);
        os.updateSettings({ wallpaper: WALLPAPERS[(i + 1) % WALLPAPERS.length] });
        notify('已更换壁纸', undefined, 'success');
        break;
      }
      case 'packages':
        launch('settings');
        break;
      case 'help':
        launch('help');
        break;
      case 'refresh':
        window.location.reload();
        break;
      case 'lock':
        os.lock();
        break;
      case 'poweroff':
        os.shutdown();
        break;
      default:
        break;
    }
    setMenu(null);
  };

  // 菜单可能超出屏幕，做一次夹取
  const left = Math.min(menu.x, window.innerWidth - 190);
  const top = Math.min(menu.y, window.innerHeight - 300);

  return (
    <div
      className="fixed z-[9500] w-44 overflow-hidden rounded-lg border border-arch-border bg-arch-panel/95 py-1 shadow-2xl backdrop-blur-md"
      style={{ left, top }}
      onMouseDown={(e) => e.stopPropagation()}
    >
      {ITEMS.map((item, idx) => {
        const Icon = item.icon;
        const prev = ITEMS[idx - 1];
        return (
          <div key={item.key}>
            {prev?.group === 1 && (
              <div className="my-1 border-t border-arch-border/70" />
            )}
            <button
              type="button"
              onClick={() => run(item.key)}
              className={
                'flex w-full items-center gap-2 px-3 py-1.5 text-left text-[11px] text-arch-text transition hover:bg-white/10' +
                (item.key === 'poweroff' ? ' text-arch-red' : '')
              }
            >
              <Icon size={12} className="text-arch-muted" />
              {item.label}
            </button>
          </div>
        );
      })}
      <div className="mt-1 border-t border-arch-border/70 px-3 pt-1.5 text-[10px] text-arch-muted">
        <span className="flex items-center gap-1">
          <RotateCcw size={9} /> 双击桌面图标也能开应用
        </span>
      </div>
    </div>
  );
}
