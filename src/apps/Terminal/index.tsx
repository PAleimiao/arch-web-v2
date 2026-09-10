import { useEffect, useRef, useState } from 'react';
import { vfs } from '@/services/filesystem';
import { useWindowStore } from '@/stores/useWindowStore';
import { APPS, getApp } from '@/apps/registry';
import { usePackageStore } from '@/stores/usePackageStore';
import { notify } from '@/stores/useNotifyStore';
import type { AppProps } from '@/shell/types';

interface Line {
  kind: 'input' | 'output' | 'error';
  text: string;
}

/** 模块加载时刻，用来算 uptime（约等于页面加载时刻） */
const BOOT_TIME = Date.now();

/* --------------------------- 命令文档（驱动 help / man / which / Tab 补全） --------------------------- */

interface CmdDoc {
  cat: string;
  desc: string;
}

const DOCS: Record<string, CmdDoc> = {
  help: { cat: '帮助', desc: '显示本帮助' },
  clear: { cat: '终端', desc: '清屏' },
  exit: { cat: '终端', desc: '关闭终端窗口' },
  history: { cat: '终端', desc: '显示历史命令' },
  pwd: { cat: '文件', desc: '显示当前目录' },
  ls: { cat: '文件', desc: '列出目录内容（-l 详情，-a 含隐藏项）' },
  cd: { cat: '文件', desc: '切换目录' },
  cat: { cat: '文件', desc: '查看文件内容' },
  echo: { cat: '文件', desc: '输出文本（支持 > 与 >> 重定向）' },
  mkdir: { cat: '文件', desc: '创建目录（写入 .keep）' },
  touch: { cat: '文件', desc: '创建空文件' },
  rm: { cat: '文件', desc: '删除文件或目录' },
  rmdir: { cat: '文件', desc: '删除目录' },
  cp: { cat: '文件', desc: '复制文件' },
  mv: { cat: '文件', desc: '移动 / 重命名文件' },
  stat: { cat: '文件', desc: '显示文件信息' },
  head: { cat: '查看', desc: '显示文件开头（-n N）' },
  tail: { cat: '查看', desc: '显示文件结尾（-n N）' },
  wc: { cat: '查看', desc: '统计行 / 词 / 字符数' },
  less: { cat: '查看', desc: '查看文件（此处当作 cat 处理）' },
  file: { cat: '查看', desc: '按扩展名猜测文件类型' },
  tree: { cat: '查看', desc: '以树形列出目录（-L n 限制深度）' },
  find: { cat: '搜索', desc: '按名字片段查找路径' },
  grep: { cat: '搜索', desc: '在文件中搜索文本（-i 忽略大小写，-n 显示行号）' },
  date: { cat: '系统', desc: '显示当前日期时间' },
  whoami: { cat: '系统', desc: '显示当前用户' },
  hostname: { cat: '系统', desc: '显示主机名' },
  uname: { cat: '系统', desc: '显示系统内核信息（-a 全部）' },
  uptime: { cat: '系统', desc: '显示运行时长' },
  neofetch: { cat: '系统', desc: '显示系统概览' },
  ps: { cat: '进程', desc: '列出已打开窗口当作进程' },
  top: { cat: '进程', desc: '进程快照' },
  free: { cat: '进程', desc: '显示内存占用' },
  df: { cat: '进程', desc: '显示存储占用' },
  du: { cat: '进程', desc: '显示目录占用' },
  pacman: { cat: '包管理', desc: 'Arch 包管理器（-Q / -Ss / -S / -Qi / -R）' },
  open: { cat: '其他', desc: '打开应用' },
  apps: { cat: '其他', desc: '列出所有应用' },
  which: { cat: '其他', desc: '显示命令路径' },
  man: { cat: '其他', desc: '显示命令说明' },
  alias: { cat: '其他', desc: '设置会话内别名' },
  curl: { cat: '其他', desc: '模拟网络请求（不会真发请求）' },
  sudo: { cat: '其他', desc: '提权（仅放行 pacman）' },
};

const HELP_ORDER = [
  '帮助',
  '文件',
  '查看',
  '搜索',
  '系统',
  '进程',
  '包管理',
  '终端',
  '其他',
];

/* ------------------------------- 解析相关小工具 ------------------------------- */

/** 把字符串切成 token，引号内的空格不切分，未加引号的 > / >> 单独成 token（用于重定向） */
function tokenize(input: string): string[] {
  const tokens: string[] = [];
  let cur = '';
  let quote: '"' | "'" | null = null;
  let has = false;
  for (let i = 0; i < input.length; i++) {
    const ch = input[i];
    if (quote) {
      if (ch === quote) quote = null;
      else cur += ch;
    } else if (ch === '"' || ch === "'") {
      quote = ch as '"' | "'";
      has = true;
    } else if (ch === '>') {
      if (has) {
        tokens.push(cur);
        cur = '';
        has = false;
      }
      if (input[i + 1] === '>') {
        tokens.push('>>');
        i++;
      } else {
        tokens.push('>');
      }
    } else if (ch === ' ' || ch === '\t') {
      if (has) {
        tokens.push(cur);
        cur = '';
        has = false;
      }
    } else {
      cur += ch;
    }
  }
  if (has || cur.length > 0) tokens.push(cur);
  return tokens;
}

/** 按未加引号的 | 切分管道阶段 */
function splitPipes(input: string): string[] {
  const parts: string[] = [];
  let cur = '';
  let quote: '"' | "'" | null = null;
  for (let i = 0; i < input.length; i++) {
    const ch = input[i];
    if (quote) {
      if (ch === quote) quote = null;
      cur += ch;
    } else if (ch === '"' || ch === "'") {
      quote = ch as '"' | "'";
      cur += ch;
    } else if (ch === '|') {
      parts.push(cur);
      cur = '';
    } else {
      cur += ch;
    }
  }
  parts.push(cur);
  return parts;
}

interface ParsedStage {
  tokens: string[];
  redirect: string | null;
  append: boolean;
}

/** 拆分单个管道阶段里的命令 token 与重定向目标 */
function parseStage(stage: string): ParsedStage {
  const tokens = tokenize(stage);
  const cmd: string[] = [];
  let redirect: string | null = null;
  let append = false;
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (t === '>>') {
      append = true;
      redirect = tokens[i + 1] ?? '';
      if (tokens[i + 1] !== undefined) i++;
    } else if (t === '>') {
      redirect = tokens[i + 1] ?? '';
      if (tokens[i + 1] !== undefined) i++;
    } else {
      cmd.push(t);
    }
  }
  return { tokens: cmd, redirect, append };
}

function human(n: number): string {
  if (n < 1024) return `${n}B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)}K`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1048576).toFixed(1)}M`;
  return `${(n / 1073741824).toFixed(1)}G`;
}

/** 根据 id 算一个稳定可读的伪版本号，纯展示用 */
function pkgVersion(id: string): string {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  const major = (h % 4) + 1;
  const minor = h % 10;
  const patch = (h >> 4) % 10;
  return `${major}.${minor}.${patch}`;
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

const pad7 = (n: number): string => String(n).padStart(7);

/** 递归构造目录树（供 tree 使用） */
async function buildTree(
  dir: string,
  prefix: string,
  depth: number,
  maxDepth: number,
  showAll: boolean,
  out: string[],
): Promise<void> {
  const nodes = await vfs.listDir(dir);
  const vis = showAll ? nodes : nodes.filter((n) => !n.name.startsWith('.'));
  for (let i = 0; i < vis.length; i++) {
    const n = vis[i];
    const last = i === vis.length - 1;
    out.push(prefix + (last ? '└── ' : '├── ') + n.name + (n.type === 'dir' ? '/' : ''));
    if (n.type === 'dir' && depth < maxDepth) {
      await buildTree(n.path, prefix + (last ? '    ' : '│   '), depth + 1, maxDepth, showAll, out);
    }
  }
}

/* --------------------------------- 终端组件 --------------------------------- */

export default function Terminal({ context }: AppProps) {
  const [lines, setLines] = useState<Line[]>([
    { kind: 'output', text: 'Arch Web OS v2 — 终端' },
    { kind: 'output', text: '输入 help 查看可用命令。' },
    { kind: 'output', text: '' },
  ]);
  const [input, setInput] = useState('');
  const [cwd, setCwd] = useState('/home/arch');
  const [busy, setBusy] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const histRef = useRef<string[]>([]);
  const histPos = useRef<number>(-1);
  const aliases = useRef<Record<string, string>>({});

  useEffect(() => {
    scrollRef.current?.scrollTo({
      top: scrollRef.current.scrollHeight,
      behavior: 'smooth',
    });
  }, [lines]);

  const print = (text: string, kind: Line['kind'] = 'output') =>
    setLines((prev) => [...prev, { kind, text }]);


  const runPacman = async (args: string[]): Promise<string> => {
    const sub = args[0] ?? '';
    const pkg = usePackageStore.getState();
    if (sub === '-Q') {
      const installed = APPS.filter((a) => pkg.isInstalled(a.id));
      if (installed.length === 0) return '（没有任何已安装的包）';
      return installed.map((a) => `${a.id} ${pkgVersion(a.id)}`).join('\n');
    }
    if (sub === '-Ss') {
      const kw = (args[1] ?? '').toLowerCase();
      if (!kw) return '用法: pacman -Ss <关键词>';
      const hits = APPS.filter(
        (a) => a.id.toLowerCase().includes(kw) || a.name.includes(kw),
      );
      if (hits.length === 0) return `没有匹配「${kw}」的包`;
      return hits
        .map((a) => {
          const mark = pkg.isInstalled(a.id) ? ' [已安装]' : '';
          return `extra/${a.id} ${pkgVersion(a.id)}${mark}\n    ${a.name} - ${a.description}`;
        })
        .join('\n');
    }
    if (sub === '-S') {
      const id = args[1] ?? '';
      if (!id) return '用法: pacman -S <id>';
      const app = getApp(id);
      if (!app) return `错误：目标 ${id} 不存在`;
      if (pkg.isInstalled(id)) return `警告：${id} 已经是最新版本 (${pkgVersion(id)})`;
      pkg.install(id);
      notify(`已安装 ${app.name}`, `${app.name} 已加入启动器`, 'success');
      return [
        '正在解析依赖关系...',
        '正在查找冲突的包...',
        '下载大小: 0.00 MiB',
        '(1/1) 正在检查密钥环              [######################] 100%',
        `(1/1) 正在安装 ${id.padEnd(20)} [######################] 100%`,
        `${id} (${pkgVersion(id)}) 已安装`,
      ].join('\n');
    }
    if (sub === '-Qi') {
      const id = args[1] ?? '';
      if (!id) return '用法: pacman -Qi <id>';
      const app = getApp(id);
      if (!app) return `错误：包 ${id} 未找到`;
      const installed = pkg.isInstalled(id);
      return [
        `名称:           ${app.id}`,
        `版本:           ${pkgVersion(app.id)}`,
        `描述:           ${app.description}`,
        `架构:           x86_64`,
        `类别:           ${app.category}`,
        `安装状态:       ${installed ? '已安装' : '未安装'}`,
      ].join('\n');
    }
    if (sub.startsWith('-R')) {
      const id = args[1] ?? '';
      if (!id) return '用法: pacman -R <id>';
      const app = getApp(id);
      if (!app) return `错误：包 ${id} 未找到`;
      if (!pkg.isInstalled(id)) return `错误：包 ${id} 未安装`;
      pkg.remove(id);
      notify(`已卸载 ${app.name}`, `${app.name} 已从启动器移除`, 'info');
      return [
        '正在检查依赖关系...',
        `(1/1) 正在删除 ${id.padEnd(21)} [######################] 100%`,
        `${id} (${pkgVersion(id)}) 已卸载`,
      ].join('\n');
    }
    return '用法: pacman {-Q|-Ss|-S|-Qi|-R} [参数]';
  };

  const dispatch = async (
    name: string,
    args: string[],
    ctx: { cwd: string; stdin: string | null },
  ): Promise<string> => {
    switch (name) {
      case 'help': {
        const out: string[] = ['可用命令（按分类）：'];
        for (const cat of HELP_ORDER) {
          const keys = Object.keys(DOCS).filter((k) => DOCS[k].cat === cat);
          if (keys.length === 0) continue;
          out.push('');
          out.push(`【${cat}】`);
          for (const k of keys) out.push(`  ${k.padEnd(10)} ${DOCS[k].desc}`);
        }
        out.push('');
        out.push('支持：管道 |、重定向 > 与 >>、引号、Tab 补全、上下方向键历史');
        return out.join('\n');
      }

      case 'pwd':
        return ctx.cwd;

      case 'ls': {
        const flags = args.filter((a) => a.startsWith('-') && a !== '-').join('');
        const showAll = flags.includes('a');
        const long = flags.includes('l');
        const pathArg = args.find((a) => !a.startsWith('-')) ?? '';
        const dir = vfs.resolve(ctx.cwd, pathArg);
        const nodes = await vfs.listDir(dir);
        const visible = showAll ? nodes : nodes.filter((n) => !n.name.startsWith('.'));
        if (visible.length === 0) return long ? '' : '（空目录）';
        if (!long) {
          return visible
            .map((n) =>
              n.type === 'dir' ? `${n.name}/` : `${n.name.padEnd(24)} ${n.size}B`,
            )
            .join('\n');
        }
        return visible
          .map((n) => {
            const perms = n.type === 'dir' ? 'drwxr-xr-x' : '-rw-r--r--';
            const size = String(n.size).padStart(6);
            const date = new Date(n.updatedAt).toLocaleString('zh-CN', {
              hour12: false,
              month: '2-digit',
              day: '2-digit',
              hour: '2-digit',
              minute: '2-digit',
            });
            const nameText = n.type === 'dir' ? `${n.name}/` : n.name;
            return `${perms} 1 arch arch ${size} ${date} ${nameText}`;
          })
          .join('\n');
      }

      case 'cd': {
        if (!args[0]) {
          setCwd('/home/arch');
          return '';
        }
        const target = vfs.resolve(ctx.cwd, args[0]);
        if (target === '/') {
          setCwd('/');
          return '';
        }
        const parentNodes = await vfs.listDir(vfs.parentOf(target));
        const hit = parentNodes.find((n) => n.path === target && n.type === 'dir');
        if (hit) {
          setCwd(target);
          return '';
        }
        throw new Error(`${args[0]}: 不是目录`);
      }

      case 'cat': {
        if (!args[0] && ctx.stdin == null) throw new Error('用法: cat <文件>');
        if (args[0]) {
          const content = await vfs.readFile(vfs.resolve(ctx.cwd, args[0]));
          if (content === null) throw new Error(`${args[0]}: 没有该文件`);
          return content;
        }
        return ctx.stdin ?? '';
      }

      case 'echo':
        return args.join(' ');

      case 'mkdir': {
        if (!args[0]) throw new Error('用法: mkdir <目录>');
        const p = vfs.resolve(ctx.cwd, args[0]);
        await vfs.writeFile(`${p}/.keep`, '');
        return `已创建 ${p}`;
      }

      case 'touch': {
        if (!args[0]) throw new Error('用法: touch <文件>');
        const t = vfs.resolve(ctx.cwd, args[0]);
        if ((await vfs.readFile(t)) === null) await vfs.writeFile(t, '');
        return t;
      }

      case 'rm': {
        if (!args[0]) throw new Error('用法: rm <路径>');
        await vfs.remove(vfs.resolve(ctx.cwd, args[0]));
        return `已删除 ${args[0]}`;
      }

      case 'rmdir': {
        if (!args[0]) throw new Error('用法: rmdir <目录>');
        const p = vfs.resolve(ctx.cwd, args[0]);
        const parent = await vfs.listDir(vfs.parentOf(p));
        const hit = parent.find((n) => n.path === p && n.type === 'dir');
        if (!hit) throw new Error(`${args[0]}: 不是目录`);
        await vfs.remove(p);
        return `已删除目录 ${args[0]}`;
      }

      case 'cp': {
        if (!args[0] || !args[1]) throw new Error('用法: cp <源> <目标>');
        const src = vfs.resolve(ctx.cwd, args[0]);
        const dst = vfs.resolve(ctx.cwd, args[1]);
        const content = await vfs.readFile(src);
        if (content === null) throw new Error(`${args[0]}: 没有该文件`);
        await vfs.writeFile(dst, content);
        return `已复制 ${src} -> ${dst}`;
      }

      case 'mv': {
        if (!args[0] || !args[1]) throw new Error('用法: mv <源> <目标>');
        const src = vfs.resolve(ctx.cwd, args[0]);
        const dst = vfs.resolve(ctx.cwd, args[1]);
        await vfs.rename(src, dst);
        return `已移动 ${src} -> ${dst}`;
      }

      case 'stat': {
        if (!args[0]) throw new Error('用法: stat <文件>');
        const p = vfs.resolve(ctx.cwd, args[0]);
        const content = await vfs.readFile(p);
        if (content === null) throw new Error(`${args[0]}: 没有该文件`);
        return [
          `  文件: ${p}`,
          `  大小: ${content.length} 字节`,
          `  类型: 普通文件`,
          `  修改: ${new Date().toLocaleString('zh-CN', { hour12: false })}`,
        ].join('\n');
      }

      case 'tree': {
        let maxDepth = Infinity;
        const showAll = args.some((a) => a.startsWith('-') && a.includes('a'));
        const pathArgs: string[] = [];
        for (let i = 0; i < args.length; i++) {
          const a = args[i];
          if (a === '-L') {
            const n = Number(args[i + 1]);
            if (!Number.isNaN(n)) maxDepth = n;
            i++;
          } else if (a.startsWith('-L')) {
            const n = Number(a.slice(2));
            if (!Number.isNaN(n)) maxDepth = n;
          } else {
            pathArgs.push(a);
          }
        }
        const root = vfs.resolve(ctx.cwd, pathArgs[0] ?? '');
        const out: string[] = [root === '/' ? '/' : root];
        await buildTree(root, '', 1, maxDepth, showAll, out);
        return out.join('\n');
      }

      case 'head': {
        let n = 10;
        const rest: string[] = [];
        for (let i = 0; i < args.length; i++) {
          const a = args[i];
          if (a === '-n') {
            n = Number(args[i + 1]) || 10;
            i++;
          } else if (a.startsWith('-n')) {
            n = Number(a.slice(2)) || 10;
          } else {
            rest.push(a);
          }
        }
        let text: string;
        if (rest[0]) {
          const c = await vfs.readFile(vfs.resolve(ctx.cwd, rest[0]));
          if (c === null) throw new Error(`${rest[0]}: 没有该文件`);
          text = c;
        } else if (ctx.stdin != null) {
          text = ctx.stdin;
        } else {
          throw new Error('用法: head [-n N] [文件]');
        }
        return text.split('\n').slice(0, n).join('\n');
      }

      case 'tail': {
        let n = 10;
        const rest: string[] = [];
        for (let i = 0; i < args.length; i++) {
          const a = args[i];
          if (a === '-n') {
            n = Number(args[i + 1]) || 10;
            i++;
          } else if (a.startsWith('-n')) {
            n = Number(a.slice(2)) || 10;
          } else {
            rest.push(a);
          }
        }
        let text: string;
        if (rest[0]) {
          const c = await vfs.readFile(vfs.resolve(ctx.cwd, rest[0]));
          if (c === null) throw new Error(`${rest[0]}: 没有该文件`);
          text = c;
        } else if (ctx.stdin != null) {
          text = ctx.stdin;
        } else {
          throw new Error('用法: tail [-n N] [文件]');
        }
        return text.split('\n').slice(-n).join('\n');
      }

      case 'wc': {
        const files = args.filter((a) => !a.startsWith('-'));
        const count = (s: string) => {
          const linesN = s === '' ? 0 : s.split('\n').length - (s.endsWith('\n') ? 1 : 0);
          const wordsN = s.trim() === '' ? 0 : s.trim().split(/\s+/).length;
          return { lines: linesN, words: wordsN, chars: s.length };
        };
        const outLines: string[] = [];
        if (files.length === 0) {
          if (ctx.stdin == null) throw new Error('用法: wc [文件...]');
          const r = count(ctx.stdin);
          outLines.push(`${pad7(r.lines)} ${pad7(r.words)} ${pad7(r.chars)}`);
        } else {
          let total = { lines: 0, words: 0, chars: 0 };
          for (const f of files) {
            const c = await vfs.readFile(vfs.resolve(ctx.cwd, f));
            if (c === null) throw new Error(`${f}: 没有该文件`);
            const r = count(c ?? '');
            total = {
              lines: total.lines + r.lines,
              words: total.words + r.words,
              chars: total.chars + r.chars,
            };
            outLines.push(`${pad7(r.lines)} ${pad7(r.words)} ${pad7(r.chars)} ${f}`);
          }
          if (files.length > 1) {
            outLines.push(
              `${pad7(total.lines)} ${pad7(total.words)} ${pad7(total.chars)} 总计`,
            );
          }
        }
        return outLines.join('\n');
      }

      case 'less': {
        if (!args[0] && ctx.stdin == null) throw new Error('用法: less <文件>');
        let text = '';
        if (args[0]) {
          const c = await vfs.readFile(vfs.resolve(ctx.cwd, args[0]));
          if (c === null) throw new Error(`${args[0]}: 没有该文件`);
          text = c;
        } else {
          text = ctx.stdin ?? '';
        }
        return `${text}\n（提示：less 在此当作 cat 处理，按 q 退出）`;
      }

      case 'file': {
        if (!args[0]) throw new Error('用法: file <路径>');
        const p = vfs.resolve(ctx.cwd, args[0]);
        const c = await vfs.readFile(p);
        if (c === null) throw new Error(`${args[0]}: 没有该文件`);
        const ext = p.includes('.') ? p.slice(p.lastIndexOf('.') + 1).toLowerCase() : '';
        const map: Record<string, string> = {
          txt: 'ASCII 文本',
          md: 'Markdown 文本',
          json: 'JSON 数据',
          html: 'HTML 文档',
          css: 'CSS 样式表',
          js: 'JavaScript 源文件',
          ts: 'TypeScript 源文件',
          png: 'PNG 图像数据',
          jpg: 'JPEG 图像数据',
          jpeg: 'JPEG 图像数据',
          gif: 'GIF 图像数据',
          svg: 'SVG 矢量图',
          mp3: 'MPEG 音频数据',
          mp4: 'MP4 视频数据',
        };
        const type = map[ext] ?? '数据文件';
        return `${args[0]}: ${type}`;
      }

      case 'find': {
        const all = await vfs.listAll();
        let pattern = '';
        const rest: string[] = [];
        for (let i = 0; i < args.length; i++) {
          const a = args[i];
          if (a === '-name') {
            pattern = args[i + 1] ?? '';
            i++;
          } else if (a.startsWith('-name')) {
            pattern = a.slice(5);
          } else {
            rest.push(a);
          }
        }
        if (!pattern && rest.length) {
          if (rest.length >= 2) pattern = rest[1];
          else pattern = rest[0];
        }
        if (!pattern) throw new Error('用法: find [路径] 片段  （或 find -name 片段）');
        const matches = all.filter((n) => n.path.includes(pattern));
        if (matches.length === 0) return `find: 没有匹配「${pattern}」的路径`;
        return matches.map((m) => m.path).join('\n');
      }

      case 'grep': {
        let flags = '';
        let pattern = '';
        const files: string[] = [];
        for (const a of args) {
          if (a.startsWith('-')) flags += a.slice(1);
          else if (!pattern) pattern = a;
          else files.push(a);
        }
        if (!pattern) throw new Error('用法: grep [-in] 模式 [文件...]');
        const insensitive = flags.includes('i');
        const showNum = flags.includes('n');
        const re = new RegExp(escapeRegExp(pattern), insensitive ? 'i' : '');
        const lines: string[] = [];
        const push = (prefix: string, line: string) => {
          lines.push(prefix + line);
        };
        if (files.length) {
          for (const f of files) {
            const c = await vfs.readFile(vfs.resolve(ctx.cwd, f));
            if (c === null) throw new Error(`${f}: 没有该文件`);
            const body = c ?? '';
            body.split('\n').forEach((l, idx) => {
              if (re.test(l)) {
                const pre = showNum ? `${idx + 1}:` : '';
                const filePre = files.length > 1 ? `${f}:` : '';
                push(`${filePre}${pre}`, l);
              }
            });
          }
        } else if (ctx.stdin != null) {
          ctx.stdin.split('\n').forEach((l, idx) => {
            if (re.test(l)) {
              const pre = showNum ? `${idx + 1}:` : '';
              push(pre, l);
            }
          });
        } else {
          throw new Error('grep: 需要输入（文件或管道）');
        }
        return lines.join('\n');
      }

      case 'date':
        return new Date().toLocaleString('zh-CN', { hour12: false });

      case 'whoami':
        return 'arch';

      case 'hostname': {
        const h = await vfs.readFile('/etc/hostname');
        return (h ?? 'arch-web').trim();
      }

      case 'uname': {
        const opt = args[0] ?? '';
        if (opt === '-a')
          return 'Linux arch-web 6.8.0-arch1-1 #1 SMP PREEMPT_DYNAMIC web x86_64 GNU/Linux';
        if (opt === '-s') return 'Linux';
        if (opt === '-r') return '6.8.0-arch1-1';
        if (opt === '-m') return 'x86_64';
        return 'Linux';
      }

      case 'uptime': {
        const sec = Math.max(0, Math.floor((Date.now() - BOOT_TIME) / 1000));
        const mm = Math.floor(sec / 60);
        const ss = sec % 60;
        const t = `${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}`;
        return ` ${t} up ${mm} 分钟,  1 用户,  平均负载: 0.00, 0.00, 0.00`;
      }

      case 'neofetch': {
        const backend = await vfs.backend();
        return [
          '       /\\        arch@web',
          '      /  \\       --------',
          '     /\\   \\      OS      : Arch Web OS v2',
          '    /      \\     Kernel  : web-6.8.0-arch1-1',
          '   /   ,,   \\    Shell   : wsh 2.0',
          '  /   |  |  -\\   Storage : ' + backend,
          " /_-'    '-_\\  Apps    : " + APPS.length,
        ].join('\n');
      }

      case 'ps': {
        const wins = useWindowStore.getState().windows;
        if (wins.length === 0) return '  当前没有打开任何窗口（进程）';
        const linesOut = ['  PID TTY      TIME CMD'];
        wins.forEach((w, i) => {
          const meta = getApp(w.appId);
          const pid = 1000 + i + 1;
          const cmd = meta ? meta.name : w.appId;
          linesOut.push(`${String(pid).padStart(5)} ?        00:00:01 ${cmd}`);
        });
        return linesOut.join('\n');
      }

      case 'top': {
        const wins = useWindowStore.getState().windows;
        const header = [
          'top - 模拟快照（一次性输出）',
          `任务: ${wins.length} 个窗口进程`,
          '',
          '  PID USER   %CPU %MEM 命令',
        ];
        const rows = wins.map((w, i) => {
          const meta = getApp(w.appId);
          const pid = 1000 + i + 1;
          const cmd = meta ? meta.name : w.appId;
          const cpu = (Math.random() * 3).toFixed(1).padStart(4);
          const mem = (Math.random() * 2).toFixed(1).padStart(4);
          return `${String(pid).padStart(5)} arch   ${cpu} ${mem} ${cmd}`;
        });
        return [...header, ...rows].join('\n');
      }

      case 'df': {
        const u = await vfs.usage();
        const lines = [
          '文件系统     容量    已用   可用   使用%  挂载点',
          `archweb   ${human(u.bytes)}  ${human(u.bytes)}  --    --   /`,
        ];
        return lines.join('\n') + '\n（注：容量以字符数近似，OPFS 实际配额由浏览器管理）';
      }

      case 'du': {
        const target = vfs.resolve(ctx.cwd, args.find((a) => !a.startsWith('-')) ?? '');
        const all = await vfs.listAll();
        const hits = all.filter((n) => n.path === target || n.path.startsWith(target + '/'));
        const bytes = hits.reduce((s, n) => s + n.size, 0);
        return `${human(bytes)}\t${target}`;
      }

      case 'free': {
        const mem = (
          performance as unknown as {
            memory?: {
              usedJSHeapSize: number;
              totalJSHeapSize: number;
              jsHeapSizeLimit: number;
            };
          }
        ).memory;
        const lines: string[] = [];
        if (!mem) {
          lines.push('（performance.memory 不可用，以下为估算值，仅供演示）');
          lines.push('             总计      已用      空闲');
          lines.push('内存:     2048MB    512MB    1536MB');
        } else {
          const total = Math.round(mem.totalJSHeapSize / 1048576);
          const used = Math.round(mem.usedJSHeapSize / 1048576);
          const free = Math.max(0, total - used);
          lines.push('             总计      已用      空闲');
          lines.push(
            `内存:     ${String(total).padStart(6)}MB  ${String(used).padStart(6)}MB  ${String(free).padStart(6)}MB`,
          );
        }
        return lines.join('\n');
      }

      case 'history':
        return histRef.current
          .map((h, i) => `  ${String(i + 1).padStart(4)}  ${h}`)
          .join('\n');

      case 'which': {
        if (!args[0]) throw new Error('用法: which <命令>');
        const target = args[0];
        if (DOCS[target] || aliases.current[target]) return `/usr/bin/${target}`;
        throw new Error(`未找到 ${target}`);
      }

      case 'man': {
        if (!args[0]) throw new Error('用法: man <命令>');
        const d = DOCS[args[0] ?? ''];
        if (!d) throw new Error(`没有 ${args[0]} 的手册页`);
        return `${args[0]} — ${d.desc}`;
      }

      case 'alias': {
        if (args.length === 0) {
          const ks = Object.keys(aliases.current);
          if (ks.length === 0) return '（当前没有别名）';
          return ks.map((k) => `alias ${k}='${aliases.current[k]}'`).join('\n');
        }
        const arg = args[0];
        const m = arg.match(/^([\w-]+)='(.+)'|^([\w-]+)="(.+)"|^([\w-]+)=(.+)$/);
        if (m) {
          const aName = m[1] ?? m[3] ?? m[5] ?? '';
          const aVal = m[2] ?? m[4] ?? m[6] ?? '';
          aliases.current[aName] = aVal;
          return `已设置别名: ${aName} -> ${aVal}`;
        }
        if (aliases.current[arg]) return `alias ${arg}='${aliases.current[arg]}'`;
        return `alias: ${arg}: 未找到`;
      }

      case 'curl': {
        const url = args.find((a) => !a.startsWith('-')) ?? '';
        if (!url) throw new Error('用法: curl <URL>');
        let host = url;
        try {
          host = new URL(url).host;
        } catch {
          /* 不是标准 URL，保留原样 */
        }
        return [
          '（这是模拟终端，curl 不会真的发起网络请求）',
          `> 正在解析主机 ${host} ...`,
          `> 已连接到 ${host}（模拟）`,
          '',
          'HTTP/1.1 200 OK（模拟响应）',
          'content-type: text/html',
          '',
          `<!-- 来自 ${host} 的模拟页面 -->`,
          `<html><body><h1>Arch Web OS</h1><p>这是 ${url} 的模拟响应。</p></body></html>`,
        ].join('\n');
      }

      case 'sudo': {
        if (args[0] === 'pacman') {
          const out = await runPacman(args.slice(1));
          return `【sudo】 password for arch: \n${out}`;
        }
        if (!args[0]) throw new Error('用法: sudo <命令>');
        return `sudo: 用户 arch 没有权限执行 ${args[0]}，需要 root 账户。`;
      }

      case 'pacman':
        return await runPacman(args);

      case 'open': {
        const app = APPS.find((a) => a.id === args[0]);
        if (!app) throw new Error(`未知应用: ${args[0] ?? ''}，用 apps 看列表`);
        useWindowStore.getState().open({
          appId: app.id,
          title: app.name,
          width: app.defaultWidth,
          height: app.defaultHeight,
          singleton: app.singleton,
        });
        return `正在打开 ${app.name}`;
      }

      case 'apps':
        return APPS.map((a) => `${a.id.padEnd(14)} ${a.name}`).join('\n');

      default:
        throw new Error('command not found，用 help 看全部命令');
    }
  };

  const execute = async (raw: string): Promise<void> => {
    const trimmed = raw.trim();
    if (!trimmed) return;
    if (histRef.current[histRef.current.length - 1] !== trimmed) {
      histRef.current.push(trimmed);
    }
    histPos.current = histRef.current.length;
    setLines((prev) => [...prev, { kind: 'input', text: `${cwd} $ ${trimmed}` }]);
    setBusy(true);

    const stages = splitPipes(trimmed);
    const singleStage = stages.length === 1;
    try {
      let stdin: string | null = null;
      for (const stage of stages) {
        const parsed = parseStage(stage);
        if (parsed.tokens.length === 0) continue;
        let name = parsed.tokens[0] ?? '';
        const restArgs = parsed.tokens.slice(1);
        // 会话内别名展开（仅首个 token）
        const aliasVal = aliases.current[name];
        if (aliasVal) {
          const exp = tokenize(`${aliasVal} ${restArgs.join(' ')}`);
          const newName = exp[0] ?? name;
          name = newName;
          restArgs.length = 0;
          for (let i = 1; i < exp.length; i++) restArgs.push(exp[i]);
        }
        if (!name) {
          print('command not found，用 help 看全部命令', 'error');
          break;
        }
        if (name === 'clear') {
          setLines([]);
          stdin = null;
          continue;
        }
        if (name === 'exit') {
          context.close();
          stdin = null;
          continue;
        }
        if (parsed.redirect === '') {
          print('重定向：缺少目标文件', 'error');
          break;
        }
        let out = '';
        try {
          out = await dispatch(name, restArgs, { cwd, stdin });
        } catch (e) {
          print(`${name}: ${(e as Error).message}`, 'error');
          break;
        }
        if (parsed.redirect) {
          const target = vfs.resolve(cwd, parsed.redirect);
          const content = parsed.append
            ? `${await vfs.readFile(target) ?? ''}${out}`
            : out;
          await vfs.writeFile(target, content);
          if (singleStage) print(`已写入 ${target}`);
        } else if (out !== '') {
          out.replace(/\n+$/, '').split('\n').forEach((l) => print(l));
        }
        stdin = out;
      }
    } finally {
      setBusy(false);
    }
  };

  const navigateHistory = (dir: number) => {
    const h = histRef.current;
    if (h.length === 0) return;
    if (dir < 0) {
      histPos.current =
        histPos.current < 0 ? h.length - 1 : Math.max(0, histPos.current - 1);
      setInput(h[histPos.current] ?? '');
    } else {
      if (histPos.current < 0) return;
      histPos.current += 1;
      if (histPos.current >= h.length) {
        histPos.current = h.length;
        setInput('');
      } else {
        setInput(h[histPos.current] ?? '');
      }
    }
  };

  const complete = async () => {
    const value = inputRef.current?.value ?? input;
    const tokens = value.split(' ');
    const last = tokens[tokens.length - 1] ?? '';
    if (tokens.length <= 1) {
      const names = Object.keys(DOCS).concat(Object.keys(aliases.current));
      const matches = names.filter((n) => n.startsWith(last));
      if (matches.length === 1) setInput(`${matches[0]} `);
      else if (matches.length > 1) print(matches.join('  '));
      return;
    }
    const nodes = await vfs.listDir(cwd);
    const matches = nodes.filter((n) => n.name.startsWith(last));
    if (matches.length === 1) {
      tokens[tokens.length - 1] =
        matches[0].name + (matches[0].type === 'dir' ? '/' : '');
      setInput(tokens.join(' '));
    } else if (matches.length > 1) {
      print(matches.map((m) => m.name + (m.type === 'dir' ? '/' : '')).join('  '));
    }
  };

  return (
    <div
      className="flex h-full flex-col bg-[#0b0e14]/85 p-2 text-[12px] leading-5 text-arch-text"
      onClick={() => inputRef.current?.focus()}
    >
      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto pr-1">
        {lines.map((line, i) => (
          <div
            key={i}
            className={
              line.kind === 'input'
                ? 'text-arch-accent'
                : line.kind === 'error'
                  ? 'text-arch-red'
                  : 'text-arch-text/90'
            }
          >
            {line.text || ' '}
          </div>
        ))}
      </div>

      <div className="mt-1 flex items-center gap-1 border-t border-arch-border pt-2">
        <span className="shrink-0 text-arch-green">{cwd} $</span>
        <input
          ref={inputRef}
          autoFocus
          value={input}
          disabled={busy}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              if (!busy) {
                void execute(input);
                setInput('');
              }
            } else if (e.key === 'Tab') {
              e.preventDefault();
              void complete();
            } else if (e.key === 'ArrowUp') {
              e.preventDefault();
              navigateHistory(-1);
            } else if (e.key === 'ArrowDown') {
              e.preventDefault();
              navigateHistory(1);
            }
          }}
          className="flex-1 bg-transparent text-arch-text outline-none"
          spellCheck={false}
        />
      </div>
    </div>
  );
}
