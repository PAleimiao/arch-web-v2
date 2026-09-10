import { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import { Pause, Play, RotateCcw, Trophy } from 'lucide-react';
import type { AppProps } from '@/shell/types';
import { cn } from '@/lib/cn';

const COLS = 10;
const ROWS = 20;
const STORAGE_KEY = 'archweb_tetris_best';

type PieceType = 'I' | 'O' | 'T' | 'S' | 'Z' | 'J' | 'L';
const TYPES: PieceType[] = ['I', 'O', 'T', 'S', 'Z', 'J', 'L'];

type Cell = number; // 0 empty, 1..7 color index

interface Piece {
  type: PieceType;
  rot: number;
  x: number;
  y: number;
}

interface Model {
  board: Cell[][];
  cur: Piece | null;
  next: PieceType;
  hold: PieceType | null;
  canHold: boolean;
  score: number;
  level: number;
  lines: number;
  best: number;
  flash: number[];
  over: boolean;
}

const SHAPES: Record<PieceType, number[][]> = {
  I: [[0, 0, 0, 0], [1, 1, 1, 1], [0, 0, 0, 0], [0, 0, 0, 0]],
  O: [[1, 1], [1, 1]],
  T: [[0, 1, 0], [1, 1, 1], [0, 0, 0]],
  S: [[0, 1, 1], [1, 1, 0], [0, 0, 0]],
  Z: [[1, 1, 0], [0, 1, 1], [0, 0, 0]],
  J: [[1, 0, 0], [1, 1, 1], [0, 0, 0]],
  L: [[0, 0, 1], [1, 1, 1], [0, 0, 0]],
};

const COLOR_INDEX: Record<PieceType, number> = { I: 1, O: 2, T: 3, S: 4, Z: 5, J: 6, L: 7 };

const COLOR_CLASS: Record<number, string> = {
  1: 'bg-cyan-400',
  2: 'bg-yellow-400',
  3: 'bg-purple-400',
  4: 'bg-emerald-400',
  5: 'bg-rose-400',
  6: 'bg-blue-400',
  7: 'bg-orange-400',
};

const KICKS: Array<[number, number]> = [
  [0, 0], [-1, 0], [1, 0], [0, -1], [-2, 0], [2, 0], [-1, -1], [1, -1],
];

function rotateCW(m: number[][]): number[][] {
  const n = m.length;
  const out: number[][] = Array.from({ length: n }, () => Array<number>(n).fill(0));
  for (let r = 0; r < n; r++) {
    const row = m[r];
    if (!row) continue;
    for (let c = 0; c < n; c++) {
      const v = row[c];
      if (v !== undefined) out[c][n - 1 - r] = v;
    }
  }
  return out;
}

function cellsOf(type: PieceType, rot: number): Array<[number, number]> {
  let m = SHAPES[type];
  for (let i = 0; i < rot; i++) m = rotateCW(m);
  const out: Array<[number, number]> = [];
  for (let r = 0; r < m.length; r++) {
    const row = m[r];
    if (!row) continue;
    for (let c = 0; c < row.length; c++) {
      if (row[c] === 1) out.push([r, c]);
    }
  }
  return out;
}

function emptyBoard(): Cell[][] {
  return Array.from({ length: ROWS }, () => Array<number>(COLS).fill(0));
}

function randomType(): PieceType {
  const idx = Math.floor(Math.random() * TYPES.length);
  const t = TYPES[idx];
  return t ?? 'T';
}

function collides(board: Cell[][], type: PieceType, rot: number, x: number, y: number): boolean {
  const cells = cellsOf(type, rot);
  for (const [r, c] of cells) {
    const bx = x + c;
    const by = y + r;
    if (bx < 0 || bx >= COLS) return true;
    if (by >= ROWS) return true;
    if (by >= 0) {
      const row = board[by];
      if (row && row[bx]) return true;
    }
  }
  return false;
}

function clearLines(board: Cell[][]): { board: Cell[][]; rows: number[] } {
  const kept: Cell[][] = [];
  const rows: number[] = [];
  for (let r = 0; r < board.length; r++) {
    const row = board[r];
    if (!row) continue;
    if (row.every((v) => v !== 0)) rows.push(r);
    else kept.push(row);
  }
  const removed = rows.length;
  const fresh = Array.from({ length: removed }, () => Array<number>(COLS).fill(0));
  return { board: [...fresh, ...kept], rows };
}

function spawn(m: Model) {
  const type = m.next;
  m.next = randomType();
  const size = SHAPES[type].length;
  const x = Math.floor((COLS - size) / 2);
  const y = 0;
  m.cur = { type, rot: 0, x, y };
  m.canHold = true;
  if (collides(m.board, type, 0, x, y)) m.over = true;
}

function lockPiece(m: Model) {
  const cur = m.cur;
  if (!cur) return;
  const cells = cellsOf(cur.type, cur.rot);
  const board = m.board.map((row) => row.slice());
  for (const [r, c] of cells) {
    const by = cur.y + r;
    const bx = cur.x + c;
    if (by >= 0 && by < ROWS && bx >= 0 && bx < COLS) board[by][bx] = COLOR_INDEX[cur.type];
  }
  const { board: cleared, rows } = clearLines(board);
  m.board = cleared;
  if (rows.length > 0) {
    const n = rows.length;
    const base = n === 1 ? 100 : n === 2 ? 300 : n === 3 ? 500 : 800;
    m.score += base * m.level;
    m.lines += n;
    m.level = Math.floor(m.lines / 10) + 1;
    m.flash = Array.from({ length: n }, (_, i) => ROWS - n + i);
  }
  m.cur = null;
  spawn(m);
}

function tryMove(m: Model, dx: number, dy: number): boolean {
  const cur = m.cur;
  if (!cur) return false;
  if (!collides(m.board, cur.type, cur.rot, cur.x + dx, cur.y + dy)) {
    cur.x += dx;
    cur.y += dy;
    return true;
  }
  return false;
}

function gravity(m: Model) {
  if (!m.cur) return;
  if (!tryMove(m, 0, 1)) lockPiece(m);
}

function softDrop(m: Model) {
  if (!m.cur) return;
  if (tryMove(m, 0, 1)) m.score += 1;
  else lockPiece(m);
}

function hardDrop(m: Model) {
  if (!m.cur) return;
  let dist = 0;
  while (tryMove(m, 0, 1)) dist++;
  m.score += dist * 2;
  lockPiece(m);
}

function rotate(m: Model) {
  const cur = m.cur;
  if (!cur) return;
  const newRot = (cur.rot + 1) % 4;
  for (const [kx, ky] of KICKS) {
    if (!collides(m.board, cur.type, newRot, cur.x + kx, cur.y + ky)) {
      cur.rot = newRot;
      cur.x += kx;
      cur.y += ky;
      return;
    }
  }
}

function hold(m: Model) {
  const cur = m.cur;
  if (!cur || !m.canHold) return;
  const curType = cur.type;
  if (m.hold === null) {
    m.hold = curType;
    spawn(m);
  } else {
    const h = m.hold;
    m.hold = curType;
    const hs = SHAPES[h].length;
    const x = Math.floor((COLS - hs) / 2);
    m.cur = { type: h, rot: 0, x, y: 0 };
    if (collides(m.board, h, 0, x, 0)) m.over = true;
  }
  m.canHold = false;
}

function newModel(best: number): Model {
  const m: Model = {
    board: emptyBoard(),
    cur: null,
    next: randomType(),
    hold: null,
    canHold: true,
    score: 0,
    level: 1,
    lines: 0,
    best,
    flash: [],
    over: false,
  };
  spawn(m);
  return m;
}

function loadBest(): number {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? Number(raw) || 0 : 0;
  } catch {
    return 0;
  }
}
function saveBest(v: number) {
  try {
    localStorage.setItem(STORAGE_KEY, String(v));
  } catch {
    /* ignore */
  }
}

const intervalFor = (level: number) => Math.max(60, 800 - (level - 1) * 70);

function MiniPiece({ type }: { type: PieceType }) {
  const cells = cellsOf(type, 0);
  const occupied = new Set(cells.map(([r, c]) => `${r},${c}`));
  const size = SHAPES[type].length;
  return (
    <div
      className="grid gap-px"
      style={{ gridTemplateColumns: `repeat(${size}, 1fr)`, width: 64, height: 64 }}
    >
      {Array.from({ length: size * size }).map((_, i) => {
        const r = Math.floor(i / size);
        const c = i % size;
        const on = occupied.has(`${r},${c}`);
        return (
          <div
            key={i}
            className={cn('rounded-[2px]', on ? COLOR_CLASS[COLOR_INDEX[type]] : 'bg-arch-bg/40')}
          />
        );
      })}
    </div>
  );
}

export default function Tetris({ context }: AppProps) {
  const [paused, setPaused] = useState(false);
  const [over, setOver] = useState(false);
  const [level, setLevel] = useState(1);
  const [, force] = useReducer((n: number) => n + 1, 0);
  const gameRef = useRef<Model>(newModel(loadBest()));
  const pausedRef = useRef(paused);
  pausedRef.current = paused;
  const flashTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearFlashLater = useCallback(() => {
    if (flashTimer.current) clearTimeout(flashTimer.current);
    flashTimer.current = setTimeout(() => {
      gameRef.current.flash = [];
      force();
    }, 250);
  }, [force]);

  const sync = useCallback(() => {
    const m = gameRef.current;
    if (m.score > m.best) {
      m.best = m.score;
      saveBest(m.score);
    }
    setLevel(m.level);
    if (m.over) setOver(true);
    if (m.flash.length > 0) clearFlashLater();
    force();
  }, [force, clearFlashLater]);

  const step = useCallback(() => {
    const m = gameRef.current;
    if (!m.cur || pausedRef.current || m.over) return;
    gravity(m);
    sync();
  }, [sync]);

  useEffect(() => {
    if (paused || over) return;
    const id = setInterval(() => step(), intervalFor(level));
    return () => clearInterval(id);
  }, [step, paused, over, level]);

  useEffect(() => {
    return () => {
      if (flashTimer.current) clearTimeout(flashTimer.current);
    };
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const m = gameRef.current;
      if (e.key === 'p' || e.key === 'P') {
        e.preventDefault();
        if (!m.over) setPaused((p) => !p);
        return;
      }
      if (e.key === 'r' || e.key === 'R') {
        e.preventDefault();
        restart();
        return;
      }
      if (pausedRef.current || m.over) return;
      switch (e.key) {
        case 'ArrowLeft':
          e.preventDefault();
          if (tryMove(m, -1, 0)) force();
          break;
        case 'ArrowRight':
          e.preventDefault();
          if (tryMove(m, 1, 0)) force();
          break;
        case 'ArrowDown':
          e.preventDefault();
          softDrop(m);
          sync();
          break;
        case 'ArrowUp':
          e.preventDefault();
          rotate(m);
          force();
          break;
        case ' ':
          e.preventDefault();
          hardDrop(m);
          sync();
          break;
        case 'c':
        case 'C':
          e.preventDefault();
          hold(m);
          force();
          break;
        default:
          break;
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sync]);

  const restart = useCallback(() => {
    const best = gameRef.current.best;
    gameRef.current = newModel(best);
    setPaused(false);
    setOver(false);
    setLevel(1);
    force();
  }, [force]);

  useEffect(() => {
    context.setTitle('俄罗斯方块');
  }, [context]);

  const m = gameRef.current;
  const ghostY = (() => {
    if (!m.cur) return 0;
    let dy = 0;
    while (!collides(m.board, m.cur.type, m.cur.rot, m.cur.x, m.cur.y + dy + 1)) dy++;
    return dy;
  })();

  // 渲染棋盘：当前方块、落点幽灵、已固定方块
  const grid: Cell[][] = m.board.map((row) => row.slice());
  if (m.cur) {
    const cells = cellsOf(m.cur.type, m.cur.rot);
    // 幽灵
    for (const [r, c] of cells) {
      const by = m.cur.y + ghostY + r;
      const bx = m.cur.x + c;
      if (by >= 0 && by < ROWS && bx >= 0 && bx < COLS && grid[by][bx] === 0) {
        grid[by][bx] = -1;
      }
    }
    // 实体
    for (const [r, c] of cells) {
      const by = m.cur.y + r;
      const bx = m.cur.x + c;
      if (by >= 0 && by < ROWS && bx >= 0 && bx < COLS) grid[by][bx] = COLOR_INDEX[m.cur.type];
    }
  }

  return (
    <div className="relative flex h-full flex-col bg-arch-bg text-arch-text">
      <header className="flex items-center justify-between border-b border-arch-border px-4 py-2">
        <div className="flex items-center gap-2 text-sm font-medium">
          <Trophy size={14} className="text-arch-accent" />
          俄罗斯方块
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setPaused((p) => !p)}
            className="flex items-center gap-1 rounded bg-arch-panel px-2.5 py-1 text-xs text-arch-muted hover:text-arch-text"
            title="暂停 (P)"
          >
            {paused ? <Play size={12} /> : <Pause size={12} />}
            {paused ? '继续' : '暂停'}
          </button>
          <button
            onClick={restart}
            className="flex items-center gap-1 rounded bg-arch-panel px-2.5 py-1 text-xs text-arch-muted hover:text-arch-text"
            title="重开 (R)"
          >
            <RotateCcw size={12} />
            重开
          </button>
        </div>
      </header>

      <div className="flex min-h-0 flex-1 gap-3 p-3">
        <div className="mx-auto flex aspect-[1/2] h-full max-h-full">
          <div
            className="grid h-full w-full overflow-hidden rounded-md border border-arch-border bg-arch-panel"
            style={{
              gridTemplateColumns: `repeat(${COLS}, 1fr)`,
              gridTemplateRows: `repeat(${ROWS}, 1fr)`,
            }}
          >
            {grid.flatMap((row, r) =>
              row.map((v, c) => {
                const flashing = m.flash.includes(r);
                if (v === 0) {
                  return <div key={`${r}-${c}`} className="rounded-[1px] bg-arch-bg/30" />;
                }
                if (v === -1) {
                  return (
                    <div
                      key={`${r}-${c}`}
                      className="rounded-[1px] border border-arch-border bg-arch-bg/10"
                    />
                  );
                }
                const cls = COLOR_CLASS[v] ?? 'bg-zinc-500';
                return (
                  <div
                    key={`${r}-${c}`}
                    className={cn('rounded-[1px]', cls, flashing && 'animate-pulse ring-1 ring-white')}
                  />
                );
              }),
            )}
          </div>
        </div>

        <aside className="flex w-32 flex-col gap-3 text-xs">
          <div className="rounded-md bg-arch-panel p-2">
            <div className="mb-1 text-arch-muted">下一个</div>
            <div className="flex justify-center py-1">
              <MiniPiece type={m.next} />
            </div>
          </div>
          <div className="rounded-md bg-arch-panel p-2">
            <div className="mb-1 text-arch-muted">持有 (C)</div>
            <div className="flex justify-center py-1">
              {m.hold ? <MiniPiece type={m.hold} /> : <div className="text-arch-muted">—</div>}
            </div>
          </div>
          <div className="grid grid-cols-1 gap-2">
            <div className="rounded-md bg-arch-panel px-2.5 py-1 text-center text-arch-muted">
              分数
              <div className="text-base font-semibold text-arch-text tabular-nums">{m.score}</div>
            </div>
            <div className="rounded-md bg-arch-panel px-2.5 py-1 text-center text-arch-muted">
              等级
              <div className="text-base font-semibold text-arch-accent tabular-nums">{m.level}</div>
            </div>
            <div className="rounded-md bg-arch-panel px-2.5 py-1 text-center text-arch-muted">
              消行
              <div className="text-base font-semibold text-arch-text tabular-nums">{m.lines}</div>
            </div>
            <div className="rounded-md bg-arch-panel px-2.5 py-1 text-center text-arch-muted">
              最高
              <div className="text-base font-semibold text-arch-green tabular-nums">{m.best}</div>
            </div>
          </div>
        </aside>
      </div>

      {over && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/70 backdrop-blur-sm">
          <div className="flex flex-col items-center">
            <div className="mb-2 text-2xl font-bold text-arch-red">游戏结束</div>
            <div className="mb-1 text-sm text-arch-muted">得分 {m.score} · 消行 {m.lines}</div>
            <div className="mb-4 text-xs text-arch-muted">最高 {m.best}</div>
            <button
              onClick={restart}
              className="rounded-md bg-arch-accent px-4 py-2 text-sm font-semibold text-white hover:opacity-90"
            >
              再来一局
            </button>
          </div>
        </div>
      )}

      <footer className="border-t border-arch-border px-4 py-1.5 text-[11px] text-arch-muted">
        ←→ 移动 · ↑ 旋转 · ↓ 软降 · 空格 硬降 · C 持有 · P 暂停 · R 重开
      </footer>
    </div>
  );
}
