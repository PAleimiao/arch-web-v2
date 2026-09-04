import { useEffect, useState } from 'react';
import { Lock, ArrowRight } from 'lucide-react';
import { useOSStore } from '@/stores/useOSStore';

/** 锁屏：任意输入密码都能解锁（当前没有账号系统，纯本地环境） */
export default function LockScreen() {
  const unlock = useOSStore((s) => s.unlock);
  const wallpaper = useOSStore((s) => s.settings.wallpaper);
  const [time, setTime] = useState(() => new Date());

  useEffect(() => {
    const t = setInterval(() => setTime(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    unlock();
  };

  return (
    <div className="relative h-full w-full overflow-hidden bg-arch-bg">
      <div
        className="absolute inset-0 bg-cover bg-center opacity-40"
        style={{ backgroundImage: `url(${wallpaper})` }}
      />
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" />

      <div className="relative flex h-full flex-col items-center justify-center gap-6">
        <div className="text-center">
          <p className="text-6xl font-light tracking-tight text-white">
            {time.toLocaleTimeString('zh-CN', { hour12: false })}
          </p>
          <p className="mt-2 text-sm text-white/60">
            {time.toLocaleDateString('zh-CN', {
              year: 'numeric',
              month: 'long',
              day: 'numeric',
              weekday: 'long',
            })}
          </p>
        </div>

        <form onSubmit={submit} className="flex items-center gap-2">
          <div className="flex items-center gap-2 rounded-lg border border-white/15 bg-white/10 px-3 py-2">
            <Lock size={15} className="text-white/60" />
            <input
              type="password"
              autoFocus
              placeholder="按回车解锁"
              className="w-40 bg-transparent text-sm text-white outline-none placeholder:text-white/40"
            />
          </div>
          <button
            type="submit"
            className="rounded-lg border border-white/15 bg-white/10 p-2 text-white/70 transition hover:bg-white/20"
            aria-label="解锁"
          >
            <ArrowRight size={15} />
          </button>
        </form>

        <p className="text-[11px] text-white/35">
          本地环境，无需密码 · 按 Enter 直接进入
        </p>
      </div>
    </div>
  );
}
