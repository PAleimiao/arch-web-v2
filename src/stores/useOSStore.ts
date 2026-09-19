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
  /** 主强调色，写进 --color-arch-accent */
  accentColor: string;
  /** 关闭后禁用窗口/应用入场动画 */
  animations: boolean;
  /** 顶栏时钟是否显示秒 */
  clockSeconds: boolean;
  /** 桌面是否平铺全部应用图标（关掉只显示前 6 个） */
  desktopAllApps: boolean;
  /** 桌面图标尺寸 */
  desktopIconSize: number;
  /** 窗口拖到屏幕边缘时自动贴边 / 最大化 */
  edgeSnap: boolean;
  /** 免打扰：通知只进通知中心，不弹右上角 toast */
  doNotDisturb: boolean;
  /** 关掉后开机直接进锁屏，不播开机动画 */
  bootAnimation: boolean;
  /** 顶栏 / 锁屏时钟用 12 小时制 */
  hour12: boolean;
  /** Dock 平时藏到屏幕外，鼠标移到底部边缘才出现 */
  dockAutoHide: boolean;
}

interface OSState {
  power: PowerState;
  /** 每次重新开机自增，用于强制重挂载开机动画 */
  bootKey: number;
  settings: DesktopSettings;
  /** 应用启动器是否展开 */
  launcherOpen: boolean;
  /** 命令面板是否展开 */
  paletteOpen: boolean;

  bootComplete: () => void;
  unlock: () => void;
  lock: () => void;
  shutdown: () => void;
  restart: () => void;
  toggleLauncher: (open?: boolean) => void;
  togglePalette: (open?: boolean) => void;
  /** 关机/重启动画播完后调用 */
  powerOffComplete: () => void;
  restartComplete: () => void;
  powerOn: () => void;
  updateSettings: (patch: Partial<DesktopSettings>) => void;
}

const SETTINGS_KEY = 'arch-web-os:settings';

function loadSettings(): DesktopSettings {
  const fallback: DesktopSettings = {
    wallpaper: `${import.meta.env.BASE_URL}/wallpapers/grid.svg`,
    windowOpacity: 0.92,
    darkMode: true,
    dockSize: 56,
    autoLockMinutes: 5,
    accentColor: '#1793d1',
    animations: true,
    clockSeconds: false,
    desktopAllApps: false,
    desktopIconSize: 44,
    edgeSnap: true,
    doNotDisturb: false,
    bootAnimation: true,
    hour12: false,
    dockAutoHide: false,
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
  paletteOpen: false,

  bootComplete: () => set({ power: 'locked' }),
  unlock: () => set({ power: 'running' }),
  lock: () => set({ power: 'locked', launcherOpen: false, paletteOpen: false }),
  shutdown: () =>
    set({ power: 'shutting-down', launcherOpen: false, paletteOpen: false }),
  restart: () =>
    set({ power: 'restarting', launcherOpen: false, paletteOpen: false }),
  toggleLauncher: (open) =>
    set((s) => ({ launcherOpen: open ?? !s.launcherOpen })),
  togglePalette: (open) => set((s) => ({ paletteOpen: open ?? !s.paletteOpen })),

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
