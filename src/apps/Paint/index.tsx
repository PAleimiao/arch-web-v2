import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import {
  Pencil,
  Eraser,
  Minus,
  Square,
  Circle,
  PaintBucket,
  Pipette,
  Type as TypeIcon,
  Undo2,
  Redo2,
  Trash2,
  Download,
  Copy,
  Grid3x3,
} from 'lucide-react';
import type { AppProps } from '@/shell/types';
import { cn } from '@/lib/cn';
import { hexToRgb, rgbToHex } from '@/lib/color';
import { notify } from '@/stores/useNotifyStore';

type Tool = 'brush' | 'eraser' | 'line' | 'rect' | 'ellipse' | 'fill' | 'picker' | 'text';

const TOOLS: { id: Tool; label: string; icon: typeof Pencil }[] = [
  { id: 'brush', label: '画笔', icon: Pencil },
  { id: 'eraser', label: '橡皮', icon: Eraser },
  { id: 'line', label: '直线', icon: Minus },
  { id: 'rect', label: '矩形', icon: Square },
  { id: 'ellipse', label: '椭圆', icon: Circle },
  { id: 'fill', label: '填充', icon: PaintBucket },
  { id: 'picker', label: '取色', icon: Pipette },
  { id: 'text', label: '文字', icon: TypeIcon },
];

const MAX_HISTORY = 25;
const FILL_AREA_LIMIT = 4_000_000;

type Rgba = [number, number, number, number];

function hexToRgba(hex: string, alpha: number): Rgba {
  const { r, g, b } = hexToRgb(hex);
  return [r, g, b, Math.round(Math.max(0, Math.min(1, alpha)) * 255)];
}

function matchPixel(d: Uint8ClampedArray, i: number, r: number, g: number, b: number, a: number): boolean {
  return d[i] === r && d[i + 1] === g && d[i + 2] === b && d[i + 3] === a;
}

/** 扫描线洪水填充，在设备像素级别操作，带面积上限保护。 */
function floodFill(img: ImageData, sx: number, sy: number, fill: Rgba): void {
  const { width, height, data } = img;
  if (sx < 0 || sy < 0 || sx >= width || sy >= height) return;
  const startIdx = (sy * width + sx) * 4;
  const sr = data[startIdx];
  const sg = data[startIdx + 1];
  const sb = data[startIdx + 2];
  const sa = data[startIdx + 3];
  if (sr === fill[0] && sg === fill[1] && sb === fill[2] && sa === fill[3]) return;

  const stack: number[] = [sx, sy];
  const max = width * height;
  let count = 0;
  while (stack.length > 0) {
    if (++count > max) break;
    const y = stack.pop();
    const x = stack.pop();
    if (y === undefined || x === undefined) break;
    let nx = x;
    let idx = (y * width + nx) * 4;
    while (nx >= 0 && matchPixel(data, idx, sr, sg, sb, sa)) {
      nx--;
      idx -= 4;
    }
    nx++;
    idx = (y * width + nx) * 4;
    let spanUp = false;
    let spanDown = false;
    while (nx < width && matchPixel(data, idx, sr, sg, sb, sa)) {
      data[idx] = fill[0];
      data[idx + 1] = fill[1];
      data[idx + 2] = fill[2];
      data[idx + 3] = fill[3];
      if (y > 0) {
        const up = ((y - 1) * width + nx) * 4;
        const m = matchPixel(data, up, sr, sg, sb, sa);
        if (m && !spanUp) {
          stack.push(nx, y - 1);
          spanUp = true;
        } else if (!m) {
          spanUp = false;
        }
      }
      if (y < height - 1) {
        const dn = ((y + 1) * width + nx) * 4;
        const m = matchPixel(data, dn, sr, sg, sb, sa);
        if (m && !spanDown) {
          stack.push(nx, y + 1);
          spanDown = true;
        } else if (!m) {
          spanDown = false;
        }
      }
      nx++;
      idx = (y * width + nx) * 4;
    }
  }
}

export default function Paint({ context }: AppProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const ctxRef = useRef<CanvasRenderingContext2D | null>(null);
  const dprRef = useRef<number>(1);

  const drawingRef = useRef(false);
  const startRef = useRef({ x: 0, y: 0 });
  const lastRef = useRef({ x: 0, y: 0 });
  const snapRef = useRef<ImageData | null>(null);

  const historyRef = useRef<ImageData[]>([]);
  const redoRef = useRef<ImageData[]>([]);

  const textInputRef = useRef<{ x: number; y: number; value: string } | null>(null);
  const textSnapRef = useRef<ImageData | null>(null);

  const [tool, setTool] = useState<Tool>('brush');
  const [color, setColor] = useState('#1793d1');
  const [size, setSize] = useState(4);
  const [opacity, setOpacity] = useState(1);
  const [showGrid, setShowGrid] = useState(false);
  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);
  const [pos, setPos] = useState({ x: 0, y: 0 });
  const [dims, setDims] = useState({ w: 0, h: 0 });
  const [textInput, setTextInput] = useState<{ x: number; y: number; value: string } | null>(null);

  function syncFlags() {
    setCanUndo(historyRef.current.length > 0);
    setCanRedo(redoRef.current.length > 0);
  }

  function snapshot(): ImageData | null {
    const canvas = canvasRef.current;
    const ctx = ctxRef.current;
    if (!canvas || !ctx || canvas.width === 0 || canvas.height === 0) return null;
    return ctx.getImageData(0, 0, canvas.width, canvas.height);
  }

  function pushHistory(prev: ImageData) {
    historyRef.current.push(prev);
    if (historyRef.current.length > MAX_HISTORY) historyRef.current.shift();
    redoRef.current = [];
    syncFlags();
  }

  function undo() {
    const canvas = canvasRef.current;
    const ctx = ctxRef.current;
    if (!canvas || !ctx || historyRef.current.length === 0) return;
    const cur = snapshot();
    const prev = historyRef.current.pop();
    if (!cur || !prev) return;
    redoRef.current.push(cur);
    ctx.putImageData(prev, 0, 0);
    syncFlags();
  }

  function redo() {
    const canvas = canvasRef.current;
    const ctx = ctxRef.current;
    if (!canvas || !ctx || redoRef.current.length === 0) return;
    const cur = snapshot();
    const next = redoRef.current.pop();
    if (!cur || !next) return;
    historyRef.current.push(cur);
    ctx.putImageData(next, 0, 0);
    syncFlags();
  }

  function setupCanvas() {
    const canvas = canvasRef.current;
    const parent = canvas?.parentElement;
    if (!canvas || !parent) return;
    const cssW = Math.max(1, parent.clientWidth);
    const cssH = Math.max(1, parent.clientHeight);
    const dpr = window.devicePixelRatio || 1;
    const newW = Math.round(cssW * dpr);
    const newH = Math.round(cssH * dpr);
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const had = canvas.width > 0 && canvas.height > 0;
    const temp = document.createElement('canvas');
    if (had) {
      temp.width = canvas.width;
      temp.height = canvas.height;
      const tctx = temp.getContext('2d');
      tctx?.drawImage(canvas, 0, 0);
    }
    canvas.width = newW;
    canvas.height = newH;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    if (had) {
      ctx.save();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.drawImage(temp, 0, 0);
      ctx.restore();
    } else {
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, cssW, cssH);
    }
    ctxRef.current = ctx;
    dprRef.current = dpr;
    // 尺寸变化会让旧的快照尺寸不匹配，清空历史避免还原错乱。
    historyRef.current = [];
    redoRef.current = [];
    syncFlags();
    setDims({ w: Math.round(cssW), h: Math.round(cssH) });
  }

  useEffect(() => {
    setupCanvas();
    const parent = canvasRef.current?.parentElement;
    if (!parent) return;
    const ro = new ResizeObserver(() => setupCanvas());
    ro.observe(parent);
    return () => ro.disconnect();
    // 仅在挂载时初始化
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function getPos(e: ReactPointerEvent<HTMLCanvasElement>) {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }

  function drawSegment(
    ctx: CanvasRenderingContext2D,
    x0: number,
    y0: number,
    x1: number,
    y1: number,
    eraser: boolean,
  ) {
    ctx.globalAlpha = opacity;
    ctx.strokeStyle = eraser ? 'rgba(0,0,0,1)' : color;
    ctx.globalCompositeOperation = eraser ? 'destination-out' : 'source-over';
    ctx.lineWidth = size;
    ctx.beginPath();
    ctx.moveTo(x0, y0);
    ctx.lineTo(x1, y1);
    ctx.stroke();
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
  }

  function drawShape(
    ctx: CanvasRenderingContext2D,
    t: Tool,
    x0: number,
    y0: number,
    x1: number,
    y1: number,
  ) {
    ctx.globalAlpha = opacity;
    ctx.strokeStyle = color;
    ctx.lineWidth = size;
    if (t === 'line') {
      ctx.beginPath();
      ctx.moveTo(x0, y0);
      ctx.lineTo(x1, y1);
      ctx.stroke();
    } else if (t === 'rect') {
      ctx.strokeRect(x0, y0, x1 - x0, y1 - y0);
    } else if (t === 'ellipse') {
      const cx = (x0 + x1) / 2;
      const cy = (y0 + y1) / 2;
      const rx = Math.abs(x1 - x0) / 2;
      const ry = Math.abs(y1 - y0) / 2;
      ctx.beginPath();
      ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }

  function onPointerDown(e: ReactPointerEvent<HTMLCanvasElement>) {
    const canvas = canvasRef.current;
    const ctx = ctxRef.current;
    if (!canvas || !ctx) return;
    canvas.setPointerCapture(e.pointerId);
    const { x, y } = getPos(e);

    if (tool === 'picker') {
      const dpr = dprRef.current;
      const dx = Math.round(x * dpr);
      const dy = Math.round(y * dpr);
      const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const i = (dy * canvas.width + dx) * 4;
      if (i >= 0 && i + 2 < img.data.length) {
        setColor(rgbToHex({ r: img.data[i], g: img.data[i + 1], b: img.data[i + 2] }));
      }
      return;
    }

    if (tool === 'text') {
      textSnapRef.current = snapshot();
      const next = { x, y, value: '' };
      textInputRef.current = next;
      setTextInput(next);
      return;
    }

    if (tool === 'fill') {
      const prev = snapshot();
      if (!prev) return;
      const dpr = dprRef.current;
      const dx = Math.round(x * dpr);
      const dy = Math.round(y * dpr);
      if (canvas.width * canvas.height > FILL_AREA_LIMIT) {
        notify('画布过大', '已跳过填充以保护性能', 'warn');
        return;
      }
      const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
      floodFill(img, dx, dy, hexToRgba(color, opacity));
      ctx.putImageData(img, 0, 0);
      pushHistory(prev);
      return;
    }

    // 画笔 / 橡皮 / 形状
    const prev = snapshot();
    if (!prev) return;
    drawingRef.current = true;
    startRef.current = { x, y };
    lastRef.current = { x, y };
    if (tool === 'brush' || tool === 'eraser') {
      pushHistory(prev);
      drawSegment(ctx, x, y, x, y, tool === 'eraser');
    } else {
      snapRef.current = prev;
    }
  }

  function onPointerMove(e: ReactPointerEvent<HTMLCanvasElement>) {
    const { x, y } = getPos(e);
    setPos({ x: Math.round(x), y: Math.round(y) });
    const ctx = ctxRef.current;
    if (!ctx || !drawingRef.current) return;
    if (tool === 'brush' || tool === 'eraser') {
      const l = lastRef.current;
      drawSegment(ctx, l.x, l.y, x, y, tool === 'eraser');
      lastRef.current = { x, y };
    } else {
      const s = startRef.current;
      const prev = snapRef.current;
      if (prev) {
        ctx.putImageData(prev, 0, 0);
        drawShape(ctx, tool, s.x, s.y, x, y);
      }
    }
  }

  function onPointerUp(e: ReactPointerEvent<HTMLCanvasElement>) {
    const canvas = canvasRef.current;
    const ctx = ctxRef.current;
    if (!canvas || !ctx) return;
    if (drawingRef.current && (tool === 'line' || tool === 'rect' || tool === 'ellipse')) {
      const s = startRef.current;
      const { x, y } = getPos(e);
      const prev = snapRef.current;
      if (prev) {
        ctx.putImageData(prev, 0, 0);
        drawShape(ctx, tool, s.x, s.y, x, y);
        pushHistory(prev);
      }
    }
    drawingRef.current = false;
    snapRef.current = null;
    try {
      canvas.releasePointerCapture(e.pointerId);
    } catch {
      /* 指针可能已释放 */
    }
  }

  function commitText() {
    const ti = textInputRef.current;
    const ctx = ctxRef.current;
    if (!ti || !ctx) {
      setTextInput(null);
      return;
    }
    if (ti.value.trim() === '') {
      setTextInput(null);
      return;
    }
    const snap = textSnapRef.current;
    if (snap) {
      ctx.putImageData(snap, 0, 0);
      ctx.globalAlpha = opacity;
      ctx.fillStyle = color;
      ctx.textBaseline = 'top';
      const fontPx = Math.max(12, size * 3);
      ctx.font = `${fontPx}px ui-monospace, SFMono-Regular, Menlo, monospace`;
      ctx.fillText(ti.value, ti.x, ti.y);
      ctx.globalAlpha = 1;
      pushHistory(snap);
    }
    setTextInput(null);
    textInputRef.current = null;
  }

  function clearCanvas() {
    const canvas = canvasRef.current;
    const ctx = ctxRef.current;
    if (!canvas || !ctx) return;
    const prev = snapshot();
    if (!prev) return;
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.restore();
    pushHistory(prev);
  }

  function downloadPng() {
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.toBlob((blob) => {
      if (!blob) {
        notify('导出失败', '无法生成图片', 'error');
        return;
      }
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `paint-${Date.now()}.png`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      notify('已导出', 'PNG 已下载', 'success');
    }, 'image/png');
  }

  async function copyImage() {
    const canvas = canvasRef.current;
    if (!canvas) return;
    if (!navigator.clipboard || typeof ClipboardItem === 'undefined') {
      notify('不支持', '当前浏览器无法写入图片剪贴板', 'warn');
      return;
    }
    canvas.toBlob(async (blob) => {
      if (!blob) return;
      try {
        await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
        notify('已复制', '图片已复制到剪贴板', 'success');
      } catch {
        notify('复制失败', '浏览器拒绝了剪贴板写入', 'error');
      }
    }, 'image/png');
  }

  useEffect(() => {
    context.setTitle('画图');
  }, [context]);

  return (
    <div className="flex h-full flex-col bg-arch-bg text-arch-text">
      {/* 工具栏 */}
      <div className="flex flex-wrap items-center gap-2 border-b border-arch-border bg-arch-panel px-2 py-1.5 text-[11px]">
        <div className="flex gap-1">
          {TOOLS.map((t) => {
            const Icon = t.icon;
            const active = tool === t.id;
            return (
              <button
                key={t.id}
                type="button"
                title={t.label}
                onClick={() => setTool(t.id)}
                className={cn(
                  'flex h-7 w-7 items-center justify-center rounded border',
                  active
                    ? 'border-arch-accent bg-arch-accent text-white'
                    : 'border-arch-border text-arch-muted hover:text-arch-text',
                )}
              >
                <Icon size={15} />
              </button>
            );
          })}
        </div>

        <div className="mx-1 h-5 w-px bg-arch-border" />

        <label className="flex items-center gap-1 text-arch-muted">
          颜色
          <input
            type="color"
            value={color}
            onChange={(e) => setColor(e.target.value)}
            className="h-6 w-7 cursor-pointer rounded border border-arch-border bg-transparent"
          />
        </label>

        <label className="flex items-center gap-1 text-arch-muted">
          粗细
          <input
            type="range"
            min={1}
            max={64}
            value={size}
            onChange={(e) => setSize(Number(e.target.value))}
            className="w-20 accent-arch-accent"
          />
          <span className="w-6 text-right tabular-nums text-arch-text">{size}</span>
        </label>

        <label className="flex items-center gap-1 text-arch-muted">
          透明
          <input
            type="range"
            min={0.1}
            max={1}
            step={0.05}
            value={opacity}
            onChange={(e) => setOpacity(Number(e.target.value))}
            className="w-20 accent-arch-accent"
          />
          <span className="w-8 text-right tabular-nums text-arch-text">
            {Math.round(opacity * 100)}%
          </span>
        </label>

        <div className="mx-1 h-5 w-px bg-arch-border" />

        <button
          type="button"
          title="撤销"
          onClick={undo}
          disabled={!canUndo}
          className={cn(
            'flex h-7 w-7 items-center justify-center rounded border border-arch-border',
            canUndo ? 'text-arch-muted hover:text-arch-text' : 'cursor-not-allowed opacity-40',
          )}
        >
          <Undo2 size={15} />
        </button>
        <button
          type="button"
          title="重做"
          onClick={redo}
          disabled={!canRedo}
          className={cn(
            'flex h-7 w-7 items-center justify-center rounded border border-arch-border',
            canRedo ? 'text-arch-muted hover:text-arch-text' : 'cursor-not-allowed opacity-40',
          )}
        >
          <Redo2 size={15} />
        </button>
        <button
          type="button"
          title="清空"
          onClick={clearCanvas}
          className="flex h-7 items-center gap-1 rounded border border-arch-border px-2 text-arch-muted hover:text-arch-red"
        >
          <Trash2 size={15} /> 清空
        </button>

        <div className="mx-1 h-5 w-px bg-arch-border" />

        <button
          type="button"
          title="网格"
          onClick={() => setShowGrid((v) => !v)}
          className={cn(
            'flex h-7 w-7 items-center justify-center rounded border',
            showGrid
              ? 'border-arch-accent bg-arch-accent text-white'
              : 'border-arch-border text-arch-muted hover:text-arch-text',
          )}
        >
          <Grid3x3 size={15} />
        </button>
        <button
          type="button"
          title="复制到剪贴板"
          onClick={copyImage}
          className="flex h-7 w-7 items-center justify-center rounded border border-arch-border text-arch-muted hover:text-arch-text"
        >
          <Copy size={15} />
        </button>
        <button
          type="button"
          title="导出 PNG"
          onClick={downloadPng}
          className="flex h-7 items-center gap-1 rounded border border-arch-border px-2 text-arch-accent hover:bg-arch-accent hover:text-white"
        >
          <Download size={15} /> 下载
        </button>
      </div>

      {/* 画布区 */}
      <div className="relative flex-1 overflow-hidden">
        <canvas
          ref={canvasRef}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          className="absolute inset-0 h-full w-full touch-none cursor-crosshair"
          style={showGrid ? gridStyle : undefined}
        />
        {textInput && (
          <input
            autoFocus
            value={textInput.value}
            onChange={(e) => {
              const next = { ...textInput, value: e.target.value };
              textInputRef.current = next;
              setTextInput(next);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                commitText();
              } else if (e.key === 'Escape') {
                e.preventDefault();
                setTextInput(null);
                textInputRef.current = null;
              }
            }}
            onBlur={commitText}
            style={{
              position: 'absolute',
              left: textInput.x,
              top: textInput.y,
              color,
              opacity,
              fontSize: Math.max(12, size * 3),
              background: 'transparent',
              border: '1px dashed var(--color-arch-accent)',
              outline: 'none',
              fontFamily: 'ui-monospace, monospace',
              padding: 0,
              margin: 0,
              minWidth: 40,
            }}
          />
        )}
        <div className="pointer-events-none absolute bottom-1 right-2 rounded bg-arch-panel/80 px-2 py-0.5 text-[10px] tabular-nums text-arch-muted">
          {dims.w}×{dims.h} · 光标 {pos.x},{pos.y}
        </div>
      </div>
    </div>
  );
}

const gridStyle: CSSProperties = {
  backgroundImage:
    'linear-gradient(to right, rgba(120,130,150,0.12) 1px, transparent 1px), linear-gradient(to bottom, rgba(120,130,150,0.12) 1px, transparent 1px)',
  backgroundSize: '20px 20px',
};
