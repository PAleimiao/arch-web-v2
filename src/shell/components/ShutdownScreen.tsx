import { useEffect } from 'react';
import { useOSStore } from '@/stores/useOSStore';

const LINES = [
  '正在停止窗口管理器…',
  '正在卸载虚拟文件系统…',
  '正在保存会话状态…',
  '已到达目标：关机',
];

/** 关机/重启过渡动画 */
export default function ShutdownScreen({
  mode,
}: {
  mode: 'shutting-down' | 'restarting';
}) {
  const powerOffComplete = useOSStore((s) => s.powerOffComplete);
  const restartComplete = useOSStore((s) => s.restartComplete);

  useEffect(() => {
    const t = setTimeout(
      () => (mode === 'restarting' ? restartComplete() : powerOffComplete()),
      1600,
    );
    return () => clearTimeout(t);
  }, [mode, powerOffComplete, restartComplete]);

  return (
    <div className="flex h-full w-full flex-col justify-center gap-1 bg-black px-10 font-mono text-[13px] text-arch-muted">
      <p className="mb-4 text-arch-accent">
        {mode === 'restarting' ? '正在重启…' : '正在关机…'}
      </p>
      {LINES.map((line, i) => (
        <div
          key={line}
          style={{ animation: `window-in 0.3s ease-out ${i * 0.28}s both` }}
        >
          <span className="text-arch-green">[  OK  ]</span> {line}
        </div>
      ))}
    </div>
  );
}
