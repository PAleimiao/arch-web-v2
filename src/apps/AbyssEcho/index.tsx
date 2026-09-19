import { useEffect, useRef } from 'react';
import type { AppProps } from '@/shell/types';
import { AbyssGame } from './game';
import { VIEW_H, VIEW_W } from './data';

/**
 * 《深渊回响》— 像素动作 RPG
 * 引擎跑在 game.ts（canvas 全权渲染），本组件只负责挂载 / 卸载 / 自适应缩放。
 */
export default function AbyssEchoApp({ context }: AppProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const gameRef = useRef<AbyssGame | null>(null);

  useEffect(() => {
    context.setTitle('深渊回响');
  }, [context]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    canvas.width = VIEW_W;
    canvas.height = VIEW_H;
    const game = new AbyssGame(canvas);
    gameRef.current = game;
    game.start();

    const onBlur = () => {
      // 窗口失焦自动暂停并清空按键，防止回来时角色狂奔
      game.suspend();
    };
    window.addEventListener('blur', onBlur);

    return () => {
      window.removeEventListener('blur', onBlur);
      game.stop();
      gameRef.current = null;
    };
  }, []);

  return (
    <div className="flex h-full items-center justify-center bg-black">
      <canvas
        ref={canvasRef}
        className="h-full w-full object-contain"
        style={{ imageRendering: 'pixelated' }}
      />
    </div>
  );
}
