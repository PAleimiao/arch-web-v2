import { Suspense, useMemo } from 'react';
import { Loader2 } from 'lucide-react';
import type { AppContext } from '@/shell/types';
import { getApp, loadApp } from '@/apps/registry';
import { useWindowStore } from '@/stores/useWindowStore';
import { useOSStore } from '@/stores/useOSStore';
import { useWindowDrag, type Direction } from './useWindowDrag';
import { cn } from '@/lib/cn';

const HANDLES: Array<{ dir: Direction; className: string }> = [
  { dir: 'n', className: 'top-0 left-2 right-2 h-1 cursor-ns-resize' },
  { dir: 's', className: 'bottom-0 left-2 right-2 h-1 cursor-ns-resize' },
  { dir: 'w', className: 'left-0 top-2 bottom-2 w-1 cursor-ew-resize' },
  { dir: 'e', className: 'right-0 top-2 bottom-2 w-1 cursor-ew-resize' },
  { dir: 'nw', className: 'left-0 top-0 h-3 w-3 cursor-nwse-resize' },
  { dir: 'ne', className: 'right-0 top-0 h-3 w-3 cursor-nesw-resize' },
  { dir: 'sw', className: 'left-0 bottom-0 h-3 w-3 cursor-nesw-resize' },
  { dir: 'se', className: 'right-0 bottom-0 h-3 w-3 cursor-nwse-resize' },
];

function AppFallback() {
  return (
    <div className="flex h-full items-center justify-center gap-2 text-xs text-arch-muted">
      <Loader2 size={14} className="animate-spin" />
      正在加载应用…
    </div>
  );
}

export default function WindowFrame({ id }: { id: string }) {
  const win = useWindowStore((s) => s.windows.find((w) => w.id === id));
  const activeId = useWindowStore((s) => s.activeId);
  const close = useWindowStore((s) => s.close);
  const minimize = useWindowStore((s) => s.minimize);
  const toggleMaximize = useWindowStore((s) => s.toggleMaximize);
  const setTitle = useWindowStore((s) => s.setTitle);
  const opacity = useOSStore((s) => s.settings.windowOpacity);

  const { startDrag, startResize } = useWindowDrag(id);

  const context = useMemo<AppContext>(
    () => ({
      windowId: id,
      close: () => close(id),
      setTitle: (t: string) => setTitle(id, t),
    }),
    [id, close, setTitle],
  );

  if (!win || win.minimized) return null;

  const meta = getApp(win.appId);
  const App = meta ? loadApp(win.appId) : null;
  const active = activeId === id;
  const Icon = meta?.icon;

  return (
    <div
      data-window
      className={cn(
        'animate-window-in absolute flex flex-col overflow-hidden rounded-lg border shadow-2xl',
        active
          ? 'border-arch-accent/60 shadow-black/60'
          : 'border-arch-border shadow-black/40',
      )}
      style={{
        left: win.x,
        top: win.y,
        width: win.width,
        height: win.height,
        zIndex: win.zIndex,
        background: `rgba(19, 23, 34, ${opacity})`,
        backdropFilter: 'blur(18px)',
      }}
      onPointerDown={() => useWindowStore.getState().focus(id)}
    >
      {/* 标题栏 */}
      <div
        className="flex h-9 shrink-0 cursor-grab select-none items-center gap-2 border-b border-arch-border bg-black/25 px-3 active:cursor-grabbing"
        onPointerDown={startDrag}
        onDoubleClick={() => toggleMaximize(id)}
      >
        <div className="flex gap-1.5">
          <button
            type="button"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={() => close(id)}
            className="h-3 w-3 rounded-full bg-arch-red/80 transition hover:bg-arch-red"
            aria-label="关闭"
          />
          <button
            type="button"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={() => minimize(id)}
            className="h-3 w-3 rounded-full bg-[#e5c07b]/80 transition hover:bg-[#e5c07b]"
            aria-label="最小化"
          />
          <button
            type="button"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={() => toggleMaximize(id)}
            className="h-3 w-3 rounded-full bg-arch-green/80 transition hover:bg-arch-green"
            aria-label="最大化"
          />
        </div>

        <div className="flex min-w-0 flex-1 items-center justify-center gap-1.5">
          {Icon && <Icon size={13} style={{ color: meta?.accent }} />}
          <span className="truncate text-xs text-arch-text/85">
            {win.title}
          </span>
        </div>

        <div className="w-[42px]" />
      </div>

      {/* 内容区 */}
      <div className="min-h-0 flex-1 overflow-hidden">
        <Suspense fallback={<AppFallback />}>
          {App ? <App context={context} /> : <MissingApp id={win.appId} />}
        </Suspense>
      </div>

      {/* 缩放热区 */}
      {!win.maximized &&
        HANDLES.map((h) => (
          <div
            key={h.dir}
            className={cn('absolute', h.className)}
            onPointerDown={startResize(h.dir)}
          />
        ))}
    </div>
  );
}

function MissingApp({ id }: { id: string }) {
  return (
    <div className="p-4 text-xs text-arch-red">应用未注册：{id}</div>
  );
}
