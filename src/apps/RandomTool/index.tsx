import { useEffect, useState } from 'react';
import {
  Dices,
  Copy,
  Check,
  KeyRound,
  Hash,
  Shuffle,
  RefreshCw,
  Layers,
} from 'lucide-react';
import type { AppProps } from '@/shell/types';
import { cn } from '@/lib/cn';
import { notify } from '@/stores/useNotifyStore';
import { rememberClip } from '@/stores/useClipboardStore';

function randInt(n: number): number {
  return Math.floor(Math.random() * n);
}

async function copyText(text: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
    rememberClip(text);
    notify('已复制', text.length > 40 ? `${text.slice(0, 40)}…` : text, 'success');
  } catch {
    notify('复制失败', '浏览器拒绝了剪贴板访问', 'error');
  }
}

function uuidv4(): string {
  const c = globalThis.crypto as unknown as {
    randomUUID?: () => string;
    getRandomValues?: (arr: Uint8Array) => Uint8Array;
  };
  if (c.randomUUID) return c.randomUUID();
  if (c.getRandomValues) {
    const b = new Uint8Array(16);
    c.getRandomValues(b);
    b[6] = (b[6] & 0x0f) | 0x40;
    b[8] = (b[8] & 0x3f) | 0x80;
    const h = Array.from(b, (x) => x.toString(16).padStart(2, '0'));
    return `${h.slice(0, 4).join('')}-${h.slice(4, 6).join('')}-${h
      .slice(6, 8)
      .join('')}-${h.slice(8, 10).join('')}-${h.slice(10, 16).join('')}`;
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (ch) => {
    const r = randInt(16);
    const v = ch === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

function randHex(): string {
  return '#' + Math.floor(Math.random() * 0xffffff).toString(16).padStart(6, '0');
}

type Tab = 'number' | 'password' | 'uuid' | 'draw' | 'color' | 'dice';

const DICE = [4, 6, 8, 12, 20, 100];

export default function RandomTool({ context }: AppProps) {
  useEffect(() => {
    context.setTitle('随机与生成');
  }, [context]);

  const [tab, setTab] = useState<Tab>('number');

  // 随机数
  const [min, setMin] = useState(1);
  const [max, setMax] = useState(100);
  const [count, setCount] = useState(5);
  const [allowDup, setAllowDup] = useState(true);
  const [numbers, setNumbers] = useState<number[]>([]);
  const [numCopied, setNumCopied] = useState(false);

  const genNumbers = () => {
    const lo = Math.min(min, max);
    const hi = Math.max(min, max);
    const span = hi - lo + 1;
    const n = Math.max(1, Math.min(count, 10000));
    if (!allowDup && n > span) {
      notify('数量超过范围', '不重复模式下结果数不能大于区间大小', 'warn');
      return;
    }
    const out: number[] = [];
    if (allowDup) {
      for (let i = 0; i < n; i++) out.push(lo + randInt(span));
    } else {
      const pool: number[] = [];
      for (let v = lo; v <= hi; v++) pool.push(v);
      for (let i = pool.length - 1; i > 0; i--) {
        const j = randInt(i + 1);
        [pool[i], pool[j]] = [pool[j] as number, pool[i] as number];
      }
      for (let i = 0; i < n; i++) out.push(pool[i] as number);
    }
    setNumbers(out);
    setNumCopied(false);
  };

  // 密码
  const [pwLen, setPwLen] = useState(16);
  const [useUpper, setUseUpper] = useState(true);
  const [useLower, setUseLower] = useState(true);
  const [useDigit, setUseDigit] = useState(true);
  const [useSymbol, setUseSymbol] = useState(true);
  const [excludeAmb, setExcludeAmb] = useState(true);
  const [password, setPassword] = useState('');
  const [pwCopied, setPwCopied] = useState(false);

  const genPassword = () => {
    let chars = '';
    if (useUpper) chars += 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
    if (useLower) chars += 'abcdefghijklmnopqrstuvwxyz';
    if (useDigit) chars += '0123456789';
    if (useSymbol) chars += '!@#$%^&*()-_=+[]{};:,.<>?';
    if (excludeAmb) chars = chars.split('').filter((c) => !'0O1lI'.includes(c)).join('');
    if (!chars) {
      notify('字符集为空', '请至少开启一类字符', 'warn');
      setPassword('');
      return;
    }
    let out = '';
    for (let i = 0; i < pwLen; i++) out += chars[randInt(chars.length)];
    setPassword(out);
    setPwCopied(false);
  };

  const pwCharsetSize = (() => {
    let s = 0;
    if (useUpper) s += 26;
    if (useLower) s += 26;
    if (useDigit) s += 10;
    if (useSymbol) s += 22;
    if (excludeAmb) s = Math.max(0, s - 4);
    return s;
  })();
  const pwBits = pwCharsetSize > 1 ? Math.round(pwLen * Math.log2(pwCharsetSize)) : 0;
  const pwStrength =
    pwBits >= 80 ? '极强' : pwBits >= 60 ? '强' : pwBits >= 40 ? '中' : '弱';

  // UUID
  const [uuids, setUuids] = useState<string[]>([]);
  const [uuidCount, setUuidCount] = useState(3);
  const genUuids = () => {
    const n = Math.max(1, Math.min(uuidCount, 200));
    setUuids(Array.from({ length: n }, () => uuidv4()));
  };

  // 抽取
  const [candidates, setCandidates] = useState('苹果\n香蕉\n橙子\n西瓜\n葡萄');
  const [drawCount, setDrawCount] = useState(1);
  const [draws, setDraws] = useState<string[]>([]);

  const genDraw = () => {
    const list = candidates
      .split('\n')
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
    const n = Math.max(1, Math.min(drawCount, list.length || 1));
    if (list.length === 0) {
      notify('候选为空', '请每行填写一个候选', 'warn');
      return;
    }
    const pool = [...list];
    for (let i = pool.length - 1; i > 0; i--) {
      const j = randInt(i + 1);
      [pool[i], pool[j]] = [pool[j] as string, pool[i] as string];
    }
    setDraws(pool.slice(0, n));
  };

  // 颜色
  const [colors, setColors] = useState<string[]>([]);
  const [colorCount, setColorCount] = useState(6);
  const genColors = () => {
    const n = Math.max(1, Math.min(colorCount, 50));
    setColors(Array.from({ length: n }, () => randHex()));
  };

  // 掷骰
  const [diceResult, setDiceResult] = useState<string>('');
  const [diceHistory, setDiceHistory] = useState<string[]>([]);
  const roll = (sides: number) => {
    const v = randInt(sides) + 1;
    const label = `D${sides} → ${v}`;
    setDiceResult(label);
    setDiceHistory((prev) => [label, ...prev].slice(0, 12));
  };
  const flipCoin = () => {
    const v = randInt(2) === 0 ? '正面' : '反面';
    setDiceResult(`硬币 → ${v}`);
    setDiceHistory((prev) => [`硬币 → ${v}`, ...prev].slice(0, 12));
  };

  const tabs: Array<[Tab, string, typeof Dices]> = [
    ['number', '随机数', Hash],
    ['password', '密码', KeyRound],
    ['uuid', 'UUID', Hash],
    ['draw', '抽取', Shuffle],
    ['color', '颜色', Layers],
    ['dice', '掷骰', Dices],
  ];

  return (
    <div className="flex h-full flex-col bg-arch-bg text-arch-text">
      <div className="flex flex-wrap gap-1 border-b border-arch-border bg-arch-panel/80 px-3 py-1.5">
        {tabs.map(([id, label, Icon]) => (
          <button
            key={id}
            type="button"
            onClick={() => setTab(id)}
            className={cn(
              'flex items-center gap-1 rounded px-2 py-1 text-xs',
              tab === id ? 'bg-arch-accent text-white' : 'hover:bg-white/10',
            )}
          >
            <Icon size={13} /> {label}
          </button>
        ))}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-3 text-[12px]">
        {tab === 'number' && (
          <div className="space-y-3">
            <div className="flex flex-wrap items-end gap-3">
              <label className="flex flex-col gap-1">
                <span className="text-[11px] text-arch-muted">最小值</span>
                <input
                  type="number"
                  value={min}
                  onChange={(e) => setMin(Number(e.target.value))}
                  className="w-20 rounded border border-arch-border bg-black/30 px-2 py-1 font-mono"
                />
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-[11px] text-arch-muted">最大值</span>
                <input
                  type="number"
                  value={max}
                  onChange={(e) => setMax(Number(e.target.value))}
                  className="w-20 rounded border border-arch-border bg-black/30 px-2 py-1 font-mono"
                />
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-[11px] text-arch-muted">数量</span>
                <input
                  type="number"
                  value={count}
                  onChange={(e) => setCount(Math.max(1, Number(e.target.value)))}
                  className="w-20 rounded border border-arch-border bg-black/30 px-2 py-1 font-mono"
                />
              </label>
              <label className="flex items-center gap-1 pb-1.5 text-[11px]">
                <input
                  type="checkbox"
                  checked={allowDup}
                  onChange={(e) => setAllowDup(e.target.checked)}
                />
                允许重复
              </label>
            </div>
            <button
              type="button"
              onClick={genNumbers}
              className="flex items-center gap-1 rounded bg-arch-accent px-3 py-1.5 text-xs text-white hover:bg-arch-accent/80"
            >
              <RefreshCw size={13} /> 生成
            </button>
            {numbers.length > 0 && (
              <div className="rounded border border-arch-border bg-arch-panel/40">
                <div className="flex items-center justify-between border-b border-arch-border px-2 py-1">
                  <span className="text-[11px] text-arch-muted">
                    共 {numbers.length} 个
                  </span>
                  <button
                    type="button"
                    onClick={async () => {
                      await copyText(numbers.join('\n'));
                      setNumCopied(true);
                      window.setTimeout(() => setNumCopied(false), 1000);
                    }}
                    className="flex items-center gap-1 text-arch-accent hover:underline"
                  >
                    {numCopied ? <Check size={12} /> : <Copy size={12} />} 复制全部
                  </button>
                </div>
                <div className="max-h-48 overflow-y-auto p-2 font-mono">
                  {numbers.map((v, i) => (
                    <span key={i} className="mr-2 inline-block">
                      {v}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {tab === 'password' && (
          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-3">
              <label className="flex flex-col gap-1">
                <span className="text-[11px] text-arch-muted">长度 {pwLen}</span>
                <input
                  type="range"
                  min={4}
                  max={64}
                  value={pwLen}
                  onChange={(e) => setPwLen(Number(e.target.value))}
                  className="w-40"
                />
              </label>
            </div>
            <div className="flex flex-wrap gap-3 text-[11px]">
              {(
                [
                  ['useUpper', '大写', setUseUpper],
                  ['useLower', '小写', setUseLower],
                  ['useDigit', '数字', setUseDigit],
                  ['useSymbol', '符号', setUseSymbol],
                  ['excludeAmb', '排除易混淆(0O1lI)', setExcludeAmb],
                ] as Array<[string, string, (v: boolean) => void]>
              ).map(([key, label, setter]) => {
                const on =
                  key === 'useUpper'
                    ? useUpper
                    : key === 'useLower'
                      ? useLower
                      : key === 'useDigit'
                        ? useDigit
                        : key === 'useSymbol'
                          ? useSymbol
                          : excludeAmb;
                return (
                  <label key={key} className="flex items-center gap-1">
                    <input
                      type="checkbox"
                      checked={on}
                      onChange={(e) => setter(e.target.checked)}
                    />
                    {label}
                  </label>
                );
              })}
            </div>
            <button
              type="button"
              onClick={genPassword}
              className="flex items-center gap-1 rounded bg-arch-accent px-3 py-1.5 text-xs text-white hover:bg-arch-accent/80"
            >
              <RefreshCw size={13} /> 生成
            </button>
            {password && (
              <div className="rounded border border-arch-border bg-arch-panel/40 p-2">
                <div className="flex items-center justify-between gap-2">
                  <code className="break-all font-mono text-[13px]">{password}</code>
                  <button
                    type="button"
                    onClick={async () => {
                      await copyText(password);
                      setPwCopied(true);
                      window.setTimeout(() => setPwCopied(false), 1000);
                    }}
                    className="flex shrink-0 items-center gap-1 text-arch-accent hover:underline"
                  >
                    {pwCopied ? <Check size={12} /> : <Copy size={12} />} 复制
                  </button>
                </div>
                <div className="mt-2 flex items-center gap-2 text-[11px] text-arch-muted">
                  <span>熵值约 {pwBits} bit</span>
                  <span
                    className={cn(
                      'rounded px-1.5 py-0.5',
                      pwStrength === '弱'
                        ? 'bg-arch-red/20 text-arch-red'
                        : pwStrength === '中'
                          ? 'bg-arch-accent/20 text-arch-accent'
                          : 'bg-arch-green/20 text-arch-green',
                    )}
                  >
                    强度：{pwStrength}
                  </span>
                </div>
              </div>
            )}
          </div>
        )}

        {tab === 'uuid' && (
          <div className="space-y-3">
            <div className="flex items-end gap-3">
              <label className="flex flex-col gap-1">
                <span className="text-[11px] text-arch-muted">数量</span>
                <input
                  type="number"
                  value={uuidCount}
                  onChange={(e) => setUuidCount(Math.max(1, Number(e.target.value)))}
                  className="w-20 rounded border border-arch-border bg-black/30 px-2 py-1 font-mono"
                />
              </label>
              <button
                type="button"
                onClick={genUuids}
                className="flex items-center gap-1 rounded bg-arch-accent px-3 py-1.5 text-xs text-white hover:bg-arch-accent/80"
              >
                <RefreshCw size={13} /> 生成
              </button>
            </div>
            {uuids.length > 0 && (
              <div className="space-y-1">
                {uuids.map((u, i) => (
                  <div
                    key={i}
                    className="flex items-center justify-between gap-2 rounded border border-arch-border bg-arch-panel/40 px-2 py-1 font-mono"
                  >
                    <span className="min-w-0 flex-1 truncate">{u}</span>
                    <button
                      type="button"
                      onClick={() => copyText(u)}
                      className="flex shrink-0 items-center gap-1 text-arch-accent hover:underline"
                    >
                      <Copy size={12} />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {tab === 'draw' && (
          <div className="space-y-3">
            <label className="flex flex-col gap-1">
              <span className="text-[11px] text-arch-muted">候选（每行一个）</span>
              <textarea
                value={candidates}
                onChange={(e) => setCandidates(e.target.value)}
                rows={5}
                className="resize-none rounded border border-arch-border bg-black/30 p-2 font-mono outline-none"
              />
            </label>
            <div className="flex items-center gap-3">
              <label className="flex items-center gap-1 text-[11px]">
                抽取数量
                <input
                  type="number"
                  value={drawCount}
                  onChange={(e) => setDrawCount(Math.max(1, Number(e.target.value)))}
                  className="w-16 rounded border border-arch-border bg-black/30 px-2 py-1 font-mono"
                />
              </label>
              <button
                type="button"
                onClick={genDraw}
                className="flex items-center gap-1 rounded bg-arch-accent px-3 py-1.5 text-xs text-white hover:bg-arch-accent/80"
              >
                <Shuffle size={13} /> 抽取
              </button>
            </div>
            {draws.length > 0 && (
              <div className="space-y-1">
                {draws.map((d, i) => (
                  <div
                    key={i}
                    className="rounded border border-arch-border bg-arch-panel/40 px-3 py-2 font-mono text-[13px]"
                  >
                    第 {i + 1} 个：{d}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {tab === 'color' && (
          <div className="space-y-3">
            <div className="flex items-end gap-3">
              <label className="flex flex-col gap-1">
                <span className="text-[11px] text-arch-muted">数量</span>
                <input
                  type="number"
                  value={colorCount}
                  onChange={(e) => setColorCount(Math.max(1, Number(e.target.value)))}
                  className="w-20 rounded border border-arch-border bg-black/30 px-2 py-1 font-mono"
                />
              </label>
              <button
                type="button"
                onClick={genColors}
                className="flex items-center gap-1 rounded bg-arch-accent px-3 py-1.5 text-xs text-white hover:bg-arch-accent/80"
              >
                <RefreshCw size={13} /> 生成
              </button>
            </div>
            {colors.length > 0 && (
              <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
                {colors.map((c, i) => (
                  <button
                    key={i}
                    type="button"
                    onClick={() => copyText(c)}
                    className="flex h-14 flex-col items-center justify-center rounded border border-arch-border font-mono text-[11px]"
                    style={{ background: c, color: '#fff' }}
                  >
                    <span className="truncate px-1" style={{ color: '#fff' }}>
                      {c}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {tab === 'dice' && (
          <div className="space-y-3">
            <div className="flex flex-wrap gap-2">
              {DICE.map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => roll(s)}
                  className="rounded bg-arch-panel px-3 py-2 text-xs hover:bg-white/10"
                >
                  D{s}
                </button>
              ))}
              <button
                type="button"
                onClick={flipCoin}
                className="rounded bg-arch-panel px-3 py-2 text-xs hover:bg-white/10"
              >
                硬币
              </button>
            </div>
            {diceResult && (
              <div className="rounded border border-arch-border bg-arch-panel/40 p-4 text-center font-mono text-2xl">
                {diceResult}
              </div>
            )}
            {diceHistory.length > 0 && (
              <div>
                <h3 className="mb-1 text-[11px] text-arch-muted">最近记录</h3>
                <div className="space-y-1">
                  {diceHistory.map((h, i) => (
                    <div
                      key={i}
                      className="rounded border border-arch-border bg-arch-panel/40 px-3 py-1 font-mono text-[12px]"
                    >
                      {h}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
