import { useEffect, useMemo, useRef, useState } from 'react';
import {
  AppWindow,
  Calculator as CalcIcon,
  CornerDownLeft,
  FileText,
  FolderTree,
  Moon,
  Power,
  RotateCcw,
  Search,
  Settings as SettingsIcon,
  Sparkles,
  Sun,
  Trash2,
  Volume2,
  VolumeX,
} from 'lucide-react';
import { cn } from '@/lib/cn';
import { tryEval } from '@/lib/expr';
import { APPS, getApp } from '@/apps/registry';
import { useOSStore } from '@/stores/useOSStore';
import { useWindowStore } from '@/stores/useWindowStore';
import { useMediaStore } from '@/stores/useMediaStore';
import { useNotifyStore, notify } from '@/stores/useNotifyStore';
import { usePackageStore } from '@/stores/usePackageStore';
import { vfs } from '@/services/filesystem';

interface Item {
  id: string;
  section: '计算' | '应用' | '文件' | '系统';
  title: string;
  subtitle?: string;
  icon: typeof Search;
  run: () => void;
}

const WALLPAPERS = [
  `${import.meta.env.BASE_URL}/wallpapers/grid.svg`,
  `${import.meta.env.BASE_URL}/wallpapers/arch.svg`,
  `${import.meta.env.BASE_URL}/wallpapers/aurora.svg`,
  `${import.meta.env.BASE_URL}/wallpapers/dots.svg`,
];

/** 子序列匹配：query 的字符按顺序出现在 text 里即算命中，返回得分（越小越靠前） */
function fuzzyScore(text: string, query: string): number | null {
  const t = text.toLowerCase();
  const q = query.toLowerCase();
  if (!q) return 0;
  let ti = 0;
  let score = 0;
  let streak = 0;
  for (const ch of q) {
    const found = t.indexOf(ch, ti);
    if (found === -1) return null;
    // 连续命中和词首命中加分（分数更低）
    streak = found === ti ? streak + 1 : 0;
    score += found - ti + 1 - Math.min(streak, 3);
    ti = found + 1;
  }
  return score + text.length * 0.01;
}

export default function CommandPalette() {
  const open = useOSStore((s) => s.paletteOpen);
  const [query, setQuery] = useState('');
  const [cursor, setCursor] = useState(0);
  const [files, setFiles] = useState<string[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  // 打开时重置并加载文件索引
  useEffect(() => {
    if (!open) return;
    setQuery('');
    setCursor(0);
    const t = setTimeout(() => inputRef.current?.focus(), 20);
    let cancelled = false;
    void (async () => {
      try {
        const all = await vfs.listAll();
        if (!cancelled) setFiles(all.map((n) => n.path));
      } catch {
        if (!cancelled) setFiles([]);
      }
    })();
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [open]);

  const items = useMemo<Item[]>(() => {
    const q = query.trim();
    const out: Item[] = [];

    /* ---------- 内联计算 ---------- */
    const calc = tryEval(q);
    if (calc !== null) {
      out.push({
        id: 'calc',
        section: '计算',
        title: `${q} = ${calc}`,
        subtitle: '回车复制结果',
        icon: CalcIcon,
        run: () => {
          void navigator.clipboard?.writeText(String(calc)).then(
            () => notify('已复制计算结果', String(calc), 'success'),
            () => notify('复制失败', '浏览器拒绝了剪贴板写入', 'warn'),
          );
        },
      });
    }

    /* ---------- 应用 ---------- */
    const installed = APPS.filter((a) =>
      usePackageStore.getState().isInstalled(a.id),
    );
    for (const app of installed) {
      const s = fuzzyScore(`${app.name} ${app.id} ${app.description}`, q);
      if (s === null) continue;
      out.push({
        id: `app:${app.id}`,
        section: '应用',
        title: app.name,
        subtitle: app.description,
        icon: app.icon,
        run: () => {
          useWindowStore.getState().open({
            appId: app.id,
            title: app.name,
            width: app.defaultWidth,
            height: app.defaultHeight,
            singleton: app.singleton,
          });
        },
      });
    }

    /* ---------- 文件 ---------- */
    if (q.length >= 1 || files.length <= 40) {
      for (const path of files) {
        const s = fuzzyScore(path, q);
        if (s === null) continue;
        out.push({
          id: `file:${path}`,
          section: '文件',
          title: path.slice(path.lastIndexOf('/') + 1),
          subtitle: path,
          icon: path.endsWith('.md') ? FileText : FileText,
          run: () => {
            const app = getApp('notepad');
            if (!app) return;
            useWindowStore.getState().open({
              appId: app.id,
              title: `${path} — 记事本`,
              width: app.defaultWidth,
              height: app.defaultHeight,
            });
            // 记事本默认打开 welcome.txt，这里把目标路径塞进剪贴板式的提示
            notify('在记事本里打开', path, 'info');
          },
        });
        if (out.filter((i) => i.section === '文件').length >= 8) break;
      }
    }

    /* ---------- 系统操作 ---------- */
    const sys = useOSStore.getState();
    const os = sys.settings;
    const actions: Array<{ key: string; title: string; sub: string; icon: typeof Search; run: () => void }> = [
      {
        key: 'lock',
        title: '锁屏',
        sub: 'Ctrl+L',
        icon: Moon,
        run: () => sys.lock(),
      },
      {
        key: 'notify',
        title: '清空通知',
        sub: `${useNotifyStore.getState().items.length} 条`,
        icon: Trash2,
        run: () => {
          useNotifyStore.getState().clear();
          notify('通知已清空', undefined, 'success');
        },
      },
      {
        key: 'theme',
        title: os.darkMode ? '切换到亮色主题' : '切换到暗色主题',
        sub: '外观',
        icon: os.darkMode ? Sun : Moon,
        run: () => sys.updateSettings({ darkMode: !os.darkMode }),
      },
      {
        key: 'wp',
        title: '换一张壁纸',
        sub: '循环切换 4 张',
        icon: Sparkles,
        run: () => {
          const i = WALLPAPERS.indexOf(os.wallpaper);
          sys.updateSettings({ wallpaper: WALLPAPERS[(i + 1) % WALLPAPERS.length] });
        },
      },
      {
        key: 'mute',
        title: useMediaStore.getState().muted ? '取消静音' : '静音',
        sub: '媒体',
        icon: useMediaStore.getState().muted ? Volume2 : VolumeX,
        run: () => useMediaStore.getState().toggleMute(),
      },
      {
        key: 'settings',
        title: '打开系统设置',
        sub: '外观 / 窗口 / 存储',
        icon: SettingsIcon,
        run: () => {
          const app = getApp('settings');
          if (app)
            useWindowStore.getState().open({
              appId: app.id,
              title: app.name,
              width: app.defaultWidth,
              height: app.defaultHeight,
              singleton: app.singleton,
            });
        },
      },
      {
        key: 'files',
        title: '打开文件管理器',
        sub: '浏览虚拟磁盘',
        icon: FolderTree,
        run: () => {
          const app = getApp('files');
          if (app)
            useWindowStore.getState().open({
              appId: app.id,
              title: app.name,
              width: app.defaultWidth,
              height: app.defaultHeight,
            });
        },
      },
      {
        key: 'tiling',
        title: '平铺/层叠所有窗口',
        sub: '整理桌面',
        icon: AppWindow,
        run: () => {
          const st = useWindowStore.getState();
          const wins = st.windows.filter((w) => !w.minimized);
          if (wins.length === 0) return;
          const gap = 12;
          const cols = Math.ceil(Math.sqrt(wins.length));
          const rows = Math.ceil(wins.length / cols);
          const vw = window.innerWidth;
          const vh = window.innerHeight - 28;
          const cw = Math.max(320, Math.floor((vw - gap * (cols + 1)) / cols));
          const ch = Math.max(220, Math.floor((vh - gap * (rows + 1)) / rows));
          wins.forEach((w, i) => {
            const r = Math.floor(i / cols);
            const c = i % cols;
            st.setGeometry(w.id, {
              x: gap + c * (cw + gap),
              y: 28 + gap + r * (ch + gap),
              width: cw,
              height: ch,
            });
            st.restore(w.id);
          });
          notify('已平铺窗口', `${wins.length} 个窗口`, 'success');
        },
      },
      {
        key: 'restart',
        title: '重启',
        sub: '重新走一遍开机流程',
        icon: RotateCcw,
        run: () => sys.restart(),
      },
      {
        key: 'poweroff',
        title: '关机',
        sub: '关闭桌面',
        icon: Power,
        run: () => sys.shutdown(),
      },
    ];

    for (const a of actions) {
      const s = fuzzyScore(`${a.title} ${a.sub}`, q);
      if (s === null) continue;
      out.push({
        id: `sys:${a.key}`,
        section: '系统',
        title: a.title,
        subtitle: a.sub,
        icon: a.icon,
        run: a.run,
      });
    }

    // 有查询时按匹配度排序，没查询时保持「应用在前」的分组顺序
    if (q) {
      const order: Record<Item['section'], number> = {
        计算: 0,
        应用: 1,
        文件: 2,
        系统: 3,
      };
      out.sort((a, b) => {
        const sa = fuzzyScore(a.title, q) ?? 99;
        const sb = fuzzyScore(b.title, q) ?? 99;
        if (Math.abs(sa - sb) > 0.5) return sa - sb;
        return order[a.section] - order[b.section];
      });
    }

    return out.slice(0, 40);
  }, [query, files, open]);

  const grouped = useMemo(() => {
    const map = new Map<Item['section'], Item[]>();
    for (const it of items) {
      const arr = map.get(it.section) ?? [];
      arr.push(it);
      map.set(it.section, arr);
    }
    return [...map.entries()];
  }, [items]);

  // cursor 落在 items 里的扁平下标
  const flat = items;

  useEffect(() => {
    setCursor((c) => Math.min(c, Math.max(flat.length - 1, 0)));
  }, [flat.length]);

  useEffect(() => {
    if (!open) return;
    const el = listRef.current?.querySelector<HTMLElement>(`[data-idx="${cursor}"]`);
    el?.scrollIntoView({ block: 'nearest' });
  }, [cursor, open]);

  if (!open) return null;

  const close = () => useOSStore.getState().togglePalette(false);

  const commit = (idx: number) => {
    const item = flat[idx];
    if (!item) return;
    close();
    // 让面板先关掉再执行，避免动作里又开窗造成闪烁
    setTimeout(() => item.run(), 0);
  };

  let runningIdx = -1;

  return (
    <div
      className="absolute inset-0 z-[7000] flex items-start justify-center bg-black/45 pt-[10vh] backdrop-blur-[2px]"
      onClick={close}
    >
      <div
        className="animate-pop-in w-[min(680px,92vw)] overflow-hidden rounded-xl border border-arch-border bg-arch-panel/97 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 border-b border-arch-border px-3 py-2.5">
          <Search size={15} className="shrink-0 text-arch-muted" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setCursor(0);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                e.preventDefault();
                close();
              } else if (e.key === 'ArrowDown') {
                e.preventDefault();
                setCursor((c) => Math.min(c + 1, flat.length - 1));
              } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                setCursor((c) => Math.max(c - 1, 0));
              } else if (e.key === 'Enter') {
                e.preventDefault();
                commit(cursor);
              }
            }}
            placeholder="搜索应用、文件，或直接输入算式…"
            className="flex-1 bg-transparent text-[13px] text-arch-text outline-none placeholder:text-arch-muted"
          />
          <kbd className="shrink-0 rounded border border-arch-border px-1.5 py-0.5 text-[10px] text-arch-muted">
            Esc
          </kbd>
        </div>

        <div ref={listRef} className="max-h-[52vh] overflow-y-auto py-1">
          {flat.length === 0 && (
            <p className="px-4 py-8 text-center text-[12px] text-arch-muted">
              没有匹配项
            </p>
          )}
          {grouped.map(([section, list]) => (
            <div key={section}>
              <p className="px-3 pb-1 pt-2 text-[10px] font-medium uppercase tracking-wider text-arch-muted">
                {section}
              </p>
              {list.map((item) => {
                runningIdx += 1;
                const idx = runningIdx;
                const Icon = item.icon;
                return (
                  <button
                    key={item.id}
                    type="button"
                    data-idx={idx}
                    onMouseEnter={() => setCursor(idx)}
                    onClick={() => commit(idx)}
                    className={cn(
                      'flex w-full items-center gap-2.5 px-3 py-1.5 text-left transition',
                      cursor === idx ? 'bg-arch-accent/20' : 'hover:bg-white/5',
                    )}
                  >
                    <Icon size={14} className="shrink-0 text-arch-muted" />
                    <span className="shrink-0 text-[12.5px] text-arch-text">
                      {item.title}
                    </span>
                    {item.subtitle && (
                      <span className="min-w-0 flex-1 truncate text-[11px] text-arch-muted">
                        {item.subtitle}
                      </span>
                    )}
                    {cursor === idx && (
                      <CornerDownLeft
                        size={12}
                        className="ml-auto shrink-0 text-arch-muted"
                      />
                    )}
                  </button>
                );
              })}
            </div>
          ))}
        </div>

        <div className="flex items-center gap-3 border-t border-arch-border px-3 py-1.5 text-[10px] text-arch-muted">
          <span>↑↓ 选择</span>
          <span>Enter 执行</span>
          <span>Ctrl+Shift+P 呼出</span>
          <span className="ml-auto">
            {APPS.filter((a) => usePackageStore.getState().isInstalled(a.id)).length} 个应用 ·{' '}
            {files.length} 个文件
          </span>
        </div>
      </div>
    </div>
  );
}
