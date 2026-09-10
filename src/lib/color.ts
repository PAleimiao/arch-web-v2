/**
 * 极简颜色工具：hex / rgb / hsl 互转 + 明暗调整 + 对比色。
 * 悬浮取色器、主题强调色派生、画图板都共用这一份。
 */

export interface Rgb {
  r: number;
  g: number;
  b: number;
}

export interface Hsl {
  h: number;
  s: number;
  l: number;
}

export function clamp(n: number, min: number, max: number): number {
  return Math.min(Math.max(n, min), max);
}

export function hexToRgb(hex: string): Rgb {
  let h = hex.trim().replace(/^#/, '');
  if (h.length === 3) {
    h = h
      .split('')
      .map((c) => c + c)
      .join('');
  }
  if (!/^[0-9a-fA-F]{6}$/.test(h)) return { r: 0, g: 0, b: 0 };
  return {
    r: parseInt(h.slice(0, 2), 16),
    g: parseInt(h.slice(2, 4), 16),
    b: parseInt(h.slice(4, 6), 16),
  };
}

export function rgbToHex({ r, g, b }: Rgb): string {
  const to = (n: number) => clamp(Math.round(n), 0, 255).toString(16).padStart(2, '0');
  return `#${to(r)}${to(g)}${to(b)}`;
}

export function rgbToHsl({ r, g, b }: Rgb): Hsl {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const d = max - min;
  let h = 0;
  if (d !== 0) {
    if (max === rn) h = ((gn - bn) / d) % 6;
    else if (max === gn) h = (bn - rn) / d + 2;
    else h = (rn - gn) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  const l = (max + min) / 2;
  const s = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1));
  return { h: Math.round(h), s: Math.round(s * 100), l: Math.round(l * 100) };
}

export function hslToRgb({ h, s, l }: Hsl): Rgb {
  const sn = clamp(s, 0, 100) / 100;
  const ln = clamp(l, 0, 100) / 100;
  const c = (1 - Math.abs(2 * ln - 1)) * sn;
  const hp = ((h % 360) + 360) % 360 / 60;
  const x = c * (1 - Math.abs((hp % 2) - 1));
  let r = 0;
  let g = 0;
  let b = 0;
  if (hp < 1) [r, g, b] = [c, x, 0];
  else if (hp < 2) [r, g, b] = [x, c, 0];
  else if (hp < 3) [r, g, b] = [0, c, x];
  else if (hp < 4) [r, g, b] = [0, x, c];
  else if (hp < 5) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];
  const m = ln - c / 2;
  return {
    r: Math.round((r + m) * 255),
    g: Math.round((g + m) * 255),
    b: Math.round((b + m) * 255),
  };
}

/** amount > 0 变亮，< 0 变暗，范围 -1 ~ 1 */
export function shade(hex: string, amount: number): string {
  const { h, s, l } = rgbToHsl(hexToRgb(hex));
  const target = amount >= 0 ? l + (100 - l) * amount : l * (1 + amount);
  return rgbToHex(hslToRgb({ h, s, l: clamp(Math.round(target), 0, 100) }));
}

/** 相对亮度（WCAG），用来挑在该底色上可读的文字颜色 */
export function luminance(hex: string): number {
  const { r, g, b } = hexToRgb(hex);
  const f = (c: number) => {
    const v = c / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}

export function readableText(hex: string): string {
  return luminance(hex) > 0.45 ? '#0b0e14' : '#ffffff';
}

/** 生成一组配色：类似色 / 互补色 / 明暗阶梯 */
export function palette(hex: string): string[] {
  const base = hexToRgb(hex);
  const { h, s, l } = rgbToHsl(base);
  const out: string[] = [];
  for (const dl of [-30, -15, 0, 15, 30]) {
    out.push(rgbToHex(hslToRgb({ h, s, l: clamp(l + dl, 4, 96) })));
  }
  for (const dh of [30, 60, 180, 210, 330]) {
    out.push(rgbToHex(hslToRgb({ h: (h + dh) % 360, s, l })));
  }
  return out;
}
