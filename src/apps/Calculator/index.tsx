import { useState } from 'react';
import { Delete } from 'lucide-react';
import type { AppProps } from '@/shell/types';

/**
 * 一个够用就行的桌面计算器：
 * - 数字 / 运算符 / 小数点 / 等号 / 清空 / 退格
 * - 显示当前表达式与最近一次结果
 * - 键盘：数字键、+ - * /、Enter、Backspace、Esc
 */
export default function Calculator(_: AppProps) {
  const [display, setDisplay] = useState('0');
  const [expr, setExpr] = useState('');
  const [reset, setReset] = useState(false);

  const input = (key: string) => {
    if (key === 'C') {
      setDisplay('0');
      setExpr('');
      setReset(false);
      return;
    }
    if (key === '←') {
      setDisplay((d) => (d.length > 1 ? d.slice(0, -1) : '0'));
      return;
    }
    if (key === '=') {
      try {
        // eslint-disable-next-line no-new-func
        const safe = expr.replace(/[^0-9+\-*/(). ]/g, '');
        // eslint-disable-next-line no-new-func
        const v = Function(`"use strict"; return (${safe || display})`)();
        const result = String(round(v));
        setExpr(`${expr}=${result}`);
        setDisplay(result);
        setReset(true);
      } catch {
        setDisplay('Error');
        setReset(true);
      }
      return;
    }
    if (/[+\-*/]/.test(key)) {
      setExpr((reset ? display : display) + key);
      setDisplay((reset ? '0' : display) + key);
      setReset(false);
      return;
    }
    if (display === '0' || reset) {
      setDisplay(key);
      setReset(false);
    } else {
      setDisplay(display + key);
    }
    setExpr((e) => e + key);
  };

  const keys: Array<[string, string?]> = [
    ['C', 'clear'],
    ['(', 'op'],
    [')', 'op'],
    ['←', 'fn'],
    ['7'],
    ['8'],
    ['9'],
    ['/', 'op'],
    ['4'],
    ['5'],
    ['6'],
    ['*', 'op'],
    ['1'],
    ['2'],
    ['3'],
    ['-', 'op'],
    ['0'],
    ['.'],
    ['=', 'eq'],
    ['+', 'op'],
  ];

  return (
    <div
      className="flex h-full select-none flex-col bg-arch-bg p-3 text-arch-text"
      onKeyDown={(e) => {
        const k = e.key;
        if (/[0-9+\-*/.]/.test(k)) {
          e.preventDefault();
          input(k);
        } else if (k === 'Enter' || k === '=') {
          e.preventDefault();
          input('=');
        } else if (k === 'Backspace') {
          e.preventDefault();
          input('←');
        } else if (k === 'Escape' || k === 'c' || k === 'C') {
          e.preventDefault();
          input('C');
        }
      }}
      tabIndex={0}
    >
      <div className="mb-2 rounded border border-arch-border bg-black/40 p-3 text-right">
        <div className="h-4 truncate text-[11px] text-arch-muted">{expr}</div>
        <div className="font-mono text-3xl">{display}</div>
      </div>
      <div className="grid flex-1 grid-cols-4 gap-2">
        {keys.map(([k, kind]) => {
          const base =
            'rounded font-mono text-base transition active:scale-95 flex items-center justify-center';
          const tone =
            kind === 'eq'
              ? 'bg-arch-accent text-white hover:bg-arch-accent-dim'
              : kind === 'op'
                ? 'bg-arch-panel text-arch-accent hover:bg-arch-border'
                : kind === 'fn' || kind === 'clear'
                  ? 'bg-arch-panel text-arch-red hover:bg-arch-border'
                  : 'bg-arch-panel hover:bg-arch-border';
          return (
            <button
              key={k}
              type="button"
              onClick={() => input(k)}
              className={`${base} ${tone}`}
              style={{ minHeight: 44 }}
            >
              {k === '←' ? <Delete size={16} /> : k}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function round(n: number): number {
  if (!Number.isFinite(n)) return NaN;
  // 保留 10 位小数后再去掉末尾零
  const v = Math.round(n * 1e10) / 1e10;
  return v;
}
