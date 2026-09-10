import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react';
import {
  Copy,
  Download,
  File as FileIcon,
  FolderTree,
  HardDrive,
  Search,
  Trash2,
  Upload,
} from 'lucide-react';
import type { AppProps } from '@/shell/types';
import { cn } from '@/lib/cn';
import { vfs } from '@/services/filesystem';
import { notify } from '@/stores/useNotifyStore';

interface FileEntry {
  path: string;
  name: string;
  size: number;
}

const BACKUP_TOP_N = 20;

function fmtBytes(n: number): string {
  if (n >= 1024 * 1024) return `${(n / 1024 / 1024).toFixed(2)} MB`;
  if (n >= 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${Math.round(n)} B`;
}

function dirOf(path: string): string {
  const i = path.lastIndexOf('/');
  return i <= 0 ? '/' : path.slice(0, i);
}

export default function DiskUsage(_: AppProps) {
  const [files, setFiles] = useState<FileEntry[] | null>(null);
  const [backend, setBackend] = useState<string>('');
  const [quota, setQuota] = useState<{ usage: number; quota: number } | null>(
    null,
  );
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<string | null>(null);
  const [restoring, setRestoring] = useState<number | null>(null);
  const [restored, setRestored] = useState(0);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const load = useCallback(async () => {
    try {
      const all = await vfs.listAll();
      setFiles(
        all.map((f) => ({ path: f.path, name: f.name, size: f.size })),
      );
    } catch (e) {
      notify('读取失败', String(e), 'error');
      setFiles([]);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const b = await vfs.backend();
        if (alive) setBackend(b);
      } catch {
        /* 忽略 */
      }
      try {
        const est = await navigator.storage?.estimate();
        if (alive && est)
          setQuota({ usage: est.usage ?? 0, quota: est.quota ?? 0 });
      } catch {
        /* 忽略 */
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  const dirs = useMemo(() => {
    if (!files) return [];
    const map = new Map<string, { count: number; bytes: number }>();
    for (const f of files) {
      const d = dirOf(f.path);
      const cur = map.get(d) ?? { count: 0, bytes: 0 };
      cur.count += 1;
      cur.bytes += f.size;
      map.set(d, cur);
    }
    return [...map.entries()]
      .map(([path, v]) => ({ path, count: v.count, bytes: v.bytes }))
      .sort((a, b) => b.bytes - a.bytes);
  }, [files]);

  const maxDir = dirs.length > 0 ? Math.max(...dirs.map((d) => d.bytes)) : 1;

  const largest = useMemo(() => {
    if (!files) return [];
    const q = query.trim().toLowerCase();
    const list = q
      ? files.filter((f) => f.path.toLowerCase().includes(q))
      : files;
    return [...list]
      .sort((a, b) => b.size - a.size)
      .slice(0, BACKUP_TOP_N);
  }, [files, query]);

  const totalBytes = files ? files.reduce((s, f) => s + f.size, 0) : 0;
  const selectedFile = files?.find((f) => f.path === selected) ?? null;

  const copyPath = async (path: string) => {
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(path);
        notify('已复制路径', path, 'success');
        return;
      }
      throw new Error('无 clipboard API');
    } catch (e) {
      notify('复制失败', String(e), 'error');
    }
  };

  const delFile = async (path: string) => {
    try {
      await vfs.remove(path);
      notify('已删除', path, 'info');
      if (selected === path) setSelected(null);
      await load();
    } catch (e) {
      notify('删除失败', String(e), 'error');
    }
  };

  const exportBackup = async () => {
    try {
      const all = files ?? (await vfs.listAll());
      const out: Array<{ path: string; content: string }> = [];
      for (const f of all) {
        const content = (await vfs.readFile(f.path)) ?? '';
        out.push({ path: f.path, content });
      }
      const payload = JSON.stringify(
        { exportedAt: Date.now(), files: out },
        null,
        2,
      );
      const blob = new Blob([payload], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
      a.href = url;
      a.download = `arch-web-backup-${stamp}.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      notify('已导出备份', `共 ${out.length} 个文件`, 'success');
    } catch (e) {
      notify('导出失败', String(e), 'error');
    }
  };

  const onImportFile = async (e: ChangeEvent<HTMLInputElement>) => {
    const input = e.target;
    const file = input.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      const parsed = JSON.parse(text) as {
        files?: Array<{ path?: unknown; content?: unknown }>;
      };
      const items = parsed.files ?? [];
      if (!Array.isArray(items) || items.length === 0) {
        notify('无效备份', '未找到文件列表', 'error');
        return;
      }
      const ok = window.confirm(
        `确定用该备份覆盖现有 VFS 吗？共 ${items.length} 个文件，此操作不可撤销。`,
      );
      if (!ok) return;
      setRestored(0);
      setRestoring(items.length);
      for (let i = 0; i < items.length; i++) {
        const it = items[i]!;
        const p = typeof it.path === 'string' ? it.path : '';
        const c = typeof it.content === 'string' ? it.content : '';
        if (p) {
          await vfs.writeFile(p, c);
          setRestored(i + 1);
        }
      }
      notify('恢复完成', `已写入 ${items.length} 个文件`, 'success');
      setRestoring(null);
      await load();
    } catch (err) {
      notify('恢复失败', String(err), 'error');
      setRestoring(null);
    }
    if (input) input.value = '';
  };

  return (
    <div className="flex h-full flex-col bg-arch-bg text-arch-text text-[12px]">
      {/* 头部：后端 / 配额 / 备份按钮 */}
      <div className="flex flex-wrap items-center gap-3 border-b border-arch-border px-3 py-2">
        <span className="flex items-center gap-1 text-arch-muted">
          <HardDrive size={13} />
          后端：
          <span className="font-mono text-arch-accent">{backend || '读取中…'}</span>
        </span>
        <span className="font-mono text-arch-muted">
          配额 {quota ? `${fmtBytes(quota.usage)} / ${fmtBytes(quota.quota)}` : '未知'}
        </span>
        <span className="font-mono text-arch-muted">
          总文件 {files ? files.length : 0} · {fmtBytes(totalBytes)}
        </span>
        <div className="ml-auto flex gap-2">
          <button
            type="button"
            onClick={exportBackup}
            className="flex items-center gap-1 rounded border border-arch-border px-2 py-1 text-arch-accent hover:bg-arch-panel"
          >
            <Download size={12} />
            导出备份
          </button>
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="flex items-center gap-1 rounded border border-arch-border px-2 py-1 text-arch-green hover:bg-arch-panel"
          >
            <Upload size={12} />
            从备份恢复
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept="application/json,.json"
            className="hidden"
            onChange={onImportFile}
          />
        </div>
      </div>

      {restoring !== null && (
        <div className="border-b border-arch-border bg-arch-accent/10 px-3 py-1">
          正在恢复：{restored} / {restoring}
          <div className="mt-1 h-1 w-full overflow-hidden rounded bg-arch-border">
            <div
              className="h-full bg-arch-accent"
              style={{
                width: restoring > 0 ? `${(restored / restoring) * 100}%` : '0%',
              }}
            />
          </div>
        </div>
      )}

      <div className="grid min-h-0 flex-1 grid-cols-1 md:grid-cols-2">
        {/* 左：目录聚合 */}
        <div className="flex min-h-0 flex-col border-r border-arch-border">
          <div className="border-b border-arch-border px-3 py-1 text-arch-muted">
            目录占用（按大小排序）
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto">
            {dirs.length === 0 ? (
              <Empty text="VFS 中还没有任何目录" />
            ) : (
              dirs.map((d) => (
                <div
                  key={d.path}
                  className="border-b border-arch-border/60 px-3 py-1"
                >
                  <div className="flex items-center justify-between">
                    <span className="flex items-center gap-1 font-mono">
                      <FolderTree size={12} className="text-arch-muted" />
                      {d.path}
                    </span>
                    <span className="font-mono text-arch-muted">
                      {d.count} 文件 · {fmtBytes(d.bytes)}
                    </span>
                  </div>
                  <div className="mt-1 h-1.5 w-full overflow-hidden rounded bg-arch-border">
                    <div
                      className="h-full bg-arch-accent"
                      style={{ width: `${maxDir > 0 ? (d.bytes / maxDir) * 100 : 0}%` }}
                    />
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        {/* 右：最大文件 + 详情 */}
        <div className="flex min-h-0 flex-col">
          <div className="flex items-center gap-2 border-b border-arch-border px-3 py-1">
            <Search size={12} className="text-arch-muted" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="按路径搜索"
              className="w-full bg-transparent py-1 outline-none placeholder:text-arch-muted"
            />
            <span className="text-arch-muted">最大的 {BACKUP_TOP_N} 个</span>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto">
            {largest.length === 0 ? (
              <Empty text={query ? '没有匹配的文件' : 'VFS 中还没有任何文件'} />
            ) : (
              largest.map((f) => (
                <button
                  key={f.path}
                  type="button"
                  onClick={() => setSelected(f.path)}
                  className={cn(
                    'flex w-full items-center justify-between border-b border-arch-border/60 px-3 py-1 text-left hover:bg-arch-panel',
                    selected === f.path && 'bg-arch-accent/10',
                  )}
                >
                  <span className="flex items-center gap-1 truncate font-mono">
                    <FileIcon size={12} className="shrink-0 text-arch-muted" />
                    <span className="truncate" title={f.path}>
                      {f.path}
                    </span>
                  </span>
                  <span className="ml-2 shrink-0 font-mono text-arch-muted">
                    {fmtBytes(f.size)}
                  </span>
                </button>
              ))
            )}
          </div>

          {selectedFile && (
            <div className="border-t border-arch-border p-2">
              <div className="mb-1 text-arch-muted">所选文件</div>
              <div className="break-all font-mono text-arch-accent">
                {selectedFile.path}
              </div>
              <div className="my-1 font-mono text-arch-muted">
                {fmtBytes(selectedFile.size)}
              </div>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => copyPath(selectedFile.path)}
                  className="flex items-center gap-1 rounded border border-arch-border px-2 py-1 text-arch-accent hover:bg-arch-panel"
                >
                  <Copy size={12} />
                  复制路径
                </button>
                <button
                  type="button"
                  onClick={() => delFile(selectedFile.path)}
                  className="flex items-center gap-1 rounded border border-arch-border px-2 py-1 text-arch-red hover:bg-arch-panel"
                >
                  <Trash2 size={12} />
                  删除
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function Empty({ text }: { text: string }) {
  return (
    <div className="flex h-full items-center justify-center p-6 text-center text-arch-muted">
      {text}
    </div>
  );
}
