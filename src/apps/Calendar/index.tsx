import { useEffect, useState } from 'react';
import {
  Calendar as CalendarIcon,
  ChevronLeft,
  ChevronRight,
  RotateCcw,
  Plus,
  Trash2,
  Pencil,
  X,
} from 'lucide-react';
import type { AppProps } from '@/shell/types';
import { cn } from '@/lib/cn';
import { notify } from '@/stores/useNotifyStore';

interface CalEvent {
  id: string;
  title: string;
  time: string;
  note: string;
}

type EventMap = Record<string, CalEvent[]>;

const KEY = 'arch-web-os:calendar';

function loadCal(): EventMap {
  if (typeof localStorage === 'undefined') return {};
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as EventMap) : {};
  } catch {
    return {};
  }
}

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

function keyOf(y: number, m: number, d: number): string {
  return `${y}-${pad(m + 1)}-${pad(d)}`;
}

function uid(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

const WEEK = ['一', '二', '三', '四', '五', '六', '日'];

export default function Calendar({ context }: AppProps) {
  useEffect(() => {
    context.setTitle('日历');
  }, [context]);

  const today = new Date();
  const [viewYear, setViewYear] = useState(today.getFullYear());
  const [viewMonth, setViewMonth] = useState(today.getMonth());
  const [selected, setSelected] = useState<Date>(new Date());
  const [events, setEvents] = useState<EventMap>(loadCal);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [draftTitle, setDraftTitle] = useState('');
  const [draftTime, setDraftTime] = useState('');
  const [draftNote, setDraftNote] = useState('');

  useEffect(() => {
    try {
      localStorage.setItem(KEY, JSON.stringify(events));
    } catch {
      /* 隐私模式下可能不可写，忽略 */
    }
  }, [events]);

  const todayKey = keyOf(today.getFullYear(), today.getMonth(), today.getDate());

  const prevMonth = () => {
    if (viewMonth === 0) {
      setViewMonth(11);
      setViewYear((y) => y - 1);
    } else {
      setViewMonth((m) => m - 1);
    }
  };
  const nextMonth = () => {
    if (viewMonth === 11) {
      setViewMonth(0);
      setViewYear((y) => y + 1);
    } else {
      setViewMonth((m) => m + 1);
    }
  };
  const goToday = () => {
    setViewYear(today.getFullYear());
    setViewMonth(today.getMonth());
    setSelected(new Date());
  };

  const selectDay = (y: number, m: number, d: number) => {
    setSelected(new Date(y, m, d));
    setEditingId(null);
    setDraftTitle('');
    setDraftTime('');
    setDraftNote('');
    if (m !== viewMonth) {
      setViewYear(y);
      setViewMonth(m);
    }
  };

  // 本周（周一为起点）
  const monday = new Date(today);
  const dow = (today.getDay() + 6) % 7;
  monday.setDate(today.getDate() - dow);

  // 月历网格（6 行 42 格，周一为起点）
  const firstWeekday = (new Date(viewYear, viewMonth, 1).getDay() + 6) % 7;
  const cells: Array<{ y: number; m: number; d: number; inMonth: boolean }> = [];
  for (let i = 0; i < 42; i++) {
    const date = new Date(viewYear, viewMonth, 1 + i - firstWeekday);
    cells.push({
      y: date.getFullYear(),
      m: date.getMonth(),
      d: date.getDate(),
      inMonth: date.getMonth() === viewMonth,
    });
  }

  const selKey = keyOf(
    selected.getFullYear(),
    selected.getMonth(),
    selected.getDate(),
  );

  const saveEvent = () => {
    if (!draftTitle.trim()) {
      notify('请填写标题', '事件标题不能为空', 'warn');
      return;
    }
    setEvents((prev) => {
      const list = prev[selKey] ? [...prev[selKey]] : [];
      if (editingId) {
        const idx = list.findIndex((e) => e.id === editingId);
        if (idx >= 0) {
          list[idx] = {
            id: editingId,
            title: draftTitle.trim(),
            time: draftTime,
            note: draftNote,
          };
        }
      } else {
        list.push({
          id: uid(),
          title: draftTitle.trim(),
          time: draftTime,
          note: draftNote,
        });
      }
      list.sort((a, b) => a.time.localeCompare(b.time));
      return { ...prev, [selKey]: list };
    });
    setEditingId(null);
    setDraftTitle('');
    setDraftTime('');
    setDraftNote('');
  };

  const deleteEvent = (id: string) => {
    setEvents((prev) => ({
      ...prev,
      [selKey]: (prev[selKey] ?? []).filter((e) => e.id !== id),
    }));
    if (editingId === id) {
      setEditingId(null);
      setDraftTitle('');
      setDraftTime('');
      setDraftNote('');
    }
  };

  const editEvent = (day: number, ev: CalEvent) => {
    setSelected(new Date(viewYear, viewMonth, day));
    setEditingId(ev.id);
    setDraftTitle(ev.title);
    setDraftTime(ev.time);
    setDraftNote(ev.note);
  };

  const monthEvents: Array<{ day: number; ev: CalEvent }> = [];
  const dim = new Date(viewYear, viewMonth + 1, 0).getDate();
  for (let d = 1; d <= dim; d++) {
    const list = events[keyOf(viewYear, viewMonth, d)];
    if (list) for (const ev of list) monthEvents.push({ day: d, ev });
  }
  monthEvents.sort(
    (a, b) => a.day - b.day || a.ev.time.localeCompare(b.ev.time),
  );

  return (
    <div className="flex h-full flex-col bg-arch-bg text-arch-text">
      <div className="flex items-center gap-2 border-b border-arch-border bg-arch-panel/80 px-3 py-1.5">
        <CalendarIcon size={14} className="text-arch-accent" />
        <span className="text-xs font-medium">
          {viewYear} 年 {viewMonth + 1} 月
        </span>
        <button
          type="button"
          onClick={prevMonth}
          className="ml-2 rounded p-1 hover:bg-white/10"
        >
          <ChevronLeft size={14} />
        </button>
        <button type="button" onClick={nextMonth} className="rounded p-1 hover:bg-white/10">
          <ChevronRight size={14} />
        </button>
        <button
          type="button"
          onClick={goToday}
          className="flex items-center gap-1 rounded bg-arch-panel px-2 py-0.5 text-[11px] hover:bg-white/10"
        >
          <RotateCcw size={12} /> 今天
        </button>
      </div>

      <div className="flex min-h-0 flex-1 flex-col">
        {/* 本周星期条 */}
        <div className="grid grid-cols-7 border-b border-arch-border bg-arch-panel/40 text-center text-[11px]">
          {Array.from({ length: 7 }).map((_, i) => {
            const dt = new Date(monday);
            dt.setDate(monday.getDate() + i);
            const isToday =
              keyOf(dt.getFullYear(), dt.getMonth(), dt.getDate()) === todayKey;
            return (
              <div
                key={i}
                className={cn(
                  'py-1',
                  isToday ? 'text-arch-accent' : 'text-arch-muted',
                )}
              >
                {WEEK[i]}
                <div className="text-[10px]">{dt.getDate()}</div>
              </div>
            );
          })}
        </div>

        <div className="flex min-h-0 flex-1">
          {/* 月历 */}
          <div className="grid min-h-0 flex-1 grid-cols-7 grid-rows-6">
            {cells.map((c, i) => {
              const k = keyOf(c.y, c.m, c.d);
              const list = events[k];
              const hasEvent = !!list && list.length > 0;
              const isToday = k === todayKey;
              const isSel = k === selKey;
              return (
                <button
                  key={i}
                  type="button"
                  onClick={() => selectDay(c.y, c.m, c.d)}
                  className={cn(
                    'flex flex-col items-center border border-arch-border/60 py-1 text-[12px]',
                    c.inMonth ? 'text-arch-text' : 'text-arch-muted/50',
                    isSel ? 'bg-arch-accent/20' : 'hover:bg-white/5',
                  )}
                >
                  <span
                    className={cn(
                      'flex h-5 w-5 items-center justify-center rounded-full',
                      isToday && 'bg-arch-accent text-white',
                    )}
                  >
                    {c.d}
                  </span>
                  {hasEvent && (
                    <span className="mt-0.5 flex gap-0.5">
                      {list.slice(0, 3).map((e) => (
                        <span
                          key={e.id}
                          className="h-1 w-1 rounded-full bg-arch-green"
                        />
                      ))}
                    </span>
                  )}
                </button>
              );
            })}
          </div>

          {/* 右侧：编辑 + 当月事件 */}
          <div className="flex w-60 shrink-0 flex-col border-l border-arch-border bg-arch-panel/40">
            <div className="border-b border-arch-border p-2 text-[11px] text-arch-muted">
              {selected.getFullYear()} 年 {selected.getMonth() + 1} 月 {selected.getDate()} 日
            </div>
            <div className="space-y-2 border-b border-arch-border p-2">
              <input
                value={draftTitle}
                onChange={(e) => setDraftTitle(e.target.value)}
                placeholder="事件标题"
                className="w-full rounded border border-arch-border bg-black/30 px-2 py-1 text-[12px] outline-none"
              />
              <input
                type="time"
                value={draftTime}
                onChange={(e) => setDraftTime(e.target.value)}
                className="w-full rounded border border-arch-border bg-black/30 px-2 py-1 text-[12px] outline-none"
              />
              <textarea
                value={draftNote}
                onChange={(e) => setDraftNote(e.target.value)}
                placeholder="备注（可选）"
                rows={2}
                className="w-full resize-none rounded border border-arch-border bg-black/30 px-2 py-1 text-[12px] outline-none"
              />
              <div className="flex gap-1">
                <button
                  type="button"
                  onClick={saveEvent}
                  className="flex flex-1 items-center justify-center gap-1 rounded bg-arch-accent px-2 py-1 text-[11px] text-white hover:bg-arch-accent/80"
                >
                  <Plus size={12} /> {editingId ? '更新' : '添加'}
                </button>
                {editingId && (
                  <button
                    type="button"
                    onClick={() => deleteEvent(editingId)}
                    className="flex items-center justify-center rounded bg-arch-red/80 px-2 py-1 text-[11px] text-white"
                  >
                    <Trash2 size={12} />
                  </button>
                )}
                {editingId && (
                  <button
                    type="button"
                    onClick={() => {
                      setEditingId(null);
                      setDraftTitle('');
                      setDraftTime('');
                      setDraftNote('');
                    }}
                    className="flex items-center justify-center rounded bg-arch-panel px-2 py-1 text-[11px]"
                  >
                    <X size={12} />
                  </button>
                )}
              </div>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto p-2">
              <h3 className="mb-1 text-[11px] text-arch-muted">当月事件</h3>
              {monthEvents.length === 0 && (
                <p className="text-[11px] text-arch-muted">本月暂无事件</p>
              )}
              {monthEvents.map(({ day, ev }) => (
                <button
                  key={ev.id}
                  type="button"
                  onClick={() => editEvent(day, ev)}
                  className="mb-1 flex w-full items-center gap-2 rounded border border-arch-border bg-arch-panel/40 px-2 py-1 text-left text-[11px] hover:bg-white/10"
                >
                  <span className="shrink-0 font-mono text-arch-muted">
                    {pad(day)} {ev.time || '--:--'}
                  </span>
                  <span className="min-w-0 flex-1 truncate">{ev.title}</span>
                  <Pencil size={11} className="shrink-0 text-arch-muted" />
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
