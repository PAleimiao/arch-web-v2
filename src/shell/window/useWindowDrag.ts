import { useCallback } from 'react';
import { useWindowStore } from '@/stores/useWindowStore';
import { useOSStore } from '@/stores/useOSStore';

type Direction =
  | 'n'
  | 's'
  | 'e'
  | 'w'
  | 'ne'
  | 'nw'
  | 'se'
  | 'sw';

const MIN_W = 320;
const MIN_H = 200;

/** 贴边判定距离（px） */
const EDGE = 8;
const TOPBAR = 28;

type SnapZone = 'left' | 'right' | 'top' | null;

/** 拖动时在屏幕上画一个预览框，纯 DOM 操作，不经过 React */
function createPreview(): HTMLDivElement {
  const el = document.createElement('div');
  el.style.cssText = [
    'position:fixed',
    'pointer-events:none',
    'z-index:8000',
    'border-radius:8px',
    'background:color-mix(in srgb, var(--color-arch-accent) 22%, transparent)',
    'border:2px solid color-mix(in srgb, var(--color-arch-accent) 70%, transparent)',
    'transition:all .09s ease-out',
    'opacity:0',
  ].join(';');
  document.body.appendChild(el);
  return el;
}

function previewRect(zone: SnapZone): { x: number; y: number; w: number; h: number } | null {
  const vw = window.innerWidth;
  const vh = window.innerHeight - TOPBAR;
  if (zone === 'left') return { x: 0, y: TOPBAR, w: Math.round(vw / 2), h: vh };
  if (zone === 'right')
    return { x: Math.round(vw / 2), y: TOPBAR, w: Math.round(vw / 2), h: vh };
  if (zone === 'top') return { x: 0, y: TOPBAR, w: vw, h: vh };
  return null;
}

/**
 * 窗口拖拽与缩放。
 * 位移阶段只改 x/y，交给 rAF 合并写入，避免 mousemove 高频触发 React 重渲染。
 * 拖到屏幕左右边缘会贴成半屏，拖到顶部会最大化（草稿预览用一层浮层画）。
 */
export function useWindowDrag(id: string) {
  const startDrag = useCallback(
    (e: React.PointerEvent) => {
      const store = useWindowStore.getState();
      const win = store.windows.find((w) => w.id === id);
      if (!win || win.maximized) return;

      store.focus(id);
      e.preventDefault();

      const snapEnabled = useOSStore.getState().settings.edgeSnap;
      const originX = e.clientX;
      const originY = e.clientY;
      const base = { x: win.x, y: win.y };
      let raf = 0;
      let zone: SnapZone = null;
      let preview: HTMLDivElement | null = null;
      let moved = false;

      const paintPreview = (next: SnapZone) => {
        if (next === zone) return;
        zone = next;
        const rect = previewRect(zone);
        if (!rect) {
          if (preview) preview.style.opacity = '0';
          return;
        }
        if (!preview) preview = createPreview();
        Object.assign(preview.style, {
          left: `${rect.x}px`,
          top: `${rect.y}px`,
          width: `${rect.w}px`,
          height: `${rect.h}px`,
          opacity: '1',
        });
      };

      const move = (ev: PointerEvent) => {
        const dx = ev.clientX - originX;
        const dy = ev.clientY - originY;
        if (Math.abs(dx) > 3 || Math.abs(dy) > 3) moved = true;

        if (snapEnabled && moved) {
          const vw = window.innerWidth;
          if (ev.clientY <= TOPBAR + EDGE) paintPreview('top');
          else if (ev.clientX <= EDGE) paintPreview('left');
          else if (ev.clientX >= vw - EDGE) paintPreview('right');
          else paintPreview(null);
        }

        cancelAnimationFrame(raf);
        raf = requestAnimationFrame(() => {
          useWindowStore.getState().setGeometry(id, {
            x: base.x + dx,
            y: Math.max(TOPBAR, base.y + dy),
          });
        });
      };

      const up = () => {
        cancelAnimationFrame(raf);
        window.removeEventListener('pointermove', move);
        window.removeEventListener('pointerup', up);

        if (preview) {
          preview.remove();
          preview = null;
        }

        if (!zone) return;

        const ws = useWindowStore.getState();
        const vw = window.innerWidth;
        const vh = window.innerHeight;
        const half = Math.round(vw / 2);

        if (zone === 'top') {
          ws.toggleMaximize(id);
        } else if (zone === 'left') {
          ws.setGeometry(id, { x: 0, y: TOPBAR, width: half, height: vh - TOPBAR });
        } else if (zone === 'right') {
          ws.setGeometry(id, {
            x: half,
            y: TOPBAR,
            width: vw - half,
            height: vh - TOPBAR,
          });
        }
      };

      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', up);
    },
    [id],
  );

  const startResize = useCallback(
    (dir: Direction) => (e: React.PointerEvent) => {
      const store = useWindowStore.getState();
      const win = store.windows.find((w) => w.id === id);
      if (!win || win.maximized) return;

      store.focus(id);
      e.preventDefault();
      e.stopPropagation();

      const originX = e.clientX;
      const originY = e.clientY;
      const base = {
        x: win.x,
        y: win.y,
        width: win.width,
        height: win.height,
      };
      let raf = 0;

      const move = (ev: PointerEvent) => {
        const dx = ev.clientX - originX;
        const dy = ev.clientY - originY;

        let { x, y, width, height } = base;
        if (dir.includes('e')) width = Math.max(MIN_W, base.width + dx);
        if (dir.includes('s')) height = Math.max(MIN_H, base.height + dy);
        if (dir.includes('w')) {
          width = Math.max(MIN_W, base.width - dx);
          x = base.x + (base.width - width);
        }
        if (dir.includes('n')) {
          height = Math.max(MIN_H, base.height - dy);
          y = Math.max(0, base.y + (base.height - height));
        }

        cancelAnimationFrame(raf);
        raf = requestAnimationFrame(() => {
          useWindowStore.getState().setGeometry(id, { x, y, width, height });
        });
      };

      const up = () => {
        cancelAnimationFrame(raf);
        window.removeEventListener('pointermove', move);
        window.removeEventListener('pointerup', up);
      };

      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', up);
    },
    [id],
  );

  return { startDrag, startResize };
}

export type { Direction };
