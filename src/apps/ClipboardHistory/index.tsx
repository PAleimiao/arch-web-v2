import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Clipboard,
  Copy,
  Pin,
  Search,
  Trash2,
} from 'lucide-react';
import type { AppProps } from '@/shell/types';
import { cn } from '@/lib/cn';
import { notify } from '@/stores/useNotifyStore';
import { useClipboardStore } from '@/stores/useClipboardStore';

function ago(ts: number): string {
  const d = Date.now() - ts;
  if (d < 60_000) return `${Math.max(1, Math.floor(d / 1000))} 秒前`;
  if (d < 3_600_000) return `${Math.floor(d / 60_000)} 分钟前`;
  if (d < 86_400_000) return `${Math.floor(d / 3_600_000)} 小时前`;
  return `${Math.floor(d / 86_400_000)} 天前`;
}

export default function ClipboardHistory(_: AppProps) {
  const items = useClipboardStore((s) => s.items);
  const watching = useClipboardStore((s) => s.watching);
  const removeItem = useClipboardStore((s) => s.remove);
  const togglePin = useClipboardStore((s) => s.togglePin);
  const clearAll = useClipboardStore((s) => s.clear);
  const setWatching = useClipboardStore((s) => s.setWatching);

  const [query, setQuery] = useState('');
  const watchTimer = useRef<number | null>(null);

  const sorted = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = q
      ? items.filter((i) => i.text.toLowerCase().includes(q))
      : items;
    return [...list].sort((a, b) => {
      if (!!a.pinned !== !!b.pinned) return a.pinned ? -1 : 1;
      return b.at - a.at;
    });
  }, [items, query]);

  const totalChars = useMemo(
    () => items.reduce((s, i) => s + i.text.length, 0),
    [items],
  );

  const copyBack = async (text: string) => {
    try {
      const clip = navigator.clipboard;
      if (!clip || !clip.writeText) throw new Error('当前环境不支持写入剪贴板');
      await clip.writeText(text);
      notify('已复制', '已写回剪贴板', 'success');
    } catch (e) {
      notify('复制失败', `无法写入剪贴板：${String(e)}`, 'error');
    }
  };

  const toggleWatch = () => {
    if (watching) {
      setWatching(false);
      notify('已关闭监听', '停止轮询系统剪贴板', 'info');
    } else {
      setWatching(true);
    }
  };

  const doClear = () => {
    if (sorted.length === 0) return;
    if (
      window.confirm('确定清空全部剪贴板历史吗？此操作不可撤销。')
    ) {
      clearAll();
      notify('已清空', '剪贴板历史已清空', 'info');
    }
  };

  useEffect(() => {
    if (!watching) {
      if (watchTimer.current !== null) {
        window.clearInterval(watchTimer.current);
        watchTimer.current = null;
      }
      return;
    }
    const tick = async () => {
      if (document.hidden) return;
      try {
        const clip = navigator.clipboard;
        if (!clip || !clip.readText) throw new Error('无读取权限');
        const text = await clip.readText();
        if (text && text.length >= 2) {
          useClipboardStore.getState().add(text);
        }
      } catch (e) {
        setWatching(false);
        notify(
          '剪贴板监听已关闭',
          `读取剪贴板失败（多为权限被拒）：${String(e)}`,
          'warn',
        );
      }
    };
    watchTimer.current = window.setInterval(tick, 1000);
    return () => {
      if (watchTimer.current !== null) {
        window.clearInterval(watchTimer.current);
        watchTimer.current = null;
      }
    };
  }, [watching, setWatching]);

  return (
    <div className="flex h-full flex-col bg-arch-bg text-arch-text text-[12px]">
      {/* 顶部：监听开关 + 统计 + 搜索 + 清空 */}
      <div className="flex flex-wrap items-center gap-3 border-b border-arch-border px-3 py-2">
        <button
          type="button"
          onClick={toggleWatch}
          className={cn(
            'flex items-center gap-1 rounded border px-2 py-1',
            watching
              ? 'border-arch-green text-arch-green'
              : 'border-arch-border text-arch-muted hover:bg-arch-panel',
          )}
        >
          <Clipboard size={12} />
          {watching ? '监听中' : '监听系统剪贴板'}
        </button>
        <span className="font-mono text-arch-muted">
          共 {items.length} 条 · {totalChars} 字符
        </span>
        <div className="ml-auto flex items-center gap-2">
          <div className="flex items-center gap-1 rounded border border-arch-border bg-arch-panel px-2">
            <Search size={12} className="text-arch-muted" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="搜索"
              className="w-28 bg-transparent py-1 outline-none placeholder:text-arch-muted"
            />
          </div>
          <button
            type="button"
            onClick={doClear}
            className="rounded border border-arch-border px-2 py-1 text-arch-red hover:bg-arch-panel"
          >
            清空
          </button>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {sorted.length === 0 ? (
          <div className="flex h-full items-center justify-center text-arch-muted">
            暂无剪贴板记录
          </div>
        ) : (
          sorted.map((it) => (
            <div
              key={it.id}
              className={cn(
                'border-b border-arch-border/60 px-3 py-2',
                it.pinned && 'bg-arch-accent/10',
              )}
            >
              <div className="mb-1 flex items-center gap-2 text-arch-muted">
                {it.pinned && (
                  <span className="flex items-center gap-0.5 text-arch-accent">
                    <Pin size={11} />
                    置顶
                  </span>
                )}
                <span className="font-mono">{it.text.length} 字符</span>
                <span className="ml-auto">{ago(it.at)}</span>
              </div>
              <div className="mb-2 whitespace-pre-wrap break-words rounded bg-black/30 p-2 font-mono">
                {it.text}
              </div>
              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  title="复制回剪贴板"
                  onClick={() => copyBack(it.text)}
                  className="flex items-center gap-1 rounded border border-arch-border px-2 py-0.5 text-arch-accent hover:bg-arch-panel"
                >
                  <Copy size={12} />
                  复制
                </button>
                <button
                  type="button"
                  title={it.pinned ? '取消置顶' : '置顶'}
                  onClick={() => togglePin(it.id)}
                  className={cn(
                    'flex items-center gap-1 rounded border px-2 py-0.5 hover:bg-arch-panel',
                    it.pinned
                      ? 'border-arch-accent text-arch-accent'
                      : 'border-arch-border text-arch-muted',
                  )}
                >
                  <Pin size={12} />
                  {it.pinned ? '取消置顶' : '置顶'}
                </button>
                <button
                  type="button"
                  title="删除"
                  onClick={() => removeItem(it.id)}
                  className="flex items-center gap-1 rounded border border-arch-border px-2 py-0.5 text-arch-red hover:bg-arch-panel"
                >
                  <Trash2 size={12} />
                  删除
                </button>
              </div>
            </div>
          ))
        )}
      </div>

      {watching && (
        <div className="border-t border-arch-border px-3 py-1 text-arch-muted">
          正在每 1 秒轮询系统剪贴板（页面隐藏时跳过）；若权限被拒将自动关闭。
        </div>
      )}
    </div>
  );
}
