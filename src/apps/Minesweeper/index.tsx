import { useEffect, useRef, useState } from 'react';
import { Bomb, Flag, RotateCcw, Smile, Timer } from 'lucide-react';
import type { AppProps } from '@/shell/types';
import { cn } from '@/lib/cn';

/**
 * 经典扫雷
 * - 三档难度（初/中/高）
 * - 左键开格、右键标雷 / 双击数字格自动开邻居（已标雷的不开）
 * - 首点击保证不踩雷（首点周围清雷）
 * - 键盘：方向键移动光标、回车开、空格标
 * - 计时 + 计雷（剩余 = 雷数 - 已标）
 */

type Difficulty = 'easy' | 'medium' | 'hard';
interface Config {
  rows: number;
  cols: number;
  mines: number;
  label: string;
}
const PRESETS: Record<Difficulty, Config> = {
  easy: { rows: 9, cols: 9, mines: 10, label: '入门 9×9 / 10雷' },
  medium: { rows: 16, cols: 16, mines: 40, label: '进阶 16×16 / 40雷' },
  hard: { rows: 16, cols: 30, mines: 99, label: '高手 16×30 / 99雷' },
};

type CellState = 'hidden' | 'revealed' | 'flagged';

interface Cell {
  isMine: boolean;
  state: CellState;
  /** 周围 8 格雷数 */
  around: number;
}

const STATUS = {
  idle: { Icon: Smile, color: '' },
  playing: { Icon: Smile, color: '' },
  won: { Icon: Smile, color: 'text-emerald-400' },
  lost: { Icon: Smile, color: 'text-red-400' },
} as const;

type GameStatus = keyof typeof STATUS;

export default function Minesweeper(_: AppProps) {
  const [diff, setDiff] = useState<Difficulty>('easy');
  const cfg = PRESETS[diff];
  const [board, setBoard] = useState<Cell[][]>(() => emptyBoard(cfg.rows, cfg.cols));
  const [status, setStatus] = useState<GameStatus>('idle');
  const [flags, setFlags] = useState(0);
  const [startTime, setStartTime] = useState(0);
  const [elapsed, setElapsed] = useState(0);
  const [cursor, setCursor] = useState<[number, number]>([0, 0]);
  const boardRef = useRef<HTMLDivElement>(null);

  // 计时
  useEffect(() => {
    if (status !== 'playing') return;
    const t = setInterval(() => setElapsed(Math.floor((Date.now() - startTime) / 1000)), 250);
    return () => clearInterval(t);
  }, [status, startTime]);

  // 重置
  const reset = (nextDiff: Difficulty = diff) => {
    setDiff(nextDiff);
    const c = PRESETS[nextDiff];
    setBoard(emptyBoard(c.rows, c.cols));
    setStatus('idle');
    setFlags(0);
    setStartTime(0);
    setElapsed(0);
    setCursor([0, 0]);
  };

  const spawnMines = (rows: number, cols: number, mines: number, safe: [number, number]) => {
    const cells: Cell[][] = Array.from({ length: rows }, () =>
      Array.from({ length: cols }, () => emptyCell()),
    );
    const banned = new Set<string>();
    // 首点周围 8 格也不放雷，保证开局一定能开一片
    const [sr, sc] = safe;
    for (let dr = -1; dr <= 1; dr++) {
      for (let dc = -1; dc <= 1; dc++) {
        banned.add(`${sr + dr},${sc + dc}`);
      }
    }
    const candidates: [number, number][] = [];
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        if (!banned.has(`${r},${c}`)) candidates.push([r, c]);
      }
    }
    // Fisher-Yates 部分洗牌
    const m = Math.min(mines, candidates.length);
    for (let i = 0; i < m; i++) {
      const j = i + Math.floor(Math.random() * (candidates.length - i));
      [candidates[i], candidates[j]] = [candidates[j], candidates[i]];
      const [r, c] = candidates[i];
      cells[r][c].isMine = true;
    }
    // 计算邻居
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        if (cells[r][c].isMine) continue;
        let n = 0;
        for (let dr = -1; dr <= 1; dr++) {
          for (let dc = -1; dc <= 1; dc++) {
            if (!dr && !dc) continue;
            const nr = r + dr;
            const nc = c + dc;
            if (nr < 0 || nr >= rows || nc < 0 || nc >= cols) continue;
            if (cells[nr][nc].isMine) n++;
          }
        }
        cells[r][c].around = n;
      }
    }
    return cells;
  };

  const floodReveal = (
    b: Cell[][],
    r: number,
    c: number,
    rows: number,
    cols: number,
  ): Cell[][] => {
    const next = b.map((row) => row.slice());
    const stack: [number, number][] = [[r, c]];
    while (stack.length) {
      const [cr, cc] = stack.pop()!;
      if (cr < 0 || cr >= rows || cc < 0 || cc >= cols) continue;
      const cell = next[cr][cc];
      if (cell.state !== 'hidden') continue;
      cell.state = 'revealed';
      if (cell.around > 0) continue;
      for (let dr = -1; dr <= 1; dr++) {
        for (let dc = -1; dc <= 1; dc++) {
          if (!dr && !dc) continue;
          stack.push([cr + dr, cc + dc]);
        }
      }
    }
    return next;
  };

  const click = (r: number, c: number, button: 'left' | 'right') => {
    if (status === 'won' || status === 'lost') return;
    const cfg = PRESETS[diff];
    let boardN = board;
    if (status === 'idle') {
      const fresh = spawnMines(cfg.rows, cfg.cols, cfg.mines, [r, c]);
      boardN = fresh;
      setStartTime(Date.now());
      setStatus('playing');
    }
    const cell = boardN[r][c];
    if (button === 'right') {
      if (cell.state === 'revealed') return;
      const flagged = cell.state === 'flagged';
      boardN[r][c].state = flagged ? 'hidden' : 'flagged';
      setBoard(boardN.map((row) => row.slice()));
      setFlags((f) => f + (flagged ? -1 : 1));
      return;
    }
    // 左键
    if (cell.state === 'flagged') return;
    if (cell.isMine) {
      const revealed = boardN.map((row) =>
        row.map((c) =>
          c.isMine ? { ...c, state: 'revealed' as const } : c,
        ),
      );
      setBoard(revealed);
      setStatus('lost');
      return;
    }
    const next = floodReveal(boardN, r, c, cfg.rows, cfg.cols);
    setBoard(next);
    // 检查胜利
    const unrevealedSafe = next.flat().filter((c) => !c.isMine && c.state !== 'revealed').length;
    if (unrevealedSafe === 0) {
      setStatus('won');
    }
  };

  /* ------------------------ 键盘支持 ------------------------ */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target && (e.target as HTMLElement).tagName === 'SELECT') return;
      const [r, c] = cursor;
      const cfg = PRESETS[diff];
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setCursor([Math.max(0, r - 1), c]);
      } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        setCursor([Math.min(cfg.rows - 1, r + 1), c]);
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault();
        setCursor([r, Math.max(0, c - 1)]);
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        setCursor([r, Math.min(cfg.cols - 1, c + 1)]);
      } else if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        click(r, c, e.key === ' ' ? 'right' : 'left');
      } else if (e.key === 'r' || e.key === 'R') {
        reset();
      } else if (e.key === 'f' || e.key === 'F') {
        click(r, c, 'right');
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cursor, status, diff, board]);

  const { Icon } = STATUS[status];
  const cellSize =
    diff === 'easy' ? 32 : diff === 'medium' ? 26 : 22;

  return (
    <div className="flex h-full flex-col bg-zinc-950 text-zinc-100">
      {/* 顶栏 */}
      <header className="flex items-center justify-between gap-3 border-b border-zinc-800 px-4 py-2 text-sm">
        <div className="flex items-center gap-2">
          <Bomb size={14} className="text-red-400" />
          <span className="font-medium">扫雷</span>
          <select
            value={diff}
            onChange={(e) => reset(e.target.value as Difficulty)}
            className="ml-2 rounded bg-zinc-900 px-1.5 py-0.5 text-xs"
          >
            {Object.entries(PRESETS).map(([k, v]) => (
              <option key={k} value={k}>
                {v.label}
              </option>
            ))}
          </select>
        </div>
        <div className="flex items-center gap-3 font-mono text-xs">
          <span className="flex items-center gap-1 text-emerald-400 tabular-nums">
            <Timer size={12} />
            {String(Math.min(999, elapsed)).padStart(3, '0')}
          </span>
          <span className={cn('flex items-center gap-1 tabular-nums', status === 'lost' ? 'text-red-300' : 'text-amber-300')}>
            <Flag size={12} />
            {String(Math.max(0, cfg.mines - flags)).padStart(2, '0')}
          </span>
          <button
            onClick={() => reset()}
            title="重开 (R)"
            className="rounded p-1 hover:bg-zinc-800"
          >
            <RotateCcw size={14} />
          </button>
          <Icon size={20} className={STATUS[status].color} />
        </div>
      </header>

      {/* 棋盘 */}
      <div className="flex flex-1 items-center justify-center overflow-auto p-4">
        <div
          ref={boardRef}
          className="inline-grid select-none rounded-md bg-zinc-900 p-2 shadow-inner"
          style={{
            gridTemplateColumns: `repeat(${cfg.cols}, ${cellSize}px)`,
            gridTemplateRows: `repeat(${cfg.rows}, ${cellSize}px)`,
          }}
        >
          {board.map((row, r) =>
            row.map((cell, c) => {
              const isCursor = r === cursor[0] && c === cursor[1];
              return (
                <button
                  key={`${r}-${c}`}
                  onClick={() => click(r, c, 'left')}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    click(r, c, 'right');
                  }}
                  onMouseMove={() => setCursor([r, c])}
                  className={cn(
                    'm-px flex items-center justify-center rounded-sm border text-[13px] font-bold transition',
                    cellSize === 32
                      ? 'size-7'
                      : cellSize === 26
                        ? 'size-[23px]'
                        : 'size-[19px]',
                    cell.state === 'hidden'
                      ? 'border-zinc-700 bg-gradient-to-br from-zinc-700 to-zinc-800 hover:from-zinc-600 hover:to-zinc-700 active:translate-y-px'
                      : 'border-zinc-800 bg-zinc-900',
                    isCursor && cell.state === 'hidden' && 'ring-1 ring-amber-400',
                  )}
                >
                  {cell.state === 'flagged' && <Flag size={cellSize * 0.55} className="text-rose-400" />}
                  {cell.state === 'revealed' && cell.isMine && (
                    <Bomb size={cellSize * 0.6} className="text-red-500" />
                  )}
                  {cell.state === 'revealed' && !cell.isMine && cell.around > 0 && (
                    <span className={AROUND_COLORS[cell.around]}>{cell.around}</span>
                  )}
                </button>
              );
            }),
          )}
        </div>
      </div>

      <footer className="border-t border-zinc-800 px-4 py-1.5 text-[11px] text-zinc-500">
        方向键移动 · 回车开格 · 空格 / 右键 标雷 · F 标雷 · R 重开
      </footer>
    </div>
  );
}

const AROUND_COLORS = [
  '',
  'text-blue-400',
  'text-emerald-400',
  'text-rose-400',
  'text-violet-400',
  'text-orange-400',
  'text-cyan-400',
  'text-fuchsia-400',
  'text-amber-400',
];

function emptyCell(): Cell {
  return { isMine: false, state: 'hidden', around: 0 };
}

function emptyBoard(rows: number, cols: number): Cell[][] {
  return Array.from({ length: rows }, () =>
    Array.from({ length: cols }, () => emptyCell()),
  );
}
