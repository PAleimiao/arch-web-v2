// abyss-test 单页截图：轻量页面，用于人工/自验收
import { chromium } from '/home/paleimiao/.workbuddy/binaries/node/workspace/node_modules/playwright-core/index.mjs';

const EXE = '/host/opt/microsoft/msedge/msedge';
const URL = process.env.SMOKE_URL ?? 'http://127.0.0.1:4399/abyss-test';
const ARGS = ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu', '--headless=old', '--disable-software-rasterizer'];

for (let i = 1; i <= 15; i++) {
  let b;
  try {
    b = await chromium.launch({ executablePath: EXE, args: ARGS });
    const p = await b.newPage({ viewport: { width: 840, height: 560 } });
    await p.goto(URL, { waitUntil: 'domcontentloaded', timeout: 45000 });
    await p.waitForTimeout(3000);
    await p.screenshot({ path: '.smoke/shot-title.png', timeout: 12000 });
    console.log('标题截图 OK');

    await p.keyboard.press('e');
    await p.waitForTimeout(1200);
    await p.screenshot({ path: '.smoke/shot-village.png', timeout: 12000 });
    console.log('村庄截图 OK');

    // 走到铃兰旁边对话（村庄 NPC 在 9,9；出生点 10,12）
    await p.keyboard.down('w');
    await p.waitForTimeout(700);
    await p.keyboard.up('w');
    await p.waitForTimeout(300);
    await p.screenshot({ path: '.smoke/shot-walk.png', timeout: 12000 });
    console.log('行走截图 OK');

    await p.keyboard.press('j');
    await p.waitForTimeout(200);
    await p.screenshot({ path: '.smoke/shot-attack.png', timeout: 12000 });
    console.log('攻击截图 OK');

    await b.close();
    console.log('SHOTS_OK');
    process.exit(0);
  } catch (e) {
    console.log(`try${i} FAIL: ${e.message.split('\n')[0].slice(0, 110)}`);
    try { await b?.close(); } catch {}
    await new Promise((r) => setTimeout(r, 600));
  }
}
console.log('SHOTS_GAVE_UP');
process.exit(1);
