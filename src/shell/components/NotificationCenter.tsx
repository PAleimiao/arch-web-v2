import { useEffect, useRef, useState } from 'react';
import {
  AlertTriangle,
  Bell,
  CheckCircle2,
  Info,
  Trash2,
  X,
  XCircle,
} from 'lucide-react';
import { cn } from '@/lib/cn';
import { useNotifyStore, type NotifyLevel } from '@/stores/useNotifyStore';
import { useOSStore } from '@/stores/useOSStore';

const LEVEL_STYLE: Record<
  NotifyLevel,
  { icon: typeof Info; text: string; ring: string }
> = {
  info: { icon: Info, text: 'text-arch-accent', ring: 'border-arch-accent/40' },
  success: { icon: CheckCircle2, text: 'text-arch-green', ring: 'border-arch-green/40' },
  warn: { icon: AlertTriangle, text: 'text-amber-400', ring: 'border-amber-400/40' },
  error: { icon: XCircle, text: 'text-arch-red', ring: 'border-arch-red/40' },
};

function timeAgo(at: number): string {
  const s = Math.max(0, Math.floor((Date.now() - at) / 1000));
  if (s < 10) return '刚刚';
  if (s < 60) return `${s} 秒前`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} 分钟前`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} 小时前`;
  return `${Math.floor(h / 24)} 天前`;
}

/** 托盘里的铃铛：未读角标 + 下拉通知中心 */
export function NotifyBell() {
  const items = useNotifyStore((s) => s.items);
  const open = useNotifyStore((s) => s.panelOpen);
  const toggle = useNotifyStore((s) => s.togglePanel);
  const clear = useNotifyStore((s) => s.clear);
  const unread = items.filter((n) => !n.read).length;

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => toggle()}
        title="通知"
        className={cn(
          'relative flex h-7 w-7 items-center justify-center rounded transition hover:bg-white/10',
          open && 'bg-white/10',
        )}
      >
        <Bell size={14} />
        {unread > 0 && (
          <span className="animate-dot-pulse absolute -right-0.5 -top-0.5 flex h-4 min-w-[16px] items-center justify-center rounded-full bg-arch-red px-1 text-[9px] font-bold leading-[14px] text-white">
            {unread > 9 ? '9+' : unread}
          </span>
        )}
      </button>

      {open && (
        <>
          {/* 点空白处关面板 */}
          <button
            type="button"
            aria-label="关闭通知"
            className="fixed inset-0 z-[6000] cursor-default"
            onClick={() => toggle(false)}
          />
          <div className="animate-pop-in absolute right-0 top-9 z-[6001] w-80 overflow-hidden rounded-lg border border-arch-border bg-arch-panel/97 shadow-2xl backdrop-blur">
            <div className="flex items-center justify-between border-b border-arch-border px-3 py-2">
              <span className="text-[11px] font-medium uppercase tracking-wider text-arch-muted">
                通知中心
              </span>
              <button
                type="button"
                onClick={clear}
                disabled={items.length === 0}
                className="flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] text-arch-muted transition hover:bg-white/10 hover:text-arch-text disabled:opacity-30"
              >
                <Trash2 size={11} /> 清空
              </button>
            </div>

            <div className="max-h-80 overflow-y-auto">
              {items.length === 0 && (
                <p className="px-3 py-8 text-center text-[11px] text-arch-muted">
                  还没有通知
                </p>
              )}
              {items.map((n) => {
                const style = LEVEL_STYLE[n.level];
                const Icon = style.icon;
                return (
                  <div
                    key={n.id}
                    className="flex gap-2 border-b border-arch-border/60 px-3 py-2 last:border-0"
                  >
                    <Icon size={13} className={cn('mt-0.5 shrink-0', style.text)} />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-baseline gap-1.5">
                        <p className="truncate text-[12px] text-arch-text">{n.title}</p>
                        {n.appName && (
                          <span className="shrink-0 text-[10px] text-arch-muted">
                            {n.appName}
                          </span>
                        )}
                      </div>
                      {n.body && (
                        <p className="mt-0.5 break-words text-[11px] leading-relaxed text-arch-muted">
                          {n.body}
                        </p>
                      )}
                      <p className="mt-0.5 text-[10px] text-arch-muted/70">
                        {timeAgo(n.at)}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => useNotifyStore.getState().dismiss(n.id)}
                      className="shrink-0 self-start rounded p-0.5 text-arch-muted transition hover:bg-white/10 hover:text-arch-text"
                      title="删除"
                    >
                      <X size={11} />
                    </button>
                  </div>
                );
              })}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

/** 右上角浮出的短期提示，几秒后自己消失（仍留在通知中心里） */
export function NotificationToasts() {
  const items = useNotifyStore((s) => s.items);
  const doNotDisturb = useOSStore((s) => s.settings.doNotDisturb);
  const [toastIds, setToastIds] = useState<string[]>([]);
  const seenRef = useRef<Set<string> | null>(null);
  const timersRef = useRef<ReturnType<typeof setTimeout>[]>([]);

  useEffect(() => {
    // 首次挂载只记录已有项，不为历史通知弹 toast
    if (seenRef.current === null) {
      seenRef.current = new Set(items.map((n) => n.id));
      return;
    }
    const seen = seenRef.current;
    const fresh = items.filter((n) => !seen.has(n.id));
    if (fresh.length === 0) return;
    fresh.forEach((n) => seen.add(n.id));

    // 免打扰：只记已读，不弹浮层
    if (doNotDisturb) return;

    setToastIds((prev) => [
      ...fresh.map((n) => n.id),
      ...prev,
    ].slice(0, 4));

    fresh.forEach((n) => {
      const t = setTimeout(() => {
        setToastIds((prev) => prev.filter((id) => id !== n.id));
      }, 5200);
      timersRef.current.push(t);
    });

    return () => {
      timersRef.current.forEach(clearTimeout);
      timersRef.current = [];
    };
  }, [items, doNotDisturb]);

  const toasts = toastIds
    .map((id) => items.find((n) => n.id === id))
    .filter((n): n is NonNullable<typeof n> => Boolean(n));

  if (toasts.length === 0) return null;

  return (
    <div className="pointer-events-none absolute right-3 top-10 z-[6500] flex w-72 flex-col gap-2">
      {toasts.map((n) => {
        const style = LEVEL_STYLE[n.level];
        const Icon = style.icon;
        return (
          <div
            key={n.id}
            className={cn(
              'animate-toast-in pointer-events-auto flex gap-2 rounded-lg border bg-arch-panel/95 px-3 py-2 shadow-xl backdrop-blur',
              style.ring,
            )}
          >
            <Icon size={14} className={cn('mt-0.5 shrink-0', style.text)} />
            <div className="min-w-0 flex-1">
              <p className="truncate text-[12px] text-arch-text">{n.title}</p>
              {n.body && (
                <p className="mt-0.5 line-clamp-2 break-words text-[11px] leading-relaxed text-arch-muted">
                  {n.body}
                </p>
              )}
            </div>
            <button
              type="button"
              onClick={() => {
                setToastIds((prev) => prev.filter((id) => id !== n.id));
                useNotifyStore.getState().dismiss(n.id);
              }}
              className="shrink-0 self-start rounded p-0.5 text-arch-muted transition hover:bg-white/10 hover:text-arch-text"
              title="关闭"
            >
              <X size={11} />
            </button>
          </div>
        );
      })}
    </div>
  );
}
