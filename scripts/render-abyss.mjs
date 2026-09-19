// 《深渊回响》美术验收：用 @napi-rs/canvas 在 Node 里真实渲染各场景帧，导出 PNG 供人工检查
//
// 用法（两步）：
//   1) esbuild 把 game.ts 打包成 .smoke/game.mjs
//   2) node scripts/render-abyss.mjs
// 输出：.smoke/render-*.png
import { createCanvas } from '/home/paleimiao/.workbuddy/binaries/node/workspace/node_modules/@napi-rs/canvas/index.js';
import { writeFileSync } from 'node:fs';

const noop = () => {};
globalThis.window = globalThis;
globalThis.document = { createElement: () => ({ getContext: () => null }) };
globalThis.performance = { now: () => Date.now() };
globalThis.requestAnimationFrame = () => 0;
globalThis.cancelAnimationFrame = noop;
globalThis.addEventListener = noop;
globalThis.removeEventListener = noop;
globalThis.localStorage = { getItem: () => null, setItem: noop, removeItem: noop };
globalThis.AudioContext = class {
  createOscillator() {
    return {
      connect: (x) => x,
      frequency: { value: 0, setValueAtTime: noop, exponentialRampToValueAtTime: noop, linearRampToValueAtTime: noop },
      type: '',
      start: noop,
      stop: noop,
    };
  }
  createGain() {
    return {
      connect: (x) => x,
      gain: { value: 0, setValueAtTime: noop, exponentialRampToValueAtTime: noop, linearRampToValueAtTime: noop },
    };
  }
  resume() {
    return Promise.resolve();
  }
};

const { AbyssGame } = await import('../.smoke/game.mjs');

const canvas = createCanvas(800, 500);
const game = new AbyssGame(canvas);
game.start();

const frames = (n, dt = 1 / 60) => {
  for (let i = 0; i < n; i++) game['update'](dt);
  game['draw']();
};
const save = (name) => {
  writeFileSync(`.smoke/render-${name}.png`, canvas.encodeSync('png'));
  console.log('rendered:', name);
};

// 1) 标题画面
frames(120);
save('1-title');

// 2) 村庄
game['newGame']();
frames(180);
save('2-village');

// 3) 铃兰对话（立绘 + 对话框）
game['quest'].stage = 0;
game['talkSuzuran']();
frames(30);
save('3-dialog');
for (let k = 0; k < 12; k++) {
  game['pressed'].add('e');
  frames(3);
  game['pressed'].delete('e');
}
frames(30);

// 4) 平原战斗
game['enterZone']('plains', 3 * 24, 15 * 24, false);
for (let f = 0; f < 900; f++) {
  const k = f % 40 < 20 ? 'd' : 'j';
  game['keys'].add(k);
  game['pressed'].add(k);
  game['update'](1 / 60);
  game['keys'].delete(k);
  game['pressed'].clear();
  if (game.state === 'dialog') game['pressed'].add('e');
}
frames(2);
save('4-plains');

// 5) 森林
game['enterZone']('forest', 4 * 24, 14 * 24, false);
frames(240);
save('5-forest');

// 6) 地牢
game['enterZone']('dungeon', 3 * 24, 2 * 24, false);
frames(240);
save('6-dungeon');

// 7) Boss 剧情 + 战况
const boss = game['enemies'].find((e) => e.kind === 'boss');
if (boss) {
  game['player'].x = boss.x - 90;
  game['player'].y = boss.y;
  game['player'].lvl = 20;
  game['player'].maxHp = 500;
  game['player'].hp = 500;
  game['player'].atkBase = 30;
  frames(60);
  save('7-boss-dialog');
  for (let k = 0; k < 8; k++) {
    game['pressed'].add('e');
    frames(3);
    game['pressed'].delete('e');
  }
  frames(30);
  boss.hp = boss.maxHp * 0.45;
  frames(60);
  save('8-boss-fight');
}

// 8) 商店
game['state'] = 'playing';
game['openShop']();
frames(30);
save('9-shop');

// 9) 结局
game['state'] = 'playing';
game['endStats'] = '等级 12 · 击杀 87 · 金币 1420';
game['finishGame']();
frames(60);
save('10-ending');

console.log('ALL_RENDERED');
