import { create } from "zustand";

/**
 * 桌面歌词挂件状态。
 *
 * 设计要点：
 * - 配置（开关 / 位置 / 行数 / 背景透明度）持久化到 localStorage，刷新后保留。
 * - 歌词数据（当前行 / 下一行 / 歌名）由 NeteaseMusic 在 activeLyricIdx 变化时推入，
 *   只在内存里，不落盘（歌词属于播放运行时数据）。
 * - 这是跨窗口挂件：桌面歌词浮层用 createPortal 挂到 document.body，独立于应用窗口树，
 *   因此数据必须走 store 而不是组件内 state。
 */

export interface DesktopLyricsConfig {
  /** 总开关，与底部播放条「词」按钮同步 */
  enabled: boolean;
  /** 显示行数：1 = 仅当前行，2 = 当前行 + 下一行 */
  lineCount: 1 | 2;
  /** 背景透明度 0（全透）~ 0.85（较实） */
  bgOpacity: number;
  /** 浮层左上角坐标；null = 尚未定位，组件首次挂载时自动放到底部中央 */
  x: number | null;
  y: number | null;
}

const KEY = "arch-web-os:desktop-lyrics";
const DEFAULT_CONFIG: DesktopLyricsConfig = {
  enabled: false,
  lineCount: 2,
  bgOpacity: 0.35,
  x: null,
  y: null,
};

function load(): DesktopLyricsConfig {
  if (typeof localStorage === "undefined") return DEFAULT_CONFIG;
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? { ...DEFAULT_CONFIG, ...(JSON.parse(raw) as Partial<DesktopLyricsConfig>) } : DEFAULT_CONFIG;
  } catch {
    return DEFAULT_CONFIG;
  }
}

function persist(cfg: DesktopLyricsConfig): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(cfg));
  } catch {
    /* 隐私模式等存储不可用时忽略 */
  }
}

interface DesktopLyricsState extends DesktopLyricsConfig {
  /** 当前高亮行文本 */
  line: string;
  /** 下一行文本（lineCount=2 时显示） */
  nextLine: string;
  /** 是否正在播放（用于无播放时的占位提示） */
  playing: boolean;
  /** 歌名（无歌词时的兜底展示） */
  title: string;

  patch: (p: Partial<DesktopLyricsConfig>) => void;
  toggle: () => void;
  setLyrics: (line: string, nextLine: string, playing: boolean, title: string) => void;
  setPosition: (x: number, y: number) => void;
  resetPosition: () => void;
}

export const useDesktopLyricsStore = create<DesktopLyricsState>((set, get) => ({
  ...load(),
  line: "",
  nextLine: "",
  playing: false,
  title: "",

  patch: (p) => {
    set(p);
    const s = get();
    persist({
      enabled: s.enabled,
      lineCount: s.lineCount,
      bgOpacity: s.bgOpacity,
      x: s.x,
      y: s.y,
    });
  },

  toggle: () => get().patch({ enabled: !get().enabled }),

  setLyrics: (line, nextLine, playing, title) => set({ line, nextLine, playing, title }),

  setPosition: (x, y) => get().patch({ x, y }),

  resetPosition: () => get().patch({ x: null, y: null }),
}));
