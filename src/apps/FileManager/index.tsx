import { useCallback, useEffect, useState } from 'react';
import {
  ArrowLeft,
  File as FileIcon,
  Folder,
  Plus,
  RefreshCw,
  Trash2,
} from 'lucide-react';
import { bus, vfs } from '@/services/filesystem';
import type { AppProps, FsNode } from '@/shell/types';

export default function FileManager({ context }: AppProps) {
  const [cwd, setCwd] = useState('/home/arch');
  const [nodes, setNodes] = useState<FsNode[]>([]);
  const [selected, setSelected] = useState<FsNode | null>(null);
  const [draft, setDraft] = useState('');
  const [dirty, setDirty] = useState(false);

  const refresh = useCallback(async () => {
    setNodes(await vfs.listDir(cwd));
  }, [cwd]);

  useEffect(() => {
    void refresh();
    setSelected(null);
    setDraft('');
    setDirty(false);
  }, [cwd, refresh]);

  useEffect(() => bus.on('fs:change', () => void refresh()), [refresh]);

  const openNode = async (node: FsNode) => {
    if (node.type === 'dir') {
      setCwd(node.path);
      return;
    }
    const content = (await vfs.readFile(node.path)) ?? '';
    setSelected(node);
    setDraft(content);
    setDirty(false);
  };

  const save = async () => {
    if (!selected) return;
    await vfs.writeFile(selected.path, draft);
    setDirty(false);
    context.setTitle(`${selected.name} — 文件管理器`);
    await refresh();
  };

  const createFile = async () => {
    const name = window.prompt('新文件名', 'untitled.txt');
    if (!name) return;
    await vfs.writeFile(`${cwd}/${name}`, '');
    await refresh();
  };

  const removeNode = async (node: FsNode) => {
    if (!window.confirm(`删除 ${node.name}？`)) return;
    await vfs.remove(node.path);
    if (selected?.path === node.path) {
      setSelected(null);
      setDraft('');
    }
    await refresh();
  };

  return (
    <div className="flex h-full flex-col bg-arch-panel/60 text-[12px] text-arch-text">
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        multiple
        className="hidden"
        onChange={(e) => {
          void importImages(e.target.files);
          e.target.value = '';
        }}
      />
      {/* 工具条 */}
      <div className="flex items-center gap-1 border-b border-arch-border px-2 py-1.5">
        <button
          type="button"
          onClick={() => setCwd(vfs.parentOf(cwd))}
          disabled={cwd === '/'}
          className="rounded p-1 transition hover:bg-white/10 disabled:opacity-30"
          title="上一级"
        >
          <ArrowLeft size={14} />
        </button>
        <button
          type="button"
          onClick={() => void refresh()}
          className="rounded p-1 transition hover:bg-white/10"
          title="刷新"
        >
          <RefreshCw size={13} />
        </button>
        <button
          type="button"
          onClick={() => void createFile()}
          className="rounded p-1 transition hover:bg-white/10"
          title="新建文件"
        >
          <Plus size={14} />
        </button>
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          disabled={importing}
          className="rounded p-1 transition hover:bg-white/10 disabled:opacity-50"
          title="导入本地图片到画廊"
        >
          <ImagePlus size={14} />
        </button>
        <span className="ml-2 flex-1 truncate font-mono text-[11px] text-arch-muted">
          {cwd}
        </span>
        {selected && (
          <button
            type="button"
            onClick={() => void save()}
            disabled={!dirty}
            className="rounded bg-arch-accent/25 px-2 py-0.5 text-[11px] text-white transition hover:bg-arch-accent/40 disabled:opacity-30"
          >
            保存
          </button>
        )}
      </div>
      {importMsg && (
        <div className="border-b border-arch-border bg-arch-accent/10 px-3 py-1 text-[11px] text-arch-accent">
          {importMsg}
        </div>
      )}

      <div className="flex min-h-0 flex-1">
        {/* 目录树 */}
        <div className="w-44 shrink-0 overflow-y-auto border-r border-arch-border p-1.5">
          {nodes.length === 0 && (
            <p className="px-1 py-2 text-[11px] text-arch-muted">空目录</p>
          )}
          {nodes.map((node) => (
            <div
              key={node.path}
              className="group flex items-center gap-1.5 rounded px-1.5 py-1"
            >
              <button
                type="button"
                onDoubleClick={() => void openNode(node)}
                onClick={() => void openNode(node)}
                className="flex min-w-0 flex-1 items-center gap-1.5 text-left"
              >
                {node.type === 'dir' ? (
                  <Folder size={13} className="shrink-0 text-arch-accent" />
                ) : (
                  <FileIcon size={13} className="shrink-0 text-arch-muted" />
                )}
                <span className="truncate">{node.name}</span>
              </button>
              <button
                type="button"
                onClick={() => void removeNode(node)}
                className="shrink-0 rounded p-0.5 text-arch-muted opacity-0 transition hover:text-arch-red group-hover:opacity-100"
                title="删除"
              >
                <Trash2 size={12} />
              </button>
            </div>
          ))}
        </div>

        {/* 编辑区 */}
        <div className="min-w-0 flex-1">
          {selected ? (
            <textarea
              value={draft}
              onChange={(e) => {
                setDraft(e.target.value);
                setDirty(true);
              }}
              spellCheck={false}
              className="h-full w-full resize-none bg-transparent p-3 font-mono text-[12px] leading-5 text-arch-text outline-none"
            />
          ) : (
            <div className="flex h-full items-center justify-center text-[11px] text-arch-muted">
              双击左侧文件开始编辑
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
