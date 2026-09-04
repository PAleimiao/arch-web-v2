import type { FsNode } from '@/shell/types';
import {
  createIdbAdapter,
  tryOpfsAdapter,
  type FsAdapter,
} from './adapters';

const normalize = (p: string) => {
  let s = (p || '/').replace(/\/+/g, '/');
  if (!s.startsWith('/')) s = `/${s}`;
  if (s.length > 1 && s.endsWith('/')) s = s.slice(0, -1);
  return s;
};

const parentOf = (p: string) => {
  const i = p.lastIndexOf('/');
  return i <= 0 ? '/' : p.slice(0, i);
};

const baseName = (p: string) => p.slice(p.lastIndexOf('/') + 1);

const SEED: Array<[string, string]> = [
  [
    '/home/arch/readme.txt',
    '欢迎来到 Arch Web OS v2\n\n' +
      '· 所有文件都存在浏览器本地（OPFS，不可用时降级 IndexedDB）\n' +
      '· 打开终端试试 ls / cat readme.txt / help\n' +
      '· 关掉标签页再回来，这些内容还在\n',
  ],
  [
    '/home/arch/notes/待办.md',
    '# 待办\n\n- [x] 搭好桌面骨架\n- [ ] 接上云同步\n- [ ] 把浏览器换成真的\n',
  ],
  ['/etc/hostname', 'arch-web\n'],
  [
    '/etc/motd',
    'Arch Web OS v2 — 运行在浏览器中的桌面环境\n',
  ],
];

class VirtualFileSystem {
  private adapter: FsAdapter | null = null;
  private initPromise: Promise<FsAdapter> | null = null;

  private async init(): Promise<FsAdapter> {
    if (this.adapter) return this.adapter;
    if (!this.initPromise) {
      this.initPromise = (async () => {
        const adapter = (await tryOpfsAdapter()) ?? createIdbAdapter();
        for (const [path, content] of SEED) {
          if ((await adapter.read(path)) === null) {
            await adapter.write(path, content);
          }
        }
        this.adapter = adapter;
        return adapter;
      })();
    }
    return this.initPromise;
  }

  /** 当前生效的存储后端，展示在设置里 */
  async backend(): Promise<string> {
    return (await this.init()).name;
  }

  async listDir(path = '/'): Promise<FsNode[]> {
    const fs = await this.init();
    const dir = normalize(path);
    const keys = await fs.keys();
    const dirs = new Set<string>();
    const files: FsNode[] = [];

    for (const key of keys) {
      const p = normalize(key);
      if (!p.startsWith(dir === '/' ? '/' : `${dir}/`)) continue;
      const rest = p.slice(dir === '/' ? 1 : dir.length + 1);
      if (!rest) continue;
      const slash = rest.indexOf('/');
      if (slash === -1) {
        const content = (await fs.read(p)) ?? '';
        files.push({
          path: p,
          name: baseName(p),
          type: 'file',
          size: content.length,
          updatedAt: Date.now(),
          content,
        });
      } else {
        dirs.add(`${dir === '/' ? '' : dir}/${rest.slice(0, slash)}`);
      }
    }

    const dirNodes: FsNode[] = [...dirs].map((d) => ({
      path: d,
      name: baseName(d),
      type: 'dir' as const,
      size: 0,
      updatedAt: Date.now(),
    }));

    return [...dirNodes, ...files].sort((a, b) => {
      if (a.type !== b.type) return a.type === 'dir' ? -1 : 1;
      return a.name.localeCompare(b.name, 'zh-Hans-CN');
    });
  }

  async readFile(path: string): Promise<string | null> {
    const fs = await this.init();
    return fs.read(normalize(path));
  }

  async writeFile(path: string, content: string): Promise<void> {
    const fs = await this.init();
    await fs.write(normalize(path), content);
    bus.emit('fs:change', normalize(path));
  }

  async remove(path: string): Promise<void> {
    const fs = await this.init();
    const target = normalize(path);
    const keys = await fs.keys();
    // 目录删除：连子路径一起清掉
    const victims = keys.filter(
      (k) => normalize(k) === target || normalize(k).startsWith(`${target}/`),
    );
    for (const v of victims) await fs.remove(v);
    bus.emit('fs:change', target);
  }

  async rename(from: string, to: string): Promise<void> {
    const content = await this.readFile(from);
    if (content === null) return;
    await this.writeFile(to, content);
    await this.remove(from);
  }

  async exists(path: string): Promise<boolean> {
    return (await this.readFile(path)) !== null;
  }

  /** 终端/文件管理器共用的路径解析：支持相对路径与 .. */
  resolve(cwd: string, input: string): string {
    const raw = input.startsWith('/') ? input : `${cwd}/${input}`;
    const parts: string[] = [];
    for (const seg of raw.split('/')) {
      if (!seg || seg === '.') continue;
      if (seg === '..') parts.pop();
      else parts.push(seg);
    }
    return `/${parts.join('/')}`;
  }

  parentOf = parentOf;
  baseName = baseName;
}

export const vfs = new VirtualFileSystem();

/* ------------------------------ 轻量事件总线 ------------------------------ */

type Handler<T> = (payload: T) => void;

class EventBus {
  private map = new Map<string, Set<Handler<never>>>();

  on<T>(event: string, fn: Handler<T>): () => void {
    const set = this.map.get(event) ?? new Set();
    set.add(fn as Handler<never>);
    this.map.set(event, set);
    return () => set.delete(fn as Handler<never>);
  }

  emit<T>(event: string, payload: T): void {
    this.map.get(event)?.forEach((fn) => (fn as Handler<T>)(payload));
  }
}

export const bus = new EventBus();
