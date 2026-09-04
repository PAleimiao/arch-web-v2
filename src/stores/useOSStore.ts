import { create } from 'zustand';
import type { PowerState } from '@/shell/types';

export interface DesktopSettings {
  wallpaper: string;
  /** 窗口背景不透明度 0–1 */
  windowOpacity: number;
  darkMode: boolean;
  dockSize: number;
  /** 无操作自动锁屏的分钟数，0 表示不自动锁 */
  autoLockMinutes: number;
}

interface OSState {
  power: PowerState;
  /** 每次重新开机自增，用于强制重挂载开机动画 */
  bootKey: number;
  settings: DesktopSettings;
  /** 应用启动器是否展开 */
  launcherOpen: boolean;

  bootComplete: () => void;
  unlock: () => void;
  lock: () => void;
  shutdown: () => void;
  restart: () => void;
  toggleLauncher: (open?: boolean) => void;
  /** 关机/重启动画播完后调用 */
  powerOffComplete: () => void;
  restartComplete: () => void;
  powerOn: () => void;
  updateSettings: (patch: Partial<DesktopSettings>) => void;
}

const SETTINGS_KEY = 'arch-web-os:settings';

function loadSettings(): DesktopSettings {
  const fallback: DesktopSettings = {
    wallpaper: '/wallpapers/grid.svg',
    windowOpacity: 0.92,
    darkMode: true,
    dockSize: 56,
    autoLockMinutes: 5,
  };
  if (typeof localStorage === 'undefined') return fallback;
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    return raw ? { ...fallback, ...JSON.parse(raw) } : fallback;
  } catch {
    return fallback;
  }
}

function persist(settings: DesktopSettings) {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  } catch {
    /* 隐私模式下 localStorage 可能不可写，忽略 */
  }
}

export const useOSStore = create<OSState>((set, get) => ({
  power: 'booting',
  bootKey: 0,
  settings: loadSettings(),
  launcherOpen: false,

  bootComplete: () => set({ power: 'locked' }),
  unlock: () => set({ power: 'running' }),
  lock: () => set({ power: 'locked', launcherOpen: false }),
  shutdown: () => set({ power: 'shutting-down', launcherOpen: false }),
  restart: () => set({ power: 'restarting', launcherOpen: false }),
  toggleLauncher: (open) =>
    set((s) => ({ launcherOpen: open ?? !s.launcherOpen })),

  powerOffComplete: () => set({ power: 'off' }),
  restartComplete: () =>
    set((s) => ({ power: 'booting', bootKey: s.bootKey + 1 })),
  powerOn: () => set((s) => ({ power: 'booting', bootKey: s.bootKey + 1 })),

  updateSettings: (patch) => {
    const next = { ...get().settings, ...patch };
    persist(next);
    set({ settings: next });
  },
}));
