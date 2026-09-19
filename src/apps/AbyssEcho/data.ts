/* ============================================================
 * 《深渊回响》数据层
 * 图例：#石墙 T树 h房屋 w水 ,路 .草 s石板 f地牢地面 x虚空 B桥
 *       P 传送点（由 PORTALS 按坐标定义） ~ 花草装饰
 * 每张图 40 列 × 30 行
 * ============================================================ */

export const TILE = 24;
export const MAP_W = 40;
export const MAP_H = 30;
export const VIEW_W = 800;
export const VIEW_H = 500;

export type ZoneId = 'village' | 'plains' | 'forest' | 'dungeon';

export interface PortalDef {
  tx: number;
  ty: number;
  to: ZoneId;
  /** 落点（像素坐标） */
  px: number;
  py: number;
  label: string;
  /** 需要的任务/物品门槛 */
  requires?: 'abyss-key';
  lockedHint?: string;
}

export type NpcLook = 'miko' | 'twintail' | 'cat' | 'hood' | 'nova';

export interface NpcDef {
  tx: number;
  ty: number;
  role: 'elder' | 'merchant' | 'guide' | 'hunter';
  name: string;
  /** 称号，显示在对话的名字下方 */
  title: string;
  look: NpcLook;
  /** 发色 / 服装色（像素立绘用） */
  hair: string;
  dress: string;
}

export interface ChestDef {
  id: string;
  tx: number;
  ty: number;
  gold?: number;
  potion?: number;
  weapon?: number;
  armor?: number;
}

export interface SpawnDef {
  tx: number;
  ty: number;
  kind: EnemyKind;
  /** 精英 / Boss 不重生 */
  respawn?: boolean;
}

export type EnemyKind =
  | 'slime'
  | 'wolf'
  | 'skeleton'
  | 'spider'
  | 'knight'
  | 'guard'
  | 'boss';

export interface ZoneDef {
  id: ZoneId;
  name: string;
  tiles: string[];
  portals: PortalDef[];
  npcs: NpcDef[];
  chests: ChestDef[];
  spawns: SpawnDef[];
  /** 区域环境色调（叠加层透明度） */
  tint?: string;
}

export const WEAPONS = [
  { name: '木剑', atk: 4, price: 0 },
  { name: '铁剑', atk: 9, price: 150 },
  { name: '骑士剑', atk: 16, price: 400 },
  { name: '符文剑', atk: 26, price: 1000 },
];

export const ARMORS = [
  { name: '布衣', def: 1, price: 0 },
  { name: '皮甲', def: 3, price: 120 },
  { name: '锁甲', def: 6, price: 350 },
  { name: '符文铠', def: 10, price: 900 },
];

export const POTION_HEAL = 60;
export const POTION_PRICE = 50;

export interface EnemyBase {
  name: string;
  hp: number;
  atk: number;
  def: number;
  spd: number;
  xp: number;
  gold: [number, number];
  /** 碰撞半径（像素） */
  r: number;
  aggro: number;
  color: string;
  dark: string;
}

export const ENEMY_BASE: Record<EnemyKind, EnemyBase> = {
  slime:    { name: '史莱姆',     hp: 18,  atk: 4,  def: 0, spd: 26, xp: 6,   gold: [3, 7],    r: 9,  aggro: 110, color: '#5fbf6e', dark: '#3a8a47' },
  wolf:     { name: '灰狼',       hp: 30,  atk: 7,  def: 1, spd: 56, xp: 12,  gold: [6, 11],   r: 10, aggro: 150, color: '#8b8f9a', dark: '#5c6069' },
  spider:   { name: '毒蛛',       hp: 35,  atk: 9,  def: 1, spd: 62, xp: 15,  gold: [8, 13],   r: 10, aggro: 160, color: '#8a5fbf', dark: '#5c3d8a' },
  skeleton: { name: '骷髅士兵',   hp: 45,  atk: 10, def: 2, spd: 40, xp: 18,  gold: [10, 17],  r: 10, aggro: 140, color: '#d8d3c0', dark: '#9a937f' },
  knight:   { name: '深渊骑士',   hp: 90,  atk: 16, def: 4, spd: 34, xp: 40,  gold: [24, 40],  r: 11, aggro: 150, color: '#4a5578', dark: '#2b3350' },
  guard:    { name: '深渊守卫',   hp: 170, atk: 18, def: 5, spd: 30, xp: 110, gold: [70, 100], r: 13, aggro: 170, color: '#7a4a9a', dark: '#4a2a60' },
  boss:     { name: '深渊魔女·诺瓦', hp: 620, atk: 22, def: 6, spd: 30, xp: 520, gold: [300, 400],r: 18, aggro: 999, color: '#c04060', dark: '#701830' },
};

export interface QuestState {
  /** 0 未开始 1 史莱姆讨伐中 2 找钥匙 3 讨伐领主 4 通关 */
  stage: number;
  slimeKills: number;
  hasKey: boolean;
  bossDead: boolean;
}

export const SLIME_TARGET = 8;

export function questTitle(q: QuestState): string {
  switch (q.stage) {
    case 0: return '去找村长阿尔登对话';
    case 1: return `讨伐史莱姆 ${Math.min(q.slimeKills, SLIME_TARGET)}/${SLIME_TARGET}`;
    case 2: return '前往枯萎森林，取得「深渊钥匙」';
    case 3: return '进入深渊地牢，讨伐深渊魔女·诺瓦';
    default: return '深渊的回响已经平息';
  }
}

/* ----------------------------- 地图 ----------------------------- */

const VILLAGE: string[] = [
  'TTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTT',
  'T......................................T',
  'T..RRRRR....RRRRR.......RRRRR..........T',
  'T..hhDhh....hhDhh.......hhDhh..........T',
  'T..hhhhh....hhhhh.......hhhhh..........T',
  'T...........~~~~.......................T',
  'T..,........,###,..........T.T.........T',
  'T..,,,,,,, ,,###,...........#..........T',
  'T.....,......###............#..........T',
  'T.....,,,,,,, ,,,,,,,,,,,,,,#..........T',
  'T........,...sssssssss......#..........T',
  'T..RRRRR.,...sssssssss......,..........T',
  'T..hDhhh.,...sssssssss......,,,,,,,,,,,P',
  'T..hhhhh.,...sss..ssss.................T',
  'T........,...sssssssss....T.T.T........T',
  'T..~~~...,...........T.T.T.......~~~~..T',
  'T........,....T.T....T.T.T.............T',
  'T..,,,,,,,.....................,,,.....T',
  'T..,...................................T',
  'T..,....T.T......~~~~~~~...............T',
  'T..,.............~~~~~~.......T.T......T',
  'T..,,,,,,,,,,,,,,,,,,.................#T',
  'T.............T.T...#..................T',
  'T..~~~~..................T.T.T....~~~..T',
  'T......................#...............T',
  'T..T.T.................#.....~~~~......T',
  'T.............~~~~.....#...............T',
  'T......................,...............T',
  'T..~~~~................................T',
  'TTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTT',
];

const PLAINS: string[] = [
  'TTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTT',
  'T......................................T',
  'T..T.T.....T.......T.T........T.T......T',
  'T......................................T',
  'T......~~~~~~~...........T.T...........T',
  'T.....~~~~~~~~~...................T.T..T',
  'T......~~~~~~..........~~~~~...........T',
  'T..T.T.........T......~~~~~~~....T.T...T',
  'T.....................~~~~~~...........T',
  'T...T.T....................~~~.........T',
  'P..........T.T.........................T',
  'T..............www......T.T.....T.T....T',
  'T.............wwwww.....................',
  'T.............wwBww...........T.T......T',
  'T....T.T......wwwww.....................',
  'T.............wwww.......T.T...........T',
  'T..T.T.........ww.......................',
  'T...................................T.TT',
  'T.....T.T.....~~~~......................',
  'T............~~~~~~.......T.T..........T',
  'T..T.T........~~~~...................T.T',
  'T.......................................',
  'T.....T.T.......T.T.............T.T....T',
  'T...........................~~~........T',
  'T..T.T..........T.T.........~~~....T.T.T',
  'T..........................~~~.........T',
  'T.......~~~............................T',
  'T......~~~~~.......T.T.....T.T.........T',
  'T.......~~~............................T',
  'TTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTT',
];

const FOREST: string[] = [
  'TTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTT',
  'TTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTT',
  'TT..................TT....TT..........TT',
  'TT....TT....TT............TT....TT....TT',
  'T.........T........TT..........TT.....TT',
  'TT...TT........TT.......TT............TT',
  'TT.......TT........TT.........TT..TT..TT',
  'T....TT.........T.........TT..........TT',
  'TT..........TT.......TT...........TT..TT',
  'T...TT....T.........T........TT.......TT',
  'T..............TT.........T...........TT',
  'TT....TT............TT.........TT.....TT',
  'T.........................TT..........TT',
  'T...TT.....TT........T.........TT.....TT',
  'T.................T.......TT..........TT',
  'TT....TT.........TT....................P',
  'T.....T...TT...................TT.....TT',
  'TT..............T......TT.............TT',
  'T.....TT....TT.........T....TT........TT',
  'T.................TT.........T........TT',
  'TT...T........TT..........TT.........TTT',
  'T........TT..........TT...............TT',
  'TT.T........T................TT.......TT',
  'T......TT.........T...................TT',
  'T..............TT.......TT............TT',
  'TT..T........T................T.......TT',
  'T.....TT........TT....TT..............P.',
  'TT...........T..............TT........TT',
  'TTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTT',
  'TTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTT',
];

/* 地牢用程序化生成：柱廊布局，天然保证 40 宽、全连通、无死区 */
const DUNGEON: string[] = (() => {
  const rows: string[] = [];
  for (let y = 0; y < 30; y++) {
    let row = '';
    for (let x = 0; x < 40; x++) {
      if (x < 2 || y < 2 || x > 37 || y > 27) row += '#';
      else if (x % 5 === 2 && y % 4 === 1) row += '#';
      else row += 'f';
    }
    rows.push(row);
  }
  return rows;
})();

export const ZONES: Record<ZoneId, ZoneDef> = {
  village: {
    id: 'village',
    name: '起始村 · 阿尔德拉',
    tiles: VILLAGE,
    portals: [
      { tx: 39, ty: 12, to: 'plains', px: 2 * TILE + 12, py: 10 * TILE + 12, label: '绿野平原' },
    ],
    npcs: [
      { tx: 9, ty: 9, role: 'elder', name: '铃兰', title: '阿尔德拉守护巫女', look: 'miko', hair: '#e8e4f4', dress: '#e05a6a' },
      { tx: 25, ty: 10, role: 'merchant', name: '玛戈', title: '行商少女', look: 'twintail', hair: '#f0c860', dress: '#4a8ad4' },
    ],
    chests: [{ id: 'v1', tx: 24, ty: 26, gold: 25 }],
    spawns: [],
  },
  plains: {
    id: 'plains',
    name: '绿野平原',
    tiles: PLAINS,
    portals: [
      { tx: 0, ty: 10, to: 'village', px: 38 * TILE - 12, py: 12 * TILE + 12, label: '起始村' },
      { tx: 39, ty: 12, to: 'forest', px: 2 * TILE + 12, py: 15 * TILE + 12, label: '枯萎森林' },
    ],
    npcs: [
      { tx: 19, ty: 13, role: 'guide', name: '雪球', title: '桥边的猫娘', look: 'cat', hair: '#f4f0ea', dress: '#f0b0c0' },
    ],
    chests: [{ id: 'p1', tx: 6, ty: 27, gold: 40 }, { id: 'p2', tx: 34, ty: 4, potion: 1 }],
    spawns: [
      { tx: 8, ty: 5, kind: 'slime' }, { tx: 14, ty: 18, kind: 'slime' },
      { tx: 26, ty: 6, kind: 'slime' }, { tx: 30, ty: 20, kind: 'slime' },
      { tx: 10, ty: 24, kind: 'slime' }, { tx: 34, ty: 25, kind: 'slime' },
      { tx: 20, ty: 3, kind: 'slime' }, { tx: 30, ty: 10, kind: 'wolf' },
      { tx: 22, ty: 25, kind: 'wolf' }, { tx: 6, ty: 15, kind: 'wolf' },
      { tx: 35, ty: 21, kind: 'slime' },
    ],
  },
  forest: {
    id: 'forest',
    name: '枯萎森林',
    tiles: FOREST,
    portals: [
      { tx: 39, ty: 15, to: 'plains', px: 37 * TILE + 12, py: 17 * TILE + 12, label: '绿野平原' },
      {
        tx: 38, ty: 26, to: 'dungeon', px: 3 * TILE + 12, py: 3 * TILE + 12,
        label: '裂隙之门', requires: 'abyss-key',
        lockedHint: '门上刻着深渊的符文，需要「深渊钥匙」才能打开。',
      },
    ],
    npcs: [
      { tx: 4, ty: 14, role: 'hunter', name: '月见', title: '森林的兽耳猎人', look: 'hood', hair: '#5a4a7a', dress: '#3a5a40' },
    ],
    chests: [{ id: 'f1', tx: 3, ty: 3, potion: 2 }],
    spawns: [
      { tx: 4, ty: 5, kind: 'skeleton' }, { tx: 14, ty: 8, kind: 'skeleton' },
      { tx: 24, ty: 4, kind: 'skeleton' }, { tx: 30, ty: 10, kind: 'skeleton' },
      { tx: 10, ty: 18, kind: 'skeleton' }, { tx: 20, ty: 22, kind: 'skeleton' },
      { tx: 30, ty: 20, kind: 'skeleton' }, { tx: 8, ty: 12, kind: 'spider' },
      { tx: 18, ty: 12, kind: 'spider' }, { tx: 28, ty: 16, kind: 'spider' },
      { tx: 31, ty: 8, kind: 'spider' },
      { tx: 20, ty: 15, kind: 'guard', respawn: false },
    ],
  },
  dungeon: {
    id: 'dungeon',
    name: '深渊地牢',
    tiles: DUNGEON,
    portals: [
      { tx: 2, ty: 2, to: 'forest', px: 37 * TILE + 12, py: 15 * TILE + 12, label: '枯萎森林' },
    ],
    npcs: [],
    chests: [{ id: 'd1', tx: 36, ty: 26, weapon: 2 }],
    spawns: [
      { tx: 12, ty: 8, kind: 'knight' }, { tx: 28, ty: 10, kind: 'knight' },
      { tx: 14, ty: 16, kind: 'knight' }, { tx: 30, ty: 16, kind: 'spider' },
      { tx: 6, ty: 20, kind: 'spider' }, { tx: 20, ty: 27, kind: 'knight' },
      { tx: 34, ty: 12, kind: 'knight' },
      { tx: 20, ty: 27, kind: 'boss', respawn: false },
    ],
  },
};

/* 修正 forest 右侧出口：钥匙逻辑在引擎里判断，portal 需要唯一 */
export const SOLID = new Set(['#', 'T', 'h', 'R', 'w', 'x', 'r']);

export function tileAt(zone: ZoneDef, tx: number, ty: number): string {
  if (tx < 0 || ty < 0 || tx >= MAP_W || ty >= MAP_H) return '#';
  return zone.tiles[ty]?.[tx] ?? '#';
}

export function isSolid(zone: ZoneDef, tx: number, ty: number): boolean {
  return SOLID.has(tileAt(zone, tx, ty));
}
