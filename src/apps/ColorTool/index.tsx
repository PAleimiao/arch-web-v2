import { useEffect, useState } from 'react';
import { Palette, Copy, Check, Pipette, Droplet, Shuffle } from 'lucide-react';
import type { AppProps } from '@/shell/types';
import { cn } from '@/lib/cn';
import {
  hexToRgb,
  rgbToHex,
  rgbToHsl,
  hslToRgb,
  shade,
  luminance,
  readableText,
  palette,
  clamp,
  type Rgb,
  type Hsl,
} from '@/lib/color';
import { notify } from '@/stores/useNotifyStore';
import { rememberClip } from '@/stores/useClipboardStore';

/** 把任意输入规范成 #rrggbb，非法返回 null */
function normalizeHex(s: string): string | null {
  let h = s.trim().replace(/^#/, '');
  if (/^[0-9a-fA-F]{3}$/.test(h)) {
    h = h
      .split('')
      .map((c) => c + c)
      .join('');
  }
  if (/^[0-9a-fA-F]{6}$/.test(h)) return `#${h.toLowerCase()}`;
  return null;
}

/** WCAG 对比度比值：亮底 / 暗底 */
function contrastRatio(fg: string, bg: string): number {
  const l1 = luminance(fg);
  const l2 = luminance(bg);
  const light = Math.max(l1, l2);
  const dark = Math.min(l1, l2);
  return (light + 0.05) / (dark + 0.05);
}

/** 在两个 RGB 之间线性插值，t ∈ 0..1 */
function mixRgb(a: Rgb, b: Rgb, t: number): string {
  const r = Math.round(a.r + (b.r - a.r) * t);
  const g = Math.round(a.g + (b.g - a.g) * t);
  const bl = Math.round(a.b + (b.b - a.b) * t);
  return rgbToHex({ r, g, b: bl });
}

/** 两个 HSL 之间线性插值（色相直接线性过渡） */
function mixHsl(a: Hsl, b: Hsl, t: number): string {
  const h = Math.round(a.h + (b.h - a.h) * t);
  const s = Math.round(a.s + (b.s - a.s) * t);
  const l = Math.round(a.l + (b.l - a.l) * t);
  return rgbToHex(hslToRgb({ h, s, l }));
}

const ANSI16: Array<[string, string]> = [
  ['黑', '#000000'],
  ['红', '#800000'],
  ['绿', '#008000'],
  ['黄', '#808000'],
  ['蓝', '#000080'],
  ['品红', '#800080'],
  ['青', '#008080'],
  ['白', '#c0c0c0'],
  ['亮黑', '#808080'],
  ['亮红', '#ff0000'],
  ['亮绿', '#00ff00'],
  ['亮黄', '#ffff00'],
  ['亮蓝', '#0000ff'],
  ['亮品红', '#ff00ff'],
  ['亮青', '#00ffff'],
  ['亮白', '#ffffff'],
];

const BRAND: Array<[string, string]> = [
  ['Arch', '#1793d1'],
  ['GitHub', '#24292e'],
  ['红', '#e04343'],
  ['蓝', '#2d8cf0'],
  ['绿', '#2eb398'],
  ['紫', '#8e44ad'],
  ['橙', '#e67e22'],
  ['黄', '#f1c40f'],
  ['粉', '#e84393'],
  ['青', '#1abc9c'],
];

export default function ColorTool({ context }: AppProps) {
  useEffect(() => {
    context.setTitle('颜色工具');
  }, [context]);

  const [hex, setHex] = useState('#1793d1');
  const [hexText, setHexText] = useState('#1793d1');
  const [copied, setCopied] = useState<string | null>(null);

  const rgb = hexToRgb(hex);
  const hsl = rgbToHsl(rgb);

  const [mixA, setMixA] = useState('#1793d1');
  const [mixB, setMixB] = useState('#e84393');
  const [mixT, setMixT] = useState(0.5);
  const [mixSpace, setMixSpace] = useState<'rgb' | 'hsl'>('rgb');

  const [fg, setFg] = useState('#0b0e14');
  const [bg, setBg] = useState('#1793d1');

  const copy = async (text: string, label = '已复制') => {
    try {
      await navigator.clipboard.writeText(text);
      rememberClip(text);
      setCopied(text.toUpperCase());
      window.setTimeout(() => setCopied(null), 1000);
      notify(label, text, 'success');
    } catch {
      notify('复制失败', '浏览器拒绝了剪贴板访问', 'error');
    }
  };

  const setFromHex = (raw: string) => {
    setHexText(raw);
    const norm = normalizeHex(raw);
    if (norm) setHex(norm);
  };

  const setFromRgb = (ch: 'r' | 'g' | 'b', v: number) => {
    const next: Rgb = {
      r: ch === 'r' ? clamp(v, 0, 255) : rgb.r,
      g: ch === 'g' ? clamp(v, 0, 255) : rgb.g,
      b: ch === 'b' ? clamp(v, 0, 255) : rgb.b,
    };
    const norm = rgbToHex(next);
    setHex(norm);
    setHexText(norm);
  };

  const setFromHsl = (ch: 'h' | 's' | 'l', v: number) => {
    const next: Hsl = {
      h: ch === 'h' ? clamp(v, 0, 360) : hsl.h,
      s: ch === 's' ? clamp(v, 0, 100) : hsl.s,
      l: ch === 'l' ? clamp(v, 0, 100) : hsl.l,
    };
    const norm = rgbToHex(hslToRgb(next));
    setHex(norm);
    setHexText(norm);
  };

  // 10 档明暗阶梯（暗 → 亮）
  const shades: string[] = [];
  for (let i = 0; i < 10; i++) shades.push(shade(hex, -0.5 + i * 0.1));

  const scheme = palette(hex);

  const mixResult =
    mixSpace === 'rgb'
      ? mixRgb(hexToRgb(mixA), hexToRgb(mixB), mixT)
      : mixHsl(rgbToHsl(hexToRgb(mixA)), rgbToHsl(hexToRgb(mixB)), mixT);

  const ratio = contrastRatio(fg, bg);
  const passAA = ratio >= 4.5;
  const passAAA = ratio >= 7;

  const Swatch = ({
    color,
    name,
  }: {
    color: string;
    name?: string;
  }) => (
    <button
      type="button"
      title={`${name ? name + ' · ' : ''}${color} 点击复制`}
      onClick={() => copy(color)}
      className="flex h-9 w-full items-center justify-center rounded border border-arch-border font-mono text-[10px]"
      style={{ background: color, color: readableText(color) }}
    >
      {copied === color.toUpperCase() ? (
        <Check size={12} />
      ) : (
        <span className="truncate px-1">{name ?? color}</span>
      )}
    </button>
  );

  return (
    <div className="flex h-full flex-col bg-arch-bg text-arch-text">
      <div className="flex items-center gap-2 border-b border-arch-border bg-arch-panel/80 px-3 py-1.5">
        <Palette size={14} className="text-arch-accent" />
        <span className="text-xs font-medium">颜色工具</span>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-3 text-[12px]">
        {/* 取色区 */}
        <section className="mb-4">
          <h3 className="mb-2 flex items-center gap-1 text-[11px] text-arch-muted">
            <Pipette size={12} /> 取色
          </h3>
          <div className="flex items-center gap-3">
            <input
              type="color"
              value={hex}
              onChange={(e) => {
                setHex(e.target.value);
                setHexText(e.target.value);
              }}
              className="h-12 w-12 cursor-pointer rounded border border-arch-border bg-transparent"
            />
            <label className="flex flex-col gap-1">
              <span className="text-[11px] text-arch-muted">HEX</span>
              <input
                value={hexText}
                onChange={(e) => setFromHex(e.target.value)}
                spellCheck={false}
                className={cn(
                  'w-40 rounded border bg-black/30 px-2 py-1 font-mono uppercase',
                  normalizeHex(hexText) ? 'border-arch-border' : 'border-arch-red',
                )}
              />
            </label>
          </div>
          <div className="mt-2 grid grid-cols-3 gap-2">
            <div>
              <div className="mb-1 flex items-center justify-between text-[11px] text-arch-muted">
                <span>RGB</span>
                <button
                  type="button"
                  onClick={() => copy(`rgb(${rgb.r}, ${rgb.g}, ${rgb.b})`)}
                  className="text-arch-accent hover:underline"
                >
                  <Copy size={11} />
                </button>
              </div>
              <div className="flex gap-1">
                {(['r', 'g', 'b'] as const).map((ch) => (
                  <input
                    key={ch}
                    type="number"
                    min={0}
                    max={255}
                    value={ch === 'r' ? rgb.r : ch === 'g' ? rgb.g : rgb.b}
                    onChange={(e) => setFromRgb(ch, Number(e.target.value))}
                    className="w-full rounded border border-arch-border bg-black/30 px-1 py-1 text-center font-mono"
                  />
                ))}
              </div>
            </div>
            <div>
              <div className="mb-1 flex items-center justify-between text-[11px] text-arch-muted">
                <span>HSL</span>
                <button
                  type="button"
                  onClick={() => copy(`hsl(${hsl.h}, ${hsl.s}%, ${hsl.l}%)`)}
                  className="text-arch-accent hover:underline"
                >
                  <Copy size={11} />
                </button>
              </div>
              <div className="flex gap-1">
                {(['h', 's', 'l'] as const).map((ch) => (
                  <input
                    key={ch}
                    type="number"
                    min={0}
                    max={ch === 'h' ? 360 : 100}
                    value={ch === 'h' ? hsl.h : ch === 's' ? hsl.s : hsl.l}
                    onChange={(e) => setFromHsl(ch, Number(e.target.value))}
                    className="w-full rounded border border-arch-border bg-black/30 px-1 py-1 text-center font-mono"
                  />
                ))}
              </div>
            </div>
            <div>
              <div className="mb-1 text-[11px] text-arch-muted">HEX</div>
              <button
                type="button"
                onClick={() => copy(hex)}
                className="flex h-[34px] w-full items-center justify-center gap-1 rounded border border-arch-border bg-black/30 font-mono hover:bg-white/10"
              >
                {hex} <Copy size={11} />
              </button>
            </div>
          </div>
        </section>

        {/* 明暗阶梯 */}
        <section className="mb-4">
          <h3 className="mb-2 flex items-center gap-1 text-[11px] text-arch-muted">
            <Droplet size={12} /> 明暗阶梯（10 档）
          </h3>
          <div className="grid grid-cols-10 gap-1">
            {shades.map((c, i) => (
              <Swatch key={`${c}-${i}`} color={c} />
            ))}
          </div>
        </section>

        {/* 配色方案 */}
        <section className="mb-4">
          <h3 className="mb-2 flex items-center gap-1 text-[11px] text-arch-muted">
            <Palette size={12} /> 配色方案（类似色 / 互补 / 三分）
          </h3>
          <div className="grid grid-cols-10 gap-1">
            {scheme.map((c, i) => (
              <Swatch key={`${c}-${i}`} color={c} />
            ))}
          </div>
        </section>

        {/* 混色 */}
        <section className="mb-4">
          <h3 className="mb-2 flex items-center gap-1 text-[11px] text-arch-muted">
            <Shuffle size={12} /> 混色
          </h3>
          <div className="flex flex-wrap items-center gap-2">
            <input
              type="color"
              value={mixA}
              onChange={(e) => setMixA(e.target.value)}
              className="h-8 w-8 cursor-pointer rounded border border-arch-border"
            />
            <input
              type="color"
              value={mixB}
              onChange={(e) => setMixB(e.target.value)}
              className="h-8 w-8 cursor-pointer rounded border border-arch-border"
            />
            <input
              type="range"
              min={0}
              max={100}
              value={Math.round(mixT * 100)}
              onChange={(e) => setMixT(Number(e.target.value) / 100)}
              className="w-40"
            />
            <span className="w-10 text-center font-mono">{Math.round(mixT * 100)}%</span>
            <div className="flex gap-1">
              {(['rgb', 'hsl'] as const).map((sp) => (
                <button
                  key={sp}
                  type="button"
                  onClick={() => setMixSpace(sp)}
                  className={cn(
                    'rounded px-2 py-0.5 text-xs uppercase',
                    mixSpace === sp ? 'bg-arch-accent text-white' : 'bg-arch-panel hover:bg-white/10',
                  )}
                >
                  {sp}
                </button>
              ))}
            </div>
          </div>
          <button
            type="button"
            onClick={() => copy(mixResult)}
            className="mt-2 flex h-10 w-full items-center justify-center gap-2 rounded border border-arch-border font-mono"
            style={{ background: mixResult, color: readableText(mixResult) }}
          >
            {mixResult} <Copy size={12} />
          </button>
        </section>

        {/* 对比度 */}
        <section className="mb-4">
          <h3 className="mb-2 flex items-center gap-1 text-[11px] text-arch-muted">
            <Droplet size={12} /> 对比度检测（WCAG）
          </h3>
          <div className="flex items-center gap-2">
            <label className="flex items-center gap-1 text-[11px]">
              前景
              <input
                type="color"
                value={fg}
                onChange={(e) => setFg(e.target.value)}
                className="h-7 w-7 cursor-pointer rounded border border-arch-border"
              />
            </label>
            <label className="flex items-center gap-1 text-[11px]">
              背景
              <input
                type="color"
                value={bg}
                onChange={(e) => setBg(e.target.value)}
                className="h-7 w-7 cursor-pointer rounded border border-arch-border"
              />
            </label>
            <span className="ml-2 font-mono text-base">{ratio.toFixed(2)} : 1</span>
            <span
              className={cn(
                'rounded px-1.5 py-0.5 text-[11px]',
                passAA ? 'bg-arch-green/20 text-arch-green' : 'bg-arch-red/20 text-arch-red',
              )}
            >
              AA {passAA ? '通过' : '未过'}
            </span>
            <span
              className={cn(
                'rounded px-1.5 py-0.5 text-[11px]',
                passAAA ? 'bg-arch-green/20 text-arch-green' : 'bg-arch-red/20 text-arch-red',
              )}
            >
              AAA {passAAA ? '通过' : '未过'}
            </span>
          </div>
          <div
            className="mt-2 flex h-14 items-center justify-center rounded border border-arch-border text-base"
            style={{ background: bg, color: fg }}
          >
            示例文字 Sample Text
          </div>
        </section>

        {/* 预设 */}
        <section>
          <h3 className="mb-2 text-[11px] text-arch-muted">预设（终端 ANSI 16 色）</h3>
          <div className="mb-3 grid grid-cols-8 gap-1">
            {ANSI16.map(([name, c]) => (
              <Swatch key={c} color={c} name={name} />
            ))}
          </div>
          <h3 className="mb-2 text-[11px] text-arch-muted">品牌色</h3>
          <div className="grid grid-cols-5 gap-1">
            {BRAND.map(([name, c]) => (
              <Swatch key={c} color={c} name={name} />
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}
