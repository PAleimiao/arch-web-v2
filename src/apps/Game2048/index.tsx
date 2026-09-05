import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp, RotateCcw, Trophy } from 'lucide-react';
import type { AppComponentProps } from '../../shell/types';

type Board = (number | null)[][];

const SIZE = 4;
const STORAGE_KEY = 'arch2048_best';

type Direction = 'up' | 'down' | 'left' | 'right';

const rotate = (b: Board): Board => {
  const out: Board = Array.from({ length: SIZE }, () => Array(SIZE).fill(null));
  for (let r = 0; r < SIZE; r++) for (let c = 0; c < SIZE; c++) out[c][SIZE - 1 - r] = b[r][c];
  return out;
};

const rotateBack = (b: Board): Board => {
  const out: Board = Array.from({ length: SIZE }, () => Array(SIZE).fill(null));
  for (let r = 0; r < SIZE; r++) for (let c = 0; c < SIZE; c++) out[SIZE - 1 - c][r] = b[r][c];
  return out;
};

const slideRow = (row: (number | null)[]): { row: (number | null)[]; gained: number } => {
  const compact = row.filter((v): v is number => v !== null);
  const merged: (number | null)[] = [];
  let gained = 0;
  let i = 0;
  while (i < compact.length) {
    if (i + 1 < compact.length && compact[i] === compact[i + 1]) {
      const v = compact[i]! * 2;
      merged.push(v);
      gained += v;
      i += 2;
    } else {
      merged.push(compact[i]);
      i++;
    }
  }
  while (merged.length < SIZE) merged.push(null);
  return { row: merged, gained };
};

const move = (board: Board, dir: Direction): { board: Board; moved: boolean; gained: number } => {
  // rotate so that "left" handles every direction uniformly
  let b = board;
  let times = 0;
  if (dir === 'up') times = 3;
  else if (dir === 'right') times = 1;
  else if (dir === 'down') times = 2;
  for (let t = 0; t < times; t++) b = rotate(b);

  let totalGained = 0;
  let anyMoved = false;
  const out: Board = Array.from({ length: SIZE }, () => Array(SIZE).fill(null));
  for (let r = 0; r < SIZE; r++) {
    const { row, gained } = slideRow(b[r]);
    for (let c = 0; c < SIZE; c++) {
      if (row[c] !== b[r][c]) anyMoved = true;
      out[r][c] = row[c];
    }
    totalGained += gained;
  }

  let result = out;
  for (let t = 0; t < (4 - times) % 4; t++) result = rotateBack(result);
  return { board: result, moved: anyMoved, gained: totalGained };
};

const emptyBoard = (): Board =>
  Array.from({ length: SIZE }, () => Array(SIZE).fill(null));

const spawn = (b: Board): Board => {
  const empties: [number, number][] = [];
  for (let r = 0; r < SIZE; r++) for (let c = 0; c < SIZE; c++) if (b[r][c] === null) empties.push([r, c]);
  if (empties.length === 0) return b;
  const [r, c] = empties[Math.floor(Math.random() * empties.length)];
  const out = b.map((row) => row.slice());
  out[r][c] = Math.random() < 0.9 ? 2 : 4;
  return out;
};

const canMove = (b: Board): boolean => {
  for (let r = 0; r < SIZE; r++)
    for (let c = 0; c < SIZE; c++) {
      if (b[r][c] === null) return true;
      if (c + 1 < SIZE && b[r][c] === b[r][c + 1]) return true;
      if (r + 1 < SIZE && b[r][c] === b[r + 1][c]) return true;
    }
  return false;
};

const colorFor = (v: number | null): string => {
  if (v === null) return 'bg-zinc-800/40';
  switch (v) {
    case 2:
      return 'bg-zinc-700 text-zinc-200';
    case 4:
      return 'bg-zinc-600 text-zinc-100';
    case 8:
      return 'bg-orange-700 text-white';
    case 16:
      return 'bg-orange-600 text-white';
    case 32:
      return 'bg-orange-500 text-white';
    case 64:
      return 'bg-rose-600 text-white';
    case 128:
      return 'bg-amber-500 text-white';
    case 256:
      return 'bg-amber-400 text-zinc-900';
    case 512:
      return 'bg-yellow-400 text-zinc-900';
    case 1024:
      return 'bg-lime-500 text-zinc-900';
    case 2048:
      return 'bg-gradient-to-br from-yellow-300 to-amber-500 text-zinc-900';
    default:
      return 'bg-fuchsia-600 text-white';
  }
};

const fontFor = (v: number | null): string => {
  if (v === null) return '';
  if (v < 100) return 'text-4xl';
  if (v < 1000) return 'text-3xl';
  if (v < 10000) return 'text-2xl';
  return 'text-xl';
};

export default function Game2048({ windowId }: AppComponentProps) {
  const [board, setBoard] = useState<Board>(() => {
    let b = emptyBoard();
    b = spawn(b);
    b = spawn(b);
    return b;
  });
  const [score, setScore] = useState(0);
  const [best, setBest] = useState(0);
  const [over, setOver] = useState(false);
  const [won, setWon] = useState(false);
  const touchRef = useRef<{ x: number; y: number } | null>(null);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) setBest(Number(raw) || 0);
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    if (score > best) {
      setBest(score);
      try {
        localStorage.setItem(STORAGE_KEY, String(score));
      } catch {
        /* ignore */
      }
    }
  }, [score, best]);

  const handleMove = useCallback(
    (dir: Direction) => {
      if (over || won) return;
      setBoard((prev) => {
        const { board: next, moved, gained } = move(prev, dir);
        if (!moved) return prev;
        const withNew = spawn(next);
        if (gained > 0) setScore((s) => s + gained);
        if (withNew.flat().includes(2048) && !won) setWon(true);
        if (!canMove(withNew)) setOver(true);
        return withNew;
      });
    },
    [over, won],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const map: Record<string, Direction> = {
        ArrowUp: 'up',
        ArrowDown: 'down',
        ArrowLeft: 'left',
        ArrowRight: 'right',
        w: 'up',
        s: 'down',
        a: 'left',
        d: 'right',
        W: 'up',
        S: 'down',
        A: 'left',
        D: 'right',
      };
      const dir = map[e.key];
      if (!dir) return;
      e.preventDefault();
      handleMove(dir);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [handleMove]);

  const reset = () => {
    let b = emptyBoard();
    b = spawn(b);
    b = spawn(b);
    setBoard(b);
    setScore(0);
    setOver(false);
    setWon(false);
  };

  const onTouchStart = (e: React.TouchEvent) => {
    const t = e.touches[0];
    touchRef.current = { x: t.clientX, y: t.clientY };
  };
  const onTouchEnd = (e: React.TouchEvent) => {
    const start = touchRef.current;
    touchRef.current = null;
    if (!start) return;
    const t = e.changedTouches[0];
    const dx = t.clientX - start.x;
    const dy = t.clientY - start.y;
    if (Math.abs(dx) < 30 && Math.abs(dy) < 30) return;
    if (Math.abs(dx) > Math.abs(dy)) handleMove(dx > 0 ? 'right' : 'left');
    else handleMove(dy > 0 ? 'down' : 'up');
  };

  return (
    <div className="flex h-full select-none flex-col bg-zinc-950 p-4 text-zinc-200" data-window-id={windowId}>
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2 text-xs uppercase tracking-widest text-zinc-500">
          <Trophy size={14} className="text-amber-400" />
          2048
        </div>
        <div className="flex gap-2">
          <div className="rounded-md bg-zinc-800 px-3 py-1 text-center text-xs text-zinc-400">
            <div>SCORE</div>
            <div className="text-sm font-semibold text-zinc-100">{score}</div>
          </div>
          <div className="rounded-md bg-zinc-800 px-3 py-1 text-center text-xs text-zinc-400">
            <div>BEST</div>
            <div className="text-sm font-semibold text-amber-400">{best}</div>
          </div>
          <button
            onClick={reset}
            className="rounded-md bg-zinc-700 px-3 py-1 text-xs text-zinc-200 hover:bg-zinc-600"
            title="重新开始"
          >
            <RotateCcw size={12} className="inline" /> 重开
          </button>
        </div>
      </div>

      <div
        className="relative flex-1 rounded-lg bg-zinc-900/70 p-2 ring-1 ring-zinc-800"
        onTouchStart={onTouchStart}
        onTouchEnd={onTouchEnd}
      >
        <div className="grid h-full grid-cols-4 gap-2">
          {board.flatMap((row, r) =>
            row.map((v, c) => (
              <div
                key={`${r}-${c}`}
                className={`flex items-center justify-center rounded-md font-bold transition-colors ${colorFor(v)} ${fontFor(v)}`}
              >
                {v ?? ''}
              </div>
            )),
          )}
        </div>

        {over && (
          <div className="absolute inset-0 flex flex-col items-center justify-center rounded-lg bg-black/70 backdrop-blur">
            <div className="mb-2 text-2xl font-bold text-rose-400">游戏结束</div>
            <div className="mb-4 text-sm text-zinc-300">得分 {score}</div>
            <button
              onClick={reset}
              className="rounded-md bg-amber-500 px-4 py-2 text-sm font-semibold text-zinc-900 hover:bg-amber-400"
            >
              再来一局
            </button>
          </div>
        )}
        {won && !over && (
          <div className="absolute inset-0 flex flex-col items-center justify-center rounded-lg bg-black/60 backdrop-blur">
            <div className="mb-2 text-2xl font-bold text-amber-400">🎉 达成 2048</div>
            <div className="mb-4 text-xs text-zinc-400">继续玩或重新开始</div>
            <div className="flex gap-2">
              <button
                onClick={() => setWon(false)}
                className="rounded-md bg-zinc-700 px-4 py-2 text-sm text-zinc-100 hover:bg-zinc-600"
              >
                继续
              </button>
              <button
                onClick={reset}
                className="rounded-md bg-amber-500 px-4 py-2 text-sm font-semibold text-zinc-900 hover:bg-amber-400"
              >
                重开
              </button>
            </div>
          </div>
        )}
      </div>

      <div className="mt-3 grid grid-cols-3 gap-2">
        <div />
        <button
          onClick={() => handleMove('up')}
          className="rounded-md bg-zinc-800 p-2 text-zinc-300 hover:bg-zinc-700"
          title="向上"
        >
          <ArrowUp size={16} className="mx-auto" />
        </button>
        <div />
        <button
          onClick={() => handleMove('left')}
          className="rounded-md bg-zinc-800 p-2 text-zinc-300 hover:bg-zinc-700"
          title="向左"
        >
          <ArrowLeft size={16} className="mx-auto" />
        </button>
        <button
          onClick={() => handleMove('down')}
          className="rounded-md bg-zinc-800 p-2 text-zinc-300 hover:bg-zinc-700"
          title="向下"
        >
          <ArrowDown size={16} className="mx-auto" />
        </button>
        <button
          onClick={() => handleMove('right')}
          className="rounded-md bg-zinc-800 p-2 text-zinc-300 hover:bg-zinc-700"
          title="向右"
        >
          <ArrowRight size={16} className="mx-auto" />
        </button>
      </div>
      <div className="mt-2 text-center text-[10px] text-zinc-500">
        方向键 / WASD / 触屏滑动
      </div>
    </div>
  );
}
