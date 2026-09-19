/**
 * 《深渊回响》像素美术层
 *
 * 设计原则（对齐麦琪的花园那种干净像素风）：
 * 1. 统一调色板：每种材质有 base / shade / light 三档，保证光影一致
 * 2. 每个精灵带 1px 深色描边 —— 像素画的清晰度八成来自描边
 * 3. 高光在左上、阴影在右下，光源统一
 * 4. 所有角色有投影，落地感
 */

/* ============================ 调色板 ============================ */

export const PAL = {
  // 草地
  grass: { light: '#7ec46a', base: '#529a44', shade: '#3d7833' },
  grassDry: { light: '#c8b46a', base: '#a89a52', shade: '#847a3e' },
  // 土路
  path: { light: '#d8b880', base: '#b8965e', shade: '#8f7448' },
  // 石（压低亮度，避免在草地旁过于抢眼）
  stone: { light: '#a8a8a2', base: '#8a8a84', shade: '#5f5f5a' },
  // 地牢砖
  crypt: { light: '#4e4a60', base: '#3a3648', shade: '#26232f' },
  // 水
  water: { light: '#6ec8f0', base: '#2f6396', shade: '#1d4270' },
  // 木
  wood: { light: '#c08a52', base: '#8a6a48', shade: '#5e4630' },
  // 树
  leaf: { light: '#6ab84e', base: '#3f7a34', shade: '#295422' },
  // 皮肤
  skin: { light: '#ffe0c0', base: '#f0c8a0', shade: '#c99a76' },
  // 主角（Arch 蓝）
  hero: { light: '#4ec9f0', base: '#1793d1', shade: '#0f6a99' },
  // 钢
  steel: { light: '#ffffff', base: '#c8ccd8', shade: '#8a8e9c' },
  // 金
  gold: { light: '#ffe98a', base: '#f0c94a', shade: '#b8901e' },
  // 危险/深渊
  abyss: { light: '#c9a0ff', base: '#8a5ad0', shade: '#5a3280' },
  // 描边（通用）
  ink: '#181a22',
} as const;

/** 画一个像素块（取整对齐，保证像素网格干净） */
export function rect(
  c: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  color: string,
) {
  c.fillStyle = color;
  c.fillRect(Math.round(x), Math.round(y), Math.round(w), Math.round(h));
}

/** 椭圆投影 */
function shadow(c: CanvasRenderingContext2D, x: number, y: number, rx: number, ry: number, a = 0.26) {
  c.fillStyle = `rgba(0,0,0,${a})`;
  c.beginPath();
  c.ellipse(Math.round(x), Math.round(y), rx, ry, 0, 0, Math.PI * 2);
  c.fill();
}

/** 精灵轮廓描边：沿矩形描一圈深色，提升可读性 */
function outlineRect(
  c: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  color = PAL.ink,
) {
  c.fillStyle = color;
  c.fillRect(Math.round(x) - 1, Math.round(y), Math.round(w) + 2, 1);
  c.fillRect(Math.round(x) - 1, Math.round(y + h), Math.round(w) + 2, 1);
  c.fillRect(Math.round(x) - 1, Math.round(y), 1, Math.round(h) + 1);
  c.fillRect(Math.round(x + w), Math.round(y), 1, Math.round(h) + 1);
}

function rnd(tx: number, ty: number, s: number): number {
  let h = (tx * 374761393 + ty * 668265263 + s * 2246822519) | 0;
  h = (h ^ (h >> 13)) * 1274126177;
  return ((h ^ (h >> 16)) >>> 0) / 4294967296;
}

/* ============================ 瓦片 ============================ */

export interface TileCtx {
  time: number;
  dungeon: boolean;
}

/**
 * 草地基底：纯色 + 抖动斑点
 * 每个 4×4 子格用确定性哈希决定是否撒明/暗点，视觉上连续、不出现整格色块
 */
function grassBase(c: CanvasRenderingContext2D, px: number, py: number, tx: number, ty: number) {
  rect(c, px, py, 24, 24, '#4e9440');
  for (let gy = 0; gy < 6; gy++) {
    for (let gx = 0; gx < 6; gx++) {
      const r = rnd(tx * 6 + gx, ty * 6 + gy, 7);
      if (r > 0.86) rect(c, px + gx * 4, py + gy * 4, 2, 2, PAL.grass.light);
      else if (r < 0.14) rect(c, px + gx * 4 + 1, py + gy * 4 + 1, 2, 2, PAL.grass.shade);
    }
  }
}

/** 地牢基底：石板 + 细碎裂纹 + 偶发深渊微光 */
function cryptBase(
  c: CanvasRenderingContext2D,
  px: number,
  py: number,
  tx: number,
  ty: number,
  time: number,
) {
  rect(c, px, py, 24, 24, '#383446');
  // 石板错缝
  rect(c, px, py + 11, 24, 1.5, '#2c2938');
  rect(c, px + (ty % 2 === 0 ? 11 : 5), py, 1.5, 11, '#2c2938');
  rect(c, px + (ty % 2 === 0 ? 5 : 17), py + 13, 1.5, 11, '#2c2938');
  // 石面高光
  rect(c, px, py, 24, 1, '#443f56');
  for (let gy = 0; gy < 6; gy++) {
    for (let gx = 0; gx < 6; gx++) {
      const r = rnd(tx * 6 + gx, ty * 6 + gy, 9);
      if (r > 0.9) rect(c, px + gx * 4, py + gy * 4, 2, 2, '#2a2734');
      else if (r < 0.08) rect(c, px + gx * 4, py + gy * 4, 2, 2, '#454058');
    }
  }
  // 深渊微光（少量格子）
  const glow = rnd(tx, ty, 11);
  if (glow > 0.93) {
    const pulse = 0.14 + Math.sin(time * 1.4 + tx + ty) * 0.08;
    c.fillStyle = `rgba(138, 90, 208, ${pulse.toFixed(3)})`;
    c.fillRect(px + 5, py + 6, 14, 10);
  }
}

/** 单块地形绘制（TILE = 24） */
export function drawTile(
  c: CanvasRenderingContext2D,
  t: string,
  px: number,
  py: number,
  tx: number,
  ty: number,
  ctx: TileCtx,
) {
  const h1 = rnd(tx, ty, 1);
  const h2 = rnd(tx, ty, 2);
  const time = ctx.time;

  // 基底：草地/地牢统一铺，用抖动（dither）过渡消除方块感
  if (ctx.dungeon) {
    cryptBase(c, px, py, tx, ty, time);
  } else {
    grassBase(c, px, py, tx, ty);
  }

  switch (t) {
    // ---- 草地 / 花丛：基底已铺好，这里只加点缀 ----
    case '.':
    case '~': {
      // 草叶簇
      if (h2 < 0.3) {
        const gx = px + 3 + h1 * 14;
        const gy = py + 6 + h2 * 40;
        rect(c, gx, gy, 1.5, 4, PAL.grass.light);
        rect(c, gx + 3, gy + 1, 1.5, 3, PAL.grass.light);
        rect(c, gx + 1, gy + 3, 1, 2, PAL.grass.shade);
      }
      // 小花
      if (t === '~') {
        const fx = px + 7 + h2 * 6;
        const fy = py + 8 + h1 * 6;
        rect(c, fx + 1.5, fy + 3, 1, 3, PAL.grass.shade); // 花茎
        const petal = ['#f0e05a', '#f08a9a', '#ffffff'][Math.floor(h1 * 3) % 3];
        rect(c, fx, fy, 4, 4, petal);
        rect(c, fx + 1, fy + 1.5, 2, 1, '#f0c94a'); // 花心
      }
      break;
    }

    // ---- 土路：底色 + 抖动 + 碎石 ----
    case ',': {
      rect(c, px, py, 24, 24, '#b08e58');
      for (let gy = 0; gy < 6; gy++) {
        for (let gx = 0; gx < 6; gx++) {
          const r = rnd(tx * 6 + gx, ty * 6 + gy, 13);
          if (r > 0.84) rect(c, px + gx * 4, py + gy * 4, 2, 2, '#c8a76e');
          else if (r < 0.16) rect(c, px + gx * 4, py + gy * 4, 2, 2, '#95784a');
        }
      }
      // 碎石
      const nx = px + 3 + h1 * 14;
      const ny = py + 4 + h2 * 14;
      rect(c, nx, ny, 5, 3.5, PAL.path.light);
      rect(c, nx, ny + 3, 5, 1, PAL.path.shade);
      if (h2 > 0.5) {
        rect(c, px + 12 + h2 * 6, py + 14 + h1 * 6, 4, 3, '#8f7448');
        rect(c, px + 12 + h2 * 6, py + 14 + h1 * 6, 4, 1, PAL.path.light);
      }
      break;
    }

    // ---- 石砖地 ----
    case 's': {
      rect(c, px, py, 24, 24, PAL.stone.base);
      rect(c, px, py, 24, 2, PAL.stone.light);
      // 砖缝
      rect(c, px, py + 11, 24, 2, PAL.stone.shade);
      rect(c, px + 11, py, 2, 12, PAL.stone.shade);
      rect(c, px + 5, py + 13, 2, 11, PAL.stone.shade);
      rect(c, px + 17, py + 13, 2, 11, PAL.stone.shade);
      if (h2 > 0.7) rect(c, px + 3 + h1 * 12, py + 2 + h2 * 6, 3, 2, PAL.stone.light);
      break;
    }

    // ---- 地牢地板 ----
    case 'f': {
      rect(c, px, py, 24, 24, h1 < 0.5 ? PAL.crypt.base : '#3e3a4c');
      // 裂缝
      if (h2 < 0.18) {
        const gx = px + 4 + h1 * 12;
        rect(c, gx, py + 6, 2, 10, PAL.crypt.shade);
        rect(c, gx + 4, py + 12, 3, 2, PAL.crypt.shade);
      }
      // 深渊微光
      if (h1 > 0.86) {
        const pulse = 0.18 + Math.sin(time * 1.4 + tx + ty) * 0.1;
        c.fillStyle = `rgba(138, 90, 208, ${pulse.toFixed(3)})`;
        c.fillRect(px + 6, py + 8, 12, 8);
      }
      break;
    }

    // ---- 墙：顶部亮、底部暗，做出体积 ----
    case '#': {
      if (ctx.dungeon) {
        rect(c, px, py, 24, 24, PAL.crypt.base);
        rect(c, px, py, 24, 8, PAL.crypt.light);
        rect(c, px, py + 8, 24, 2, PAL.crypt.shade);
        rect(c, px, py + 20, 24, 4, PAL.crypt.shade);
        rect(c, px + 4, py + 10, 3, 8, PAL.crypt.shade);
        rect(c, px + 15, py + 10, 3, 8, PAL.crypt.shade);
      } else {
        // 石墙：上沿受光、下沿落影，中段砖缝
        rect(c, px, py, 24, 24, '#7c7c76');
        rect(c, px, py, 24, 8, '#98988f'); // 顶面
        rect(c, px, py + 8, 24, 2, '#6a6a64'); // 顶面阴影
        rect(c, px, py + 21, 24, 3, '#5f5f5a'); // 底部
        // 砖块错缝
        rect(c, px + ((ty % 2) * 6 + 4), py + 11, 2, 9, '#6a6a64');
        rect(c, px + ((ty % 2) * 6 + 15), py + 11, 2, 9, '#6a6a64');
        rect(c, px, py + 19, 24, 1.5, '#6a6a64');
        if (h2 < 0.3) rect(c, px + 2 + h1 * 14, py + 3, 5, 2, '#a8a8a2');
      }
      break;
    }

    // ---- 树：圆形树冠（椭圆叠层）+ 树干，基底沿用草地 ----
    case 'T': {
      if (ctx.dungeon) {
        // 地牢里的枯柱：柱身 + 柱头
        rect(c, px + 7, py + 3, 10, 20, '#2f2c3c');
        rect(c, px + 7, py + 3, 3, 20, '#423e52'); // 左侧受光
        rect(c, px + 4, py + 1, 16, 4, '#454058'); // 柱头
        outlineRect(c, px + 4, py + 1, 16, 4);
        rect(c, px + 5, py + 21, 14, 3, '#242130'); // 柱础
      } else {
        const sway = Math.sin(time * 1.1 + tx * 0.7) * 0.7;
        // 树下阴影
        c.fillStyle = 'rgba(20, 40, 16, 0.28)';
        c.beginPath();
        c.ellipse(px + 12, py + 20, 9, 3.6, 0, 0, Math.PI * 2);
        c.fill();
        // 树干（带描边与纹理）
        rect(c, px + 10, py + 11, 5, 10, PAL.wood.shade);
        rect(c, px + 11, py + 11, 3, 10, PAL.wood.base);
        rect(c, px + 11, py + 11, 1, 10, PAL.wood.light);
        // 树冠：三层椭圆，暗→中→亮，整体轻微摇摆
        const cx = px + 12 + sway;
        c.fillStyle = PAL.leaf.shade;
        c.beginPath();
        c.ellipse(cx, py + 11, 11.5, 9, 0, 0, Math.PI * 2);
        c.fill();
        c.fillStyle = PAL.leaf.base;
        c.beginPath();
        c.ellipse(cx - 0.6, py + 9.5, 10, 7.5, 0, 0, Math.PI * 2);
        c.fill();
        c.fillStyle = PAL.leaf.light;
        c.beginPath();
        c.ellipse(cx - 2.4, py + 7, 6.4, 4.6, 0, 0, Math.PI * 2);
        c.fill();
        // 叶隙亮点
        if (h1 > 0.55) rect(c, cx - 6, py + 4, 2, 2, '#8cd874');
        // 果实
        if (h2 > 0.72) rect(c, cx + 4, py + 10, 2.5, 2.5, '#e0506a');
        if (h1 < 0.25) rect(c, cx - 3.5, py + 12, 2.5, 2.5, '#f0c94a');
      }
      break;
    }

    // ---- 屋顶瓦：只用在房子的最上一行 ----
    case 'R': {
      rect(c, px, py, 24, 24, '#9c4444');
      // 瓦楞（横向瓦片叠压）
      for (let row = 0; row < 3; row++) {
        const ry = py + 4 + row * 7;
        rect(c, px, ry, 24, 6, row % 2 ? '#a84e4e' : '#b05656');
        rect(c, px, ry, 24, 1, '#c86e6e'); // 每排瓦上沿高光
        rect(c, px, ry + 5.5, 24, 1.5, '#7c3434'); // 瓦缝阴影
        for (let i = 0; i < 3; i++) rect(c, px + 8 * i + (row % 2 ? 4 : 0), ry, 1, 6, 'rgba(0,0,0,0.18)');
      }
      rect(c, px, py, 24, 4, '#7e3636'); // 屋脊
      rect(c, px, py, 24, 1.5, '#a34a4a');
      rect(c, px, py + 21, 24, 3, '#6a2e2e'); // 檐口
      break;
    }

    // ---- 房屋墙体：木板 + 暖光窗 ----
    case 'h': {
      rect(c, px, py, 24, 24, '#8a6a48');
      // 木板（横向，交错接缝）
      rect(c, px, py, 24, 1.5, '#a0805c');
      for (let i = 0; i < 3; i++) {
        const ry = py + 6 + i * 6;
        rect(c, px, ry, 24, 1.5, PAL.wood.shade);
        rect(c, px + (i % 2 ? 6 : 16), ry - 6, 1.5, 6, PAL.wood.shade);
      }
      // 窗（暖光，随呼吸变化）
      if (h1 > 0.35) {
        rect(c, px + 5, py + 7, 9, 9, '#4a3520');
        rect(c, px + 6, py + 8, 7, 7, `rgba(255, 202, 96, ${(0.74 + Math.sin(time * 2 + tx) * 0.14).toFixed(3)})`);
        rect(c, px + 9, py + 8, 1, 7, '#4a3520'); // 窗棂
        rect(c, px + 6, py + 11, 7, 1, '#4a3520');
        rect(c, px + 5, py + 15, 9, 1.5, '#5e4630'); // 窗台
      } else {
        rect(c, px + 5, py + 12, 6, 6, '#5e4630'); // 壁挂小柜/木牌
        rect(c, px + 6, py + 13, 4, 4, '#7a5c3e');
      }
      break;
    }

    // ---- 门（可通行）：门框 + 门板 ----
    case 'D': {
      rect(c, px, py, 24, 24, '#8a6a48');
      rect(c, px, py, 24, 1.5, '#a0805c');
      rect(c, px + 3, py + 4, 18, 20, '#4a3520'); // 门框
      rect(c, px + 5, py + 6, 14, 18, '#6b4f36'); // 门板
      rect(c, px + 5, py + 6, 14, 1, '#7e5f42');
      for (let i = 0; i < 2; i++) rect(c, px + 6, py + 10 + i * 6, 12, 1.5, '#5a4129');
      rect(c, px + 15, py + 15, 2, 2, PAL.gold.base); // 门把手
      rect(c, px, py + 22, 24, 2, '#5e4630'); // 门槛
      break;
    }

    // ---- 水：浅水带 + 波纹 + 反光 ----
    case 'w': {
      rect(c, px, py, 24, 24, PAL.water.base);
      // 顶部浅水（近岸）亮带，形成渐变
      rect(c, px, py, 24, 6, '#3a7ab0');
      rect(c, px, py, 24, 2, '#4a8cc0');
      // 波纹
      for (let i = 0; i < 3; i++) {
        const wx = px + 1 + Math.sin(time * 1.6 + tx * 1.7 + ty * 0.9 + i * 2.1) * 3.5;
        const wy = py + 7 + i * 6.5;
        rect(c, wx, wy, 9 - i * 1.5, 1.5, PAL.water.light);
      }
      // 反光点
      if (h1 > 0.7) {
        const tw = 0.35 + Math.sin(time * 3 + tx + ty) * 0.25;
        rect(c, px + 4 + h2 * 12, py + 4 + h1 * 12, 3, 1.5, `rgba(255,255,255,${tw.toFixed(2)})`);
      }
      // 底部深水
      rect(c, px, py + 20, 24, 4, PAL.water.shade);
      break;
    }

    // ---- 木桥 ----
    case 'B': {
      rect(c, px, py, 24, 24, PAL.wood.shade);
      for (let i = 0; i < 3; i++) rect(c, px + i * 8, py, 7, 24, PAL.wood.base);
      rect(c, px, py, 24, 3, PAL.wood.light); // 栏杆
      rect(c, px, py + 20, 24, 4, PAL.wood.shade);
      break;
    }

    // ---- 深渊裂隙（装饰用实心黑紫） ----
    case 'x': {
      rect(c, px, py, 24, 24, '#120a1a');
      const pulse = 0.2 + Math.sin(time * 2 + tx * 0.6 + ty * 0.4) * 0.14;
      c.fillStyle = `rgba(138, 90, 208, ${pulse.toFixed(3)})`;
      c.fillRect(px + 4, py + 4, 16, 16);
      break;
    }

    // ---- 传送点 ----
    case 'P': {
      rect(c, px, py, 24, 24, ctx.dungeon ? PAL.crypt.base : PAL.grass.base);
      // 符文圆环
      const cx = px + 12;
      const cy = py + 12;
      c.fillStyle = 'rgba(180, 140, 255, 0.22)';
      c.beginPath();
      c.arc(cx, cy, 9, 0, Math.PI * 2);
      c.fill();
      for (let i = 0; i < 6; i++) {
        const a = time * 1.4 + (i / 6) * Math.PI * 2;
        const rx = cx + Math.cos(a) * 8;
        const ry = cy + Math.sin(a) * 5;
        rect(c, rx - 1.5, ry - 1.5, 3, 3, i % 2 ? '#e0d0ff' : PAL.abyss.light);
      }
      c.fillStyle = 'rgba(255,255,255,0.8)';
      c.beginPath();
      c.arc(cx, cy, 2.5 + Math.sin(time * 4) * 0.6, 0, Math.PI * 2);
      c.fill();
      break;
    }

    default:
      rect(c, px, py, 24, 24, PAL.grass.base);
  }
}

/* ============================ 角色：主角 ============================ */

export type Facing = 'up' | 'down' | 'left' | 'right';

export interface HeroOpts {
  facing: Facing;
  moving: boolean;
  anim: number;
  swing: number;
  iframes: number;
  weapon: number;
  time: number;
}

const BLADES = [
  { blade: '#c8ccd8', edge: '#ffffff', guard: '#8a6a3a', len: 13 },
  { blade: '#9ad8e8', edge: '#dff4ff', guard: '#5a6a7a', len: 15 },
  { blade: '#f0c94a', edge: '#ffe98a', guard: '#8a5a2a', len: 17 },
  { blade: '#c9a0ff', edge: '#ffffff', guard: '#5a3280', len: 19 },
];

export function drawHero(c: CanvasRenderingContext2D, x: number, y: number, o: HeroOpts) {
  // 无敌闪烁
  if (o.iframes > 0 && Math.floor(o.time * 20) % 2 === 0) return;

  const bob = o.moving ? Math.sin(o.anim * 2) * 1.2 : Math.sin(o.time * 1.6) * 0.4;
  const legSwing = o.moving ? Math.sin(o.anim * 2) * 2.2 : 0;
  const back = o.facing === 'up';

  shadow(c, x, y + 10, 9, 3.4);

  // ---- 腿（带描边）----
  rect(c, x - 5, y + 4, 4, 6 + legSwing, '#2b3140');
  rect(c, x + 1, y + 4, 4, 6 - legSwing, '#2b3140');
  rect(c, x - 5, y + 4, 4, 2, '#3c4457');
  rect(c, x + 1, y + 4, 4, 2, '#3c4457');

  // ---- 披风（在身体后）----
  if (!back) {
    const w1 = Math.sin(o.time * 3 + o.anim) * 1.4;
    rect(c, x - 7 + w1, y - 5 + bob, 4, 11, PAL.hero.shade);
    rect(c, x + 4 - w1, y - 5 + bob, 4, 11, PAL.hero.shade);
  }

  // ---- 身体：束腰外衣 ----
  rect(c, x - 6, y - 5 + bob, 12, 10, PAL.hero.base);
  outlineRect(c, x - 6, y - 5 + bob, 12, 10);
  rect(c, x - 6, y - 5 + bob, 12, 3, PAL.hero.light); // 肩部受光
  rect(c, x - 6, y + 2 + bob, 12, 3, PAL.hero.shade); // 下摆阴影
  rect(c, x - 1, y - 5 + bob, 2, 10, PAL.gold.base); // 前襟

  // ---- 头 ----
  const hy = y - 14 + bob;
  rect(c, x - 5, hy, 10, 9, PAL.skin.base);
  outlineRect(c, x - 5, hy, 10, 9);
  rect(c, x - 5, hy, 10, 2, PAL.skin.light); // 额头高光
  rect(c, x - 5, hy + 6, 10, 3, PAL.skin.shade);

  // 头发（后脑/刘海按朝向）
  if (back) {
    rect(c, x - 5, hy - 1, 10, 8, '#4a3020');
    rect(c, x - 5, hy - 1, 10, 2, '#5e4028');
  } else {
    rect(c, x - 5, hy - 2, 10, 4, '#4a3020'); // 发顶
    rect(c, x - 5, hy, 2, 4, '#4a3020'); // 侧鬓
    rect(c, x + 3, hy, 2, 4, '#4a3020');
    rect(c, x - 5, hy - 2, 10, 1, '#6a4a30'); // 高光
    // 头巾飘带
    rect(c, x + 4, hy + 1, 4, 2, PAL.hero.light);
    rect(c, x + 7, hy + 2 + Math.sin(o.time * 4) * 1, 3, 2, PAL.hero.light);
  }

  // 五官（背向时隐藏）
  if (!back) {
    const look = o.facing === 'left' ? -1 : o.facing === 'right' ? 1 : 0;
    rect(c, x - 3 + look, hy + 3, 2, 2, PAL.ink);
    rect(c, x + 1 + look, hy + 3, 2, 2, PAL.ink);
    if (o.facing === 'down') rect(c, x - 1, hy + 6, 2, 1, '#c98a7a');
  } else {
    rect(c, x - 5, hy + 7, 10, 2, PAL.skin.shade); // 后颈阴影
  }

  // ---- 武器 ----
  const b = BLADES[Math.min(o.weapon, BLADES.length - 1)];
  const angByDir: Record<Facing, number> = { right: 0, down: Math.PI / 2, left: Math.PI, up: -Math.PI / 2 };
  const baseAng = angByDir[o.facing];
  const swingP = o.swing > 0 ? 1 - o.swing / 0.16 : -1;

  c.save();
  c.translate(x, y - 1 + bob);
  if (swingP >= 0) {
    // 挥砍弧光
    c.strokeStyle = `rgba(255,255,255,${(0.9 - swingP * 0.7).toFixed(3)})`;
    c.lineWidth = 4;
    c.beginPath();
    c.arc(0, 0, 22 + b.len * 0.4, baseAng - 1.1 + swingP * 2.2 - 0.5, baseAng - 1.1 + swingP * 2.2 + 0.5);
    c.stroke();
    c.rotate(baseAng - 1.3 + swingP * 2.4);
  } else {
    c.rotate(baseAng + 0.55);
  }
  // 剑柄
  rect(c, 4, -2, 5, 4, b.guard);
  rect(c, 8, -4, 2, 8, PAL.gold.base);
  // 剑身（带描边与刃线）
  rect(c, 9, -2, b.len, 4, PAL.ink);
  rect(c, 9, -1.5, b.len, 3, b.blade);
  rect(c, 9, -1.5, b.len, 1, b.edge);
  c.restore();
}

/* ============================ 角色：敌人 ============================ */

export interface EnemyArtOpts {
  r: number;
  color: string;
  dark: string;
  flash: boolean;
  time: number;
  vx: number;
  hpFrac: number;
  phase: number;
}

export function drawEnemy(
  c: CanvasRenderingContext2D,
  kind: string,
  x: number,
  y: number,
  o: EnemyArtOpts,
) {
  const body = o.flash ? '#ffffff' : o.color;
  const dark = o.flash ? '#d8d8e0' : o.dark;
  const t = o.time;
  const dir = o.vx >= 0 ? 1 : -1;
  shadow(c, x, y + o.r * 0.85, o.r * 0.95, o.r * 0.38);

  switch (kind) {
    case 'slime': {
      const bob = Math.sin(t * 4 + o.phase) * 1.6;
      const squash = 1 + Math.sin(t * 4 + o.phase) * 0.08;
      const w = o.r * (2 - squash);
      const h = o.r * squash;
      // 主体
      c.fillStyle = body;
      c.beginPath();
      c.ellipse(x, y + bob * 0.4, w, h, 0, 0, Math.PI * 2);
      c.fill();
      // 描边感：底部暗边
      c.fillStyle = dark;
      c.beginPath();
      c.ellipse(x, y + bob * 0.4 + h * 0.45, w * 0.86, h * 0.3, 0, 0, Math.PI * 2);
      c.fill();
      // 高光
      c.fillStyle = 'rgba(255,255,255,0.55)';
      c.beginPath();
      c.ellipse(x - w * 0.35, y - h * 0.35 + bob * 0.4, w * 0.28, h * 0.22, 0, 0, Math.PI * 2);
      c.fill();
      // 眼睛
      rect(c, x - 4, y - 3 + bob * 0.4, 3, 3, '#ffffff');
      rect(c, x + 1, y - 3 + bob * 0.4, 3, 3, '#ffffff');
      rect(c, x - 3, y - 2 + bob * 0.4, 2, 2, PAL.ink);
      rect(c, x + 2, y - 2 + bob * 0.4, 2, 2, PAL.ink);
      break;
    }

    case 'bat': {
      const flap = Math.sin(t * 9 + o.phase) * 3;
      // 翅膀（两片）
      rect(c, x - 13, y - 3 + flap, 9, 5, dark);
      rect(c, x + 4, y - 3 - flap, 9, 5, dark);
      rect(c, x - 13, y - 3 + flap, 9, 1, body);
      rect(c, x + 4, y - 3 - flap, 9, 1, body);
      // 身体
      rect(c, x - 5, y - 5, 10, 9, body);
      outlineRect(c, x - 5, y - 5, 10, 9);
      rect(c, x - 5, y - 5, 10, 2, 'rgba(255,255,255,0.25)');
      // 耳朵
      rect(c, x - 4, y - 9, 3, 4, dark);
      rect(c, x + 1, y - 9, 3, 4, dark);
      // 眼睛
      rect(c, x - 3, y - 2, 2, 2, '#ff5a5a');
      rect(c, x + 1, y - 2, 2, 2, '#ff5a5a');
      break;
    }

    case 'wolf': {
      const run = Math.sin(t * 8 + o.phase) * 2;
      // 尾巴
      rect(c, x - 11 * dir, y - 6 + run, 5, 3, dark);
      // 身体
      rect(c, x - 9, y - 5, 18, 9, body);
      outlineRect(c, x - 9, y - 5, 18, 9);
      rect(c, x - 9, y - 5, 18, 2, 'rgba(255,255,255,0.18)'); // 背脊光
      rect(c, x - 9, y + 2, 18, 2, dark);
      // 腿
      rect(c, x - 7, y + 3, 3, 5 + run, dark);
      rect(c, x + 4, y + 3, 3, 5 - run, dark);
      // 头
      rect(c, x + (dir > 0 ? 5 : -13), y - 9, 8, 7, body);
      outlineRect(c, x + (dir > 0 ? 5 : -13), y - 9, 8, 7);
      // 耳朵
      rect(c, x + (dir > 0 ? 6 : -12), y - 12, 2, 4, dark);
      rect(c, x + (dir > 0 ? 10 : -8), y - 12, 2, 4, dark);
      // 眼 + 牙
      rect(c, x + (dir > 0 ? 8 : -6), y - 7, 2, 2, '#ff5a5a');
      rect(c, x + (dir > 0 ? 11 : -3), y - 3, 2, 2, '#ffffff');
      break;
    }

    case 'skeleton': {
      const sway = Math.sin(t * 3 + o.phase) * 1;
      // 腿骨
      rect(c, x - 4, y + 3, 3, 6, '#e8e4d8');
      rect(c, x + 1, y + 3, 3, 6, '#e8e4d8');
      // 脊柱 + 肋骨
      rect(c, x - 1, y - 4, 2, 8, '#d8d4c8');
      for (let i = 0; i < 3; i++) rect(c, x - 5, y - 3 + i * 3, 10, 2, '#e8e4d8');
      // 肩
      rect(c, x - 6, y - 5 + sway, 12, 2, '#d8d4c8');
      // 头骨
      rect(c, x - 5, y - 13 + sway, 10, 9, '#f0ece0');
      outlineRect(c, x - 5, y - 13 + sway, 10, 9);
      rect(c, x - 4, y - 11 + sway, 3, 3, PAL.ink); // 眼窝
      rect(c, x + 1, y - 11 + sway, 3, 3, PAL.ink);
      rect(c, x - 3.5, y - 10.5 + sway, 2, 2, '#ff8a4a'); // 幽光
      rect(c, x + 1.5, y - 10.5 + sway, 2, 2, '#ff8a4a');
      rect(c, x - 2, y - 6 + sway, 4, 2, '#c8c4b8'); // 下颌
      break;
    }

    case 'spider': {
      // 八条腿
      for (let i = 0; i < 8; i++) {
        const side = i < 4 ? -1 : 1;
        const k = i % 4;
        const la = Math.sin(t * 7 + i * 0.9 + o.phase) * 2.5;
        rect(c, x + side * (5 + k * 2), y - 2, 2, 7 + la, dark);
      }
      // 腹部
      c.fillStyle = body;
      c.beginPath();
      c.ellipse(x + dir * 4, y + 1, o.r * 0.85, o.r * 0.7, 0, 0, Math.PI * 2);
      c.fill();
      // 头胸
      c.fillStyle = dark;
      c.beginPath();
      c.ellipse(x - dir * 3, y - 1, o.r * 0.6, o.r * 0.5, 0, 0, Math.PI * 2);
      c.fill();
      // 花纹
      rect(c, x + dir * 3, y - 1, 3, 2, 'rgba(0,0,0,0.4)');
      // 眼
      rect(c, x - dir * 4, y - 3, 2, 2, '#ff5a5a');
      rect(c, x - dir * 1, y - 3, 2, 2, '#ff5a5a');
      break;
    }

    case 'knight': {
      const step = Math.sin(t * 5 + o.phase) * 1.6;
      // 腿甲
      rect(c, x - 5, y + 3, 4, 6 + step, '#5a5e6c');
      rect(c, x + 1, y + 3, 4, 6 - step, '#5a5e6c');
      // 铠甲身体
      rect(c, x - 6, y - 5, 12, 9, body);
      outlineRect(c, x - 6, y - 5, 12, 9);
      rect(c, x - 6, y - 5, 12, 2, 'rgba(255,255,255,0.3)');
      rect(c, x - 1, y - 4, 2, 7, dark); // 甲缝
      // 头盔
      rect(c, x - 5, y - 14, 10, 9, body);
      outlineRect(c, x - 5, y - 14, 10, 9);
      rect(c, x - 5, y - 9, 10, 4, '#2a2c38'); // 面甲缝
      rect(c, x - 4, y - 11, 2, 2, '#ff9a4a'); // 眼
      rect(c, x + 2, y - 11, 2, 2, '#ff9a4a');
      // 盔缨
      rect(c, x - 2, y - 17, 4, 4, '#c0404a');
      // 战斧
      rect(c, x + 7 * dir, y - 6, 2, 14, PAL.wood.base);
      rect(c, x + (dir > 0 ? 6 : -12), y - 8, 7, 6, PAL.steel.base);
      rect(c, x + (dir > 0 ? 6 : -12), y - 8, 7, 1, PAL.steel.light);
      break;
    }

    case 'guard': {
      const step = Math.sin(t * 4 + o.phase) * 2;
      // 腿
      rect(c, x - 7, y + 4, 5, 7 + step, '#3a3e4c');
      rect(c, x + 2, y + 4, 5, 7 - step, '#3a3e4c');
      // 躯干
      rect(c, x - 8, y - 6, 16, 11, body);
      outlineRect(c, x - 8, y - 6, 16, 11);
      rect(c, x - 8, y - 6, 16, 3, 'rgba(255,255,255,0.22)');
      // 肩甲
      rect(c, x - 11, y - 7, 6, 6, dark);
      rect(c, x + 5, y - 7, 6, 6, dark);
      // 头 + 兜帽
      rect(c, x - 6, y - 16, 12, 10, '#2a2c38');
      outlineRect(c, x - 6, y - 16, 12, 10);
      rect(c, x - 4, y - 13, 3, 3, '#ff6a4a');
      rect(c, x + 1, y - 13, 3, 3, '#ff6a4a');
      // 巨斧
      rect(c, x + 11 * dir, y - 10, 3, 20, PAL.wood.shade);
      rect(c, x + (dir > 0 ? 10 : -18), y - 12, 9, 9, PAL.steel.base);
      rect(c, x + (dir > 0 ? 10 : -18), y - 12, 9, 2, PAL.steel.light);
      break;
    }

    case 'boss': {
      // Boss 整体放大 1.5 倍，体量感
      c.save();
      c.translate(x, y);
      c.scale(1.5, 1.5);
      c.translate(-x, -y);
      const float = Math.sin(t * 1.6) * 3;
      const y2 = y + float;
      shadow(c, x, y + 16, 13, 4.2, 0.3);
      // 披风
      c.fillStyle = '#5a3280';
      c.beginPath();
      c.moveTo(x - 12, y2 - 8);
      c.lineTo(x + 12, y2 - 8);
      c.lineTo(x + 8 + Math.sin(t * 2) * 3, y2 + 14);
      c.lineTo(x - 8 + Math.sin(t * 2 + 1) * 3, y2 + 14);
      c.closePath();
      c.fill();
      // 裙摆
      rect(c, x - 9, y2 - 2, 18, 12, '#3a2448');
      rect(c, x - 9, y2 - 2, 18, 2, '#4a3058');
      // 上身
      rect(c, x - 7, y2 - 14, 14, 13, '#2a1a3a');
      outlineRect(c, x - 7, y2 - 14, 14, 13);
      rect(c, x - 7, y2 - 14, 14, 2, '#3c2a4c');
      rect(c, x - 1, y2 - 13, 2, 11, '#8a5ad0'); // 胸前深渊光
      // 头
      rect(c, x - 6, y2 - 26, 12, 12, PAL.skin.base);
      outlineRect(c, x - 6, y2 - 26, 12, 12);
      rect(c, x - 6, y2 - 26, 12, 2, PAL.skin.light);
      // 长发
      rect(c, x - 8, y2 - 24, 3, 22, '#f0eef8');
      rect(c, x + 5, y2 - 24, 3, 22, '#f0eef8');
      rect(c, x - 6, y2 - 28, 12, 4, '#f0eef8');
      // 角/冠
      rect(c, x - 7, y2 - 33, 3, 6, PAL.abyss.light);
      rect(c, x + 4, y2 - 33, 3, 6, PAL.abyss.light);
      rect(c, x - 2, y2 - 31, 4, 3, PAL.gold.base);
      // 眼（发光）
      const glow = 0.7 + Math.sin(t * 5) * 0.3;
      rect(c, x - 4, y2 - 21, 3, 3, `rgba(255, 90, 120, ${glow.toFixed(2)})`);
      rect(c, x + 1, y2 - 21, 3, 3, `rgba(255, 90, 120, ${glow.toFixed(2)})`);
      c.restore();
      break;
    }

    default: {
      rect(c, x - 6, y - 6, 12, 12, body);
      outlineRect(c, x - 6, y - 6, 12, 12);
    }
  }
}

/* ============================ 角色：NPC ============================ */

export interface NpcArtOpts {
  look: string;
  hair: string;
  dress: string;
  time: number;
}

export function drawNpc(c: CanvasRenderingContext2D, x: number, y: number, o: NpcArtOpts) {
  const bob = Math.sin(o.time * 2 + x * 0.1) * 1.1;
  const t = o.time;
  shadow(c, x, y + 9, 8, 3);

  // 腿
  rect(c, x - 4, y + 3, 3, 6, '#333a48');
  rect(c, x + 1, y + 3, 3, 6, '#333a48');

  // 身体
  rect(c, x - 5, y - 4 + bob, 10, 8, o.dress);
  outlineRect(c, x - 5, y - 4 + bob, 10, 8);
  rect(c, x - 5, y - 4 + bob, 10, 2, 'rgba(255,255,255,0.28)');
  rect(c, x - 5, y + 1 + bob, 10, 3, 'rgba(0,0,0,0.18)');

  // 头
  const hy = y - 12 + bob;
  rect(c, x - 4, hy, 8, 7, PAL.skin.base);
  outlineRect(c, x - 4, hy, 8, 7);
  rect(c, x - 4, hy + 5, 8, 2, PAL.skin.shade);

  // 眼睛 + 腮红
  rect(c, x - 3, hy + 3, 2, 2, PAL.ink);
  rect(c, x + 1, hy + 3, 2, 2, PAL.ink);
  rect(c, x - 4, hy + 5, 2, 1.5, 'rgba(240,140,160,0.5)');
  rect(c, x + 2, hy + 5, 2, 1.5, 'rgba(240,140,160,0.5)');

  switch (o.look) {
    case 'miko': {
      // 巫女：长直发 + 红缎带 + 白衣领
      rect(c, x - 6, hy - 1, 2, 13, o.hair);
      rect(c, x + 4, hy - 1, 2, 13, o.hair);
      rect(c, x - 4, hy - 2, 8, 3, o.hair);
      rect(c, x - 4, hy - 2, 8, 1, 'rgba(255,255,255,0.4)');
      rect(c, x - 2, hy - 3, 4, 2, '#d43a4a'); // 缎带
      rect(c, x - 3, y - 4 + bob, 6, 3, '#f4f4f8'); // 白衣领
      break;
    }
    case 'twintail': {
      // 双马尾 + 发饰
      const sw = Math.sin(t * 3) * 1.2;
      rect(c, x - 8, hy - 1 + sw, 3, 11, o.hair);
      rect(c, x + 5, hy - 1 - sw, 3, 11, o.hair);
      rect(c, x - 4, hy - 2, 8, 3, o.hair);
      rect(c, x - 4, hy - 2, 8, 1, 'rgba(255,255,255,0.45)');
      rect(c, x - 8, hy - 2 + sw, 2, 2, '#e05a8a');
      rect(c, x + 6, hy - 2 - sw, 2, 2, '#e05a8a');
      break;
    }
    case 'cat': {
      // 猫耳 + 尾巴 + 项圈
      rect(c, x - 5, hy - 4, 3, 4, o.hair);
      rect(c, x + 2, hy - 4, 3, 4, o.hair);
      rect(c, x - 4.2, hy - 3, 1.4, 1.6, '#e88');
      rect(c, x + 2.8, hy - 3, 1.4, 1.6, '#e88');
      rect(c, x - 4, hy - 2, 8, 3, o.hair);
      const tw = Math.sin(t * 2.6) * 4;
      rect(c, x + 5, y - 2 + bob, 2, 8 + tw * 0.2, o.hair);
      rect(c, x - 4, y - 4 + bob, 8, 2, '#f0c94a'); // 项圈铃铛带
      break;
    }
    case 'hood': {
      // 兽耳兜帽 + 弓箭
      rect(c, x - 6, hy - 4, 12, 6, o.dress);
      rect(c, x - 6, hy - 4, 12, 2, 'rgba(255,255,255,0.2)');
      rect(c, x - 5, hy - 7, 2.5, 4, o.hair);
      rect(c, x + 2.5, hy - 7, 2.5, 4, o.hair);
      rect(c, x - 4, hy + 1, 8, 6, PAL.skin.shade); // 兜帽阴影
      rect(c, x - 3, hy + 3, 2, 2, PAL.ink);
      rect(c, x + 1, hy + 3, 2, 2, PAL.ink);
      rect(c, x + 6, y - 8 + bob, 2, 14, PAL.wood.base); // 背弓
      break;
    }
    case 'nova': {
      // 魔女：碎角 + 破损王冠 + 深渊光
      rect(c, x - 6, hy - 1, 2, 13, o.hair);
      rect(c, x + 4, hy - 1, 2, 13, o.hair);
      rect(c, x - 4, hy - 2, 8, 3, o.hair);
      rect(c, x - 5, hy - 7, 2, 5, PAL.abyss.light);
      rect(c, x + 3, hy - 7, 2, 5, PAL.abyss.light);
      rect(c, x - 2, hy - 6, 4, 2, PAL.gold.base);
      rect(c, x - 3, hy + 3, 2, 2, '#ff5a78');
      rect(c, x + 1, hy + 3, 2, 2, '#ff5a78');
      break;
    }
    default:
      rect(c, x - 4, hy - 2, 8, 3, o.hair);
  }
}

/* ============================ UI 小件 ============================ */

/** 一颗心（满/空） */
export function drawHeart(c: CanvasRenderingContext2D, x: number, y: number, filled: boolean) {
  const col = filled ? '#e0506a' : '#3a3e4c';
  rect(c, x, y, 2, 2, col);
  rect(c, x + 3, y, 2, 2, col);
  rect(c, x, y + 2, 5, 2, col);
  rect(c, x + 1, y + 4, 3, 1, col);
  rect(c, x + 2, y + 5, 1, 1, col);
  if (filled) rect(c, x, y, 2, 1, '#ff9aa8');
}

/** 金币图标 */
export function drawCoin(c: CanvasRenderingContext2D, x: number, y: number) {
  rect(c, x + 1, y, 4, 6, PAL.gold.base);
  rect(c, x + 1, y, 4, 1, PAL.gold.light);
  rect(c, x + 1, y + 5, 4, 1, PAL.gold.shade);
  rect(c, x + 2, y + 2, 2, 2, PAL.gold.light);
}

/** 药水图标 */
export function drawPotion(c: CanvasRenderingContext2D, x: number, y: number) {
  rect(c, x + 1, y, 3, 2, '#8a8e9c'); // 瓶塞
  rect(c, x + 1, y + 2, 4, 1, '#c8ccd8');
  rect(c, x, y + 3, 6, 5, PAL.hero.light);
  rect(c, x, y + 3, 2, 5, PAL.hero.base);
}
