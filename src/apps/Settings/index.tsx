import { useEffect, useMemo, useState } from 'react';
import {
  AppWindow,
  Bell,
  CheckCircle2,
  Cpu,
  HardDrive,
  ImageUp,
  LayoutGrid,
  Monitor,
  Moon,
  Package,
  Palette,
  RotateCcw,
  Shield,
  Sparkles,
  Sun,
  Trash2,
} from 'lucide-react';
import { cn } from '@/lib/cn';
import { APPS } from '@/apps/registry';
import { useOSStore, type DesktopSettings } from '@/stores/useOSStore';
import { useNotifyStore, notify } from '@/stores/useNotifyStore';
import { usePackageStore } from '@/stores/usePackageStore';
import { useWindowStore } from '@/stores/useWindowStore';
import { vfs } from '@/services/filesystem';
import type { AppProps } from '@/shell/types';

const WALLPAPERS = [
  { id: 'grid', label: '默认网格', url: '/wallpapers/grid.svg' },
  { id: 'arch', label: 'Arch Blue', url: '/wallpapers/arch.svg' },
  { id: 'dots', label: '暗夜点阵', url: '/wallpapers/dots.svg' },
  { id: 'aurora', label: '极光', url: '/wallpapers/aurora.svg' },
];

const ACCENTS = [
  { name: 'Arch 蓝', value: '#1793d1' },
  { name: '薄荷', value: '#4ec9b0' },
  { name: '珊瑚', value: '#e06c75' },
  { name: '紫罗兰', value: '#c678dd' },
  { name: '琥珀', value: '#d19a66' },
  { name: '天青', value: '#61afef' },
  { name: '桃红', value: '#e84393' },
];

type Tab = 'desktop' | 'appearance' | 'window' | 'system' | 'apps';

const TABS: Array<{ id: Tab; label: string; Icon: typeof Monitor }> = [
  { id: 'desktop', label: '桌面', Icon: Monitor },
  { id: 'appearance', label: '外观', Icon: Palette },
  { id: 'window', label: '窗口', Icon: AppWindow },
  { id: 'system', label: '系统', Icon: Shield },
  { id: 'apps', label: '应用', Icon: Package },
];

function Row({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="mb-3">
      <div className="mb-1 text-xs">{label}</div>
      {children}
      {hint && <div className="mt-1 text-[11px] text-arch-muted">{hint}</div>}
    </div>
  );
}

function Switch({
  label,
  checked,
  onChange,
  hint,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  hint?: string;
}) {
  return (
    <label className="mb-2 flex cursor-pointer items-start justify-between gap-3">
      <span>
        <span className="block text-xs">{label}</span>
        {hint && <span className="block text-[11px] text-arch-muted">{hint}</span>}
      </span>
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="mt-0.5 accent-[var(--color-arch-accent)]"
      />
    </label>
  );
}

export default function Settings({ context }: AppProps) {
  const settings = useOSStore((s) => s.settings);
  const update = useOSStore((s) => s.updateSettings);
  const lock = useOSStore((s) => s.lock);
  const disabled = usePackageStore((s) => s.disabled);
  const install = usePackageStore((s) => s.install);
  const remove = usePackageStore((s) => s.remove);
  const resetAll = usePackageStore((s) => s.resetAll);
  const notifyCount = useNotifyStore((s) => s.items.length);
  const windowCount = useWindowStore((s) => s.windows.length);

  const [tab, setTab] = useState<Tab>('desktop');
  const [uploadMsg, setUploadMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [storage, setStorage] = useState<string>('读取中…');
  const [fsUsage, setFsUsage] = useState<{ files: number; bytes: number } | null>(null);
  const [backend, setBackend] = useState<string>('—');
  const [appQuery, setAppQuery] = useState('');

  const isPreset = WALLPAPERS.some((w) => w.url === settings.wallpaper);
  const isCustom = !isPreset;

  useEffect(() => {
    context.setTitle('设置');
  }, [context]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const est = await navigator.storage?.estimate?.();
        if (!cancelled && est) {
          const used = (est.usage ?? 0) / 1024 / 1024;
          const quota = (est.quota ?? 0) / 1024 / 1024;
          setStorage(
            `${used.toFixed(2)} MB / ${quota >= 1024 ? `${(quota / 1024).toFixed(1)} GB` : `${quota.toFixed(0)} MB`}`,
          );
        } else if (!cancelled) {
          setStorage('浏览器不支持 storage.estimate');
        }
      } catch {
        if (!cancelled) setStorage('读取失败');
      }
      try {
        const u = await vfs.usage();
        if (!cancelled) setFsUsage(u);
      } catch {
        if (!cancelled) setFsUsage(null);
      }
      try {
        const b = await vfs.backend();
        if (!cancelled) setBackend(b);
      } catch {
        if (!cancelled) setBackend('—');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const handleFile = async (file: File | null) => {
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      setUploadMsg({ ok: false, text: '请选择图片文件' });
      return;
    }
    const MAX = 1.5 * 1024 * 1024;
    if (file.size > MAX) {
      setUploadMsg({ ok: false, text: '图片超过 1.5MB，请压缩后再上传' });
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = String(reader.result || '');
      try {
        update({ wallpaper: dataUrl });
        setUploadMsg({ ok: true, text: `已应用 ${file.name}` });
      } catch {
        setUploadMsg({ ok: false, text: '保存失败（存储已满）' });
      }
    };
    reader.onerror = () => setUploadMsg({ ok: false, text: '读取失败' });
    reader.readAsDataURL(file);
  };

  const filteredApps = useMemo(() => {
    const q = appQuery.trim().toLowerCase();
    return APPS.filter(
      (a) =>
        !q ||
        a.name.toLowerCase().includes(q) ||
        a.id.includes(q) ||
        a.description.toLowerCase().includes(q),
    );
  }, [appQuery]);

  const DEFAULTS: DesktopSettings = {
    wallpaper: '/wallpapers/grid.svg',
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
  };

  return (
    <div className="flex h-full bg-arch-bg text-arch-text">
      <nav className="w-40 shrink-0 border-r border-arch-border bg-arch-panel/60 p-2 text-sm">
        {TABS.map(({ id, label, Icon }) => (
          <button
            key={id}
            type="button"
            onClick={() => setTab(id)}
            className={cn(
              'flex w-full items-center gap-2 rounded px-3 py-2 text-left transition',
              tab === id
                ? 'bg-arch-accent/15 text-arch-accent'
                : 'text-arch-text hover:bg-white/5',
            )}
          >
            <Icon size={14} /> {label}
          </button>
        ))}
        <div className="mt-3 border-t border-arch-border px-3 pt-3 text-[10px] leading-relaxed text-arch-muted">
          {windowCount} 个窗口
          <br />
          {notifyCount} 条通知
          <br />
          {disabled.length} 个已卸载
        </div>
      </nav>

      <div className="flex-1 overflow-auto p-5 text-sm">
        {/* ------------------------------ 桌面 ------------------------------ */}
        {tab === 'desktop' && (
          <>
            <section className="mb-6">
              <h3 className="mb-2 text-xs uppercase tracking-wider text-arch-muted">壁纸</h3>
              <div className="grid grid-cols-4 gap-2">
                {WALLPAPERS.map((w) => {
                  const active = settings.wallpaper === w.url;
                  return (
                    <button
                      key={w.id}
                      type="button"
                      onClick={() => {
                        update({ wallpaper: w.url });
                        setUploadMsg(null);
                      }}
                      className={cn(
                        'overflow-hidden rounded-lg border-2 transition',
                        active
                          ? 'border-arch-accent'
                          : 'border-transparent hover:border-arch-border',
                      )}
                    >
                      <div
                        className="h-16 w-full bg-cover bg-center"
                        style={{ backgroundImage: `url(${w.url})` }}
                      />
                      <div className="bg-black/40 py-1 text-[11px]">{w.label}</div>
                    </button>
                  );
                })}

                <label
                  className={cn(
                    'flex h-16 cursor-pointer items-center justify-center gap-1 rounded-lg border-2 border-dashed transition',
                    isCustom
                      ? 'border-arch-accent bg-arch-accent/10 text-arch-accent'
                      : 'border-arch-border/60 text-arch-muted hover:border-arch-border hover:text-arch-text',
                  )}
                  title="上传自己的图片（≤1.5MB）"
                >
                  <ImageUp size={18} />
                  <span className="text-[11px]">上传</span>
                  <input
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={(e) => handleFile(e.target.files?.[0] ?? null)}
                  />
                </label>
              </div>

              {isCustom && (
                <div className="mt-2 flex items-center gap-2 text-[11px]">
                  <div
                    className="h-8 w-14 rounded border border-arch-border bg-cover bg-center"
                    style={{ backgroundImage: `url(${settings.wallpaper})` }}
                  />
                  <span className="flex-1 text-arch-muted">已应用自定义图片</span>
                  <button
                    type="button"
                    onClick={() => {
                      update({ wallpaper: DEFAULTS.wallpaper });
                      setUploadMsg({ ok: true, text: '已恢复默认壁纸' });
                    }}
                    className="flex items-center gap-1 rounded border border-arch-border px-2 py-1 hover:bg-white/10"
                  >
                    <Trash2 size={11} /> 清除
                  </button>
                </div>
              )}

              {uploadMsg && (
                <div
                  className={cn(
                    'mt-2 text-[11px]',
                    uploadMsg.ok ? 'text-arch-green' : 'text-arch-red',
                  )}
                >
                  {uploadMsg.text}
                </div>
              )}
            </section>

            <section>
              <h3 className="mb-2 text-xs uppercase tracking-wider text-arch-muted">
                <LayoutGrid size={12} className="mr-1 inline" />
                桌面图标
              </h3>
              <Switch
                label="平铺全部应用"
                checked={settings.desktopAllApps}
                onChange={(v) => update({ desktopAllApps: v })}
                hint="关掉时桌面只放前 6 个应用，其余走启动器 / 命令面板"
              />
              <Row label={`图标尺寸 · ${settings.desktopIconSize}px`}>
                <input
                  type="range"
                  min={32}
                  max={72}
                  step={4}
                  value={settings.desktopIconSize}
                  onChange={(e) => update({ desktopIconSize: Number(e.target.value) })}
                  className="w-full accent-[var(--color-arch-accent)]"
                />
              </Row>
            </section>
          </>
        )}

        {/* ------------------------------ 外观 ------------------------------ */}
        {tab === 'appearance' && (
          <>
            <section className="mb-6">
              <h3 className="mb-2 text-xs uppercase tracking-wider text-arch-muted">主题</h3>
              <div className="mb-4 flex gap-2">
                <button
                  type="button"
                  onClick={() => update({ darkMode: true })}
                  className={cn(
                    'flex flex-1 items-center justify-center gap-1.5 rounded border px-3 py-2 transition',
                    settings.darkMode
                      ? 'border-arch-accent bg-arch-accent/20'
                      : 'border-arch-border text-arch-muted hover:bg-white/5',
                  )}
                >
                  <Moon size={13} /> 暗色
                </button>
                <button
                  type="button"
                  onClick={() => update({ darkMode: false })}
                  className={cn(
                    'flex flex-1 items-center justify-center gap-1.5 rounded border px-3 py-2 transition',
                    !settings.darkMode
                      ? 'border-arch-accent bg-arch-accent/20'
                      : 'border-arch-border text-arch-muted hover:bg-white/5',
                  )}
                >
                  <Sun size={13} /> 亮色
                </button>
              </div>

              <h3 className="mb-2 text-xs uppercase tracking-wider text-arch-muted">强调色</h3>
              <div className="flex flex-wrap gap-2">
                {ACCENTS.map((a) => (
                  <button
                    key={a.value}
                    type="button"
                    title={a.name}
                    onClick={() => update({ accentColor: a.value })}
                    className={cn(
                      'flex items-center gap-2 rounded border px-2 py-1 text-[11px] transition',
                      settings.accentColor.toLowerCase() === a.value.toLowerCase()
                        ? 'border-arch-accent bg-arch-accent/15 text-arch-text'
                        : 'border-arch-border text-arch-muted hover:bg-white/5',
                    )}
                  >
                    <span
                      className="h-3.5 w-3.5 rounded-full border border-black/30"
                      style={{ background: a.value }}
                    />
                    {a.name}
                  </button>
                ))}
                <label className="flex items-center gap-1.5 rounded border border-arch-border px-2 py-1 text-[11px] text-arch-muted">
                  自定义
                  <input
                    type="color"
                    value={settings.accentColor}
                    onChange={(e) => update({ accentColor: e.target.value })}
                    className="h-5 w-6 cursor-pointer border-0 bg-transparent p-0"
                  />
                </label>
              </div>
            </section>

            <section>
              <h3 className="mb-2 text-xs uppercase tracking-wider text-arch-muted">动效</h3>
              <Switch
                label="窗口与应用动画"
                checked={settings.animations}
                onChange={(v) => update({ animations: v })}
                hint="关掉后窗口弹出、通知滑入等过渡会立即完成（低性能设备更流畅）"
              />
              <Switch
                label="顶栏时钟显示秒"
                checked={settings.clockSeconds}
                onChange={(v) => update({ clockSeconds: v })}
              />
            </section>
          </>
        )}

        {/* ------------------------------ 窗口 ------------------------------ */}
        {tab === 'window' && (
          <>
            <section className="mb-6">
              <h3 className="mb-2 text-xs uppercase tracking-wider text-arch-muted">外观</h3>
              <Row
                label={`背景不透明度 · ${(settings.windowOpacity * 100).toFixed(0)}%`}
                hint="影响所有窗口面板的透明程度"
              >
                <input
                  type="range"
                  min={0.5}
                  max={1}
                  step={0.02}
                  value={settings.windowOpacity}
                  onChange={(e) => update({ windowOpacity: Number(e.target.value) })}
                  className="w-full accent-[var(--color-arch-accent)]"
                />
              </Row>
              <Row label={`Dock 尺寸 · ${settings.dockSize}px`}>
                <input
                  type="range"
                  min={40}
                  max={80}
                  step={4}
                  value={settings.dockSize}
                  onChange={(e) => update({ dockSize: Number(e.target.value) })}
                  className="w-full accent-[var(--color-arch-accent)]"
                />
              </Row>
            </section>

            <section>
              <h3 className="mb-2 text-xs uppercase tracking-wider text-arch-muted">行为</h3>
              <Switch
                label="边缘吸附"
                checked={settings.edgeSnap}
                onChange={(v) => update({ edgeSnap: v })}
                hint="把窗口拖到屏幕左/右边缘贴成半屏，拖到顶部最大化"
              />
              <div className="mt-3 flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => {
                    const st = useWindowStore.getState();
                    st.windows.forEach((w) => st.close(w.id));
                    notify('已关闭全部窗口', undefined, 'success');
                  }}
                  className="rounded border border-arch-border px-2 py-1 text-[11px] hover:bg-white/10"
                >
                  关闭全部窗口
                </button>
                <button
                  type="button"
                  onClick={() => {
                    const st = useWindowStore.getState();
                    st.windows.forEach((w) => st.minimize(w.id));
                  }}
                  className="rounded border border-arch-border px-2 py-1 text-[11px] hover:bg-white/10"
                >
                  最小化全部
                </button>
              </div>
            </section>
          </>
        )}

        {/* ------------------------------ 系统 ------------------------------ */}
        {tab === 'system' && (
          <>
            <section className="mb-6">
              <h3 className="mb-2 text-xs uppercase tracking-wider text-arch-muted">安全</h3>
              <Row label="无操作自动锁屏（分钟）" hint="设为 0 表示不自动锁屏">
                <div className="flex items-center gap-2">
                  <input
                    type="number"
                    min={0}
                    max={120}
                    value={settings.autoLockMinutes}
                    onChange={(e) =>
                      update({ autoLockMinutes: Math.max(0, Number(e.target.value)) })
                    }
                    className="w-24 rounded border border-arch-border bg-black/30 px-2 py-1 text-xs"
                  />
                  <button
                    type="button"
                    onClick={lock}
                    className="rounded border border-arch-border px-2 py-1 text-[11px] hover:bg-white/10"
                  >
                    立即锁屏
                  </button>
                </div>
              </Row>
            </section>

            <section className="mb-6">
              <h3 className="mb-2 text-xs uppercase tracking-wider text-arch-muted">
                <HardDrive size={12} className="mr-1 inline" />
                存储
              </h3>
              <dl className="space-y-1 text-[11px]">
                <div className="flex justify-between border-b border-arch-border/50 pb-1">
                  <dt className="text-arch-muted">存储后端</dt>
                  <dd>{backend === 'opfs' ? 'OPFS（文件系统 API）' : backend === 'idb' ? 'IndexedDB（降级）' : backend}</dd>
                </div>
                <div className="flex justify-between border-b border-arch-border/50 pb-1">
                  <dt className="text-arch-muted">浏览器配额</dt>
                  <dd className="tabular-nums">{storage}</dd>
                </div>
                <div className="flex justify-between border-b border-arch-border/50 pb-1">
                  <dt className="text-arch-muted">虚拟磁盘文件数</dt>
                  <dd className="tabular-nums">{fsUsage ? fsUsage.files : '—'}</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-arch-muted">虚拟磁盘占用</dt>
                  <dd className="tabular-nums">
                    {fsUsage ? `${(fsUsage.bytes / 1024).toFixed(1)} KB` : '—'}
                  </dd>
                </div>
              </dl>
            </section>

            <section className="mb-6">
              <h3 className="mb-2 text-xs uppercase tracking-wider text-arch-muted">
                <Cpu size={12} className="mr-1 inline" />
                运行时
              </h3>
              <p className="text-[11px] leading-relaxed text-arch-muted">
                逻辑核心 {navigator.hardwareConcurrency ?? '未知'} · 视口{' '}
                {window.innerWidth}×{window.innerHeight} · 设备像素比{' '}
                {window.devicePixelRatio}
                <br />
                窗口 ID：{context.windowId}
              </p>
            </section>

            <section className="mb-6">
              <h3 className="mb-2 text-xs uppercase tracking-wider text-arch-muted">通知</h3>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => {
                    notify('测试通知', '这是一条来自设置应用的通知', 'info');
                  }}
                  className="flex items-center gap-1 rounded border border-arch-border px-2 py-1 text-[11px] hover:bg-white/10"
                >
                  <Bell size={11} /> 发一条测试通知
                </button>
                <button
                  type="button"
                  onClick={() => {
                    useNotifyStore.getState().clear();
                  }}
                  className="rounded border border-arch-border px-2 py-1 text-[11px] hover:bg-white/10"
                >
                  清空（{notifyCount}）
                </button>
              </div>
            </section>

            <section className="border-t border-arch-border pt-3">
              <h3 className="mb-2 text-xs uppercase tracking-wider text-arch-muted">重置</h3>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => {
                    update(DEFAULTS);
                    notify('外观设置已恢复默认', undefined, 'success');
                  }}
                  className="flex items-center gap-1 rounded border border-arch-border px-2 py-1 text-[11px] hover:bg-white/10"
                >
                  <RotateCcw size={11} /> 恢复默认外观
                </button>
                <button
                  type="button"
                  onClick={() => {
                    resetAll();
                    notify('已重新安装全部应用', undefined, 'success');
                  }}
                  className="flex items-center gap-1 rounded border border-arch-border px-2 py-1 text-[11px] hover:bg-white/10"
                >
                  <Package size={11} /> 重装全部应用
                </button>
                <button
                  type="button"
                  onClick={() => {
                    if (!window.confirm('清空通知历史？')) return;
                    useNotifyStore.getState().clear();
                  }}
                  className="rounded border border-arch-border px-2 py-1 text-[11px] hover:bg-white/10"
                >
                  清空通知
                </button>
              </div>
              <p className="mt-2 text-[11px] text-arch-muted">
                注意：重置外观不会动虚拟磁盘里的文件。要清文件请用「存储分析」应用。
              </p>
            </section>

            <section className="mt-6 flex items-center gap-2 border-t border-arch-border pt-3 text-[11px] text-arch-muted">
              <Sparkles size={12} className="text-arch-accent" />
              Arch Web OS v2 · 在浏览器里运行 Arch Linux
            </section>
          </>
        )}

        {/* ------------------------------ 应用 ------------------------------ */}
        {tab === 'apps' && (
          <>
            <section className="mb-4">
              <h3 className="mb-2 text-xs uppercase tracking-wider text-arch-muted">
                <Package size={12} className="mr-1 inline" />
                软件包管理（模拟）
              </h3>
              <p className="mb-3 text-[11px] leading-relaxed text-arch-muted">
                这里的「卸载」等价于把它从启动器和桌面上隐藏，代码仍在包里。
                也可以在终端里用
                <code className="mx-1 rounded bg-black/30 px-1">pacman -R 包名</code>
                操作。
              </p>
              <div className="mb-3 flex items-center gap-2">
                <input
                  value={appQuery}
                  onChange={(e) => setAppQuery(e.target.value)}
                  placeholder="搜索应用…"
                  className="flex-1 rounded border border-arch-border bg-black/30 px-2 py-1 text-xs outline-none focus:border-arch-accent"
                />
                <span className="text-[11px] text-arch-muted">
                  {APPS.length - disabled.length}/{APPS.length} 已安装
                </span>
              </div>
            </section>

            <div className="space-y-1">
              {filteredApps.map((app) => {
                const Icon = app.icon;
                const installed = !disabled.includes(app.id);
                return (
                  <div
                    key={app.id}
                    className="flex items-center gap-3 rounded border border-arch-border/60 px-2.5 py-2"
                  >
                    <span
                      className="flex h-7 w-7 shrink-0 items-center justify-center rounded"
                      style={{ background: `${app.accent ?? '#1793d1'}33` }}
                    >
                      <Icon size={15} style={{ color: app.accent ?? '#1793d1' }} />
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="text-[12.5px]">{app.name}</span>
                        <span className="rounded bg-white/5 px-1 text-[10px] text-arch-muted">
                          {app.category}
                        </span>
                        <code className="text-[10px] text-arch-muted">{app.id}</code>
                        {installed && (
                          <CheckCircle2 size={11} className="text-arch-green" />
                        )}
                      </div>
                      <p className="truncate text-[11px] text-arch-muted">
                        {app.description}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        if (installed) {
                          remove(app.id);
                          notify('已卸载', app.name, 'warn');
                        } else {
                          install(app.id);
                          notify('已安装', app.name, 'success');
                        }
                      }}
                      className={cn(
                        'shrink-0 rounded border px-2 py-1 text-[11px] transition',
                        installed
                          ? 'border-arch-border text-arch-muted hover:border-arch-red hover:text-arch-red'
                          : 'border-arch-accent bg-arch-accent/15 text-arch-accent hover:bg-arch-accent/25',
                      )}
                    >
                      {installed ? '卸载' : '安装'}
                    </button>
                  </div>
                );
              })}
              {filteredApps.length === 0 && (
                <p className="py-8 text-center text-[11px] text-arch-muted">
                  没有匹配的应用
                </p>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
