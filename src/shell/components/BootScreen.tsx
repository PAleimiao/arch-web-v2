import { useEffect, useRef, useState } from 'react';
import { useOSStore } from '@/stores/useOSStore';

const LINES: Array<[string, string]> = [
  ['  OK  ', '已加载 Arch Web OS v2.0（浏览器环境）'],
  ['  OK  ', '已挂载虚拟文件系统'],
  ['  OK  ', '窗口管理器已启动'],
  ['  OK  ', '应用注册表已启动'],
  ['  OK  ', 'Dock 与顶栏已启动'],
  ['  OK  ', '已到达目标：图形界面'],
];

const LOGO = `    _             _      __        __   ____   _____
   / \\   _ __ ___| |__   \\ \\      / /  / ___| / ___|
  / _ \\ | '__/ __| '_ \\   \\ \\ /\\ / /  | |     \\___ \\
 / ___ \\| | | (__| | | |   \\ V  V /   | |___   ___) |
/_/   \\_\\_|  \\___|_| |_|    \\_/\\_/     \\____| |____/`;

/** 开机动画：逐行吐日志，结束后切到锁屏 */
export default function BootScreen() {
  const bootComplete = useOSStore((s) => s.bootComplete);
  const [shown, setShown] = useState(0);
  const done = useRef(false);

  useEffect(() => {
    if (shown >= LINES.length) {
      const t = setTimeout(() => {
        if (!done.current) {
          done.current = true;
          bootComplete();
        }
      }, 420);
      return () => clearTimeout(t);
    }
    const t = setTimeout(() => setShown((n) => n + 1), 190);
    return () => clearTimeout(t);
  }, [shown, bootComplete]);

  return (
    <div className="flex h-full w-full flex-col justify-end bg-black px-10 py-12 font-mono text-[13px] leading-6 text-arch-text">
      <pre className="mb-8 text-[9px] leading-[1.2] text-arch-accent">
        {LOGO}
      </pre>
      <p className="mb-6 text-[11px] text-arch-muted">
        Arch Web OS v2 · kernel web-6.8.0-arch1-1
      </p>

      {LINES.slice(0, shown).map(([tag, text], i) => (
        <div key={i}>
          <span className="text-arch-green">[{tag}]</span> {text}
        </div>
      ))}

      {shown < LINES.length && (
        <span className="cursor-blink text-arch-accent">▋</span>
      )}
    </div>
  );
}
