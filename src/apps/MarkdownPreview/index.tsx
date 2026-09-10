import { useMemo, useState, useEffect, type ReactNode } from 'react';
import {
  Pencil,
  Columns2,
  Eye,
  Copy,
  Save,
  FileText,
} from 'lucide-react';
import type { AppProps } from '@/shell/types';
import { cn } from '@/lib/cn';
import { vfs } from '@/services/filesystem';
import { notify } from '@/stores/useNotifyStore';

const SAMPLE = `# Markdown 预览

这是一个**迷你渲染器**，不依赖任何第三方库，也不使用危险的内联 HTML。

## 支持的语法

- 标题（一到六级）
- *斜体* 与 **粗体**
- 行内代码 \`const x = 1\`
- [链接](https://example.com)

### 代码块

\`\`\`ts
function hello(name: string) {
  return \`你好, \${name}\`;
}
\`\`\`

> 引用：把 Markdown 解析成结构化节点再渲染，天然免疫 XSS。

1. 有序列表第一项
2. 有序列表第二项

---

分割线以上。请输入左侧文本，右侧实时更新。
`;

type Mode = 'edit' | 'split' | 'preview';

/** 仅允许安全的链接协议，杜绝 javascript: 之类的注入 */
function safeHref(url: string): string | null {
  const u = url.trim();
  if (/^(https?:\/\/|mailto:)/i.test(u)) return u;
  if (u.startsWith('#') || u.startsWith('/')) return u;
  return null;
}

/** 行内语法解析：粗体 / 斜体 / 行内代码 / 链接。返回 React 节点数组 */
function renderInline(text: string, keyPrefix: string): ReactNode[] {
  const out: ReactNode[] = [];
  const re =
    /(\*\*(.+?)\*\*)|(\*(.+?)\*)|(`(.+?)`)|(\[([^\]]+)\]\(([^)\s]+)\))/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let i = 0;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) {
      out.push(text.slice(last, m.index));
    }
    if (m[2] !== undefined) {
      out.push(<strong key={`${keyPrefix}-${i}`}>{m[2]}</strong>);
    } else if (m[4] !== undefined) {
      out.push(<em key={`${keyPrefix}-${i}`}>{m[4]}</em>);
    } else if (m[6] !== undefined) {
      out.push(
        <code
          key={`${keyPrefix}-${i}`}
          className="rounded bg-black/40 px-1 py-0.5 font-mono text-[12px] text-arch-accent"
        >
          {m[6]}
        </code>,
      );
    } else if (m[8] !== undefined && m[9] !== undefined) {
      const href = safeHref(m[9]);
      if (href) {
        out.push(
          <a
            key={`${keyPrefix}-${i}`}
            href={href}
            target="_blank"
            rel="noopener noreferrer"
            className="text-arch-accent underline"
          >
            {m[8]}
          </a>,
        );
      } else {
        out.push(m[0]);
      }
    }
    last = re.lastIndex;
    i++;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

/** 把 Markdown 解析成结构化块并渲染成 React 元素 */
function renderMarkdown(src: string): ReactNode[] {
  const lines = src.replace(/\r\n/g, '\n').split('\n');
  const blocks: ReactNode[] = [];
  let i = 0;
  let key = 0;

  while (i < lines.length) {
    const line = lines[i];

    // 代码块
    const fence = line.match(/^```(.*)$/);
    if (fence) {
      const buf: string[] = [];
      i++;
      while (i < lines.length && !/^```/.test(lines[i])) {
        buf.push(lines[i]);
        i++;
      }
      i++; // 跳过结束的 ```
      blocks.push(
        <pre
          key={key++}
          className="my-2 overflow-x-auto rounded border border-arch-border bg-black/40 p-2 font-mono text-[12px] leading-5"
        >
          <code>{buf.join('\n')}</code>
        </pre>,
      );
      continue;
    }

    // 空行
    if (line.trim() === '') {
      i++;
      continue;
    }

    // 分割线
    if (/^(-{3,}|\*{3,})\s*$/.test(line)) {
      blocks.push(
        <hr key={key++} className="my-3 border-arch-border" />,
      );
      i++;
      continue;
    }

    // 标题
    const h = line.match(/^(#{1,6})\s+(.*)$/);
    if (h) {
      const level = h[1].length;
      const text = h[2];
      const cls =
        level <= 2 ? 'text-base font-bold' : 'text-sm font-semibold';
      blocks.push(
        <div
          key={key++}
          className={cn('mt-3 mb-1 text-arch-text', cls)}
        >
          {renderInline(text, `h${key}`)}
        </div>,
      );
      i++;
      continue;
    }

    // 引用
    if (/^>\s?/.test(line)) {
      const buf: string[] = [];
      while (i < lines.length && /^>\s?/.test(lines[i])) {
        buf.push(lines[i].replace(/^>\s?/, ''));
        i++;
      }
      blocks.push(
        <blockquote
          key={key++}
          className="my-2 border-l-2 border-arch-accent bg-white/5 px-3 py-1 text-arch-muted"
        >
          {buf.map((b, bi) => (
            <div key={bi}>{renderInline(b, `q${key}-${bi}`)}</div>
          ))}
        </blockquote>,
      );
      continue;
    }

    // 无序列表
    if (/^[-*]\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^[-*]\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^[-*]\s+/, ''));
        i++;
      }
      blocks.push(
        <ul
          key={key++}
          className="my-2 list-disc space-y-0.5 pl-5"
        >
          {items.map((it, ii) => (
            <li key={ii}>{renderInline(it, `ul${key}-${ii}`)}</li>
          ))}
        </ul>,
      );
      continue;
    }

    // 有序列表
    if (/^\d+\.\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\d+\.\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\d+\.\s+/, ''));
        i++;
      }
      blocks.push(
        <ol
          key={key++}
          className="my-2 list-decimal space-y-0.5 pl-5"
        >
          {items.map((it, ii) => (
            <li key={ii}>{renderInline(it, `ol${key}-${ii}`)}</li>
          ))}
        </ol>,
      );
      continue;
    }

    // 段落：合并连续非空行
    const buf: string[] = [];
    while (
      i < lines.length &&
      lines[i].trim() !== '' &&
      !/^```/.test(lines[i]) &&
      !/^(#{1,6})\s+/.test(lines[i]) &&
      !/^>\s?/.test(lines[i]) &&
      !/^[-*]\s+/.test(lines[i]) &&
      !/^\d+\.\s+/.test(lines[i]) &&
      !/^(-{3,}|\*{3,})\s*$/.test(lines[i])
    ) {
      buf.push(lines[i]);
      i++;
    }
    blocks.push(
      <p key={key++} className="my-2 leading-6">
        {renderInline(buf.join(' '), `p${key}`)}
      </p>,
    );
  }

  return blocks;
}

/** 提取渲染后的纯文本（用于复制） */
function markdownToPlainText(src: string): string {
  return src
    .replace(/```[\s\S]*?```/g, (b) => b.replace(/```\w*\n?/g, ''))
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\*([^*]+)\*/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/^>\s?/gm, '')
    .replace(/^[-*]\s+/gm, '- ')
    .replace(/^\d+\.\s+/gm, '')
    .replace(/^(-{3,}|\*{3,})\s*$/gm, '')
    .trim();
}

export default function MarkdownPreview({ context }: AppProps) {
  useEffect(() => {
    context.setTitle('Markdown 预览');
  }, [context]);
  const [md, setMd] = useState(SAMPLE);
  const [mode, setMode] = useState<Mode>('split');
  const [path, setPath] = useState('/home/arch/notes/preview.md');
  const [flash, setFlash] = useState<string | null>(null);

  const rendered = useMemo(() => renderMarkdown(md), [md]);
  const lines = useMemo(() => md.split('\n').length, [md]);

  const showFlash = (msg: string) => {
    setFlash(msg);
    window.setTimeout(() => setFlash(null), 1500);
  };

  const copyPlain = async () => {
    const text = markdownToPlainText(md);
    try {
      await navigator.clipboard.writeText(text);
      showFlash('已复制纯文本');
    } catch {
      showFlash('复制失败');
    }
  };

  const save = async () => {
    try {
      await vfs.writeFile(path, md);
      notify('已保存', path, 'success');
      showFlash('已保存');
    } catch (err) {
      notify('保存失败', (err as Error).message, 'error');
      showFlash('保存失败');
    }
  };

  const modes: Array<[Mode, string, ReactNode]> = [
    ['edit', '仅编辑', <Pencil key="edit" size={13} />],
    ['split', '分栏', <Columns2 key="split" size={13} />],
    ['preview', '仅预览', <Eye key="preview" size={13} />],
  ];

  return (
    <div className="flex h-full flex-col bg-arch-bg text-arch-text">
      <div className="flex flex-wrap items-center gap-2 border-b border-arch-border bg-arch-panel/80 px-3 py-1.5">
        <div className="flex overflow-hidden rounded border border-arch-border">
          {modes.map(([m, label, icon]) => (
            <button
              key={m}
              type="button"
              onClick={() => setMode(m)}
              className={cn(
                'flex items-center gap-1 px-2 py-1 text-xs',
                mode === m
                  ? 'bg-arch-accent text-white'
                  : 'bg-arch-panel hover:bg-white/10',
              )}
            >
              {icon}
              {label}
            </button>
          ))}
        </div>
        <button
          type="button"
          onClick={copyPlain}
          className="flex items-center gap-1 rounded border border-arch-border px-2 py-1 text-xs hover:bg-white/10"
        >
          <Copy size={13} /> 复制纯文本
        </button>
        <div className="ml-auto flex items-center gap-2 text-[11px] text-arch-muted">
          {flash && <span className="text-arch-green">{flash}</span>}
          <span className="flex items-center gap-1">
            <FileText size={12} /> {md.length} 字符 · {lines} 行
          </span>
        </div>
      </div>

      <div className="flex min-h-0 flex-1">
        {(mode === 'edit' || mode === 'split') && (
          <div className={cn('flex min-h-0 flex-col', mode === 'split' ? 'w-1/2 border-r border-arch-border' : 'flex-1')}>
            <textarea
              value={md}
              onChange={(e) => setMd(e.target.value)}
              spellCheck={false}
              className="min-h-0 flex-1 resize-none bg-arch-bg p-3 font-mono text-[13px] leading-6 outline-none"
            />
            <div className="flex items-center gap-2 border-t border-arch-border bg-arch-panel/60 px-3 py-1">
              <input
                value={path}
                onChange={(e) => setPath(e.target.value)}
                className="flex-1 rounded border border-arch-border bg-black/30 px-2 py-1 font-mono text-[11px]"
              />
              <button
                type="button"
                onClick={save}
                className="flex items-center gap-1 rounded bg-arch-accent px-2 py-1 text-xs text-white hover:opacity-90"
              >
                <Save size={13} /> 保存
              </button>
            </div>
          </div>
        )}
        {(mode === 'split' || mode === 'preview') && (
          <div className="min-h-0 flex-1 overflow-y-auto p-4 text-[13px]">
            {rendered.length > 0 ? (
              rendered
            ) : (
              <p className="text-arch-muted">（空）</p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
