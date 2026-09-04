import { useEffect, useState } from 'react';
import { RefreshCw, TerminalSquare, Lock, Power } from 'lucide-react';
import { useOSStore } from '@/stores/useOSStore';
import { useWindowStore } from '@/stores/useWindowStore';
import { getApp } from '@/apps/registry';

interface MenuState {
  x: number;
  y: number;
}

const ITEMS = [
  { key: 'terminal', label: '打开终端', icon: TerminalSquare },
  { key: 'refresh', label: '刷新桌面', icon: RefreshCw },
  { key: 'lock', label: '锁定屏幕', icon: Lock },
  { key: 'poweroff', label: '关机', icon: Power },
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

  const run = (key: string) => {
    if (key === 'terminal') {
      const app = getApp('terminal');
      if (app) win.open({ appId: app.id, title: app.name });
    } else if (key === 'refresh') {
      window.location.reload();
    } else if (key === 'lock') {
      os.lock();
    } else if (key === 'poweroff') {
      os.shutdown();
    }
    setMenu(null);
  };

  return (
    <div
      className="fixed z-[9500] w-44 overflow-hidden rounded-lg border border-arch-border bg-arch-panel/95 py-1 shadow-2xl backdrop-blur-md"
      style={{ left: menu.x, top: menu.y }}
      onMouseDown={(e) => e.stopPropagation()}
    >
      {ITEMS.map((item) => {
        const Icon = item.icon;
        return (
          <button
            key={item.key}
            type="button"
            onClick={() => run(item.key)}
            className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-[11px] text-arch-text transition hover:bg-white/10"
          >
            <Icon size={12} className="text-arch-muted" />
            {item.label}
          </button>
        );
      })}
    </div>
  );
}
