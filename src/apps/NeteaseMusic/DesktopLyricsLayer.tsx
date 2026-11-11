/* ==========================================================================
 * 桌面歌词浮层 · 独立组件
 *
 * 用 createPortal 挂到 document.body，脱离应用窗口的 overflow-hidden / 层叠上下文，
 * 以接近 int32 上限的 z-index 浮在桌面所有窗口之上。
 * 自己订阅 useDesktopLyricsStore，歌词行变化时只重渲染本组件，不牵连网易云主组件。
 * 位置拖拽用原生 pointer + setPointerCapture，松手才落盘。
 * 主题色 / 字号 / 高亮放大度由播放器设置传入。
 * ========================================================================== */
import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { useDesktopLyricsStore } from '@/stores/useDesktopLyricsStore';

export interface DesktopLyricsStyle {
  accent: string;
  lyricSize: number;
  lyricHighlight: number;
}

interface Props {
  style: DesktopLyricsStyle;
  onOpenPlayer: () => void;
}

export default function DesktopLyricsLayer({ style, onOpenPlayer }: Props) {
  const s = useDesktopLyricsStore();
  const dragRef = useRef<{ ox: number; oy: number; x: number; y: number } | null>(null);

  // 首次开启且未记录位置时，放到底部中央偏上（桌面歌词惯例位置）
  useEffect(() => {
    if (s.enabled && s.x === null && s.y === null) {
      const w = Math.min(560, Math.round(window.innerWidth * 0.5));
      useDesktopLyricsStore.getState().setPosition(
        Math.round((window.innerWidth - w) / 2),
        Math.round(window.innerHeight * 0.72),
      );
    }
  }, [s.enabled, s.x, s.y]);

  if (!s.enabled) return null;

  const clamp = (x: number, y: number) => ({
    x: Math.max(8, Math.min(x, window.innerWidth - 160)),
    y: Math.max(8, Math.min(y, window.innerHeight - 80)),
  });
  const pos = clamp(s.x ?? 120, s.y ?? Math.round(window.innerHeight * 0.72));

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if ((e.target as HTMLElement).closest('button')) return;
    dragRef.current = { ox: e.clientX - pos.x, oy: e.clientY - pos.y, x: pos.x, y: pos.y };
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = dragRef.current;
    if (!d) return;
    const next = clamp(e.clientX - d.ox, e.clientY - d.oy);
    // 拖动中直接改 DOM，避免每帧 setState；松手才落盘
    e.currentTarget.style.left = `${next.x}px`;
    e.currentTarget.style.top = `${next.y}px`;
    d.x = next.x;
    d.y = next.y;
  };
  const onPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = dragRef.current;
    if (!d) return;
    e.currentTarget.releasePointerCapture(e.pointerId);
    useDesktopLyricsStore.getState().setPosition(d.x, d.y);
    dragRef.current = null;
  };

  return createPortal(
    <div
      className="fixed select-none"
      style={{
        left: pos.x,
        top: pos.y,
        zIndex: 2147483000,
        width: 'min(560px, 60vw)',
        padding: '10px 16px',
        borderRadius: 12,
        cursor: 'grab',
        touchAction: 'none',
        background: `rgba(10, 12, 20, ${s.bgOpacity})`,
        backdropFilter: 'blur(10px)',
        border: '1px solid rgba(255,255,255,.12)',
        boxShadow: '0 8px 30px rgba(0,0,0,.4)',
        textAlign: 'center',
      }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      title="拖动移动桌面歌词"
    >
      {/* 悬浮工具：回播放页 / 关闭 */}
      <div className="flex justify-end gap-1" style={{ marginBottom: 2, height: 16 }}>
        <button
          type="button"
          title="回到播放页"
          onClick={onOpenPlayer}
          style={{ border: 'none', background: 'transparent', color: 'rgba(255,255,255,.6)', cursor: 'pointer', padding: '0 3px', fontSize: 11 }}
        >
          播放页
        </button>
        <button
          type="button"
          title="关闭桌面歌词"
          onClick={() => useDesktopLyricsStore.getState().patch({ enabled: false })}
          style={{ border: 'none', background: 'transparent', color: 'rgba(255,255,255,.6)', cursor: 'pointer', padding: '0 3px', display: 'flex' }}
        >
          <X size={12} />
        </button>
      </div>
      {s.line || s.nextLine ? (
        <>
          <div
            style={{
              fontSize: style.lyricSize * style.lyricHighlight,
              fontWeight: 700,
              color: style.accent,
              lineHeight: 1.4,
              letterSpacing: '.5px',
              textShadow: '0 2px 12px rgba(0,0,0,.6)',
            }}
          >
            {s.line || '\u00a0'}
          </div>
          {s.lineCount === 2 && (
            <div style={{ fontSize: style.lyricSize * 0.8, color: 'rgba(255,255,255,.55)', lineHeight: 1.5, marginTop: 3 }}>
              {s.nextLine || '\u00a0'}
            </div>
          )}
        </>
      ) : (
        <div style={{ fontSize: 14, color: 'rgba(255,255,255,.7)' }} className="truncate">
          {s.playing ? s.title || '正在播放' : '暂无歌词'}
        </div>
      )}
    </div>,
    document.body,
  );
}
