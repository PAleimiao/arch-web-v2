import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  Activity,
  ArrowDown,
  ArrowUp,
  Camera,
  Cpu,
  Gauge,
  HardDrive,
  MemoryStick,
  ShieldCheck,
} from 'lucide-react';
import type { AppProps } from '@/shell/types';
import { cn } from '@/lib/cn';
import { notify } from '@/stores/useNotifyStore';
import { useWindowStore } from '@/stores/useWindowStore';

interface PerfMemory {
  usedJSHeapSize: number;
  totalJSHeapSize: number;
  jsHeapSizeLimit: number;
}

function getHeap(): PerfMemory | null {
  const p = performance as unknown as { memory?: PerfMemory };
  return p.memory ?? null;
}

const hasRealHeap = getHeap() !== null;
const EST_BASE = 4 * 1024 * 1024;
const EST_PER_WINDOW = 1.5 * 1024 * 1024;

const SAMPLE_MS = 1000;
const MAX_POINTS = 60;

function pushSample(buf: number[], v: number) {
  buf.push(v);
  if (buf.length > MAX_POINTS) buf.shift();
}

function trend(buf: number[]): 'up' | 'down' | 'flat' {
  const n = buf.length;
  if (n < 2) return 'flat';
  const a = buf[n - 2]!;
  const b = buf[n - 1]!;
  if (b > a) return 'up';
  if (b < a) return 'down';
  return 'flat';
}

function fmtBytes(n: number): string {
  if (n >= 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  if (n >= 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${Math.round(n)} B`;
}

export default function SystemMonitor(_: AppProps) {
  const winCount = useWindowStore((s) => s.windows.length);
  const winCountRef = useRef(winCount);
  winCountRef.current = winCount;

  const fpsBuf = useRef<number[]>([]);
  const memBuf = useRef<number[]>([]);
  const lagBuf = useRef<number[]>([]);

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const wrapRef = useRef<HTMLDivElement | null>(null);

  const [snap, setSnap] = useState<{ fps: number; mem: number; lag: number }>({
    fps: 0,
    mem: 0,
    lag: 0,
  });

  const [quota, setQuota] = useState<{ usage: number; quota: number } | null>(
    null,
  );
  const [persisted, setPersisted] = useState<boolean | null>(null);

  const deviceInfo = useMemo(() => {
    const devMemory = (navigator as unknown as { deviceMemory?: number })
      .deviceMemory;
    return {
      cores: navigator.hardwareConcurrency ?? 0,
      memory: devMemory ? `${devMemory} GB` : '未知',
      ua: navigator.userAgent,
    };
  }, []);

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    if (!canvas || !wrap) return;
    const dpr = window.devicePixelRatio || 1;
    const w = wrap.clientWidth;
    const h = wrap.clientHeight;
    if (w <= 0 || h <= 0) return;
    canvas.width = Math.floor(w * dpr);
    canvas.height = Math.floor(h * dpr);
    canvas.style.width = `${w}px`;
    canvas.style.height = `${h}px`;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);

    // 背景网格
    ctx.strokeStyle = 'rgba(255,255,255,0.06)';
    ctx.lineWidth = 1;
    for (let i = 1; i < 4; i++) {
      const y = (h / 4) * i;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(w, y);
      ctx.stroke();
    }

    const series: Array<{
      buf: number[];
      color: string;
      max: number;
    }> = [
      { buf: fpsBuf.current, color: '#56b6c2', max: Math.max(60, ...fpsBuf.current) },
      { buf: memBuf.current, color: '#e06c75', max: Math.max(1, ...memBuf.current) },
      { buf: lagBuf.current, color: '#e5c07b', max: Math.max(50, ...lagBuf.current) },
    ];

    for (const s of series) {
      const len = s.buf.length;
      if (len < 2) continue;
      ctx.strokeStyle = s.color;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      for (let i = 0; i < len; i++) {
        const x = (i / (MAX_POINTS - 1)) * w;
        const norm = s.max > 0 ? s.buf[i]! / s.max : 0;
        const y = h - norm * (h - 4) - 2;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
  }, []);

  useEffect(() => {
    let raf = 0;
    let frames = 0;
    let prevSample = performance.now();
    const loop = () => {
      frames += 1;
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    const id = window.setInterval(() => {
      const now = performance.now();
      const actual = now - prevSample;
      const lag = Math.max(0, actual - SAMPLE_MS);
      prevSample = now;
      const curFps = frames;
      frames = 0;
      const h = getHeap();
      const mem = h
        ? h.usedJSHeapSize
        : EST_BASE + winCountRef.current * EST_PER_WINDOW;
      pushSample(fpsBuf.current, curFps);
      pushSample(memBuf.current, mem);
      pushSample(lagBuf.current, lag);
      setSnap({ fps: curFps, mem, lag });
      draw();
    }, SAMPLE_MS);
    return () => {
      cancelAnimationFrame(raf);
      window.clearInterval(id);
    };
  }, [draw]);

  useEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap) return;
    const ro = new ResizeObserver(() => draw());
    ro.observe(wrap);
    draw();
    return () => ro.disconnect();
  }, [draw]);

  useEffect(() => {
    let alive = true;
    const ns = navigator.storage;
    void (async () => {
      if (!ns) {
        if (alive) setPersisted(false);
        return;
      }
      try {
        const est = await ns.estimate();
        if (alive) setQuota({ usage: est.usage ?? 0, quota: est.quota ?? 0 });
      } catch {
        /* 忽略配额读取失败 */
      }
      try {
        const p = await ns.persisted();
        if (alive) setPersisted(p);
      } catch {
        if (alive) setPersisted(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  const requestPersist = async () => {
    const ns = navigator.storage;
    if (!ns) {
      notify('不支持', '当前浏览器没有提供 StorageManager', 'error');
      return;
    }
    try {
      const ok = await ns.persist();
      setPersisted(ok);
      notify(
        ok ? '已申请持久化' : '申请被拒',
        ok ? '浏览器将优先保留本地存储' : '浏览器拒绝了持久化请求',
        ok ? 'success' : 'warn',
      );
    } catch (e) {
      notify('申请失败', String(e), 'error');
    }
  };

  const fpsT = trend(fpsBuf.current);
  const memT = trend(memBuf.current);
  const lagT = trend(lagBuf.current);

  return (
    <div className="flex h-full flex-col bg-arch-bg text-arch-text text-[12px]">
      {/* 大号实时数字 */}
      <div className="grid grid-cols-3 gap-px border-b border-arch-border bg-arch-border">
        <BigNum
          icon={<Gauge size={16} />}
          label="FPS"
          value={String(snap.fps)}
          tone="cyan"
          dir={fpsT}
        />
        <BigNum
          icon={<MemoryStick size={16} />}
          label={hasRealHeap ? '内存占用' : '内存(估算)'}
          value={fmtBytes(snap.mem)}
          tone="red"
          dir={memT}
        />
        <BigNum
          icon={<Activity size={16} />}
          label="事件循环延迟"
          value={`${snap.lag.toFixed(0)} ms`}
          tone="yellow"
          dir={lagT}
        />
      </div>

      {/* 折线图 */}
      <div className="border-b border-arch-border p-2">
        <div className="mb-1 flex items-center gap-3 text-arch-muted">
          <Legend color="#56b6c2" text="FPS" />
          <Legend color="#e06c75" text={hasRealHeap ? '内存' : '内存(估算)'} />
          <Legend color="#e5c07b" text="延迟" />
          <span className="ml-auto">最近 {MAX_POINTS} 秒</span>
        </div>
        <div ref={wrapRef} className="h-40 w-full rounded border border-arch-border bg-black/30">
          <canvas ref={canvasRef} className="block" />
        </div>
      </div>

      {/* 设备信息 */}
      <div className="grid grid-cols-2 gap-2 border-b border-arch-border p-2 sm:grid-cols-3">
        <InfoRow icon={<Cpu size={13} />} label="逻辑核心" value={deviceInfo.cores ? `${deviceInfo.cores}` : '未知'} />
        <InfoRow icon={<MemoryStick size={13} />} label="设备内存" value={deviceInfo.memory} />
        <InfoRow icon={<HardDrive size={13} />} label="用户代理" value={deviceInfo.ua} wrap />
      </div>

      {/* 存储配额与持久化 */}
      <div className="flex items-center gap-3 border-b border-arch-border p-2">
        <div className="flex items-center gap-1 text-arch-muted">
          <HardDrive size={13} />
          配额
        </div>
        <span className="font-mono">
          {quota
            ? `${fmtBytes(quota.usage)} / ${fmtBytes(quota.quota)}`
            : '读取中…'}
        </span>
        <div className="ml-auto flex items-center gap-3">
          <span className="flex items-center gap-1 text-arch-muted">
            <ShieldCheck size={13} />
            持久化：
            <span
              className={cn(
                persisted === null
                  ? 'text-arch-muted'
                  : persisted
                    ? 'text-arch-green'
                    : 'text-arch-red',
              )}
            >
              {persisted === null ? '未知' : persisted ? '已开启' : '未开启'}
            </span>
          </span>
          <button
            type="button"
            onClick={requestPersist}
            className="flex items-center gap-1 rounded border border-arch-border px-2 py-1 text-arch-accent hover:bg-arch-panel"
          >
            <Camera size={12} />
            申请持久化存储
          </button>
        </div>
      </div>

      <div className="p-2 text-arch-muted">
        提示：FPS 由 requestAnimationFrame 统计；事件循环延迟取采样间隔与设定 1s
        的实际偏差；内存优先读取 performance.memory，不可用时按窗口数估算。
      </div>
    </div>
  );
}

function BigNum({
  icon,
  label,
  value,
  tone,
  dir,
}: {
  icon: ReactNode;
  label: string;
  value: string;
  tone: 'cyan' | 'red' | 'yellow';
  dir: 'up' | 'down' | 'flat';
}) {
  const color =
    tone === 'cyan'
      ? 'text-[#56b6c2]'
      : tone === 'red'
        ? 'text-[#e06c75]'
        : 'text-[#e5c07b]';
  return (
    <div className="flex items-center gap-2 bg-arch-bg px-3 py-3">
      <span className={color}>{icon}</span>
      <div className="leading-tight">
        <div className="flex items-center gap-1 text-arch-muted">
          {label}
          {dir === 'up' && <ArrowUp size={11} className="text-arch-green" />}
          {dir === 'down' && <ArrowDown size={11} className="text-arch-red" />}
        </div>
        <div className={cn('font-mono text-2xl', color)}>{value}</div>
      </div>
    </div>
  );
}

function Legend({ color, text }: { color: string; text: string }) {
  return (
    <span className="flex items-center gap-1">
      <span
        className="inline-block h-2 w-2 rounded-full"
        style={{ background: color }}
      />
      {text}
    </span>
  );
}

function InfoRow({
  icon,
  label,
  value,
  wrap,
}: {
  icon: ReactNode;
  label: string;
  value: string;
  wrap?: boolean;
}) {
  return (
    <div className="rounded border border-arch-border bg-arch-panel px-2 py-1">
      <div className="flex items-center gap-1 text-arch-muted">
        {icon}
        {label}
      </div>
      <div className={cn('font-mono', wrap && 'break-all text-[11px]')}>
        {value}
      </div>
    </div>
  );
}
