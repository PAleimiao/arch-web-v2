import { create } from 'zustand';

/**
 * 「软件包」= 应用。pacman 装的卸的其实就是应用在启动器 / 桌面上的可见性。
 *
 * 用 disabled 列表（而不是 enabled 列表）来存，好处是新加的应用默认就是已安装，
 * 不需要迁移历史数据。
 */
interface PackageState {
  disabled: string[];

  isInstalled: (appId: string) => boolean;
  install: (appId: string) => void;
  remove: (appId: string) => void;
  /** 恢复全部应用到初始状态 */
  resetAll: () => void;
}

const KEY = 'arch-web-os:packages';

function load(): string[] {
  if (typeof localStorage === 'undefined') return [];
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as string[]) : [];
  } catch {
    return [];
  }
}

function persist(disabled: string[]) {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(KEY, JSON.stringify(disabled));
  } catch {
    /* 忽略 */
  }
}

export const usePackageStore = create<PackageState>((set, get) => ({
  disabled: load(),

  isInstalled: (appId) => !get().disabled.includes(appId),

  install: (appId) =>
    set((s) => {
      if (!s.disabled.includes(appId)) return s;
      const next = s.disabled.filter((id) => id !== appId);
      persist(next);
      return { disabled: next };
    }),

  remove: (appId) =>
    set((s) => {
      if (s.disabled.includes(appId)) return s;
      const next = [...s.disabled, appId];
      persist(next);
      return { disabled: next };
    }),

  resetAll: () => {
    persist([]);
    set({ disabled: [] });
  },
}));
