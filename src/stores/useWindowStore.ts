import { create } from 'zustand';
import type { WindowState } from '@/shell/types';

const MIN_WIDTH = 320;
const MIN_HEIGHT = 220;
const BASE_Z = 100;

function clampWindow(w: WindowState): WindowState {
  const maxW = typeof window === 'undefined' ? 1440 : window.innerWidth;
  const maxH = typeof window === 'undefined' ? 900 : window.innerHeight;
  return {
    ...w,
    width: Math.min(Math.max(w.width, MIN_WIDTH), maxW - 16),
    height: Math.min(Math.max(w.height, MIN_HEIGHT), maxH - 80),
    x: Math.min(Math.max(w.x, -w.width + 120), maxW - 80),
    y: Math.min(Math.max(w.y, 0), maxH - 60),
  };
}

interface WindowStore {
  windows: WindowState[];
  activeId: string | null;
  nextZ: number;

  open: (input: {
    appId: string;
    title: string;
    width?: number;
    height?: number;
  }) => string;
  close: (id: string) => void;
  closeByApp: (appId: string) => void;
  focus: (id: string) => void;
  minimize: (id: string) => void;
  toggleMaximize: (id: string) => void;
  restore: (id: string) => void;
  setGeometry: (
    id: string,
    geo: Partial<Pick<WindowState, 'x' | 'y' | 'width' | 'height'>>,
  ) => void;
  setTitle: (id: string, title: string) => void;
  isOpen: (appId: string) => boolean;
}

let seq = 0;

export const useWindowStore = create<WindowStore>((set, get) => ({
  windows: [],
  activeId: null,
  nextZ: BASE_Z,

  open: ({ appId, title, width = 760, height = 520 }) => {
    const state = get();
    // 单例应用：已打开就直接聚焦并还原
    const existing = state.windows.find((w) => w.appId === appId);
    if (existing) {
      get().restore(existing.id);
      get().focus(existing.id);
      return existing.id;
    }

    const vw = typeof window === 'undefined' ? 1440 : window.innerWidth;
    const vh = typeof window === 'undefined' ? 900 : window.innerHeight;
    const w = Math.min(width, vw - 40);
    const h = Math.min(height, vh - 100);
    // 逐级错位，避免新窗口完全盖住旧的
    const offset = (state.windows.length % 6) * 28;
    const id = `win-${++seq}`;

    const next: WindowState = clampWindow({
      id,
      appId,
      title,
      x: Math.max(0, (vw - w) / 2 + offset - 60),
      y: Math.max(28, (vh - h) / 2 + offset - 80),
      width: w,
      height: h,
      zIndex: state.nextZ,
      minimized: false,
      maximized: false,
      restore: null,
    });

    set({
      windows: [
        ...state.windows.map((x) => ({ ...x, minimized: x.minimized })),
        next,
      ],
      activeId: id,
      nextZ: state.nextZ + 1,
    });
    return id;
  },

  close: (id) =>
    set((s) => {
      const windows = s.windows.filter((w) => w.id !== id);
      const rest = windows.filter((w) => !w.minimized);
      const top = rest.reduce<WindowState | null>(
        (acc, w) => (!acc || w.zIndex > acc.zIndex ? w : acc),
        null,
      );
      return { windows, activeId: top?.id ?? null };
    }),

  closeByApp: (appId) => {
    const target = get().windows.find((w) => w.appId === appId);
    if (target) get().close(target.id);
  },

  focus: (id) =>
    set((s) => {
      const z = s.nextZ;
      return {
        activeId: id,
        nextZ: z + 1,
        windows: s.windows.map((w) =>
          w.id === id ? { ...w, zIndex: z, minimized: false } : w,
        ),
      };
    }),

  minimize: (id) =>
    set((s) => {
      const windows = s.windows.map((w) =>
        w.id === id ? { ...w, minimized: true } : w,
      );
      const rest = windows.filter((w) => !w.minimized);
      const top = rest.reduce<WindowState | null>(
        (acc, w) => (!acc || w.zIndex > acc.zIndex ? w : acc),
        null,
      );
      return { windows, activeId: top?.id ?? null };
    }),

  toggleMaximize: (id) =>
    set((s) => ({
      windows: s.windows.map((w) => {
        if (w.id !== id) return w;
        if (w.maximized && w.restore) {
          return { ...w, ...w.restore, maximized: false, restore: null };
        }
        const vw = typeof window === 'undefined' ? 1440 : window.innerWidth;
        const vh = typeof window === 'undefined' ? 900 : window.innerHeight;
        return {
          ...w,
          restore: { x: w.x, y: w.y, width: w.width, height: w.height },
          x: 0,
          y: 0,
          width: vw,
          height: vh - 52,
          maximized: true,
        };
      }),
    })),

  restore: (id) =>
    set((s) => ({
      windows: s.windows.map((w) =>
        w.id === id ? { ...w, minimized: false } : w,
      ),
    })),

  setGeometry: (id, geo) =>
    set((s) => ({
      windows: s.windows.map((w) =>
        w.id === id ? clampWindow({ ...w, ...geo }) : w,
      ),
    })),

  setTitle: (id, title) =>
    set((s) => ({
      windows: s.windows.map((w) => (w.id === id ? { ...w, title } : w)),
    })),

  isOpen: (appId) => get().windows.some((w) => w.appId === appId),
}));
