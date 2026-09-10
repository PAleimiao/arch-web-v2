import { useEffect, useState } from 'react';
import { Braces, Copy, Check, Hash, ListTree } from 'lucide-react';
import type { AppProps } from '@/shell/types';
import { cn } from '@/lib/cn';
import { notify } from '@/stores/useNotifyStore';

const MAX_LEN = 200_000;

type Action = 'format' | 'minify' | 'validate' | 'interface' | 'yaml' | 'stats';

const SAMPLE = `{
  "name": "arch-web",
  "version": "2.0",
  "active": true,
  "tags": ["os", "browser"],
  "owner": { "name": "arch", "age": 30 },
  "scores": [1, 2, 3]
}`;

interface JsonError {
  message: string;
  line: number;
  column: number;
}

/** 根据 JSON.parse 报错里的 position 反算行号/列号 */
function locateError(input: string, err: unknown): JsonError {
  const msg = err instanceof Error ? err.message : String(err);
  const posMatch = msg.match(/position (\d+)/);
  if (posMatch) {
    const pos = Number(posMatch[1]);
    let line = 1;
    let col = 1;
    for (let i = 0; i < pos && i < input.length; i++) {
      if (input[i] === '\n') {
        line++;
        col = 1;
      } else {
        col++;
      }
    }
    return { message: msg, line, column: col };
  }
  return { message: msg, line: 0, column: 0 };
}

/** 按 ASCII 排序对象键（递归） */
function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value && typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(obj).sort()) out[k] = sortKeys(obj[k]);
    return out;
  }
  return value;
}

/** 推断一个值的 TypeScript 类型字符串 */
function typeOf(value: unknown): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) {
    if (value.length === 0) return 'unknown[]';
    const merged = mergeTypes(value.map(typeOf));
    return `${merged}[]`;
  }
  switch (typeof value) {
    case 'string':
      return 'string';
    case 'number':
      return 'number';
    case 'boolean':
      return 'boolean';
    case 'object':
      return 'Record<string, unknown>';
    default:
      return 'unknown';
  }
}

function mergeTypes(types: string[]): string {
  const uniq = [...new Set(types)];
  if (uniq.length === 1) return uniq[0] ?? 'unknown';
  return uniq.join(' | ');
}

/** 把对象转成 TS interface 文本 */
function toInterface(value: unknown, rootName = 'Root'): string {
  const lines: string[] = [];
  const walk = (name: string, val: unknown, indent: number) => {
    const pad = '  '.repeat(indent);
    if (val && typeof val === 'object' && !Array.isArray(val)) {
      lines.push(`${pad}${name === rootName ? 'export interface ' + name + ' ' : name + ': '}{`);
      const obj = val as Record<string, unknown>;
      for (const k of Object.keys(obj)) {
        const child = obj[k];
        if (child && typeof child === 'object' && !Array.isArray(child)) {
          const childName = /^[A-Za-z_$][\w$]*$/.test(k) ? k : `'${k}'`;
          lines.push(`${pad}  ${childName}: {`);
          walk(k, child, indent + 2);
          lines.push(`${pad}  };`);
        } else {
          const keyName = /^[A-Za-z_$][\w$]*$/.test(k) ? k : `'${k}'`;
          lines.push(`${pad}  ${keyName}: ${typeOf(child)};`);
        }
      }
      lines.push(`${pad}}`);
    } else {
      lines.push(`${pad}${name}: ${typeOf(val)};`);
    }
  };
  walk(rootName, value, 0);
  return lines.join('\n');
}

/** 简易 YAML 风格输出 */
function toYaml(value: unknown, indent = 0): string {
  const pad = '  '.repeat(indent);
  if (Array.isArray(value)) {
    if (value.length === 0) return `${pad}[]`;
    return value
      .map((v) => {
        if (v && typeof v === 'object' && !Array.isArray(v)) {
          const inner = toYaml(v, indent + 1).split('\n');
          return `${pad}- ${inner[0]?.replace(/^\s*/, '') ?? ''}\n${inner.slice(1).join('\n')}`;
        }
        return `${pad}- ${scalar(v)}`;
      })
      .join('\n');
  }
  if (value && typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    const keys = Object.keys(obj);
    if (keys.length === 0) return `${pad}{}`;
    return keys
      .map((k) => {
        const v = obj[k];
        if (v && typeof v === 'object') {
          return `${pad}${k}:\n${toYaml(v, indent + 1)}`;
        }
        return `${pad}${k}: ${scalar(v)}`;
      })
      .join('\n');
  }
  return `${pad}${scalar(value)}`;
}

function scalar(v: unknown): string {
  if (v === null) return 'null';
  if (typeof v === 'string') return `"${v}"`;
  return String(v);
}

/** 统计：键数量、嵌套深度、最长数组长度 */
function stats(value: unknown): { keys: number; depth: number; maxArray: number } {
  let keys = 0;
  let maxDepth = 0;
  let maxArray = 0;
  const walk = (v: unknown, depth: number) => {
    maxDepth = Math.max(maxDepth, depth);
    if (Array.isArray(v)) {
      maxArray = Math.max(maxArray, v.length);
      v.forEach((item) => walk(item, depth + 1));
    } else if (v && typeof v === 'object') {
      const obj = v as Record<string, unknown>;
      const ks = Object.keys(obj);
      keys += ks.length;
      ks.forEach((k) => walk(obj[k], depth + 1));
    }
  };
  walk(value, 0);
  return { keys, depth: maxDepth, maxArray };
}

export default function JsonTool({ context }: AppProps) {
  useEffect(() => {
    context.setTitle('JSON 工具');
  }, [context]);
  const [input, setInput] = useState(SAMPLE);
  const [indent, setIndent] = useState(2);
  const [sortKey, setSortKey] = useState(false);
  const [action, setAction] = useState<Action>('format');
  const [output, setOutput] = useState('');
  const [error, setError] = useState<JsonError | null>(null);
  const [copied, setCopied] = useState(false);

  const tooLarge = input.length > MAX_LEN;

  const run = (a: Action) => {
    setAction(a);
    setError(null);
    if (input.trim() === '') {
      setOutput('');
      return;
    }
    try {
      let parsed: unknown = JSON.parse(input);
      if (sortKey && (parsed && typeof parsed === 'object')) {
        parsed = sortKeys(parsed);
      }
      switch (a) {
        case 'format':
          setOutput(JSON.stringify(parsed, null, indent));
          break;
        case 'minify':
          setOutput(JSON.stringify(parsed));
          break;
        case 'validate':
          setOutput('校验通过：输入是合法的 JSON。');
          break;
        case 'interface':
          setOutput(toInterface(parsed));
          break;
        case 'yaml':
          setOutput(toYaml(parsed));
          break;
        case 'stats': {
          const s = stats(parsed);
          setOutput(
            `键数量：${s.keys}\n嵌套深度：${s.depth}\n最长数组长度：${s.maxArray}`,
          );
          break;
        }
      }
    } catch (err) {
      const e = locateError(input, err);
      setError(e);
      setOutput('');
      notify('JSON 解析失败', `第 ${e.line} 行第 ${e.column} 列`, 'error');
    }
  };

  const copy = async () => {
    if (!output) return;
    try {
      await navigator.clipboard.writeText(output);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1200);
    } catch {
      notify('复制失败', '浏览器拒绝访问剪贴板', 'error');
    }
  };

  const actions: Array<[Action, string]> = [
    ['format', '格式化'],
    ['minify', '压缩'],
    ['validate', '校验'],
    ['interface', '转 TS 接口'],
    ['yaml', '转 YAML'],
    ['stats', '统计'],
  ];

  return (
    <div className="flex h-full flex-col bg-arch-bg text-arch-text">
      <div className="flex flex-wrap items-center gap-2 border-b border-arch-border bg-arch-panel/80 px-3 py-1.5">
        <Braces size={14} className="text-arch-accent" />
        <div className="flex flex-wrap gap-1">
          {actions.map(([a, label]) => (
            <button
              key={a}
              type="button"
              onClick={() => run(a)}
              className={cn(
                'rounded px-2 py-1 text-xs',
                action === a
                  ? 'bg-arch-accent text-white'
                  : 'bg-arch-panel hover:bg-white/10',
              )}
            >
              {label}
            </button>
          ))}
        </div>
        <label className="flex items-center gap-1 text-xs text-arch-muted">
          缩进
          <select
            value={indent}
            onChange={(e) => setIndent(Number(e.target.value))}
            className="rounded border border-arch-border bg-black/30 px-1 py-0.5 text-xs"
          >
            <option value={2}>2</option>
            <option value={4}>4</option>
          </select>
        </label>
        <label className="flex items-center gap-1 text-xs text-arch-muted">
          <input
            type="checkbox"
            checked={sortKey}
            onChange={(e) => setSortKey(e.target.checked)}
          />
          键排序
        </label>
        <button
          type="button"
          onClick={copy}
          disabled={!output}
          className="ml-auto flex items-center gap-1 rounded bg-arch-panel px-2 py-1 text-xs hover:bg-white/10 disabled:opacity-40"
        >
          {copied ? <Check size={13} /> : <Copy size={13} />}
          {copied ? '已复制' : '复制'}
        </button>
      </div>

      <div className="flex min-h-0 flex-1 flex-col md:flex-row">
        <div className="flex min-h-0 flex-1 flex-col border-b border-arch-border md:border-b-0 md:border-r">
          <div className="flex items-center justify-between px-3 py-1 text-[11px] text-arch-muted">
            <span className="flex items-center gap-1">
              <Hash size={12} /> 输入（{input.length} 字符）
            </span>
            {tooLarge && (
              <span className="text-arch-red">输入过大，可能卡顿</span>
            )}
          </div>
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            spellCheck={false}
            placeholder="在此粘贴 JSON…"
            className="min-h-0 flex-1 resize-none bg-arch-bg p-3 font-mono text-[12px] leading-5 outline-none"
          />
        </div>

        <div className="flex min-h-0 flex-1 flex-col">
          <div className="flex items-center gap-1 px-3 py-1 text-[11px] text-arch-muted">
            <ListTree size={12} /> 结果
            {error && (
              <span className="text-arch-red">
                第 {error.line} 行，第 {error.column} 列
              </span>
            )}
          </div>
          {error ? (
            <div className="min-h-0 flex-1 overflow-y-auto bg-black/30 p-3 font-mono text-[12px] text-arch-red">
              {error.message}
            </div>
          ) : (
            <pre className="min-h-0 flex-1 overflow-y-auto bg-arch-bg p-3 font-mono text-[12px] leading-5">
              {output || '（点击上方按钮生成结果）'}
            </pre>
          )}
        </div>
      </div>
    </div>
  );
}
