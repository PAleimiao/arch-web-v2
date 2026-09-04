import { useCallback } from 'react';
import { useWindowStore } from '@/stores/useWindowStore';

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

/**
 * 窗口拖拽与缩放。
 * 位移阶段只改 x/y，交给 rAF 合并写入，避免 mousemove 高频触发 React 重渲染。
 */
export function useWindowDrag(id: string) {
  const startDrag = useCallback(
    (e: React.PointerEvent) => {
      const store = useWindowStore.getState();
      const win = store.windows.find((w) => w.id === id);
      if (!win || win.maximized) return;

      store.focus(id);
      e.preventDefault();

      const originX = e.clientX;
      const originY = e.clientY;
      const base = { x: win.x, y: win.y };
      let raf = 0;

      const move = (ev: PointerEvent) => {
        const dx = ev.clientX - originX;
        const dy = ev.clientY - originY;
        cancelAnimationFrame(raf);
        raf = requestAnimationFrame(() => {
          useWindowStore.getState().setGeometry(id, {
            x: base.x + dx,
            y: Math.max(0, base.y + dy),
          });
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
