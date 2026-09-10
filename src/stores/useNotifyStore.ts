import { create } from 'zustand';

export type NotifyLevel = 'info' | 'success' | 'warn' | 'error';

export interface Notification {
  id: string;
  title: string;
  body?: string;
  level: NotifyLevel;
  appName?: string;
  at: number;
  read: boolean;
}

interface NotifyState {
  items: Notification[];
  /** 通知中心面板是否展开 */
  panelOpen: boolean;

  push: (input: {
    title: string;
    body?: string;
    level?: NotifyLevel;
    appName?: string;
  }) => string;
  dismiss: (id: string) => void;
  markAllRead: () => void;
  clear: () => void;
  togglePanel: (open?: boolean) => void;
}

const MAX_ITEMS = 60;

let seq = 0;

export const useNotifyStore = create<NotifyState>((set) => ({
  items: [],
  panelOpen: false,

  push: ({ title, body, level = 'info', appName }) => {
    const id = `n-${Date.now().toString(36)}-${++seq}`;
    const item: Notification = {
      id,
      title,
      body,
      level,
      appName,
      at: Date.now(),
      read: false,
    };
    set((s) => ({ items: [item, ...s.items].slice(0, MAX_ITEMS) }));
    return id;
  },

  dismiss: (id) => set((s) => ({ items: s.items.filter((n) => n.id !== id) })),

  markAllRead: () =>
    set((s) => ({ items: s.items.map((n) => ({ ...n, read: true })) })),

  clear: () => set({ items: [] }),

  togglePanel: (open) =>
    set((s) => {
      const next = open ?? !s.panelOpen;
      // 打开面板时顺手标记已读
      return next
        ? { panelOpen: true, items: s.items.map((n) => ({ ...n, read: true })) }
        : { panelOpen: false };
    }),
}));

/** 非 React 环境（终端命令、任意工具函数）里发通知 */
export function notify(
  title: string,
  body?: string,
  level: NotifyLevel = 'info',
): void {
  useNotifyStore.getState().push({ title, body, level });
}
