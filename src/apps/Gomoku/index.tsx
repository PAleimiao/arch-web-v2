import { useCallback, useEffect, useRef, useState } from 'react';
import type { MouseEvent as ReactMouseEvent } from 'react';
import { Bot, Cpu, RotateCcw, Undo2, User } from 'lucide-react';
import type { AppProps } from '@/shell/types';
import { cn } from '@/lib/cn';
import { notify } from '@/stores/useNotifyStore';

const N = 15;
const CELL = 30;
const PAD = 24;
const SIZE = PAD * 2 + (N - 1) * CELL;

type Stone = 0 | 1 | 2;
type Board = Stone[][];

type Difficulty = 'easy' | 'medium' | 'hard';
const DIFF_LABEL: Record<Difficulty, string> = { easy: '简单', medium: '中等', hard: '困难' };

const DIRS: Array<[number, number]> = [
  [0, 1],
  [1, 0],
  [1, 1],
  [1, -1],
];

function emptyBoard(): Board {
  return Array.from({ length: N }, () => Array<Stone>(N).fill(0));
}

function inBounds(r: number, c: number): boolean {
  return r >= 0 && r < N && c >= 0 && c < N;
}

function isFull(b: Board): boolean {
  for (let r = 0; r < N; r++) {
    const row = b[r];
    if (!row) continue;
    for (let c = 0; c < N; c++) {
      if (row[c] === 0) return false;
    }
  }
  return true;
}

function scoreLine(cnt: number, open: number): number {
  if (cnt >= 5) return 100000;
  if (open === 0) return 0;
  switch (cnt) {
    case 4:
      return open === 2 ? 10000 : 1000;
    case 3:
      return open === 2 ? 1000 : 100;
    case 2:
      return open === 2 ? 100 : 10;
    case 1:
      return open === 2 ? 10 : 1;
    default:
      return 0;
  }
}

/** 评估在 (r,c) 落 color 后的价值（仅看该点引出的 4 条线） */
function evalCell(b: Board, r: number, c: number, color: Stone): number {
  b[r][c] = color;
  let total = 0;
  for (const [dx, dy] of DIRS) {
    let cnt = 1;
    let openEnds = 0;
    let x = r + dx;
    let y = c + dy;
    while (inBounds(x, y) && b[x][y] === color) {
      cnt++;
      x += dx;
      y += dy;
    }
    if (inBounds(x, y) && b[x][y] === 0) openEnds++;
    x = r - dx;
    y = c - dy;
    while (inBounds(x, y) && b[x][y] === color) {
      cnt++;
      x -= dx;
      y -= dy;
    }
    if (inBounds(x, y) && b[x][y] === 0) openEnds++;
    total += scoreLine(cnt, openEnds);
  }
  b[r][c] = 0;
  return total;
}

function bestOffense(b: Board, color: Stone): number {
  let best = 0;
  for (let r = 0; r < N; r++) {
    const row = b[r];
    if (!row) continue;
    for (let c = 0; c < N; c++) {
      if (row[c] !== 0) continue;
      const s = evalCell(b, r, c, color);
      if (s > best) best = s;
    }
  }
  return best;
}

function chooseAIMove(
  b: Board,
  diff: Difficulty,
  aiColor: Stone,
  humanColor: Stone,
): [number, number] {
  const empties: Array<[number, number]> = [];
  for (let r = 0; r < N; r++) {
    const row = b[r];
    if (!row) continue;
    for (let c = 0; c < N; c++) {
      if (row[c] === 0) empties.push([r, c]);
    }
  }
  if (empties.length === 0) return [-1, -1];

  let bestScore = -Infinity;
  let bestCell: [number, number] = empties[0] ?? [-1, -1];

  for (const [r, c] of empties) {
    const offense = evalCell(b, r, c, aiColor);
    const defense = evalCell(b, r, c, humanColor);
    let score = offense + defense * 0.9;
    if (diff === 'hard') {
      // 一层预判：落子后对手的最佳回应价值（越大越危险），予以减分
      b[r][c] = aiColor;
      const oppReply = bestOffense(b, humanColor);
      b[r][c] = 0;
      score -= oppReply * 0.4;
    }
    if (diff === 'easy') {
      score += Math.random() * 6;
    }
    if (score > bestScore) {
      bestScore = score;
      bestCell = [r, c];
    }
  }

  if (diff === 'easy' && Math.random() < 0.25) {
    const pick = empties[Math.floor(Math.random() * empties.length)];
    if (pick) return pick;
  }
  return bestCell;
}

/** 检查 (r,c) 落 color 后是否成五连，返回获胜的五子坐标 */
function checkWin(b: Board, r: number, c: number, color: Stone): Array<[number, number]> | null {
  for (const [dx, dy] of DIRS) {
    const line: Array<[number, number]> = [[r, c]];
    let x = r + dx;
    let y = c + dy;
    while (inBounds(x, y) && b[x][y] === color) {
      line.push([x, y]);
      x += dx;
      y += dy;
    }
    x = r - dx;
    y = c - dy;
    while (inBounds(x, y) && b[x][y] === color) {
      line.unshift([x, y]);
      x -= dx;
      y -= dy;
    }
    if (line.length >= 5) return line.slice(0, 5);
  }
  return null;
}

export default function Gomoku({ context }: AppProps) {
  const [board, setBoard] = useState<Board>(emptyBoard);
  const [current, setCurrent] = useState<Stone>(1);
  const [winner, setWinner] = useState<Stone>(0);
  const [over, setOver] = useState(false);
  const [winLine, setWinLine] = useState<Array<[number, number]>>([]);
  const [moves, setMoves] = useState<Array<[number, number, Stone]>>([]);
  const [diff, setDiff] = useState<Difficulty>('medium');
  const [first, setFirst] = useState<'human' | 'ai'>('human');

  const humanColor: Stone = 1;
  const aiColor: Stone = 2;

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const boardRef = useRef<Board>(board);
  boardRef.current = board;
  const currentRef = useRef<Stone>(current);
  currentRef.current = current;
  const overRef = useRef<boolean>(over);
  overRef.current = over;
  const aiTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const draw = useCallback(() => {
    const cv = canvasRef.current;
    if (!cv) return;
    const ctx = cv.getContext('2d');
    if (!ctx) return;
    ctx.fillStyle = '#131722';
    ctx.fillRect(0, 0, cv.width, cv.height);
    ctx.strokeStyle = '#232838';
    ctx.lineWidth = 1;
    for (let i = 0; i < N; i++) {
      const p = PAD + i * CELL;
      ctx.beginPath();
      ctx.moveTo(PAD, p);
      ctx.lineTo(PAD + (N - 1) * CELL, p);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(p, PAD);
      ctx.lineTo(p, PAD + (N - 1) * CELL);
      ctx.stroke();
    }
    const b = boardRef.current;
    for (let r = 0; r < N; r++) {
      const row = b[r];
      if (!row) continue;
      for (let c = 0; c < N; c++) {
        const v = row[c];
        if (v === 0) continue;
        const cx = PAD + c * CELL;
        const cy = PAD + r * CELL;
        ctx.beginPath();
        ctx.arc(cx, cy, CELL * 0.42, 0, Math.PI * 2);
        ctx.fillStyle = v === 1 ? '#0b0e14' : '#e6e9ef';
        ctx.fill();
        ctx.lineWidth = 1;
        ctx.strokeStyle = v === 1 ? '#3a3f4d' : '#9aa3b5';
        ctx.stroke();
      }
    }
    // 高亮获胜五子
    for (const [r, c] of winLine) {
      const cx = PAD + c * CELL;
      const cy = PAD + r * CELL;
      ctx.beginPath();
      ctx.arc(cx, cy, CELL * 0.5, 0, Math.PI * 2);
      ctx.lineWidth = 3;
      ctx.strokeStyle = '#e06c75';
      ctx.stroke();
    }
    // 最近一手标记
    const last = moves[moves.length - 1];
    if (last) {
      const cx = PAD + last[1] * CELL;
      const cy = PAD + last[0] * CELL;
      ctx.beginPath();
      ctx.arc(cx, cy, CELL * 0.18, 0, Math.PI * 2);
      ctx.fillStyle = '#e06c75';
      ctx.fill();
    }
  }, [winLine, moves]);

  useEffect(() => {
    draw();
  }, [draw]);

  useEffect(() => {
    context.setTitle('五子棋');
  }, [context]);

  const doAIMove = useCallback(() => {
    const b = boardRef.current;
    if (overRef.current) return;
    const [ar, ac] = chooseAIMove(b, diff, aiColor, humanColor);
    if (ar < 0 || ac < 0) {
      setOver(true);
      notify('五子棋', '平局', 'info');
      return;
    }
    const nb = b.map((row) => row.slice()) as Board;
    nb[ar][ac] = aiColor;
    setBoard(nb);
    setMoves((m) => [...m, [ar, ac, aiColor]]);
    const line = checkWin(nb, ar, ac, aiColor);
    if (line) {
      setWinner(aiColor);
      setWinLine(line);
      setOver(true);
      notify('五子棋', '电脑获胜', 'error');
      return;
    }
    if (isFull(nb)) {
      setOver(true);
      notify('五子棋', '平局', 'info');
      return;
    }
    setCurrent(humanColor);
  }, [diff, aiColor, humanColor]);

  const scheduleAI = useCallback(() => {
    if (aiTimer.current) clearTimeout(aiTimer.current);
    aiTimer.current = setTimeout(() => doAIMove(), 320);
  }, [doAIMove]);

  const place = useCallback(
    (r: number, c: number) => {
      if (overRef.current) return;
      if (currentRef.current !== humanColor) return;
      const b = boardRef.current;
      const cell = b[r]?.[c];
      if (cell === undefined || cell !== 0) return;
      const nb = b.map((row) => row.slice()) as Board;
      nb[r][c] = humanColor;
      setBoard(nb);
      setMoves((m) => [...m, [r, c, humanColor]]);
      const line = checkWin(nb, r, c, humanColor);
      if (line) {
        setWinner(humanColor);
        setWinLine(line);
        setOver(true);
        notify('五子棋', '你赢了！', 'success');
        return;
      }
      if (isFull(nb)) {
        setOver(true);
        notify('五子棋', '平局', 'info');
        return;
      }
      setCurrent(aiColor);
      scheduleAI();
    },
    [humanColor, aiColor, scheduleAI],
  );

  const onClick = (e: ReactMouseEvent<HTMLCanvasElement>) => {
    const cv = canvasRef.current;
    if (!cv) return;
    const rect = cv.getBoundingClientRect();
    const scaleX = cv.width / rect.width;
    const scaleY = cv.height / rect.height;
    const mx = (e.clientX - rect.left) * scaleX;
    const my = (e.clientY - rect.top) * scaleY;
    const c = Math.floor((mx - PAD) / CELL);
    const r = Math.floor((my - PAD) / CELL);
    if (!inBounds(r, c)) return;
    place(r, c);
  };

  const reset = useCallback(() => {
    if (aiTimer.current) clearTimeout(aiTimer.current);
    setBoard(emptyBoard());
    setMoves([]);
    setWinner(0);
    setWinLine([]);
    setOver(false);
    const start: Stone = first === 'human' ? humanColor : aiColor;
    setCurrent(start);
    if (start === aiColor) scheduleAI();
  }, [first, humanColor, aiColor, scheduleAI]);

  const undo = useCallback(() => {
    if (aiTimer.current) clearTimeout(aiTimer.current);
    setMoves((prev) => {
      const next = prev.slice();
      let removed = 0;
      while (next.length > 0 && removed < 2) {
        next.pop();
        removed++;
      }
      const nb = emptyBoard();
      for (const [r, c, col] of next) nb[r][c] = col;
      setBoard(nb);
      setWinner(0);
      setWinLine([]);
      setOver(false);
      setCurrent(humanColor);
      return next;
    });
  }, [humanColor]);

  useEffect(() => {
    reset();
    return () => {
      if (aiTimer.current) clearTimeout(aiTimer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const turnText =
    over
      ? winner === humanColor
        ? '你获胜'
        : winner === aiColor
          ? '电脑获胜'
          : '平局'
      : current === humanColor
        ? '轮到你'
        : '电脑思考中';

  return (
    <div className="flex h-full flex-col bg-arch-bg text-arch-text">
      <header className="flex flex-wrap items-center justify-between gap-2 border-b border-arch-border px-4 py-2 text-sm">
        <div className="flex items-center gap-2 font-medium">
          <Cpu size={14} className="text-arch-accent" />
          五子棋
        </div>
        <div className="flex items-center gap-2 text-xs text-arch-muted">
          <span>难度</span>
          {(['easy', 'medium', 'hard'] as Difficulty[]).map((d) => (
            <button
              key={d}
              onClick={() => setDiff(d)}
              className={cn(
                'rounded px-2 py-1 transition',
                diff === d ? 'bg-arch-accent text-white' : 'bg-arch-panel text-arch-muted hover:text-arch-text',
              )}
            >
              {DIFF_LABEL[d]}
            </button>
          ))}
          <span className="ml-2">先后手</span>
          <button
            onClick={() => setFirst('human')}
            className={cn(
              'flex items-center gap-1 rounded px-2 py-1 transition',
              first === 'human' ? 'bg-arch-green/20 text-arch-green' : 'bg-arch-panel text-arch-muted hover:text-arch-text',
            )}
          >
            <User size={12} /> 先手
          </button>
          <button
            onClick={() => setFirst('ai')}
            className={cn(
              'flex items-center gap-1 rounded px-2 py-1 transition',
              first === 'ai' ? 'bg-arch-red/20 text-arch-red' : 'bg-arch-panel text-arch-muted hover:text-arch-text',
            )}
          >
            <Bot size={12} /> 后手
          </button>
        </div>
      </header>

      <div className="flex min-h-0 flex-1 items-center justify-center gap-4 overflow-auto p-3">
        <canvas
          ref={canvasRef}
          width={SIZE}
          height={SIZE}
          onClick={onClick}
          className="cursor-pointer rounded-md border border-arch-border shadow-inner"
          style={{ width: SIZE, height: SIZE, maxWidth: '100%' }}
        />
        <aside className="flex w-36 flex-col gap-3 text-xs">
          <div className="rounded-md bg-arch-panel p-3 text-center">
            <div className="text-arch-muted">当前</div>
            <div
              className={cn(
                'mt-1 text-base font-semibold',
                over ? 'text-arch-muted' : current === humanColor ? 'text-arch-green' : 'text-arch-red',
              )}
            >
              {turnText}
            </div>
          </div>
          <div className="rounded-md bg-arch-panel p-3 text-center">
            <div className="text-arch-muted">步数</div>
            <div className="mt-1 text-base font-semibold text-arch-text tabular-nums">{moves.length}</div>
          </div>
          <div className="flex flex-col gap-2">
            <button
              onClick={undo}
              className="flex items-center justify-center gap-1 rounded-md bg-arch-panel px-3 py-2 text-arch-muted hover:text-arch-text"
              title="撤销上一步"
            >
              <Undo2 size={14} /> 撤销
            </button>
            <button
              onClick={reset}
              className="flex items-center justify-center gap-1 rounded-md bg-arch-panel px-3 py-2 text-arch-muted hover:text-arch-text"
              title="重新开始"
            >
              <RotateCcw size={14} /> 重开
            </button>
          </div>
          <div className="rounded-md bg-arch-panel p-2 text-[11px] leading-relaxed text-arch-muted">
            黑棋为你，白棋为电脑。点击交叉点落子，五子连珠（横/竖/斜）即胜。
          </div>
        </aside>
      </div>

      <footer className="border-t border-arch-border px-4 py-1.5 text-[11px] text-arch-muted">
        鼠标点击落子 · 撤销回退双方各一步 · 重开可选先后手
      </footer>
    </div>
  );
}
