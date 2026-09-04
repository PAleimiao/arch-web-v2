import type { LucideIcon } from 'lucide-react';

/** 电源状态机：开机 → 锁屏 → 运行 → 关机/重启 */
export type PowerState =
  | 'booting'
  | 'running'
  | 'locked'
  | 'shutting-down'
  | 'restarting'
  | 'off';

export type AppCategory =
  | '系统'
  | '工具'
  | '开发'
  | '网络'
  | '影音'
  | '游戏';

/** 窗口运行时状态 */
export interface WindowState {
  id: string;
  appId: string;
  title: string;
  x: number;
  y: number;
  width: number;
  height: number;
  zIndex: number;
  minimized: boolean;
  maximized: boolean;
  /** 最大化前的几何信息，用于还原 */
  restore: { x: number; y: number; width: number; height: number } | null;
}

/** 应用元数据：注册表里的静态描述，不含组件实现 */
export interface AppMeta {
  id: string;
  name: string;
  icon: LucideIcon;
  category: AppCategory;
  description: string;
  defaultWidth: number;
  defaultHeight: number;
  minWidth?: number;
  minHeight?: number;
  accent?: string;
  /** 是否允许同时开多个实例 */
  singleton?: boolean;
}

/** 应用实例向桌面环境暴露的上下文 */
export interface AppContext {
  windowId: string;
  /** 请求关闭本窗口 */
  close: () => void;
  /** 修改窗口标题 */
  setTitle: (title: string) => void;
}

export interface AppProps {
  context: AppContext;
}

/** 虚拟文件系统里的节点 */
export interface FsNode {
  path: string;
  name: string;
  type: 'file' | 'dir';
  size: number;
  updatedAt: number;
  content?: string;
}
