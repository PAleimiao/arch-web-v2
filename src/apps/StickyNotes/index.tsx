import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Copy,
  Plus,
  Search,
  StickyNote,
  Trash2,
} from 'lucide-react';
import type { AppProps } from '@/shell/types';
import { cn } from '@/lib/cn';
import { vfs } from '@/services/filesystem';
import { notify } from '@/stores/useNotifyStore';

interface Note {
  id: string;
  title: string;
  body: string;
  color: string;
  pinned: boolean;
  createdAt: number;
  updatedAt: number;
}

const PATH = '/home/arch/notes/stickies.json';
const COLORS = [
  '#fde68a',
  '#bbf7d0',
  '#bfdbfe',
  '#fbcfe8',
  '#fed7aa',
  '#e9d5ff',
];

function defaultWelcome(): Note {
  const now = Date.now();
  return {
    id: `note-${now.toString(36)}`,
    title: '欢迎',
    body: '这是一张便签。\n左侧列表管理便签，右侧编辑。内容会自动保存到虚拟磁盘。',
    color: COLORS[0] ?? '#fde68a',
    pinned: false,
    createdAt: now,
    updatedAt: now,
  };
}

function fmtTime(ts: number): string {
  const d = new Date(ts);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

export default function StickyNotes(_: AppProps) {
  const [notes, setNotes] = useState<Note[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [loaded, setLoaded] = useState(false);

  const notesRef = useRef<Note[]>([]);
  notesRef.current = notes;
  const saveTimer = useRef<number | null>(null);

  const saveNow = useCallback(() => {
    try {
      void vfs.writeFile(PATH, JSON.stringify(notesRef.current));
    } catch (e) {
      notify('保存失败', String(e), 'error');
    }
  }, []);

  const scheduleSave = useCallback(() => {
    if (saveTimer.current !== null) window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => saveNow(), 600);
  }, [saveNow]);

  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const raw = await vfs.readFile(PATH);
        if (raw === null) {
          const welcome = [defaultWelcome()];
          if (alive) setNotes(welcome);
          try {
            await vfs.writeFile(PATH, JSON.stringify(welcome));
          } catch {
            /* 忽略初始写入失败 */
          }
        } else {
          const parsed = JSON.parse(raw) as Note[];
          if (alive) setNotes(Array.isArray(parsed) ? parsed : []);
        }
      } catch (e) {
        notify('便签加载失败', String(e), 'error');
        if (alive) setNotes([]);
      } finally {
        if (alive) setLoaded(true);
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  // 卸载时刷新未保存内容
  useEffect(
    () => () => {
      if (saveTimer.current !== null) window.clearTimeout(saveTimer.current);
      try {
        void vfs.writeFile(PATH, JSON.stringify(notesRef.current));
      } catch {
        /* 忽略 */
      }
    },
    [],
  );

  const updateNote = (id: string, patch: Partial<Note>) => {
    setNotes((prev) =>
      prev.map((n) => (n.id === id ? { ...n, ...patch, updatedAt: Date.now() } : n)),
    );
    scheduleSave();
  };

  const addNote = () => {
    const now = Date.now();
    const n: Note = {
      id: `note-${now.toString(36)}`,
      title: '新便签',
      body: '',
      color: COLORS[0] ?? '#fde68a',
      pinned: false,
      createdAt: now,
      updatedAt: now,
    };
    setNotes((prev) => [n, ...prev]);
    setSelectedId(n.id);
    scheduleSave();
  };

  const delNote = (id: string) => {
    setNotes((prev) => prev.filter((n) => n.id !== id));
    if (selectedId === id) setSelectedId(null);
    scheduleSave();
  };

  const dupNote = (id: string) => {
    setNotes((prev) => {
      const src = prev.find((n) => n.id === id);
      if (!src) return prev;
      const now = Date.now();
      const copy: Note = {
        ...src,
        id: `note-${now.toString(36)}`,
        title: `${src.title} 副本`,
        pinned: false,
        createdAt: now,
        updatedAt: now,
      };
      return [copy, ...prev];
    });
    scheduleSave();
  };

  const copyBody = async (text: string) => {
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
        notify('已复制', '便签正文已复制到剪贴板', 'success');
        return;
      }
      throw new Error('无 clipboard API');
    } catch (e) {
      notify('复制失败', String(e), 'error');
    }
  };

  const list = useMemo(() => {
    const q = query.trim().toLowerCase();
    const filtered = q
      ? notes.filter(
          (n) =>
            n.title.toLowerCase().includes(q) ||
            n.body.toLowerCase().includes(q),
        )
      : notes;
    return [...filtered].sort((a, b) => {
      if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
      return b.updatedAt - a.updatedAt;
    });
  }, [notes, query]);

  const selected = notes.find((n) => n.id === selectedId) ?? null;

  return (
    <div className="flex h-full flex-col bg-arch-bg text-arch-text text-[12px]">
      <div className="flex items-center gap-2 border-b border-arch-border px-2 py-1">
        <span className="flex items-center gap-1 text-arch-muted">
          <StickyNote size={13} />
          便签
        </span>
        <button
          type="button"
          onClick={addNote}
          className="flex items-center gap-1 rounded border border-arch-border px-2 py-0.5 text-arch-green hover:bg-arch-panel"
        >
          <Plus size={12} />
          新建
        </button>
        <span className="ml-auto text-arch-muted">{notes.length} 张</span>
      </div>

      <div className="grid min-h-0 flex-1 grid-cols-[180px_1fr]">
        {/* 左：列表 */}
        <div className="flex min-h-0 flex-col border-r border-arch-border">
          <div className="flex items-center gap-1 border-b border-arch-border px-2 py-1">
            <Search size={12} className="text-arch-muted" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="搜索便签"
              className="w-full bg-transparent py-1 outline-none placeholder:text-arch-muted"
            />
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto">
            {!loaded ? (
              <div className="p-3 text-arch-muted">加载中…</div>
            ) : list.length === 0 ? (
              <div className="p-3 text-center text-arch-muted">
                {notes.length === 0 ? '还没有便签，点“新建”创建' : '没有匹配的便签'}
              </div>
            ) : (
              list.map((n) => (
                <button
                  key={n.id}
                  type="button"
                  onClick={() => setSelectedId(n.id)}
                  className={cn(
                    'flex w-full flex-col gap-0.5 border-b border-arch-border/60 px-2 py-1 text-left hover:bg-arch-panel',
                    selectedId === n.id && 'bg-arch-accent/10',
                  )}
                >
                  <span className="flex items-center gap-1 truncate">
                    <span
                      className="inline-block h-2 w-2 shrink-0 rounded-full"
                      style={{ background: n.color }}
                    />
                    <span className="truncate">{n.title || '（无标题）'}</span>
                    {n.pinned && (
                      <span className="ml-auto shrink-0 text-arch-accent">置顶</span>
                    )}
                  </span>
                  <span className="truncate text-arch-muted">
                    {n.body.replace(/\n/g, ' ').slice(0, 24) || '（空）'}
                  </span>
                </button>
              ))
            )}
          </div>
        </div>

        {/* 右：编辑区 */}
        <div className="flex min-h-0 flex-col">
          {!selected ? (
            <div className="flex h-full items-center justify-center text-arch-muted">
              选择左侧便签进行编辑
            </div>
          ) : (
            <div className="flex min-h-0 flex-1 flex-col">
              <div className="flex items-center gap-2 border-b border-arch-border px-2 py-1">
                <input
                  value={selected.title}
                  onChange={(e) => updateNote(selected.id, { title: e.target.value })}
                  placeholder="标题"
                  className="flex-1 bg-transparent font-mono outline-none placeholder:text-arch-muted"
                />
                <button
                  type="button"
                  title="复制正文"
                  onClick={() => copyBody(selected.body)}
                  className="rounded border border-arch-border p-1 text-arch-muted hover:bg-arch-panel"
                >
                  <Copy size={12} />
                </button>
                <button
                  type="button"
                  title="复制便签"
                  onClick={() => dupNote(selected.id)}
                  className="rounded border border-arch-border px-2 py-1 text-arch-accent hover:bg-arch-panel"
                >
                  复制
                </button>
                <button
                  type="button"
                  title="删除便签"
                  onClick={() => delNote(selected.id)}
                  className="rounded border border-arch-border p-1 text-arch-red hover:bg-arch-panel"
                >
                  <Trash2 size={12} />
                </button>
              </div>

              <div className="flex items-center gap-2 border-b border-arch-border px-2 py-1">
                <span className="text-arch-muted">颜色</span>
                {COLORS.map((c) => (
                  <button
                    key={c}
                    type="button"
                    title={c}
                    onClick={() => updateNote(selected.id, { color: c })}
                    className={cn(
                      'h-4 w-4 rounded-full border',
                      selected.color === c
                        ? 'border-arch-text'
                        : 'border-arch-border',
                    )}
                    style={{ background: c }}
                  />
                ))}
                <button
                  type="button"
                  onClick={() =>
                    updateNote(selected.id, { pinned: !selected.pinned })
                  }
                  className={cn(
                    'ml-auto rounded border px-2 py-0.5 hover:bg-arch-panel',
                    selected.pinned
                      ? 'border-arch-accent text-arch-accent'
                      : 'border-arch-border text-arch-muted',
                  )}
                >
                  {selected.pinned ? '已置顶' : '置顶'}
                </button>
              </div>

              <textarea
                value={selected.body}
                onChange={(e) => updateNote(selected.id, { body: e.target.value })}
                placeholder="写点什么…"
                className="min-h-0 flex-1 resize-none bg-transparent p-2 font-mono leading-relaxed outline-none"
              />

              <div className="flex items-center justify-between border-t border-arch-border px-2 py-1 text-arch-muted">
                <span>{selected.body.length} 字</span>
                <span>
                  创建 {fmtTime(selected.createdAt)} · 修改{' '}
                  {fmtTime(selected.updatedAt)}
                </span>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
