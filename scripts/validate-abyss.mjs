// 校验 AbyssEcho 地图数据：行宽、传送点/NPC/宝箱/出生点必须可行走
// 用法：node scripts/validate-abyss.mjs
import { readFileSync } from 'node:fs';

const src = readFileSync(new URL('../src/apps/AbyssEcho/data.ts', import.meta.url), 'utf8');

// 从 TS 源码里抠出四个地图字符串数组
function extractMap(name) {
  const re = new RegExp(`const ${name}: string\\[\\] = \\[\\n([\\s\\S]*?)\\n\\];`);
  const m = re.exec(src);
  if (!m) throw new Error(`找不到 ${name}`);
  return [...m[1].matchAll(/'([^']*)'/g)].map((x) => x[1]);
}

const SOLID = new Set(['#', 'T', 'h', 'w', 'x', 'r']);
const zones = {
  village: extractMap('VILLAGE'),
  plains: extractMap('PLAINS'),
  forest: extractMap('FOREST'),
  // DUNGEON 在 data.ts 里由 IIFE 生成，这里复刻同一逻辑
  dungeon: (() => {
    const rows = [];
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
  })(),
};

let bad = 0;
for (const [name, rows] of Object.entries(zones)) {
  rows.forEach((row, i) => {
    if (row.length !== 40) {
      console.log(`${name} 第 ${i} 行宽度 ${row.length} (应为 40): "${row}"`);
      bad++;
    }
  });
  if (rows.length !== 30) {
    console.log(`${name} 行数 ${rows.length} (应为 30)`);
    bad++;
  }
}

function at(zone, x, y) {
  const row = zones[zone][y] ?? '';
  if (x < 0 || y < 0 || x >= 40 || y >= 30) return '#';
  return row[x] ?? '#';
}

function check(label, zone, x, y) {
  const t = at(zone, x, y);
  if (SOLID.has(t)) {
    console.log(`${label} → ${zone}(${x},${y}) 是 '${t}' 不可行走`);
    bad++;
  }
}

// 传送点（与 data.ts 保持一致）
check('village→plains 出口', 'village', 39, 12);
check('plains→village 出口', 'plains', 0, 10);
check('plains→forest 出口', 'plains', 39, 12);
check('forest→plains 出口', 'forest', 39, 15);
check('forest→dungeon 裂隙之门', 'forest', 38, 26);
check('dungeon→forest 出口', 'dungeon', 2, 2);
// 落点
check('落点 village', 'village', 38, 12);
check('落点 plains(左)', 'plains', 2, 10);
check('落点 plains(右)', 'plains', 37, 17);
check('落点 forest', 'forest', 2, 15);
check('落点 dungeon', 'dungeon', 3, 3);

// NPC / 宝箱 / 出生点
check('NPC 铃兰', 'village', 9, 9);
check('NPC 玛戈', 'village', 25, 10);
check('NPC 雪球', 'plains', 19, 13);
check('NPC 月见', 'forest', 4, 14);
check('宝箱 v1', 'village', 24, 26);
check('宝箱 p1', 'plains', 6, 27);
check('宝箱 p2', 'plains', 34, 4);
check('宝箱 f1', 'forest', 3, 3);
check('宝箱 d1', 'dungeon', 36, 26);
for (const [zone, pts] of Object.entries({
  plains: [[8,5],[14,18],[26,6],[30,20],[10,24],[34,25],[20,3],[30,10],[22,25],[6,15],[35,21]],
  forest: [[4,5],[14,8],[24,4],[30,10],[10,18],[20,22],[30,20],[8,12],[18,12],[28,16],[31,8],[20,15]],
  dungeon: [[12,8],[28,10],[14,16],[30,16],[6,20],[20,27],[34,12]],
})) {
  pts.forEach(([x, y], i) => check(`${zone} spawn#${i}`, zone, x, y));
}

console.log(bad === 0 ? '全部通过' : `共 ${bad} 处问题`);
