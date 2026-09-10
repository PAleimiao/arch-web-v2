import { useEffect, useState } from 'react';
import { Calculator, ArrowRightLeft } from 'lucide-react';
import type { AppProps } from '@/shell/types';
import { cn } from '@/lib/cn';
import { round10 } from '@/lib/expr';

interface FactorUnit {
  name: string;
  factor: number;
}
interface FuncUnit {
  name: string;
  toBase: (v: number) => number;
  fromBase: (v: number) => number;
}
type Unit = FactorUnit | FuncUnit;

interface Category {
  id: string;
  name: string;
  units: Unit[];
}

const CATEGORIES: Category[] = [
  {
    id: 'length',
    name: '长度',
    units: [
      { name: '毫米 mm', factor: 0.001 },
      { name: '厘米 cm', factor: 0.01 },
      { name: '米 m', factor: 1 },
      { name: '千米 km', factor: 1000 },
      { name: '英寸 in', factor: 0.0254 },
      { name: '英尺 ft', factor: 0.3048 },
      { name: '码 yd', factor: 0.9144 },
      { name: '英里 mi', factor: 1609.344 },
      { name: '海里 nmi', factor: 1852 },
    ],
  },
  {
    id: 'mass',
    name: '质量',
    units: [
      { name: '毫克 mg', factor: 0.001 },
      { name: '克 g', factor: 1 },
      { name: '千克 kg', factor: 1000 },
      { name: '吨 t', factor: 1e6 },
      { name: '盎司 oz', factor: 28.349523125 },
      { name: '磅 lb', factor: 453.59237 },
    ],
  },
  {
    id: 'temperature',
    name: '温度',
    units: [
      {
        name: '摄氏度 °C',
        toBase: (v) => v,
        fromBase: (v) => v,
      },
      {
        name: '华氏度 °F',
        toBase: (v) => (v - 32) * 5 / 9,
        fromBase: (v) => (v * 9) / 5 + 32,
      },
      {
        name: '开尔文 K',
        toBase: (v) => v - 273.15,
        fromBase: (v) => v + 273.15,
      },
    ],
  },
  {
    id: 'area',
    name: '面积',
    units: [
      { name: '平方毫米 mm²', factor: 1e-6 },
      { name: '平方厘米 cm²', factor: 1e-4 },
      { name: '平方米 m²', factor: 1 },
      { name: '平方千米 km²', factor: 1e6 },
      { name: '公顷 ha', factor: 10000 },
      { name: '英亩 acre', factor: 4046.8564224 },
      { name: '平方英尺 ft²', factor: 0.09290304 },
    ],
  },
  {
    id: 'volume',
    name: '体积',
    units: [
      { name: '毫升 mL', factor: 0.001 },
      { name: '升 L', factor: 1 },
      { name: '立方厘米 cm³', factor: 0.001 },
      { name: '立方米 m³', factor: 1000 },
      { name: '加仑(美) gal', factor: 3.785411784 },
      { name: '品脱(美) pt', factor: 0.473176473 },
      { name: '杯(美) cup', factor: 0.2365882365 },
    ],
  },
  {
    id: 'speed',
    name: '速度',
    units: [
      { name: '米/秒 m/s', factor: 1 },
      { name: '千米/时 km/h', factor: 1 / 3.6 },
      { name: '英里/时 mph', factor: 0.44704 },
      { name: '节 knot', factor: 0.514444 },
    ],
  },
  {
    id: 'data',
    name: '数据存储',
    units: [
      { name: '比特 bit', factor: 0.125 },
      { name: '字节 B', factor: 1 },
      { name: '千字节 KB', factor: 1024 },
      { name: '兆字节 MB', factor: 1024 ** 2 },
      { name: '吉字节 GB', factor: 1024 ** 3 },
      { name: '太字节 TB', factor: 1024 ** 4 },
    ],
  },
  {
    id: 'time',
    name: '时间',
    units: [
      { name: '毫秒 ms', factor: 0.001 },
      { name: '秒 s', factor: 1 },
      { name: '分 min', factor: 60 },
      { name: '时 h', factor: 3600 },
      { name: '天 d', factor: 86400 },
      { name: '周 wk', factor: 604800 },
    ],
  },
  {
    id: 'angle',
    name: '角度',
    units: [
      { name: '度 °', factor: 1 },
      { name: '弧度 rad', factor: 180 / Math.PI },
      { name: '梯度 grad', factor: 0.9 },
      { name: '角分 arcmin', factor: 1 / 60 },
      { name: '角秒 arcsec', factor: 1 / 3600 },
    ],
  },
  {
    id: 'pressure',
    name: '压力',
    units: [
      { name: '帕 Pa', factor: 1 },
      { name: '千帕 kPa', factor: 1000 },
      { name: '兆帕 MPa', factor: 1e6 },
      { name: '巴 bar', factor: 1e5 },
      { name: '标准大气压 atm', factor: 101325 },
      { name: '毫米汞柱 mmHg', factor: 133.322 },
      { name: '磅/平方英寸 psi', factor: 6894.757 },
    ],
  },
];

function toBase(u: Unit, v: number): number {
  return 'factor' in u ? v * u.factor : u.toBase(v);
}
function fromBase(u: Unit, v: number): number {
  return 'factor' in u ? v / u.factor : u.fromBase(v);
}

function fmt(n: number): string {
  if (!Number.isFinite(n)) return '—';
  const r = round10(n);
  if (r === 0) return '0';
  const abs = Math.abs(r);
  if (abs >= 1e15 || (abs > 0 && abs < 1e-9)) return r.toExponential(6);
  return String(r);
}

export default function UnitConverter({ context }: AppProps) {
  useEffect(() => {
    context.setTitle('单位换算');
  }, [context]);
  const [catId, setCatId] = useState(CATEGORIES[0]!.id);
  const [fromIdx, setFromIdx] = useState(0);
  const [toIdx, setToIdx] = useState(1);
  const [amount, setAmount] = useState('1');

  const category =
    CATEGORIES.find((c) => c.id === catId) ?? CATEGORIES[0]!;

  // 切换分类时重置单位下标，避免越界
  useEffect(() => {
    setFromIdx(0);
    setToIdx(1);
  }, [catId]);

  const fromUnit = category.units[fromIdx] ?? category.units[0]!;
  const toUnit = category.units[toIdx] ?? category.units[1]!;

  const value = (() => {
    const n = Number(amount);
    return Number.isFinite(n) ? n : 0;
  })();

  const base = toBase(fromUnit, value);
  const result = fromBase(toUnit, base);

  const swap = () => {
    setFromIdx(toIdx);
    setToIdx(fromIdx);
  };

  return (
    <div className="flex h-full flex-col bg-arch-bg text-arch-text">
      <div className="flex flex-wrap items-center gap-2 border-b border-arch-border bg-arch-panel/80 px-3 py-1.5">
        <Calculator size={14} className="text-arch-accent" />
        <select
          value={catId}
          onChange={(e) => setCatId(e.target.value)}
          className="rounded border border-arch-border bg-black/30 px-2 py-1 text-xs"
        >
          {CATEGORIES.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        <div className="flex flex-wrap items-end gap-3 rounded border border-arch-border bg-black/20 p-3">
          <label className="flex flex-col gap-1 text-[11px] text-arch-muted">
            数值
            <input
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              inputMode="decimal"
              className="w-32 rounded border border-arch-border bg-black/30 px-2 py-1 font-mono text-[13px]"
            />
          </label>
          <label className="flex flex-col gap-1 text-[11px] text-arch-muted">
            从
            <select
              value={fromIdx}
              onChange={(e) => setFromIdx(Number(e.target.value))}
              className="rounded border border-arch-border bg-black/30 px-2 py-1 text-xs"
            >
              {category.units.map((u, i) => (
                <option key={u.name} value={i}>
                  {u.name}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            onClick={swap}
            title="互换"
            className="rounded border border-arch-border bg-arch-panel p-2 hover:bg-white/10"
          >
            <ArrowRightLeft size={14} />
          </button>
          <label className="flex flex-col gap-1 text-[11px] text-arch-muted">
            到
            <select
              value={toIdx}
              onChange={(e) => setToIdx(Number(e.target.value))}
              className="rounded border border-arch-border bg-black/30 px-2 py-1 text-xs"
            >
              {category.units.map((u, i) => (
                <option key={u.name} value={i}>
                  {u.name}
                </option>
              ))}
            </select>
          </label>
          <div className="flex min-w-[160px] flex-col gap-1">
            <span className="text-[11px] text-arch-muted">结果</span>
            <span className="font-mono text-[15px] text-arch-green">
              {fmt(result)} {toUnit.name}
            </span>
          </div>
        </div>

        <div className="mt-3 rounded border border-arch-border">
          <div className="border-b border-arch-border bg-arch-panel/60 px-3 py-1.5 text-[11px] text-arch-muted">
            {value} {fromUnit.name} → 全部单位
          </div>
          <table className="w-full text-[12px]">
            <tbody>
              {category.units.map((u, i) => {
                const v = fromBase(u, base);
                return (
                  <tr
                    key={u.name}
                    className={cn(
                      'border-t border-arch-border/60',
                      i === toIdx && 'bg-arch-accent/10',
                    )}
                  >
                    <td className="px-3 py-1 font-mono text-arch-muted">
                      {u.name}
                    </td>
                    <td className="px-3 py-1 text-right font-mono text-arch-text">
                      {fmt(v)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
