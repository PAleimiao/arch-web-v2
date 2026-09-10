import { useEffect, useRef, useState } from 'react';
import { Clock, Timer, Bell, Coffee, Play, Pause, RotateCcw } from 'lucide-react';
import type { AppProps } from '@/shell/types';
import { cn } from '@/lib/cn';
import { notify } from '@/stores/useNotifyStore';

/** 短促提示音：用 Web Audio 现场合成，不引外部文件 */
function beep(): void {
  try {
    const Ctor =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext?: typeof AudioContext })
        .webkitAudioContext;
    if (!Ctor) return;
    const ctx = new Ctor();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.type = 'sine';
    osc.frequency.value = 880;
    gain.gain.setValueAtTime(0.0001, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.3, ctx.currentTime + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.4);
    osc.start();
    osc.stop(ctx.currentTime + 0.42);
    osc.onended = () => ctx.close();
  } catch {
    /* 忽略音频不可用的情况 */
  }
}

function pad(n: number, w = 2): string {
  return String(n).padStart(w, '0');
}

/** 毫秒 → MM:SS.mmm（满一小时显示 HH:MM:SS.mmm） */
function fmtStopwatch(ms: number): string {
  const total = Math.max(0, Math.floor(ms));
  const h = Math.floor(total / 3600000);
  const m = Math.floor((total % 3600000) / 60000);
  const s = Math.floor((total % 60000) / 1000);
  const milli = total % 1000;
  return h > 0
    ? `${pad(h)}:${pad(m)}:${pad(s)}.${pad(milli, 3)}`
    : `${pad(m)}:${pad(s)}.${pad(milli, 3)}`;
}

/** 秒 → MM:SS 或 HH:MM:SS */
function fmtCountdown(sec: number): string {
  const s = Math.max(0, Math.floor(sec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = s % 60;
  return h > 0 ? `${pad(h)}:${pad(m)}:${pad(ss)}` : `${pad(m)}:${pad(ss)}`;
}

const TZ: Array<[string, string]> = [
  ['本地', ''],
  ['UTC', 'UTC'],
  ['北京', 'Asia/Shanghai'],
  ['东京', 'Asia/Tokyo'],
  ['纽约', 'America/New_York'],
  ['伦敦', 'Europe/London'],
];

function tzTime(tz: string, now: Date): string {
  try {
    return now.toLocaleTimeString('zh-CN', {
      timeZone: tz || undefined,
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    });
  } catch {
    return now.toLocaleTimeString('zh-CN', { hour12: false });
  }
}

function tzDate(tz: string, now: Date): string {
  try {
    return now.toLocaleDateString('zh-CN', {
      timeZone: tz || undefined,
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      weekday: 'long',
    });
  } catch {
    return now.toLocaleDateString('zh-CN', { weekday: 'long' });
  }
}

type Tab = 'clock' | 'stopwatch' | 'timer' | 'pomodoro';

export default function ClockApp({ context }: AppProps) {
  useEffect(() => {
    context.setTitle('时钟');
  }, [context]);

  const [tab, setTab] = useState<Tab>('clock');
  const [now, setNow] = useState(() => new Date());
  const [tz, setTz] = useState('Asia/Shanghai');

  // ---- 时钟：每秒刷新 ----
  useEffect(() => {
    if (tab !== 'clock') return;
    const id = window.setInterval(() => setNow(new Date()), 500);
    return () => window.clearInterval(id);
  }, [tab]);

  // ---- 秒表 ----
  const [swRunning, setSwRunning] = useState(false);
  const [swElapsed, setSwElapsed] = useState(0);
  const swStart = useRef(0);
  const swAccum = useRef(0);
  const [laps, setLaps] = useState<number[]>([]);

  useEffect(() => {
    if (tab !== 'stopwatch' || !swRunning) return;
    const id = window.setInterval(() => {
      setSwElapsed(swAccum.current + (performance.now() - swStart.current));
    }, 50);
    return () => window.clearInterval(id);
  }, [tab, swRunning]);

  const swStartRun = () => {
    swStart.current = performance.now();
    setSwRunning(true);
  };
  const swPause = () => {
    swAccum.current += performance.now() - swStart.current;
    setSwElapsed(swAccum.current);
    setSwRunning(false);
  };
  const swReset = () => {
    swAccum.current = 0;
    setSwElapsed(0);
    setSwRunning(false);
    setLaps([]);
  };
  const swLap = () => {
    const cur = swAccum.current + (performance.now() - swStart.current);
    setLaps((prev) => [...prev, cur]);
  };

  // ---- 计时器 ----
  const [timerDur, setTimerDur] = useState({ h: 0, m: 5, s: 0 });
  const [timerRemain, setTimerRemain] = useState(5 * 60 * 1000);
  const [timerRunning, setTimerRunning] = useState(false);
  const timerEnd = useRef(0);

  const timerTotalMs = () =>
    (timerDur.h * 3600 + timerDur.m * 60 + timerDur.s) * 1000;

  const startTimer = () => {
    if (timerRemain <= 0) return;
    timerEnd.current = Date.now() + timerRemain;
    setTimerRunning(true);
  };
  const pauseTimer = () => {
    setTimerRemain(Math.max(0, timerEnd.current - Date.now()));
    setTimerRunning(false);
  };
  const resetTimer = () => {
    setTimerRunning(false);
    setTimerRemain(timerTotalMs());
  };
  const changeTimer = (k: 'h' | 'm' | 's', v: number) => {
    const next = { ...timerDur, [k]: Math.max(0, Math.min(k === 'h' ? 23 : 59, v)) };
    setTimerDur(next);
    if (!timerRunning) setTimerRemain((next.h * 3600 + next.m * 60 + next.s) * 1000);
  };

  useEffect(() => {
    if (tab !== 'timer' || !timerRunning) return;
    const id = window.setInterval(() => {
      const rem = timerEnd.current - Date.now();
      if (rem <= 0) {
        setTimerRemain(0);
        setTimerRunning(false);
        notify('计时结束', '时间到！', 'success');
        beep();
      } else {
        setTimerRemain(rem);
      }
    }, 200);
    return () => window.clearInterval(id);
  }, [tab, timerRunning]);

  // ---- 番茄钟 ----
  const [pomoWork, setPomoWork] = useState(25);
  const [pomoBreak, setPomoBreak] = useState(5);
  const [pomoMode, setPomoMode] = useState<'work' | 'break'>('work');
  const [pomoRemain, setPomoRemain] = useState(25 * 60 * 1000);
  const [pomoRunning, setPomoRunning] = useState(false);
  const [pomoCount, setPomoCount] = useState(0);
  const pomoEnd = useRef(0);

  const pomoTotalMs = () => (pomoMode === 'work' ? pomoWork : pomoBreak) * 60 * 1000;

  const startPomo = () => {
    pomoEnd.current = Date.now() + pomoRemain;
    setPomoRunning(true);
  };
  const pausePomo = () => {
    setPomoRemain(Math.max(0, pomoEnd.current - Date.now()));
    setPomoRunning(false);
  };
  const resetPomo = () => {
    setPomoRunning(false);
    setPomoRemain(pomoTotalMs());
  };
  const changePomo = (k: 'work' | 'break', v: number) => {
    const val = Math.max(1, Math.min(120, v));
    if (k === 'work') setPomoWork(val);
    else setPomoBreak(val);
    if (!pomoRunning) setPomoRemain(pomoTotalMs());
  };

  useEffect(() => {
    if (tab !== 'pomodoro' || !pomoRunning) return;
    const id = window.setInterval(() => {
      const rem = pomoEnd.current - Date.now();
      if (rem <= 0) {
        if (pomoMode === 'work') {
          setPomoCount((c) => c + 1);
          setPomoMode('break');
          setPomoRemain(pomoBreak * 60 * 1000);
          pomoEnd.current = Date.now() + pomoBreak * 60 * 1000;
          notify('工作完成', '休息一下吧', 'success');
        } else {
          setPomoMode('work');
          setPomoRemain(pomoWork * 60 * 1000);
          pomoEnd.current = Date.now() + pomoWork * 60 * 1000;
          notify('休息结束', '继续专注工作', 'success');
        }
        beep();
      } else {
        setPomoRemain(rem);
      }
    }, 200);
    return () => window.clearInterval(id);
  }, [tab, pomoRunning, pomoMode, pomoWork, pomoBreak]);

  const tabs: Array<[Tab, string, typeof Clock]> = [
    ['clock', '时钟', Clock],
    ['stopwatch', '秒表', Timer],
    ['timer', '计时器', Bell],
    ['pomodoro', '番茄钟', Coffee],
  ];

  return (
    <div className="flex h-full flex-col bg-arch-bg text-arch-text">
      <div className="flex flex-wrap gap-1 border-b border-arch-border bg-arch-panel/80 px-3 py-1.5">
        {tabs.map(([id, label, Icon]) => (
          <button
            key={id}
            type="button"
            onClick={() => setTab(id)}
            className={cn(
              'flex items-center gap-1 rounded px-2 py-1 text-xs',
              tab === id ? 'bg-arch-accent text-white' : 'hover:bg-white/10',
            )}
          >
            <Icon size={13} /> {label}
          </button>
        ))}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        {tab === 'clock' && (
          <div className="space-y-4">
            <div className="rounded border border-arch-border bg-arch-panel/40 p-4 text-center">
              <div className="font-mono text-5xl tracking-wider">
                {tzTime(tz, now)}
              </div>
              <div className="mt-1 text-[12px] text-arch-muted">
                {tzDate(tz, now)}
              </div>
              <label className="mt-3 inline-flex items-center gap-1 text-[11px] text-arch-muted">
                时区
                <select
                  value={tz}
                  onChange={(e) => setTz(e.target.value)}
                  className="rounded border border-arch-border bg-black/30 px-2 py-1 text-xs"
                >
                  {TZ.map(([label, value]) => (
                    <option key={value || 'local'} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <div>
              <h3 className="mb-2 text-[11px] text-arch-muted">世界时钟</h3>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                {TZ.map(([label, value]) => (
                  <div
                    key={value || 'local'}
                    className="rounded border border-arch-border bg-arch-panel/40 p-2 text-center"
                  >
                    <div className="text-[11px] text-arch-muted">{label}</div>
                    <div className="font-mono text-lg">
                      {tzTime(value, now)}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {tab === 'stopwatch' && (
          <div className="space-y-3">
            <div className="rounded border border-arch-border bg-arch-panel/40 p-4 text-center">
              <div className="font-mono text-5xl tracking-wider">
                {fmtStopwatch(swElapsed)}
              </div>
            </div>
            <div className="flex justify-center gap-2">
              {!swRunning ? (
                <button
                  type="button"
                  onClick={swStartRun}
                  className="flex items-center gap-1 rounded bg-arch-green px-3 py-1.5 text-xs text-black"
                >
                  <Play size={13} /> 开始
                </button>
              ) : (
                <button
                  type="button"
                  onClick={swPause}
                  className="flex items-center gap-1 rounded bg-arch-accent px-3 py-1.5 text-xs text-white"
                >
                  <Pause size={13} /> 暂停
                </button>
              )}
              <button
                type="button"
                onClick={swLap}
                disabled={!swRunning}
                className="flex items-center gap-1 rounded bg-arch-panel px-3 py-1.5 text-xs disabled:opacity-40"
              >
                <RotateCcw size={13} /> 计次
              </button>
              <button
                type="button"
                onClick={swReset}
                className="flex items-center gap-1 rounded bg-arch-panel px-3 py-1.5 text-xs"
              >
                <RotateCcw size={13} /> 重置
              </button>
            </div>
            <div className="space-y-1">
              {laps.length === 0 && (
                <p className="text-center text-[11px] text-arch-muted">
                  还没有计次记录
                </p>
              )}
              {laps.map((cur, i) => {
                const prev = i > 0 ? laps[i - 1] : 0;
                return (
                  <div
                    key={i}
                    className="flex items-center justify-between rounded border border-arch-border bg-arch-panel/40 px-3 py-1 font-mono text-[12px]"
                  >
                    <span className="text-arch-muted">第 {i + 1} 次</span>
                    <span>分段 {fmtStopwatch(cur - prev)}</span>
                    <span className="text-arch-accent">总计 {fmtStopwatch(cur)}</span>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {tab === 'timer' && (
          <div className="space-y-3">
            <div className="rounded border border-arch-border bg-arch-panel/40 p-4 text-center">
              <div className="font-mono text-5xl tracking-wider">
                {fmtCountdown(timerRemain / 1000)}
              </div>
            </div>
            <div className="flex items-center justify-center gap-2">
              {(['h', 'm', 's'] as const).map((k) => (
                <label key={k} className="flex flex-col items-center gap-1">
                  <span className="text-[11px] text-arch-muted">
                    {k === 'h' ? '时' : k === 'm' ? '分' : '秒'}
                  </span>
                  <input
                    type="number"
                    min={0}
                    max={k === 'h' ? 23 : 59}
                    value={timerDur[k]}
                    disabled={timerRunning}
                    onChange={(e) => changeTimer(k, Number(e.target.value))}
                    className="w-16 rounded border border-arch-border bg-black/30 py-1 text-center font-mono"
                  />
                </label>
              ))}
            </div>
            <div className="flex justify-center gap-2">
              {!timerRunning ? (
                <button
                  type="button"
                  onClick={startTimer}
                  className="flex items-center gap-1 rounded bg-arch-green px-3 py-1.5 text-xs text-black"
                >
                  <Play size={13} /> 开始
                </button>
              ) : (
                <button
                  type="button"
                  onClick={pauseTimer}
                  className="flex items-center gap-1 rounded bg-arch-accent px-3 py-1.5 text-xs text-white"
                >
                  <Pause size={13} /> 暂停
                </button>
              )}
              <button
                type="button"
                onClick={resetTimer}
                className="flex items-center gap-1 rounded bg-arch-panel px-3 py-1.5 text-xs"
              >
                <RotateCcw size={13} /> 重置
              </button>
            </div>
          </div>
        )}

        {tab === 'pomodoro' && (
          <div className="space-y-3">
            <div
              className={cn(
                'rounded border p-4 text-center',
                pomoMode === 'work'
                  ? 'border-arch-accent bg-arch-accent/10'
                  : 'border-arch-green bg-arch-green/10',
              )}
            >
              <div className="text-[11px] text-arch-muted">
                {pomoMode === 'work' ? '工作时段' : '休息时段'} · 已完成 {pomoCount} 轮
              </div>
              <div className="font-mono text-5xl tracking-wider">
                {fmtCountdown(pomoRemain / 1000)}
              </div>
            </div>
            <div className="flex items-center justify-center gap-4">
              <label className="flex items-center gap-1 text-[11px]">
                工作(分)
                <input
                  type="number"
                  min={1}
                  max={120}
                  value={pomoWork}
                  disabled={pomoRunning}
                  onChange={(e) => changePomo('work', Number(e.target.value))}
                  className="w-14 rounded border border-arch-border bg-black/30 py-1 text-center font-mono"
                />
              </label>
              <label className="flex items-center gap-1 text-[11px]">
                休息(分)
                <input
                  type="number"
                  min={1}
                  max={120}
                  value={pomoBreak}
                  disabled={pomoRunning}
                  onChange={(e) => changePomo('break', Number(e.target.value))}
                  className="w-14 rounded border border-arch-border bg-black/30 py-1 text-center font-mono"
                />
              </label>
            </div>
            <div className="flex justify-center gap-2">
              {!pomoRunning ? (
                <button
                  type="button"
                  onClick={startPomo}
                  className="flex items-center gap-1 rounded bg-arch-green px-3 py-1.5 text-xs text-black"
                >
                  <Play size={13} /> 开始
                </button>
              ) : (
                <button
                  type="button"
                  onClick={pausePomo}
                  className="flex items-center gap-1 rounded bg-arch-accent px-3 py-1.5 text-xs text-white"
                >
                  <Pause size={13} /> 暂停
                </button>
              )}
              <button
                type="button"
                onClick={resetPomo}
                className="flex items-center gap-1 rounded bg-arch-panel px-3 py-1.5 text-xs"
              >
                <RotateCcw size={13} /> 重置
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
