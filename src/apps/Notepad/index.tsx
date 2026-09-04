import { useEffect, useRef, useState } from 'react';
import { vfs } from '@/services/filesystem';
import { Save, FileText, FilePlus } from 'lucide-react';
import type { AppProps } from '@/shell/types';

const DEFAULT_PATH = '/home/arch/notes/welcome.txt';

export default function Notepad({ context }: AppProps) {
  const [path, setPath] = useState(DEFAULT_PATH);
  const [content, setContent] = useState('');
  const [dirty, setDirty] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const node = await vfs.read(path);
        if (!cancelled) {
          setContent(node?.content ?? '');
          setDirty(false);
        }
      } catch {
        if (!cancelled) setContent('');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [path]);

  // 标题栏显示当前路径 + 修改标记
  useEffect(() => {
    context.setTitle(`记事本 — ${path}${dirty ? ' *' : ''}`);
  }, [path, dirty, context]);

  const flash = (msg: string) => {
    setMessage(msg);
    setTimeout(() => setMessage(null), 1500);
  };

  const save = async () => {
    try {
      await vfs.write(path, content);
      setDirty(false);
      flash('已保存');
    } catch (err) {
      flash(`保存失败：${(err as Error).message}`);
    }
  };

  const newFile = async () => {
    const name = window.prompt('新文件名（相对路径或绝对路径）', 'untitled.txt');
    if (!name) return;
    const abs = name.startsWith('/') ? name : `/home/arch/notes/${name}`;
    try {
      await vfs.mkdir('/home/arch/notes');
      await vfs.write(abs, '');
      setPath(abs);
      setContent('');
      setDirty(false);
      flash('已新建');
    } catch (err) {
      flash(`创建失败：${(err as Error).message}`);
    }
  };

  return (
    <div className="flex h-full flex-col bg-arch-bg text-arch-text">
      <div className="flex items-center gap-2 border-b border-arch-border bg-arch-panel/80 px-3 py-2">
        <button
          type="button"
          onClick={save}
          className="flex items-center gap-1.5 rounded px-2 py-1 text-xs hover:bg-white/10"
        >
          <Save size={14} /> 保存
        </button>
        <button
          type="button"
          onClick={newFile}
          className="flex items-center gap-1.5 rounded px-2 py-1 text-xs hover:bg-white/10"
        >
          <FilePlus size={14} /> 新建
        </button>
        <input
          value={path}
          onChange={(e) => setPath(e.target.value)}
          className="flex-1 rounded border border-arch-border bg-black/30 px-2 py-1 text-xs font-mono"
        />
        {message && (
          <span className="text-xs text-arch-green">{message}</span>
        )}
      </div>
      <textarea
        ref={taRef}
        value={content}
        onChange={(e) => {
          setContent(e.target.value);
          setDirty(true);
        }}
        spellCheck={false}
        className="flex-1 resize-none bg-arch-bg p-3 font-mono text-[13px] leading-6 outline-none"
      />
      <div className="flex items-center justify-between border-t border-arch-border bg-arch-panel/60 px-3 py-1 text-[11px] text-arch-muted">
        <span className="flex items-center gap-1.5">
          <FileText size={12} /> {content.length} 字符
        </span>
        <span>{dirty ? '未保存的修改' : '已保存'}</span>
      </div>
    </div>
  );
}
