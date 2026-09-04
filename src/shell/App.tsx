import { useEffect } from 'react';
import { useOSStore } from '@/stores/useOSStore';
import { useWindowStore } from '@/stores/useWindowStore';
import { getApp } from '@/apps/registry';
import BootScreen from './components/BootScreen';
import LockScreen from './components/LockScreen';
import Desktop from './Desktop';
import ShutdownScreen from './components/ShutdownScreen';

/** 全局快捷键，只在桌面运行时生效 */
function useGlobalHotkeys(enabled: boolean) {
  useEffect(() => {
    if (!enabled) return;

    const onKey = (e: KeyboardEvent) => {
      const os = useOSStore.getState();
      const win = useWindowStore.getState();

      // Ctrl+Alt+T 开终端
      if (e.ctrlKey && e.altKey && (e.key === 't' || e.key === 'T')) {
        e.preventDefault();
        const app = getApp('terminal');
        if (app) win.open({ appId: app.id, title: app.name });
        return;
      }

      // Ctrl+L 锁屏
      if (e.ctrlKey && (e.key === 'l' || e.key === 'L')) {
        e.preventDefault();
        os.lock();
        return;
      }

      // Alt+F4 关闭当前窗口
      if (e.altKey && e.key === 'F4') {
        e.preventDefault();
        if (win.activeId) win.close(win.activeId);
        return;
      }

      // Super / Win 键切换应用启动器
      if (e.key === 'Meta') {
        e.preventDefault();
        os.toggleLauncher();
        return;
      }

      // Esc 关闭启动器
      if (e.key === 'Escape' && os.launcherOpen) {
        os.toggleLauncher(false);
      }
    };

    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [enabled]);
}

/** 无操作自动锁屏 */
function useAutoLock(enabled: boolean) {
  const minutes = useOSStore((s) => s.settings.autoLockMinutes);

  useEffect(() => {
    if (!enabled || minutes <= 0) return;
    let timer: ReturnType<typeof setTimeout>;

    const reset = () => {
      clearTimeout(timer);
      timer = setTimeout(() => useOSStore.getState().lock(), minutes * 60_000);
    };

    const events = ['mousedown', 'keydown', 'touchstart', 'wheel'] as const;
    events.forEach((e) => window.addEventListener(e, reset));
    reset();

    return () => {
      clearTimeout(timer);
      events.forEach((e) => window.removeEventListener(e, reset));
    };
  }, [enabled, minutes]);
}

export default function App() {
  const power = useOSStore((s) => s.power);
  const bootKey = useOSStore((s) => s.bootKey);
  const running = power === 'running';

  useGlobalHotkeys(running);
  useAutoLock(running);

  if (power === 'booting') return <BootScreen key={bootKey} />;
  if (power === 'locked') return <LockScreen />;
  if (power === 'off') return <PowerOffScreen />;
  if (power === 'shutting-down' || power === 'restarting') {
    return <ShutdownScreen mode={power} />;
  }
  return <Desktop />;
}

function PowerOffScreen() {
  const powerOn = useOSStore((s) => s.powerOn);
  return (
    <button
      type="button"
      onClick={powerOn}
      className="flex h-full w-full cursor-pointer items-center justify-center bg-black"
    >
      <div className="text-center text-arch-muted">
        <div className="mb-3 text-5xl opacity-25">◉</div>
        <p className="text-xs tracking-[0.3em]">点击开机</p>
      </div>
    </button>
  );
}
