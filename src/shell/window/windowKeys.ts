import { useWindowStore } from "@/stores/useWindowStore";

/**
 * 应用级键盘隔离守卫。
 *
 * 背景：游戏 / 播放器等应用把 keydown 监听挂在 window 上，多个窗口同时开着时，
 * 所有监听会一起收到方向键 —— 玩贪吃蛇时网易云跟着切歌就是这个原因。
 *
 * 各应用在 window keydown 回调开头加一行：
 *   if (!isWindowActive(context.windowId)) return;
 * 只有本应用窗口处于激活态（activeId === 自己）时才继续处理按键，
 * 失焦窗口直接忽略，从而做到应用间互不串键。
 *
 * 用 getState() 实时读取，不做闭包缓存，因此不影响各应用现有 useEffect 的依赖结构。
 */
export function isWindowActive(windowId: string): boolean {
  return useWindowStore.getState().activeId === windowId;
}

export default isWindowActive;
