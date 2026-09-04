import { useState } from 'react';
import { CATEGORIES, APPS } from '@/apps/registry';
import { useWindowStore } from '@/stores/useWindowStore';
import { useOSStore } from '@/stores/useOSStore';
import { cn } from '@/lib/cn';

export default function AppLauncher() {
  const launcherOpen = useOSStore((s) => s.launcherOpen);
  const toggleLauncher = useOSStore((s) => s.toggleLauncher);
  const open = useWindowStore((s) => s.open);
  const [category, setCategory] = useState<string>('全部');
  const [query, setQuery] = useState('');

  if (!launcherOpen) return null;

  const apps = APPS.filter((a) => {
    const okCat = category === '全部' || a.category === category;
    const okQuery =
      !query ||
      a.name.toLowerCase().includes(query.toLowerCase()) ||
      a.description.toLowerCase().includes(query.toLowerCase()) ||
      a.id.includes(query.toLowerCase());
    return okCat && okQuery;
  });

  const launch = (id: string, name: string) => {
    open({ appId: id, title: name });
    toggleLauncher(false);
    setQuery('');
  };

  return (
    <div
      className="fixed inset-0 z-[8000] flex items-start justify-center bg-black/50 pt-[12vh] backdrop-blur-sm"
      onClick={() => toggleLauncher(false)}
    >
      <div
        className="w-[min(680px,90vw)] overflow-hidden rounded-xl border border-arch-border bg-arch-panel/95 shadow-2xl backdrop-blur-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="border-b border-arch-border p-3">
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="搜索应用…"
            className="w-full bg-transparent text-sm text-arch-text outline-none placeholder:text-arch-muted"
          />
        </div>

        <div className="flex gap-1 border-b border-arch-border px-3 py-2">
          {CATEGORIES.map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => setCategory(c)}
              className={cn(
                'rounded px-2 py-0.5 text-[11px] transition',
                category === c
                  ? 'bg-arch-accent/25 text-white'
                  : 'text-arch-muted hover:bg-white/5 hover:text-arch-text',
              )}
            >
              {c}
            </button>
          ))}
        </div>

        <div className="grid max-h-[46vh] grid-cols-4 gap-2 overflow-y-auto p-3">
          {apps.map((app) => {
            const Icon = app.icon;
            return (
              <button
                key={app.id}
                type="button"
                onClick={() => launch(app.id, app.name)}
                className="group flex flex-col items-center gap-2 rounded-lg p-3 transition hover:bg-white/8"
              >
                <div
                  className="flex h-11 w-11 items-center justify-center rounded-xl transition group-hover:scale-105"
                  style={{ background: `${app.accent ?? '#1793d1'}22` }}
                >
                  <Icon size={20} style={{ color: app.accent ?? '#1793d1' }} />
                </div>
                <span className="w-full truncate text-center text-[11px] text-arch-text/90">
                  {app.name}
                </span>
              </button>
            );
          })}

          {apps.length === 0 && (
            <p className="col-span-4 py-8 text-center text-xs text-arch-muted">
              没有匹配的应用
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
