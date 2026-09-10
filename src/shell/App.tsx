import { useEffect } from 'react';
import { useOSStore } from '@/stores/useOSStore';
import { useWindowStore } from '@/stores/useWindowStore';
import { useMediaStore } from '@/stores/useMediaStore';
import { getApp } from '@/apps/registry';
import { shade } from '@/lib/color';
import BootScreen from './components/BootScreen';
import LockScreen from './components/LockScreen';
import Desktop from './Desktop';
import ShutdownScreen from './components/ShutdownScreen';

/** 焦点在可编辑元素里时，不应触发全局快捷键 / 媒体键 */
function isEditableTarget(t: EventTarget | null): boolean {
  if (!(t instanceof HTMLElement)) return false;
  const tag = t.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
  if (t.isContentEditable) return true;
  return false;
}

/** 全局快捷键，只在桌面运行时生效 */
function useGlobalHotkeys(enabled: boolean) {
  useEffect(() => {
    if (!enabled) return;

    const onKey = (e: KeyboardEvent) => {
      const os = useOSStore.getState();
      const win = useWindowStore.getState();
      const media = useMediaStore.getState();

      // Ctrl+Alt+T 开终端
      if (e.ctrlKey && e.altKey && (e.key === 't' || e.key === 'T')) {
        e.preventDefault();
        const app = getApp('terminal');
        if (app) win.open({ appId: app.id, title: app.name, singleton: app.singleton });
        return;
      }

      // Ctrl+Shift+P / Ctrl+K 呼出命令面板
      if (
        (e.ctrlKey && e.shiftKey && (e.key === 'p' || e.key === 'P')) ||
        (e.ctrlKey && !e.shiftKey && (e.key === 'k' || e.key === 'K'))
      ) {
        e.preventDefault();
        os.togglePalette();
        return;
      }

      // Ctrl+L 锁屏
      if (e.ctrlKey && (e.key === 'l' || e.key === 'L')) {
        e.preventDefault();
        os.lock();
        return;
      }

      // Ctrl+Shift+W 关闭全部窗口
      if (e.ctrlKey && e.shiftKey && (e.key === 'w' || e.key === 'W')) {
        e.preventDefault();
        win.windows.forEach((w) => win.close(w.id));
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

      // Esc 关闭启动器 / 命令面板
      if (e.key === 'Escape') {
        if (os.paletteOpen) {
          os.togglePalette(false);
          return;
        }
        if (os.launcherOpen) {
          os.toggleLauncher(false);
          return;
        }
      }

      /* ---------- 全局媒体键 ---------- */
      if (isEditableTarget(e.target)) return;
      if (!e.ctrlKey && !e.altKey && !e.shiftKey && !e.metaKey) {
        // 空格 切换播放（任意窗口焦点）
        if (e.code === 'Space') {
          e.preventDefault();
          if (media.bridge?.hasTrack()) media.togglePlay();
          return;
        }
        // MediaNext / MediaPrev 物理媒体键
        if (e.key === 'MediaTrackNext') {
          e.preventDefault();
          if (media.bridge?.hasTrack()) media.next();
          return;
        }
        if (e.key === 'MediaTrackPrevious') {
          e.preventDefault();
          if (media.bridge?.hasTrack()) media.prev();
          return;
        }
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

/** 把设置里的外观项写进 :root，供所有 CSS 变量消费 */
function useApplyTheme() {
  const accent = useOSStore((s) => s.settings.accentColor);
  const animations = useOSStore((s) => s.settings.animations);
  const dark = useOSStore((s) => s.settings.darkMode);

  useEffect(() => {
    const root = document.documentElement;
    root.style.setProperty('--color-arch-accent', accent);
    root.style.setProperty('--color-arch-accent-dim', shade(accent, -0.3));
    root.dataset.motion = animations ? 'on' : 'off';
    root.dataset.theme = dark ? 'dark' : 'light';
  }, [accent, animations, dark]);
}

export default function App() {
  const power = useOSStore((s) => s.power);
  const bootKey = useOSStore((s) => s.bootKey);
  const running = power === 'running';

  useGlobalHotkeys(running);
  useAutoLock(running);
  useApplyTheme();

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
