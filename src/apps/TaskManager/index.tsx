import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  Activity,
  Cpu,
  Eye,
  Maximize2,
  Minimize2,
  Package,
  Rocket,
  Search,
  Trash2,
} from 'lucide-react';
import type { AppProps } from '@/shell/types';
import { cn } from '@/lib/cn';
import { APPS } from '@/apps/registry';
import { notify } from '@/stores/useNotifyStore';
import { useWindowStore } from '@/stores/useWindowStore';
import { usePackageStore } from '@/stores/usePackageStore';

interface PerfMemory {
  usedJSHeapSize: number;
  totalJSHeapSize: number;
  jsHeapSizeLimit: number;
}

function getHeap(): PerfMemory | null {
  const p = performance as unknown as { memory?: PerfMemory };
  return p.memory ?? null;
}

const hasRealHeap = getHeap() !== null;

/** 无可测堆时的内存估算基准（固定基准 + 每窗口增量） */
const EST_BASE = 4 * 1024 * 1024;
const EST_PER_WINDOW = 1.5 * 1024 * 1024;

function fmtBytes(n: number): string {
  if (n >= 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  if (n >= 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${Math.round(n)} B`;
}

function fmtDuration(ms: number): string {
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
  return `${m}:${String(sec).padStart(2, '0')}`;
}

type Tab = 'process' | 'startup';
type SortKey = 'z' | 'area' | 'title';

export default function TaskManager(_: AppProps) {
  const windows = useWindowStore((s) => s.windows);
  const activeId = useWindowStore((s) => s.activeId);
  const close = useWindowStore((s) => s.close);
  const focus = useWindowStore((s) => s.focus);
  const minimize = useWindowStore((s) => s.minimize);
  const toggleMaximize = useWindowStore((s) => s.toggleMaximize);

  const disabled = usePackageStore((s) => s.disabled);
  const installPkg = usePackageStore((s) => s.install);
  const removePkg = usePackageStore((s) => s.remove);

  const [tab, setTab] = useState<Tab>('process');
  const [query, setQuery] = useState('');
  const [sortKey, setSortKey] = useState<SortKey>('z');

  const [fps, setFps] = useState(0);
  const [heap, setHeap] = useState<number | null>(
    hasRealHeap ? (getHeap()?.usedJSHeapSize ?? null) : null,
  );
  const [runtime, setRuntime] = useState(0);

  const mountedAt = useRef(performance.now());
  const rafRef = useRef<number | null>(null);
  const frameCount = useRef(0);
  const intervalRef = useRef<number | null>(null);

  useEffect(() => {
    const loop = () => {
      frameCount.current += 1;
      rafRef.current = requestAnimationFrame(loop);
    };
    rafRef.current = requestAnimationFrame(loop);
    intervalRef.current = window.setInterval(() => {
      setFps(frameCount.current);
      frameCount.current = 0;
      const h = getHeap();
      setHeap(h ? h.usedJSHeapSize : null);
      setRuntime(performance.now() - mountedAt.current);
    }, 1000);
    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
      if (intervalRef.current !== null) window.clearInterval(intervalRef.current);
    };
  }, []);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = q
      ? windows.filter(
          (w) =>
            w.title.toLowerCase().includes(q) ||
            w.appId.toLowerCase().includes(q),
        )
      : windows;
    const sorted = [...list].sort((a, b) => {
      if (sortKey === 'area') return b.width * b.height - a.width * a.height;
      if (sortKey === 'title')
        return a.title.localeCompare(b.title, 'zh-Hans-CN');
      return b.zIndex - a.zIndex;
    });
    return sorted;
  }, [windows, query, sortKey]);

  const byApp = useMemo(() => {
    const map = new Map<string, { count: number }>();
    for (const w of windows) {
      const cur = map.get(w.appId) ?? { count: 0 };
      cur.count += 1;
      map.set(w.appId, cur);
    }
    return map;
  }, [windows]);

  const appMemory = (appId: string): { value: number; estimated: boolean } => {
    const count = byApp.get(appId)?.count ?? 0;
    if (heap !== null) {
      const totalWindows = Math.max(1, windows.length);
      return {
        value: Math.max(0, Math.round((heap * count) / totalWindows)),
        estimated: true,
      };
    }
    return { value: Math.round(EST_BASE + count * EST_PER_WINDOW), estimated: true };
  };

  const activeCount = windows.filter((w) => !w.minimized).length;

  const endProcess = (id: string) => {
    close(id);
    notify('已结束进程', `窗口 ${id} 已关闭`, 'info');
  };

  const isInstalled = (id: string) => !disabled.includes(id);

  const doRemove = (id: string, name: string) => {
    removePkg(id);
    notify('已卸载（模拟）', `${name} 已从启动器移除`, 'warn');
  };

  const doInstall = (id: string, name: string) => {
    installPkg(id);
    notify('已重新安装（模拟）', `${name} 已恢复到启动器`, 'success');
  };

  return (
    <div className="flex h-full flex-col bg-arch-bg text-arch-text text-[12px]">
      {/* 顶栏：实时指标 */}
      <div className="grid grid-cols-4 gap-px border-b border-arch-border bg-arch-border">
        <Stat icon={<Activity size={14} />} label="FPS" value={String(fps)} tone={fps >= 50 ? 'green' : fps >= 30 ? 'accent' : 'red'} />
        <Stat icon={<Cpu size={14} />} label="已用堆" value={heap !== null ? fmtBytes(heap) : '不可用'} tone={heap !== null ? 'accent' : 'muted'} />
        <Stat icon={<Rocket size={14} />} label="活跃窗口" value={String(activeCount)} tone="accent" />
        <Stat icon={<Cpu size={14} />} label="运行时长" value={fmtDuration(runtime)} tone="muted" />
      </div>

      {/* 标签页切换 */}
      <div className="flex items-center gap-1 border-b border-arch-border px-2 py-1">
        <TabBtn active={tab === 'process'} onClick={() => setTab('process')}>
          进程
        </TabBtn>
        <TabBtn active={tab === 'startup'} onClick={() => setTab('startup')}>
          启动项
        </TabBtn>
        <span className="ml-auto text-arch-muted">
          内存数值为按窗口数分摊的估算，仅作参考
        </span>
      </div>

      {tab === 'process' ? (
        <div className="flex min-h-0 flex-1 flex-col">
          <div className="flex items-center gap-2 border-b border-arch-border px-2 py-1">
            <div className="flex items-center gap-1 rounded border border-arch-border bg-arch-panel px-2">
              <Search size={12} className="text-arch-muted" />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="搜索标题或应用"
                className="w-40 bg-transparent py-1 outline-none placeholder:text-arch-muted"
              />
            </div>
            <label className="flex items-center gap-1 text-arch-muted">
              排序
              <select
                value={sortKey}
                onChange={(e) => setSortKey(e.target.value as SortKey)}
                className="rounded border border-arch-border bg-arch-panel px-1 py-0.5 outline-none"
              >
                <option value="z">z 序</option>
                <option value="area">窗口面积</option>
                <option value="title">标题</option>
              </select>
            </label>
            <span className="ml-auto text-arch-muted">
              共 {filtered.length} 个进程
            </span>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto">
            <table className="w-full border-collapse">
              <thead className="sticky top-0 bg-arch-panel text-arch-muted">
                <tr className="text-left">
                  <Th>应用</Th>
                  <Th>标题</Th>
                  <Th>窗口 ID</Th>
                  <Th>状态</Th>
                  <Th className="text-right">面积(px²)</Th>
                  <Th className="text-right">z</Th>
                  <Th className="text-right">操作</Th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((w) => (
                  <tr
                    key={w.id}
                    className={cn(
                      'border-b border-arch-border/60',
                      w.id === activeId && 'bg-arch-accent/10',
                    )}
                  >
                    <Td className="font-mono">{w.appId}</Td>
                    <Td className="truncate" title={w.title}>
                      {w.title}
                    </Td>
                    <Td className="font-mono text-arch-muted">{w.id}</Td>
                    <Td>
                      <span
                        className={cn(
                          w.minimized ? 'text-arch-muted' : 'text-arch-green',
                        )}
                      >
                        {w.minimized ? '已最小化' : '运行中'}
                      </span>
                    </Td>
                    <Td className="text-right font-mono">
                      {w.width * w.height}
                    </Td>
                    <Td className="text-right font-mono text-arch-muted">
                      {w.zIndex}
                    </Td>
                    <Td>
                      <div className="flex justify-end gap-1">
                        <IconBtn title="聚焦" onClick={() => focus(w.id)}>
                          <Eye size={13} />
                        </IconBtn>
                        <IconBtn title="最小化" onClick={() => minimize(w.id)}>
                          <Minimize2 size={13} />
                        </IconBtn>
                        <IconBtn
                          title="最大化"
                          onClick={() => toggleMaximize(w.id)}
                        >
                          <Maximize2 size={13} />
                        </IconBtn>
                        <IconBtn
                          title="结束进程"
                          danger
                          onClick={() => endProcess(w.id)}
                        >
                          <Trash2 size={13} />
                        </IconBtn>
                      </div>
                    </Td>
                  </tr>
                ))}
                {filtered.length === 0 && (
                  <tr>
                    <td colSpan={7} className="px-3 py-6 text-center text-arch-muted">
                      没有匹配的进程
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          {/* 按应用聚合 */}
          <div className="border-t border-arch-border px-2 py-2">
            <div className="mb-1 text-arch-muted">按应用聚合</div>
            <div className="flex flex-wrap gap-2">
              {[...byApp.entries()].map(([appId, info]) => {
                const mem = appMemory(appId);
                return (
                  <div
                    key={appId}
                    className="rounded border border-arch-border bg-arch-panel px-2 py-1 font-mono"
                  >
                    <span className="text-arch-accent">{appId}</span>
                    <span className="text-arch-muted"> ×{info.count}</span>
                    <span className="ml-2 text-arch-text">
                      {fmtBytes(mem.value)}
                    </span>
                    <span className="ml-1 text-arch-muted">
                      {mem.estimated ? '估算' : ''}
                    </span>
                  </div>
                );
              })}
              {byApp.size === 0 && (
                <span className="text-arch-muted">当前没有打开的窗口</span>
              )}
            </div>
          </div>
        </div>
      ) : (
        <div className="min-h-0 flex-1 overflow-y-auto p-2">
          <div className="mb-2 text-arch-muted">
            这是模拟的包管理：卸载只是让应用从启动器消失，重新安装即可恢复，不会真正删除代码。
          </div>
          <table className="w-full border-collapse">
            <thead className="bg-arch-panel text-arch-muted">
              <tr className="text-left">
                <Th>应用</Th>
                <Th>说明</Th>
                <Th>状态</Th>
                <Th className="text-right">操作</Th>
              </tr>
            </thead>
            <tbody>
              {APPS.map((app) => {
                const installed = isInstalled(app.id);
                return (
                  <tr
                    key={app.id}
                    className="border-b border-arch-border/60"
                  >
                    <Td className="font-mono text-arch-accent">{app.id}</Td>
                    <Td className="text-arch-muted">{app.description}</Td>
                    <Td>
                      <span
                        className={cn(
                          installed ? 'text-arch-green' : 'text-arch-red',
                        )}
                      >
                        {installed ? '已安装' : '已卸载'}
                      </span>
                    </Td>
                    <Td>
                      <div className="flex justify-end">
                        {installed ? (
                          <button
                            type="button"
                            onClick={() => doRemove(app.id, app.name)}
                            className="rounded border border-arch-border px-2 py-0.5 text-arch-red hover:bg-arch-border"
                          >
                            卸载
                          </button>
                        ) : (
                          <button
                            type="button"
                            onClick={() => doInstall(app.id, app.name)}
                            className="flex items-center gap-1 rounded border border-arch-border px-2 py-0.5 text-arch-green hover:bg-arch-border"
                          >
                            <Package size={12} />
                            重新安装
                          </button>
                        )}
                      </div>
                    </Td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function Stat({
  icon,
  label,
  value,
  tone,
}: {
  icon: ReactNode;
  label: string;
  value: string;
  tone: 'green' | 'accent' | 'red' | 'muted';
}) {
  const color =
    tone === 'green'
      ? 'text-arch-green'
      : tone === 'red'
        ? 'text-arch-red'
        : tone === 'accent'
          ? 'text-arch-accent'
          : 'text-arch-muted';
  return (
    <div className="flex items-center gap-2 bg-arch-bg px-3 py-2">
      <span className="text-arch-muted">{icon}</span>
      <div className="leading-tight">
        <div className="text-arch-muted">{label}</div>
        <div className={cn('font-mono text-sm', color)}>{value}</div>
      </div>
    </div>
  );
}

function TabBtn({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'rounded px-3 py-1',
        active ? 'bg-arch-accent text-white' : 'text-arch-muted hover:bg-arch-panel',
      )}
    >
      {children}
    </button>
  );
}

function Th({
  children,
  className,
}: {
  children?: ReactNode;
  className?: string;
}) {
  return (
    <th className={cn('px-3 py-1 font-normal', className)}>{children}</th>
  );
}

function Td({
  children,
  className,
  title,
}: {
  children?: ReactNode;
  className?: string;
  title?: string;
}) {
  return (
    <td className={cn('px-3 py-1', className)} title={title}>
      {children}
    </td>
  );
}

function IconBtn({
  title,
  onClick,
  danger,
  children,
}: {
  title: string;
  onClick: () => void;
  danger?: boolean;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      className={cn(
        'rounded border border-arch-border p-1 hover:bg-arch-border',
        danger ? 'text-arch-red' : 'text-arch-muted',
      )}
    >
      {children}
    </button>
  );
}
