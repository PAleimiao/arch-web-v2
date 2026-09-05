import { create } from 'zustand';

export interface MediaTrack {
  /** 文件原始名 */
  name: string;
  /** 暴露给 <audio> 的 URL（objectURL 或 dataURL） */
  url: string;
  /** 额外元数据 */
  size?: number;
  duration?: number;
}

/** MusicPlayer 在挂载时把它的几个回调注入到 store；这样全局可以经由 store 控制播放器。
 *  MusicPlayer 内部仍维持自己的状态机，此桥仅作为外部播控通道，不参与内部数据流。 */
export interface MediaBridge {
  hasTrack: () => boolean;
  togglePlay: () => void;
  next: () => void;
  prev: () => void;
  seek: (sec: number) => void;
  setVolume: (v: number) => void;
  toggleMute: () => void;
  getCurrentTitle: () => string | null;
}

interface MediaState {
  /** 当前播放轨；null 表示无 */
  current: MediaTrack | null;
  playing: boolean;
  position: number;
  duration: number;
  /** 队列（不含 current） */
  queue: MediaTrack[];
  /** 音量 0..1 */
  volume: number;
  muted: boolean;
  /** 由 MusicPlayer 在 onMount 时填入；onUnmount 清空 */
  bridge: MediaBridge | null;

  setBridge: (b: MediaBridge | null) => void;
  /** MusicPlayer 在播放状态变化时调用（供悬浮 miniPlayer 或外部 HUD 订阅） */
  sync: (patch: Partial<Pick<MediaState, 'playing' | 'position' | 'duration'>>) => void;
  playTrack: (track: MediaTrack, restQueue?: MediaTrack[]) => void;
  togglePlay: () => void;
  next: () => void;
  prev: () => void;
  seek: (sec: number) => void;
  setVolume: (v: number) => void;
  toggleMute: () => void;
  clear: () => void;
}

const noopBridge: MediaBridge = {
  hasTrack: () => false,
  togglePlay: () => undefined,
  next: () => undefined,
  prev: () => undefined,
  seek: () => undefined,
  setVolume: () => undefined,
  toggleMute: () => undefined,
  getCurrentTitle: () => null,
};

export const useMediaStore = create<MediaState>((set, get) => ({
  current: null,
  playing: false,
  position: 0,
  duration: 0,
  queue: [],
  volume: 0.8,
  muted: false,
  bridge: null,

  setBridge: (b) => set({ bridge: b }),

  sync: (patch) => set(patch),

  playTrack: (track, restQueue = []) => {
    set({ current: track, queue: restQueue, position: 0, duration: 0, playing: true });
  },

  togglePlay: () => {
    const b = get().bridge ?? noopBridge;
    b.togglePlay();
  },

  next: () => {
    const b = get().bridge ?? noopBridge;
    b.next();
  },

  prev: () => {
    const b = get().bridge ?? noopBridge;
    b.prev();
  },

  seek: (sec) => {
    const b = get().bridge ?? noopBridge;
    b.seek(sec);
  },

  setVolume: (v) => {
    const b = get().bridge ?? noopBridge;
    set({ volume: v, muted: v === 0 });
    b.setVolume(v);
  },

  toggleMute: () => {
    const b = get().bridge ?? noopBridge;
    const next = !get().muted;
    set({ muted: next });
    b.toggleMute();
  },

  clear: () => {
    set({
      current: null,
      queue: [],
      position: 0,
      duration: 0,
      playing: false,
    });
  },
}));

