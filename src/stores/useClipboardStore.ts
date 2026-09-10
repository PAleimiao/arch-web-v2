import { create } from 'zustand';

export interface ClipItem {
  id: string;
  text: string;
  at: number;
  /** 置顶项不会被自动淘汰 */
  pinned?: boolean;
}

interface ClipboardState {
  items: ClipItem[];
  /** 是否正在「监听」系统剪贴板（需要页面可见 + 用户授权） */
  watching: boolean;

  add: (text: string) => void;
  remove: (id: string) => void;
  togglePin: (id: string) => void;
  clear: () => void;
  setWatching: (on: boolean) => void;
}

const MAX_ITEMS = 80;
const KEY = 'arch-web-os:clipboard';

function load(): ClipItem[] {
  if (typeof localStorage === 'undefined') return [];
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as ClipItem[]) : [];
  } catch {
    return [];
  }
}

function persist(items: ClipItem[]) {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(KEY, JSON.stringify(items.slice(0, MAX_ITEMS)));
  } catch {
    /* 忽略 */
  }
}

let seq = 0;

export const useClipboardStore = create<ClipboardState>((set) => ({
  items: load(),
  watching: false,

  add: (text) => {
    const trimmed = text.trim();
    // 太短的（单字符）和重复项都不收
    if (trimmed.length < 2) return;
    set((s) => {
      if (s.items[0]?.text === trimmed) return s;
      const item: ClipItem = {
        id: `c-${Date.now().toString(36)}-${++seq}`,
        text: trimmed,
        at: Date.now(),
      };
      const merged = [item, ...s.items.filter((i) => i.text !== trimmed)];
      const pinned = merged.filter((i) => i.pinned);
      const plain = merged.filter((i) => !i.pinned).slice(0, MAX_ITEMS - pinned.length);
      const next = [...pinned, ...plain];
      persist(next);
      return { items: next };
    });
  },

  remove: (id) =>
    set((s) => {
      const next = s.items.filter((i) => i.id !== id);
      persist(next);
      return { items: next };
    }),

  togglePin: (id) =>
    set((s) => {
      const next = s.items.map((i) =>
        i.id === id ? { ...i, pinned: !i.pinned } : i,
      );
      persist(next);
      return { items: next };
    }),

  clear: () => {
    persist([]);
    set({ items: [] });
  },

  setWatching: (on) => set({ watching: on }),
}));

/** 非 React 环境里写入一条剪贴板记录 */
export function rememberClip(text: string): void {
  useClipboardStore.getState().add(text);
}
