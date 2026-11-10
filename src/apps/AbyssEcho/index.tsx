import { useEffect, useRef } from "react";
import type { AppProps } from "@/shell/types";
import { isWindowActive } from "@/shell/window/windowKeys";
import { useWindowStore } from "@/stores/useWindowStore";
import { AbyssGame } from "./game";
import { VIEW_H, VIEW_W } from "./data";

/**
 * 《深渊回响》— 像素动作 RPG
 * 引擎跑在 game.ts（canvas 全权渲染），本组件只负责挂载 / 卸载 / 自适应缩放。
 */
export default function AbyssEchoApp({ context }: AppProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const gameRef = useRef<AbyssGame | null>(null);

  useEffect(() => {
    context.setTitle("深渊回响");
  }, [context]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    canvas.width = VIEW_W;
    canvas.height = VIEW_H;
    const windowId = context.windowId;
    // 只有本游戏窗口激活时才接收按键，避免玩别的游戏时角色乱动
    const game = new AbyssGame(canvas, () => isWindowActive(windowId));
    gameRef.current = game;
    game.start();

    const onBlur = () => {
      // 浏览器窗口失焦自动暂停并清空按键，防止回来时角色狂奔
      game.suspend();
    };
    window.addEventListener("blur", onBlur);

    // 切到别的桌面应用（如贪吃蛇）时同样暂停，应用级按键隔离
    const unsub = useWindowStore.subscribe((state, prev) => {
      if (state.activeId !== windowId && prev.activeId === windowId) game.suspend();
    });

    return () => {
      window.removeEventListener("blur", onBlur);
      unsub();
      game.stop();
      gameRef.current = null;
    };
  }, [context.windowId]);

  return (
    <div className="flex h-full items-center justify-center bg-black">
      <canvas
        ref={canvasRef}
        className="h-full w-full object-contain"
        style={{ imageRendering: "pixelated" }}
      />
    </div>
  );
}
