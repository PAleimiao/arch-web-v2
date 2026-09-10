import { useEffect, useMemo, useRef, useState } from 'react';
import { RotateCcw, Keyboard, Check, X, Trophy } from 'lucide-react';
import type { AppProps } from '@/shell/types';
import { cn } from '@/lib/cn';
import { notify } from '@/stores/useNotifyStore';

type Mode = 'en' | 'zh';

const EN_TEXTS = [
  'the quick brown fox jumps over the lazy dog while the sun sets behind the quiet hills',
  'learning to type fast takes daily practice but the reward is clear when your thoughts flow onto the screen',
  'a small step each day builds a habit that lasts a lifetime and opens doors you never expected to find',
  'she opened the window and watched the rain tap gently against the glass as the city slowly woke up',
];

const ZH_TEXTS = [
  '窗外的雨轻轻落下，街灯在湿漉漉的地面上拉出长长的影子。',
  '学习是一件需要耐心的事，每天进步一点点，终会看到改变。',
  '生活里最温柔的时刻，往往藏在那些不起眼的日常之中。',
  '他把热茶放在桌上，翻开一本书，让安静的午后慢慢流淌过去。',
];

const HISTORY_KEY = 'arch-web-os:typing-history';
const MAX_HISTORY = 10;

interface HistoryEntry {
  mode: Mode;
  wpm: number;
  acc: number;
  time: number;
  errors: number;
  at: number;
}

const KEY_ROWS = ['qwertyuiop', 'asdfghjkl', 'zxcvbnm'];

function loadHistory(): HistoryEntry[] {
  try {
    const raw = localStorage.getItem(HISTORY_KEY);
    if (!raw) return [];
    const v = JSON.parse(raw);
    if (Array.isArray(v)) return v as HistoryEntry[];
    return [];
  } catch {
    return [];
  }
}

function saveHistory(list: HistoryEntry[]) {
  try {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(list.slice(0, MAX_HISTORY)));
  } catch {
    /* 忽略 */
  }
}

function pick<T>(arr: T[]): T {
  const item = arr[Math.floor(Math.random() * arr.length)];
  return item as T;
}

interface Stats {
  wpm: number;
  acc: number;
  errors: number;
  correct: number;
  time: number;
}

function computeStats(target: string, input: string, startMs: number, endMs: number): Stats {
  const typed = input.length;
  const n = Math.min(typed, target.length);
  let correct = 0;
  let errors = 0;
  for (let i = 0; i < n; i++) {
    if (input[i] === target[i]) correct++;
    else errors++;
  }
  const minutes = Math.max((endMs - startMs) / 60000, 1 / 60000);
  const wpm = Math.round(correct / 5 / minutes);
  const acc = typed > 0 ? Math.round((correct / typed) * 100) : 100;
  return { wpm, acc, errors, correct, time: Math.round((endMs - startMs) / 1000) };
}

export default function TypingTest({ context }: AppProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const startRef = useRef<number>(0);

  const [mode, setMode] = useState<Mode>('en');
  const [target, setTarget] = useState<string>(() => pick(EN_TEXTS));
  const [input, setInput] = useState('');
  const [started, setStarted] = useState(false);
  const [finished, setFinished] = useState(false);
  const [result, setResult] = useState<Stats | null>(null);
  const [history, setHistory] = useState<HistoryEntry[]>(() => loadHistory());

  useEffect(() => {
    context.setTitle('打字练习');
  }, [context]);

  const best = useMemo(
    () => (history.length > 0 ? Math.max(...history.map((h) => h.wpm)) : 0),
    [history],
  );

  function newRound(nextMode?: Mode) {
    const m = nextMode ?? mode;
    const text = pick(m === 'en' ? EN_TEXTS : ZH_TEXTS);
    setTarget(text);
    setInput('');
    setStarted(false);
    setFinished(false);
    setResult(null);
    startRef.current = 0;
    requestAnimationFrame(() => textareaRef.current?.focus());
  }

  function switchMode(m: Mode) {
    if (m === mode) return;
    setMode(m);
    newRound(m);
  }

  function onChange(value: string) {
    if (finished) return;
    const v = value.slice(0, target.length);
    if (!started) {
      setStarted(true);
      startRef.current = Date.now();
    }
    setInput(v);
    if (v.length === target.length) {
      const stats = computeStats(target, v, startRef.current, Date.now());
      setResult(stats);
      setFinished(true);
      const entry: HistoryEntry = {
        mode,
        wpm: stats.wpm,
        acc: stats.acc,
        time: stats.time,
        errors: stats.errors,
        at: Date.now(),
      };
      const next = [entry, ...history].slice(0, MAX_HISTORY);
      setHistory(next);
      saveHistory(next);
      notify('练习完成', `速度 ${stats.wpm} WPM · 准确率 ${stats.acc}%`, 'success');
    }
  }

  const live = useMemo(() => {
    if (finished && result) return result;
    if (!started) return null;
    return computeStats(target, input, startRef.current, Date.now());
  }, [finished, result, started, target, input]);

  const nextChar = started && !finished ? target[input.length] ?? '' : '';
  const nextKey = nextChar ? nextChar.toLowerCase() : '';

  return (
    <div className="flex h-full flex-col bg-arch-bg text-arch-text">
      {/* 顶栏 */}
      <div className="flex flex-wrap items-center gap-2 border-b border-arch-border bg-arch-panel px-2 py-1.5 text-[12px]">
        <div className="flex overflow-hidden rounded border border-arch-border">
          <button
            type="button"
            onClick={() => switchMode('en')}
            className={cn(
              'px-3 py-1',
              mode === 'en' ? 'bg-arch-accent text-white' : 'text-arch-muted hover:text-arch-text',
            )}
          >
            英文
          </button>
          <button
            type="button"
            onClick={() => switchMode('zh')}
            className={cn(
              'px-3 py-1',
              mode === 'zh' ? 'bg-arch-accent text-white' : 'text-arch-muted hover:text-arch-text',
            )}
          >
            中文
          </button>
        </div>

        <div className="ml-auto flex items-center gap-3 tabular-nums text-[12px]">
          <Stat label="WPM" value={live ? String(live.wpm) : '—'} />
          <Stat label="准确率" value={live ? `${live.acc}%` : '—'} />
          <Stat label="用时" value={live ? `${live.time}s` : '0s'} />
          <Stat label="错误" value={live ? String(live.errors) : '0'} />
          {best > 0 && (
            <span className="flex items-center gap-1 text-arch-accent" title="历史最佳 WPM">
              <Trophy size={13} /> {best}
            </span>
          )}
          <button
            type="button"
            onClick={() => newRound()}
            className="flex items-center gap-1 rounded border border-arch-border px-2 py-1 text-arch-muted hover:text-arch-text"
          >
            <RotateCcw size={13} /> 重开
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-3">
        {/* 文本展示 */}
        <div
          className="mb-3 whitespace-pre-wrap break-words rounded-lg border border-arch-border bg-arch-panel p-4 text-[15px] leading-7"
          onClick={() => textareaRef.current?.focus()}
        >
          {target.split('').map((ch, i) => {
            const typed = input[i];
            let cls = 'text-arch-muted';
            if (typed !== undefined) {
              cls = typed === ch ? 'text-arch-green' : 'bg-arch-red/30 text-arch-red';
            }
            if (i === input.length && started && !finished) {
              cls += ' border-b-2 border-arch-accent';
            }
            return (
              <span key={i} className={cls}>
                {ch}
              </span>
            );
          })}
        </div>

        {/* 输入区 */}
        <textarea
          ref={textareaRef}
          value={input}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Tab') {
              e.preventDefault();
            }
          }}
          disabled={finished}
          placeholder={finished ? '已完成，点击「重开」再来一次' : '在此区域开始输入…'}
          className="h-24 w-full resize-none rounded-lg border border-arch-border bg-arch-bg p-3 text-[15px] leading-7 text-arch-text outline-none focus:border-arch-accent disabled:opacity-60"
        />

        {/* 成绩卡 */}
        {finished && result && (
          <div className="mt-3 rounded-lg border border-arch-accent/40 bg-arch-panel p-4">
            <div className="mb-2 flex items-center justify-between">
              <span className="text-[13px] text-arch-text">本次成绩</span>
              <button
                type="button"
                onClick={() => newRound()}
                className="flex items-center gap-1 rounded border border-arch-accent bg-arch-accent px-3 py-1 text-white"
              >
                <RotateCcw size={13} /> 再来一次
              </button>
            </div>
            <div className="grid grid-cols-4 gap-2 text-center tabular-nums">
              <BigStat icon={Keyboard} label="WPM" value={result.wpm} />
              <BigStat icon={Check} label="准确率" value={`${result.acc}%`} />
              <BigStat icon={X} label="错误" value={result.errors} />
              <BigStat icon={Trophy} label="耗时" value={`${result.time}s`} />
            </div>
          </div>
        )}

        {/* 历史趋势 */}
        {history.length > 0 && (
          <div className="mt-3 rounded-lg border border-arch-border bg-arch-panel p-3">
            <div className="mb-2 text-[12px] text-arch-muted">最近成绩（最新在左）</div>
            <div className="flex flex-col gap-1">
              {history.slice(0, 10).map((h, i) => (
                <div
                  key={h.at}
                  className="flex items-center gap-2 text-[11px] tabular-nums text-arch-muted"
                >
                  <span className="w-4 text-right">{i + 1}</span>
                  <span className="w-8 text-arch-text">{h.mode === 'en' ? '英' : '中'}</span>
                  <span className="w-14 text-arch-text">{h.wpm} WPM</span>
                  <span className="w-14">准 {h.acc}%</span>
                  <span className="w-12">错 {h.errors}</span>
                  <span>{h.time}s</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* 虚拟键盘（英文模式高亮下一键） */}
        {mode === 'en' && !finished && (
          <div className="mt-3 rounded-lg border border-arch-border bg-arch-panel p-3">
            <div className="mb-2 flex items-center gap-1 text-[11px] text-arch-muted">
              <Keyboard size={13} /> 下一键：{nextKey ? nextKey.toUpperCase() : '—'}
            </div>
            <div className="flex flex-col items-center gap-1">
              {KEY_ROWS.map((row) => (
                <div key={row} className="flex gap-1">
                  {row.split('').map((k) => (
                    <div
                      key={k}
                      className={cn(
                        'flex h-7 w-7 items-center justify-center rounded border text-[12px] tabular-nums',
                        k === nextKey
                          ? 'border-arch-accent bg-arch-accent text-white'
                          : 'border-arch-border text-arch-muted',
                      )}
                    >
                      {k.toUpperCase()}
                    </div>
                  ))}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <span className="flex items-center gap-1 text-arch-muted">
      {label}
      <span className="text-arch-text">{value}</span>
    </span>
  );
}

function BigStat({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof Keyboard;
  label: string;
  value: string | number;
}) {
  return (
    <div className="flex flex-col items-center rounded bg-arch-bg py-2">
      <Icon size={15} className="text-arch-accent" />
      <span className="mt-1 text-lg font-semibold text-arch-text">{value}</span>
      <span className="text-[10px] text-arch-muted">{label}</span>
    </div>
  );
}
