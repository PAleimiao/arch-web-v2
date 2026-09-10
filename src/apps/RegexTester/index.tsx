import { useMemo, useState, useEffect } from 'react';
import { Regex, Replace, Copy, Check, AlertTriangle, Clock } from 'lucide-react';
import type { AppProps } from '@/shell/types';
import { cn } from '@/lib/cn';

const MAX_TEXT = 200_000;

interface MatchInfo {
  index: number;
  value: string;
  groups: string[];
}

interface ComputeResult {
  matches: MatchInfo[];
  segments: Array<{ text: string; hit: boolean; key: number }>;
  error: string | null;
  ms: number;
}

const FLAG_DEFS: Array<[string, string]> = [
  ['g', '全局'],
  ['i', '忽略大小写'],
  ['m', '多行'],
  ['s', '点匹配换行'],
  ['u', 'Unicode'],
  ['y', '粘连'],
];

const PRESETS: Array<[string, string]> = [
  ['邮箱', '[\\w.+-]+@[\\w-]+\\.[\\w.-]+'],
  ['手机号', '1[3-9]\\d{9}'],
  ['URL', 'https?://[\\w.-]+(?:/[\\w./?%&=#-]*)?'],
  ['IPv4', '\\b(?:\\d{1,3}\\.){3}\\d{1,3}\\b'],
  ['日期', '\\d{4}-\\d{2}-\\d{2}'],
  ['十六进制颜色', '#[0-9a-fA-F]{6}'],
];

function compute(
  pattern: string,
  flags: string,
  text: string,
): ComputeResult {
  if (pattern === '') {
    return {
      matches: [],
      segments: text ? [{ text, hit: false, key: 0 }] : [],
      error: null,
      ms: 0,
    };
  }
  let re: RegExp;
  try {
    re = new RegExp(pattern, flags.includes('g') ? flags : flags + 'g');
  } catch (err) {
    return {
      matches: [],
      segments: [],
      error: err instanceof Error ? err.message : '无效的正则表达式',
      ms: 0,
    };
  }

  const t0 = performance.now();
  const matches: MatchInfo[] = [];
  const segments: Array<{ text: string; hit: boolean; key: number }> = [];
  let last = 0;
  let key = 0;
  let guard = 0;
  try {
    for (const m of text.matchAll(re)) {
      const idx = m.index ?? 0;
      const value = m[0];
      if (idx < last) continue; // 防止零宽匹配回退
      if (idx > last) {
        segments.push({ text: text.slice(last, idx), hit: false, key: key++ });
      }
      segments.push({ text: value, hit: true, key: key++ });
      matches.push({
        index: idx,
        value,
        groups: m.slice(1).map((g) => g ?? ''),
      });
      last = idx + (value.length || 1);
      if (++guard > 10000) break; // 安全上限
    }
    if (last < text.length) {
      segments.push({ text: text.slice(last), hit: false, key: key++ });
    }
  } catch (err) {
    return {
      matches: [],
      segments: [],
      error: err instanceof Error ? err.message : '匹配出错',
      ms: 0,
    };
  }
  const ms = performance.now() - t0;
  return { matches, segments, error: null, ms };
}

export default function RegexTester({ context }: AppProps) {
  useEffect(() => {
    context.setTitle('正则测试');
  }, [context]);
  const [pattern, setPattern] = useState('\\d{4}-\\d{2}-\\d{2}');
  const [flags, setFlags] = useState('g');
  const [text, setText] = useState(
    '订单 2024-01-15 已发货，订单 2024-02-03 已签收，预约 2025-12-31。',
  );
  const [replace, setReplace] = useState('[$1]');
  const [copied, setCopied] = useState(false);

  const truncated = text.length > MAX_TEXT;
  const workText = truncated ? text.slice(0, MAX_TEXT) : text;

  const result = useMemo(
    () => compute(pattern, flags, workText),
    [pattern, flags, workText],
  );

  const replaceResult = useMemo(() => {
    if (pattern === '') return '';
    try {
      const re = new RegExp(pattern, flags);
      return workText.replace(re, replace);
    } catch {
      return '';
    }
  }, [pattern, flags, replace, workText]);

  const toggleFlag = (f: string) => {
    setFlags((prev) => (prev.includes(f) ? prev.replace(f, '') : prev + f));
  };

  const copyReplace = async () => {
    if (!replaceResult) return;
    try {
      await navigator.clipboard.writeText(replaceResult);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1200);
    } catch {
      /* 忽略 */
    }
  };

  return (
    <div className="flex h-full flex-col bg-arch-bg text-arch-text">
      <div className="flex flex-wrap items-center gap-2 border-b border-arch-border bg-arch-panel/80 px-3 py-1.5">
        <Regex size={14} className="text-arch-accent" />
        <input
          value={pattern}
          onChange={(e) => setPattern(e.target.value)}
          placeholder="正则表达式"
          spellCheck={false}
          className="w-64 rounded border border-arch-border bg-black/30 px-2 py-1 font-mono text-[12px]"
        />
        <div className="flex flex-wrap gap-1">
          {FLAG_DEFS.map(([f, label]) => (
            <label
              key={f}
              className={cn(
                'flex cursor-pointer items-center gap-1 rounded border px-1.5 py-0.5 text-[11px]',
                flags.includes(f)
                  ? 'border-arch-accent text-arch-accent'
                  : 'border-arch-border text-arch-muted',
              )}
            >
              <input
                type="checkbox"
                className="hidden"
                checked={flags.includes(f)}
                onChange={() => toggleFlag(f)}
              />
              {f}
              <span className="opacity-60">{label}</span>
            </label>
          ))}
        </div>
      </div>

      <div className="flex min-h-0 flex-1">
        <div className="flex w-1/2 min-h-0 flex-col border-r border-arch-border">
          <div className="px-3 py-1 text-[11px] text-arch-muted">
            测试文本
            {truncated && (
              <span className="ml-1 text-arch-red">
                已截断到 {MAX_TEXT / 1000}KB
              </span>
            )}
          </div>
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            spellCheck={false}
            className="min-h-0 flex-1 resize-none bg-arch-bg p-3 font-mono text-[12px] leading-5 outline-none"
          />
          <div className="border-t border-arch-border bg-black/20 p-3 font-mono text-[12px] leading-6">
            {result.error ? (
              <div className="flex items-center gap-1 text-arch-red">
                <AlertTriangle size={13} /> {result.error}
              </div>
            ) : (
              <span className="whitespace-pre-wrap break-words">
                {result.segments.map((seg) =>
                  seg.hit ? (
                    <mark
                      key={seg.key}
                      className="rounded bg-arch-accent/30 text-arch-accent"
                    >
                      {seg.text}
                    </mark>
                  ) : (
                    <span key={seg.key}>{seg.text}</span>
                  ),
                )}
              </span>
            )}
          </div>
        </div>

        <div className="flex w-1/2 min-h-0 flex-col">
          <div className="flex items-center gap-2 px-3 py-1 text-[11px] text-arch-muted">
            <span>匹配 {result.matches.length} 处</span>
            <span className="flex items-center gap-1">
              <Clock size={12} /> {result.ms.toFixed(2)} ms
            </span>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-2">
            {result.matches.slice(0, 200).map((m, i) => (
              <div
                key={i}
                className="mb-1 rounded border border-arch-border bg-black/20 p-2 text-[12px]"
              >
                <div className="flex justify-between">
                  <span className="text-arch-muted">#{i + 1}</span>
                  <span className="font-mono text-arch-accent">
                    index {m.index}
                  </span>
                </div>
                <div className="font-mono text-arch-text">“{m.value}”</div>
                {m.groups.length > 0 && (
                  <div className="mt-1 text-[11px] text-arch-muted">
                    捕获组：
                    {m.groups.map((g, gi) => (
                      <span key={gi} className="ml-1 font-mono">
                        ${gi + 1}=“{g}”
                      </span>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
          <div className="border-t border-arch-border p-3">
            <div className="flex items-center gap-2">
              <Replace size={13} className="text-arch-accent" />
              <span className="text-[11px] text-arch-muted">替换预览</span>
            </div>
            <div className="mt-1 flex gap-2">
              <input
                value={replace}
                onChange={(e) => setReplace(e.target.value)}
                placeholder="$1"
                spellCheck={false}
                className="flex-1 rounded border border-arch-border bg-black/30 px-2 py-1 font-mono text-[12px]"
              />
              <button
                type="button"
                onClick={copyReplace}
                disabled={!replaceResult}
                className="flex items-center gap-1 rounded bg-arch-panel px-2 py-1 text-xs hover:bg-white/10 disabled:opacity-40"
              >
                {copied ? <Check size={13} /> : <Copy size={13} />} 复制
              </button>
            </div>
            <pre className="mt-1 max-h-24 overflow-y-auto rounded bg-black/30 p-2 font-mono text-[12px] text-arch-green">
              {replaceResult || '（无）'}
            </pre>
          </div>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-1.5 border-t border-arch-border bg-arch-panel/60 px-3 py-1.5">
        <span className="text-[11px] text-arch-muted">常用速查：</span>
        {PRESETS.map(([label, rx]) => (
          <button
            key={label}
            type="button"
            onClick={() => setPattern(rx)}
            className="rounded border border-arch-border px-2 py-0.5 text-[11px] hover:bg-white/10"
          >
            {label}
          </button>
        ))}
      </div>
    </div>
  );
}
