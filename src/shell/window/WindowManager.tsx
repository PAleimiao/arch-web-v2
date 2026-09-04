import { useWindowStore } from '@/stores/useWindowStore';
import WindowFrame from './WindowFrame';

/** 按 z-index 顺序渲染所有窗口 */
export default function WindowManager() {
  const windows = useWindowStore((s) => s.windows);

  return (
    <>
      {windows
        .filter((w) => !w.minimized)
        .sort((a, b) => a.zIndex - b.zIndex)
        .map((w) => (
          <WindowFrame key={w.id} id={w.id} />
        ))}
    </>
  );
}
