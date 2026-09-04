import { useEffect, useRef, useState } from 'react';
import {
  LayoutGrid,
  Power,
  RefreshCw,
  Lock,
  Volume2,
  Wifi,
} from 'lucide-react';
import { useOSStore } from '@/stores/useOSStore';
import { cn } from '@/lib/cn';

function useClock() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);
  return now;
}

export default function TopBar() {
  const now = useClock();
  const toggleLauncher = useOSStore((s) => s.toggleLauncher);
  const launcherOpen = useOSStore((s) => s.launcherOpen);
  const lock = useOSStore((s) => s.lock);
  const shutdown = useOSStore((s) => s.shutdown);
  const restart = useOSStore((s) => s.restart);

  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menuOpen) return;
    const onDown = (e: MouseEvent) => {
      if (!menuRef.current?.contains(e.target as Node)) setMenuOpen(false);
    };
    window.addEventListener('mousedown', onDown);
    return () => window.removeEventListener('mousedown', onDown);
  }, [menuOpen]);

  return (
    <header className="relative z-[9000] flex h-7 shrink-0 items-center justify-between border-b border-white/5 bg-black/45 px-2 text-[11px] text-arch-text backdrop-blur-md">
      <div className="flex items-center gap-1">
        <button
          type="button"
          onClick={() => toggleLauncher()}
          className={cn(
            'flex items-center gap-1.5 rounded px-2 py-0.5 transition',
            launcherOpen
              ? 'bg-arch-accent/25 text-white'
              : 'hover:bg-white/10',
          )}
        >
          <LayoutGrid size={12} />
          应用
        </button>
        <span className="px-2 text-arch-muted">Arch Web OS</span>
      </div>

      <div className="absolute left-1/2 -translate-x-1/2 tabular-nums">
        {now.toLocaleTimeString('zh-CN', { hour12: false })}
        <span className="ml-2 text-arch-muted">
          {now.toLocaleDateString('zh-CN', { month: '2-digit', day: '2-digit' })}
        </span>
      </div>

      <div className="relative flex items-center gap-3 pr-1" ref={menuRef}>
        <Wifi size={12} className="text-arch-muted" />
        <Volume2 size={12} className="text-arch-muted" />
        <button
          type="button"
          onClick={() => setMenuOpen((v) => !v)}
          className="rounded p-1 transition hover:bg-white/10"
          aria-label="电源菜单"
        >
          <Power size={12} />
        </button>

        {menuOpen && (
          <div className="absolute right-0 top-6 w-36 overflow-hidden rounded-lg border border-arch-border bg-arch-panel/95 py-1 shadow-2xl backdrop-blur-md">
            <MenuItem icon={<Lock size={12} />} label="锁定" onClick={lock} />
            <MenuItem
              icon={<RefreshCw size={12} />}
              label="重启"
              onClick={restart}
            />
            <MenuItem
              icon={<Power size={12} />}
              label="关机"
              onClick={shutdown}
              danger
            />
          </div>
        )}
      </div>
    </header>
  );
}

function MenuItem({
  icon,
  label,
  onClick,
  danger,
}: {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
  danger?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'flex w-full items-center gap-2 px-3 py-1.5 text-left text-[11px] transition',
        danger
          ? 'text-arch-red hover:bg-arch-red/15'
          : 'text-arch-text hover:bg-white/10',
      )}
    >
      {icon}
      {label}
    </button>
  );
}
