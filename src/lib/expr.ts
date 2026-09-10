/**
 * 四则运算表达式求值（手写递归下降）。
 *
 * 原本内联在计算器里，命令面板的内联计算、单位换算等也要用，所以抽出来共用。
 * 支持：数字（含小数）、+ - * /、括号、一元正负号、空白。
 */

type Tok = { t: 'num'; v: number } | { t: 'op'; v: string };

function tokenize(src: string): Tok[] {
  const out: Tok[] = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (c === ' ' || c === '\t') {
      i++;
      continue;
    }
    if ((c >= '0' && c <= '9') || c === '.') {
      let j = i;
      while (j < src.length && /[0-9.]/.test(src[j])) j++;
      const n = Number(src.slice(i, j));
      if (!Number.isFinite(n)) throw new Error(`非法数字 ${src.slice(i, j)}`);
      out.push({ t: 'num', v: n });
      i = j;
      continue;
    }
    if ('+-*/()'.includes(c)) {
      out.push({ t: 'op', v: c });
      i++;
      continue;
    }
    throw new Error(`非法字符 ${c}`);
  }
  return out;
}

export function evalExpr(src: string): number {
  const toks = tokenize(src);
  let pos = 0;
  const peek = (): Tok | undefined => toks[pos];

  const parseExpr = (): number => {
    let left = parseTerm();
    for (;;) {
      const tk = peek();
      if (!tk || tk.t !== 'op' || (tk.v !== '+' && tk.v !== '-')) break;
      pos++;
      const right = parseTerm();
      left = tk.v === '+' ? left + right : left - right;
    }
    return left;
  };

  const parseTerm = (): number => {
    let left = parseFactor();
    for (;;) {
      const tk = peek();
      if (!tk || tk.t !== 'op' || (tk.v !== '*' && tk.v !== '/')) break;
      pos++;
      const right = parseFactor();
      if (tk.v === '/' && right === 0) throw new Error('除零');
      left = tk.v === '*' ? left * right : left / right;
    }
    return left;
  };

  const parseFactor = (): number => {
    const tk = peek();
    if (!tk) throw new Error('表达式不完整');
    if (tk.t === 'num') {
      pos++;
      return tk.v;
    }
    if (tk.v === '-' || tk.v === '+') {
      pos++;
      const v = parseFactor();
      return tk.v === '-' ? -v : v;
    }
    if (tk.v === '(') {
      pos++;
      const v = parseExpr();
      const close = peek();
      if (!close || close.t !== 'op' || close.v !== ')') throw new Error('括号不匹配');
      pos++;
      return v;
    }
    throw new Error('语法错误');
  };

  if (toks.length === 0) throw new Error('空表达式');
  const value = parseExpr();
  if (pos < toks.length) throw new Error('表达式有多余内容');
  return value;
}

/** 保留 10 位小数再去掉浮点噪声 */
export function round10(n: number): number {
  if (!Number.isFinite(n)) return NaN;
  return Math.round(n * 1e10) / 1e10;
}

/**
 * 宽松求值：整个输入看起来就是个算式才返回结果，否则返回 null。
 * 命令面板靠这个做内联计算，避免把搜索词误当公式。
 */
export function tryEval(src: string): number | null {
  const s = src.trim();
  if (!s) return null;
  // 必须同时含数字和运算符，且只由算式字符组成
  if (!/\d/.test(s)) return null;
  if (!/[+\-*/]/.test(s)) return null;
  if (!/^[0-9+\-*/().\s]+$/.test(s)) return null;
  try {
    const v = round10(evalExpr(s));
    return Number.isFinite(v) ? v : null;
  } catch {
    return null;
  }
}
