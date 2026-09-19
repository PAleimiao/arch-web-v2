// 生产构建截图连拍：goto 成功后立刻高频截图 + 按键，崩溃也保留已拍帧
import { chromium } from '/home/paleimiao/.workbuddy/binaries/node/workspace/node_modules/playwright-core/index.mjs';
import { renameSync } from 'node:fs';

const EXE = '/host/opt/microsoft/msedge/msedge';
const URL = 'http://127.0.0.1:8322/arch-web-v2/';
const ARGS = ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu', '--headless=old', '--disable-software-rasterizer'];

for (let i = 1; i <= 12; i++) {
  let b;
  try {
    b = await chromium.launch({ executablePath: EXE, args: ARGS });
    const p = await b.newPage({ viewport: { width: 1280, height: 800 } });
    const errs = [];
    p.on('pageerror', (e) => errs.push(String(e).slice(0, 150)));
    await p.goto(URL, { waitUntil: 'domcontentloaded', timeout: 60000 });

    // 高频截图，捕获 boot→锁屏
    let ok = 0;
    const snap = async (name) => {
      try {
        const tmp = `.smoke/burst_${name}.png`;
        await p.screenshot({ path: tmp, timeout: 6000 });
        renameSync(tmp, `.smoke/abyss-burst-${name}.png`);
        ok++;
      } catch {}
    };
    await snap('t0');
    await p.waitForTimeout(1500); await snap('t1.5');
    await p.waitForTimeout(2000); await snap('t3.5'); // 应到锁屏
    await p.keyboard.press('Enter'); // 解锁
    await p.waitForTimeout(1000); await snap('t6-desktop');
    await p.keyboard.press('Control+k');
    await p.keyboard.type('深渊');
    await p.waitForTimeout(600); await snap('t8-palette');
    await p.keyboard.press('Enter');
    await p.waitForTimeout(1500); await snap('t11-title');
    await p.keyboard.press('e');
    await p.waitForTimeout(1500); await snap('t14-game');
    await p.keyboard.down('d'); await p.waitForTimeout(600); await p.keyboard.up('d');
    await p.keyboard.press('j'); await p.waitForTimeout(500);
    await snap('t18-play');
    console.log(`try${i} 完成, 成功截图 ${ok} 张, JS错误 ${errs.length}`);
    errs.slice(0, 3).forEach((e) => console.log('ERR:', e));
    await b.close().catch(() => {});
    if (ok >= 6) { console.log('BURST_OK'); process.exit(0); }
    continue;
  } catch (e) {
    console.log(`try${i} FAIL: ${e.message.split('\n')[0].slice(0, 120)}`);
    try { await b?.close(); } catch {}
    await new Promise((r) => setTimeout(r, 400));
  }
}
console.log('BURST_GAVE_UP');
process.exit(1);
