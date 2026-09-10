import { useState } from 'react';
import { Delete } from 'lucide-react';
import type { AppProps } from '@/shell/types';
import { evalExpr, round10 } from '@/lib/expr';

/**
 * 一个够用就行的桌面计算器：
 * - 数字 / 运算符 / 小数点 / 等号 / 清空 / 退格
 * - 显示当前表达式与最近一次结果
 * - 键盘：数字键、+ - * /、Enter、Backspace、Esc
 */
const OPS = '+-*/';

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
      // 刚算完就退格 = 放弃结果重新开始，否则 display / expr 同步回退
      if (reset) {
        setDisplay('0');
        setExpr('');
        setReset(false);
        return;
      }
      const next = display.length > 1 ? display.slice(0, -1) : '';
      setDisplay(next || '0');
      setExpr(next);
      return;
    }
    if (key === '=') {
      const src = reset ? display : expr || display;
      try {
        const v = round10(evalExpr(src));
        if (!Number.isFinite(v)) throw new Error('结果无效');
        setExpr(`${src}=${String(v)}`);
        setDisplay(String(v));
      } catch {
        setDisplay('Error');
        setExpr('');
      }
      setReset(true);
      return;
    }
    if (OPS.includes(key)) {
      // 连续按运算符时替换掉末尾那个，避免拼出 2++3 这种畸形表达式
      const base = reset
        ? display
        : /[+\-*/]$/.test(display)
          ? display.slice(0, -1)
          : display;
      const next = base + key;
      setExpr(next);
      setDisplay(next);
      setReset(false);
      return;
    }
    // 数字 / 小数点 / 括号
    if (reset || display === '0') {
      setDisplay(key);
      setExpr(key);
      setReset(false);
      return;
    }
    setDisplay(display + key);
    setExpr(expr + key);
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
