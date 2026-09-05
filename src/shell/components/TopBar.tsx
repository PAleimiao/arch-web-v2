import { useEffect, useMemo, useRef, useState } from 'react';
import {
  CalendarDays,
  ChevronLeft,
  ChevronRight,
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

function CalendarPopover({ now, onClose }: { now: Date; onClose: () => void }) {
  const [view, setView] = useState(() => new Date(now.getFullYear(), now.getMonth(), 1));
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) onClose();
    };
    window.addEventListener('mousedown', onDown);
    return () => window.removeEventListener('mousedown', onDown);
  }, [onClose]);

  const monthLabel = view.toLocaleDateString('zh-CN', { year: 'numeric', month: 'long' });
  const firstWeekday = (view.getDay() + 6) % 7; // Mon=0
  const daysInMonth = new Date(view.getFullYear(), view.getMonth() + 1, 0).getDate();

  const cells = useMemo(() => {
    const arr: (number | null)[] = [];
    for (let i = 0; i < firstWeekday; i++) arr.push(null);
    for (let d = 1; d <= daysInMonth; d++) arr.push(d);
    while (arr.length % 7 !== 0) arr.push(null);
    return arr;
  }, [firstWeekday, daysInMonth]);

  const todayStr = `${now.getFullYear()}-${now.getMonth()}-${now.getDate()}`;
  const isToday = (d: number) =>
    d === now.getDate() && view.getFullYear() === now.getFullYear() && view.getMonth() === now.getMonth();

  const move = (delta: number) => {
    setView((v) => new Date(v.getFullYear(), v.getMonth() + delta, 1));
  };

  return (
    <div
      ref={wrapRef}
      className="absolute right-0 top-7 w-72 overflow-hidden rounded-lg border border-arch-border bg-arch-panel/95 shadow-2xl backdrop-blur-md"
    >
      <div className="flex items-center justify-between px-3 py-2">
        <div className="flex items-center gap-1.5 text-[12px] font-semibold text-arch-text">
          <CalendarDays size={14} className="text-arch-accent" />
          {monthLabel}
        </div>
        <div className="flex items-center gap-0.5">
          <button
            onClick={() => move(-1)}
            className="rounded p-1 text-arch-muted hover:bg-white/10 hover:text-arch-text"
            title="上个月"
          >
            <ChevronLeft size={12} />
          </button>
          <button
            onClick={() => setView(new Date(now.getFullYear(), now.getMonth(), 1))}
            className="rounded px-1.5 py-0.5 text-[10px] text-arch-muted hover:bg-white/10 hover:text-arch-text"
          >
            今天
          </button>
          <button
            onClick={() => move(1)}
            className="rounded p-1 text-arch-muted hover:bg-white/10 hover:text-arch-text"
            title="下个月"
          >
            <ChevronRight size={12} />
          </button>
        </div>
      </div>

      <div className="grid grid-cols-7 gap-0.5 px-2 pb-1 text-center text-[10px] text-arch-muted">
        {['一', '二', '三', '四', '五', '六', '日'].map((d) => (
          <div key={d} className="py-1">
            {d}
          </div>
        ))}
      </div>

      <div className="grid grid-cols-7 gap-0.5 px-2 pb-3 text-center text-[11px]">
        {cells.map((d, i) => (
          <div key={i} className="aspect-square">
            {d !== null && (
              <div
                className={cn(
                  'flex h-full w-full items-center justify-center rounded transition',
                  isToday(d)
                    ? 'bg-arch-accent text-white shadow-lg'
                    : 'text-arch-text hover:bg-white/10',
                )}
              >
                {d}
              </div>
            )}
          </div>
        ))}
      </div>

      <div className="border-t border-arch-border bg-black/20 px-3 py-1.5 text-[10px] text-arch-muted tabular-nums">
        ISO {todayStr} · {now.toLocaleTimeString('zh-CN', { hour12: false })}
      </div>
    </div>
  );
}

export default function TopBar() {
  const now = useClock();
  const toggleLauncher = useOSStore((s) => s.toggleLauncher);
  const launcherOpen = useOSStore((s) => s.launcherOpen);
  const lock = useOSStore((s) => s.lock);
  const shutdown = useOSStore((s) => s.shutdown);
  const restart = useOSStore((s) => s.restart);

  const [menuOpen, setMenuOpen] = useState(false);
  const [calOpen, setCalOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const clockRef = useRef<HTMLDivElement>(null);

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

      <div
        ref={clockRef}
        className="absolute left-1/2 -translate-x-1/2 tabular-nums"
      >
        <button
          onClick={() => setCalOpen((v) => !v)}
          className={cn(
            'flex items-center gap-2 rounded px-2 py-0.5 transition',
            calOpen ? 'bg-white/15' : 'hover:bg-white/10',
          )}
        >
          <span>{now.toLocaleTimeString('zh-CN', { hour12: false })}</span>
          <span className="text-arch-muted">
            {now.toLocaleDateString('zh-CN', {
              month: '2-digit',
              day: '2-digit',
              weekday: 'short',
            })}
          </span>
        </button>
        {calOpen && <CalendarPopover now={now} onClose={() => setCalOpen(false)} />}
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
