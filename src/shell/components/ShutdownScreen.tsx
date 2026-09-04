import { useEffect } from 'react';
import { useOSStore } from '@/stores/useOSStore';

const LINES = [
  'Stopping Window Manager...',
  'Unmounting virtual filesystem...',
  'Saving session state...',
  'Reached target Shutdown',
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
    <div className="flex h-full w-full flex-col justify-center gap-1 bg-black px-10 text-[13px] text-arch-muted">
      <p className="mb-4 text-arch-accent">
        {mode === 'restarting' ? 'Rebooting...' : 'Shutting down...'}
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
