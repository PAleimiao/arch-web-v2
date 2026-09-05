import { lazy, type ComponentType, type LazyExoticComponent } from 'react';
import {
  Bomb,
  Calculator,
  FileText,
  FolderTree,
  Grid3x3,
  Globe,
  Image as ImageIcon,
  Music2,
  Settings,
  Terminal,
} from 'lucide-react';
import type { AppMeta, AppProps } from '@/shell/types';

/**
 * 预扫描所有应用目录。Vite 会在构建时为每个匹配文件生成独立 chunk，
 * 点击应用时才真正下载对应代码，避免首屏一次性拉进全部应用。
 */
const modules = import.meta.glob<{ default: ComponentType<AppProps> }>(
  './*/index.tsx',
);

/** 应用 id → 入口文件路径 */
const ENTRY: Record<string, string> = {
  terminal: './Terminal/index.tsx',
  files: './FileManager/index.tsx',
  notepad: './Notepad/index.tsx',
  calculator: './Calculator/index.tsx',
  settings: './Settings/index.tsx',
  browser: './Browser/index.tsx',
  music: './MusicPlayer/index.tsx',
  gallery: './Gallery/index.tsx',
  minesweeper: './Minesweeper/index.tsx',
  game2048: './Game2048/index.tsx',
};

export const CATEGORIES = [
  '全部',
  '系统',
  '工具',
  '开发',
  '网络',
  '影音',
  '游戏',
] as const;

export const APPS: AppMeta[] = [
  {
    id: 'terminal',
    name: '终端',
    icon: Terminal,
    category: '系统',
    description: '模拟 Shell，支持 ls / cd / cat / echo 等命令',
    defaultWidth: 720,
    defaultHeight: 440,
    accent: '#4ec9b0',
  },
  {
    id: 'files',
    name: '文件管理器',
    icon: FolderTree,
    category: '系统',
    description: '浏览与编辑虚拟文件系统中的文件',
    defaultWidth: 860,
    defaultHeight: 560,
    accent: '#1793d1',
  },
  {
    id: 'notepad',
    name: '记事本',
    icon: FileText,
    category: '工具',
    description: '纯文本编辑，内容持久化到虚拟磁盘',
    defaultWidth: 640,
    defaultHeight: 480,
    accent: '#e5c07b',
  },
  {
    id: 'calculator',
    name: '计算器',
    icon: Calculator,
    category: '工具',
    description: '四则运算与常用函数',
    defaultWidth: 320,
    defaultHeight: 440,
    minWidth: 280,
    minHeight: 400,
    accent: '#c678dd',
    singleton: true,
  },
  {
    id: 'settings',
    name: '设置',
    icon: Settings,
    category: '系统',
    description: '壁纸、窗口透明度、自动锁屏',
    defaultWidth: 620,
    defaultHeight: 520,
    accent: '#7d8496',
    singleton: true,
  },
  {
    id: 'browser',
    name: '浏览器',
    icon: Globe,
    category: '网络',
    description: '沙箱 iframe 的内嵌网页浏览',
    defaultWidth: 960,
    defaultHeight: 640,
    accent: '#61afef',
  },
  {
    id: 'music',
    name: '音乐',
    icon: Music2,
    category: '影音',
    description: '本地音频播放 · 队列 · 媒体键控制',
    defaultWidth: 720,
    defaultHeight: 520,
    accent: '#e06c75',
  },
  {
    id: 'gallery',
    name: '画廊',
    icon: ImageIcon,
    category: '工具',
    description: '浏览虚拟磁盘里保存的图片',
    defaultWidth: 760,
    defaultHeight: 540,
    accent: '#56b6c2',
  },
  {
    id: 'minesweeper',
    name: '扫雷',
    icon: Bomb,
    category: '游戏',
    description: '经典扫雷，支持三种难度',
    defaultWidth: 380,
    defaultHeight: 480,
    minWidth: 340,
    minHeight: 440,
    accent: '#d19a66',
    singleton: true,
  },
  {
    id: 'game2048',
    name: '2048',
    icon: Grid3x3,
    category: '游戏',
    description: '合并数字，挑战 2048',
    defaultWidth: 380,
    defaultHeight: 540,
    minWidth: 320,
    minHeight: 460,
    accent: '#c678dd',
    singleton: true,
  },
  {
    id: 'video',
    name: '视频',
    icon: Film,
    category: '影音',
    description: '本地视频与在线 URL，含 m3u8 / HLS 自动加载',
    defaultWidth: 880,
    defaultHeight: 560,
    minWidth: 560,
    minHeight: 380,
    accent: '#be5046',
  },
  {
    id: 'netease',
    name: '在线音乐',
    icon: Disc3,
    category: '影音',
    description: '搜索 / 播放 网易 / QQ / 酷我等音源',
    defaultWidth: 880,
    defaultHeight: 600,
    minWidth: 720,
    minHeight: 500,
    accent: '#e84393',
  },
];

const cache = new Map<string, LazyExoticComponent<ComponentType<AppProps>>>();

/** 取得应用的懒加载组件，同一应用只创建一次 lazy 包装 */
export function loadApp(id: string) {
  const cached = cache.get(id);
  if (cached) return cached;

  const entry = ENTRY[id];
  const loader = entry ? modules[entry] : undefined;
  if (!loader) {
    throw new Error(`应用 ${id} 未注册，找不到入口 ${entry ?? '(未知)'}`);
  }

  const Comp = lazy(loader);
  cache.set(id, Comp);
  return Comp;
}

export function getApp(id: string): AppMeta | undefined {
  return APPS.find((a) => a.id === id);
}

/** 校验注册表与磁盘目录是否一一对应，供开发期自检 */
export function auditRegistry(): string[] {
  const problems: string[] = [];
  for (const [id, entry] of Object.entries(ENTRY)) {
    if (!modules[entry]) problems.push(`${id}: 缺少文件 ${entry}`);
    if (!APPS.some((a) => a.id === id)) problems.push(`${id}: 缺少元数据`);
  }
  for (const path of Object.keys(modules)) {
    if (!Object.values(ENTRY).includes(path)) {
      problems.push(`孤儿应用目录: ${path}`);
    }
  }
  return problems;
}
