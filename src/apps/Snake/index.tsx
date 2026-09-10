import { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import { Gamepad, Pause, Play, RotateCcw, Trophy } from 'lucide-react';
import type { AppProps } from '@/shell/types';
import { cn } from '@/lib/cn';

const COLS = 20;
const ROWS = 20;
const STORAGE_KEY = 'archweb_snake_best';

interface Pos {
  x: number;
  y: number;
}
const UP: Pos = { x: 0, y: -1 };
const DOWN: Pos = { x: 0, y: 1 };
const LEFT: Pos = { x: -1, y: 0 };
const RIGHT: Pos = { x: 1, y: 0 };

type Diff = 'slow' | 'medium' | 'fast';
const SPEED: Record<Diff, number> = { slow: 150, medium: 100, fast: 60 };
const DIFF_LABEL: Record<Diff, string> = { slow: '慢', medium: '中', fast: '快' };

interface Game {
  snake: Pos[];
  dir: Pos;
  queue: Pos[];
  food: Pos;
  alive: boolean;
  score: number;
  best: number;
}

const isOpp = (a: Pos, b: Pos) => a.x === -b.x && a.y === -b.y;
const sameDir = (a: Pos, b: Pos) => a.x === b.x && a.y === b.y;

const lerp = (a: number, b: number, t: number) => Math.round(a + (b - a) * t);
function bodyColor(t: number): string {
  const r = lerp(0x17, 0x4e, t);
  const g = lerp(0x93, 0xc9, t);
  const b = lerp(0xd1, 0xb0, t);
  return `rgb(${r}, ${g}, ${b})`;
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

function spawnFood(g: Game) {
  const occ = new Set(g.snake.map((p) => `${p.x},${p.y}`));
  const empties: Pos[] = [];
  for (let y = 0; y < ROWS; y++) {
    for (let x = 0; x < COLS; x++) {
      if (!occ.has(`${x},${y}`)) empties.push({ x, y });
    }
  }
  if (empties.length === 0) {
    g.alive = false;
    return;
  }
  const cell = empties[Math.floor(Math.random() * empties.length)];
  if (cell) g.food = { x: cell.x, y: cell.y };
}

function newGame(best: number): Game {
  const snake: Pos[] = [
    { x: 8, y: 10 },
    { x: 7, y: 10 },
    { x: 6, y: 10 },
  ];
  const g: Game = { snake, dir: RIGHT, queue: [], food: { x: 0, y: 0 }, alive: true, score: 0, best };
  spawnFood(g);
  return g;
}

export default function Snake({ context }: AppProps) {
  const [diff, setDiff] = useState<Diff>('medium');
  const [paused, setPaused] = useState(false);
  const [alive, setAlive] = useState(true);
  const [, force] = useReducer((n: number) => n + 1, 0);
  const gameRef = useRef<Game>(newGame(loadBest()));
  const pausedRef = useRef(paused);
  pausedRef.current = paused;

  const tick = useCallback(() => {
    const g = gameRef.current;
    if (!g.alive || pausedRef.current) return;
    const nextDir = g.queue.length ? (g.queue.shift() as Pos) : g.dir;
    g.dir = nextDir;
    const head = g.snake[0];
    if (!head) return;
    const nx = head.x + g.dir.x;
    const ny = head.y + g.dir.y;
    if (nx < 0 || nx >= COLS || ny < 0 || ny >= ROWS) {
      g.alive = false;
      setAlive(false);
      force();
      return;
    }
    if (g.snake.some((p) => p.x === nx && p.y === ny)) {
      g.alive = false;
      setAlive(false);
      force();
      return;
    }
    const ate = nx === g.food.x && ny === g.food.y;
    const newSnake: Pos[] = [{ x: nx, y: ny }, ...g.snake];
    if (!ate) newSnake.pop();
    g.snake = newSnake;
    if (ate) {
      g.score += 10;
      if (g.score > g.best) {
        g.best = g.score;
        saveBest(g.score);
      }
      spawnFood(g);
    }
    force();
  }, [force]);

  useEffect(() => {
    if (paused || !alive) return;
    const id = setInterval(() => tick(), SPEED[diff]);
    return () => clearInterval(id);
  }, [tick, paused, diff, alive]);

  const restart = useCallback(() => {
    const best = gameRef.current.best;
    gameRef.current = newGame(best);
    setPaused(false);
    setAlive(true);
    force();
  }, [force]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const g = gameRef.current;
      let want: Pos | null = null;
      switch (e.key) {
        case 'ArrowUp':
        case 'w':
        case 'W':
          want = UP;
          break;
        case 'ArrowDown':
        case 's':
        case 'S':
          want = DOWN;
          break;
        case 'ArrowLeft':
        case 'a':
        case 'A':
          want = LEFT;
          break;
        case 'ArrowRight':
        case 'd':
        case 'D':
          want = RIGHT;
          break;
        case ' ':
          e.preventDefault();
          setPaused((p) => !p);
          return;
        case 'r':
        case 'R':
          e.preventDefault();
          restart();
          return;
        default:
          return;
      }
      e.preventDefault();
      const last = g.queue.length ? g.queue[g.queue.length - 1] : g.dir;
      if (last && !isOpp(want, last) && !sameDir(want, last)) {
        if (g.queue.length < 3) g.queue.push(want);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [diff, restart]);

  useEffect(() => {
    context.setTitle('贪吃蛇');
  }, [context]);

  const chooseDiff = (d: Diff) => {
    if (d === diff) return;
    setDiff(d);
    const best = gameRef.current.best;
    gameRef.current = newGame(best);
    setPaused(false);
    setAlive(true);
    force();
  };

  const g = gameRef.current;
  const len = Math.max(1, g.snake.length);
  const cellType: Array<number | 'food' | 'empty'> = new Array(COLS * ROWS).fill('empty');
  g.snake.forEach((p, i) => {
    if (p.y >= 0 && p.y < ROWS && p.x >= 0 && p.x < COLS) {
      cellType[p.y * COLS + p.x] = i;
    }
  });
  if (g.food.y >= 0 && g.food.y < ROWS && g.food.x >= 0 && g.food.x < COLS) {
    cellType[g.food.y * COLS + g.food.x] = 'food';
  }

  return (
    <div className="flex h-full flex-col bg-arch-bg text-arch-text">
      <header className="flex items-center justify-between gap-3 border-b border-arch-border px-4 py-2">
        <div className="flex items-center gap-2 text-sm font-medium">
          <Gamepad size={14} className="text-arch-accent" />
          贪吃蛇
        </div>
        <div className="flex items-center gap-2">
          <div className="rounded bg-arch-panel px-2.5 py-1 text-center text-xs text-arch-muted">
            得分
            <div className="text-sm font-semibold text-arch-text tabular-nums">{g.score}</div>
          </div>
          <div className="rounded bg-arch-panel px-2.5 py-1 text-center text-xs text-arch-muted">
            最高
            <div className="text-sm font-semibold text-arch-green tabular-nums">{g.best}</div>
          </div>
        </div>
      </header>

      <div className="flex items-center gap-2 border-b border-arch-border px-4 py-2 text-xs text-arch-muted">
        难度
        {(['slow', 'medium', 'fast'] as Diff[]).map((d) => (
          <button
            key={d}
            onClick={() => chooseDiff(d)}
            className={cn(
              'rounded px-2.5 py-1 transition',
              diff === d ? 'bg-arch-accent text-white' : 'bg-arch-panel text-arch-muted hover:text-arch-text',
            )}
          >
            {DIFF_LABEL[d]}
          </button>
        ))}
        <button
          onClick={() => setPaused((p) => !p)}
          className="ml-auto flex items-center gap-1 rounded bg-arch-panel px-2.5 py-1 text-arch-muted hover:text-arch-text"
          title="暂停 (空格)"
        >
          {paused ? <Play size={12} /> : <Pause size={12} />}
          {paused ? '继续' : '暂停'}
        </button>
        <button
          onClick={() => restart()}
          className="flex items-center gap-1 rounded bg-arch-panel px-2.5 py-1 text-arch-muted hover:text-arch-text"
          title="重开 (R)"
        >
          <RotateCcw size={12} />
          重开
        </button>
      </div>

      <div className="flex min-h-0 flex-1 items-center justify-center p-3">
        <div className="relative aspect-square w-full max-h-full max-w-full">
          <div
            className="grid h-full w-full rounded-md border border-arch-border bg-arch-panel"
            style={{
              gridTemplateColumns: `repeat(${COLS}, 1fr)`,
              gridTemplateRows: `repeat(${ROWS}, 1fr)`,
            }}
          >
            {cellType.map((t, idx) => {
              if (typeof t === 'number') {
                if (t === 0) {
                  return (
                    <div
                      key={idx}
                      className="rounded-[2px]"
                      style={{ background: 'var(--color-arch-accent)' }}
                    />
                  );
                }
                return (
                  <div
                    key={idx}
                    className="rounded-[1px]"
                    style={{ background: bodyColor(t / len) }}
                  />
                );
              }
              if (t === 'food') {
                return (
                  <div
                    key={idx}
                    className="rounded-full"
                    style={{
                      background: 'var(--color-arch-red)',
                      boxShadow: '0 0 8px 2px color-mix(in srgb, var(--color-arch-red) 70%, transparent)',
                    }}
                  />
                );
              }
              return <div key={idx} className="rounded-[1px] bg-arch-bg/40" />;
            })}
          </div>

          {paused && alive && (
            <div className="absolute inset-0 flex items-center justify-center rounded-md bg-black/60 text-lg font-semibold text-arch-text">
              已暂停
            </div>
          )}
          {!alive && (
            <div className="absolute inset-0 flex flex-col items-center justify-center rounded-md bg-black/75 backdrop-blur-sm">
              <div className="mb-1 flex items-center gap-2 text-xl font-bold text-arch-red">
                <Trophy size={18} />
                游戏结束
              </div>
              <div className="mb-4 text-sm text-arch-muted">
                本局 {g.score} 分 · 最高 {g.best} 分
              </div>
              <button
                onClick={() => restart()}
                className="rounded-md bg-arch-accent px-4 py-2 text-sm font-semibold text-white hover:opacity-90"
              >
                再来一局
              </button>
            </div>
          )}
        </div>
      </div>

      <footer className="border-t border-arch-border px-4 py-1.5 text-[11px] text-arch-muted">
        方向键 / WASD 控制 · 空格暂停 · R 重开
      </footer>
    </div>
  );
}
