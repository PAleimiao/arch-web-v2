// abyss-test 单页探针：无桌面壳，只有游戏 canvas，验证真实渲染 + 截图
import { chromium } from '/home/paleimiao/.workbuddy/binaries/node/workspace/node_modules/playwright-core/index.mjs';

const EXE = '/host/opt/microsoft/msedge/msedge';
const URL = 'http://127.0.0.1:8322/arch-web-v2/abyss-test';
const ARGS = ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu', '--headless=old', '--disable-software-rasterizer', '--single-process'];

for (let i = 1; i <= 12; i++) {
  let b;
  try {
    b = await chromium.launch({ executablePath: EXE, args: ARGS });
    const p = await b.newPage({ viewport: { width: 900, height: 620 } });
    const errs = [];
    p.on('pageerror', (e) => errs.push(String(e).slice(0, 200)));
    await p.goto(URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await p.waitForTimeout(2500);

    const title = await Promise.race([
      p.evaluate(() => ({ state: window.__game?.state, game: !!window.__game })),
      new Promise((_, rej) => setTimeout(() => rej(new Error('evaluate超时')), 8000)),
    ]);
    console.log(`try${i} 标题态:`, JSON.stringify(title), '| JS错误:', errs.length);

    await p.keyboard.press('e'); // 开始新游戏
    await p.waitForTimeout(1500);
    const play = await Promise.race([
      p.evaluate(() => ({ state: window.__game?.state, zone: window.__game?.zone?.id, t: Math.round((window.__game?.time ?? 0) * 10) / 10 })),
      new Promise((_, rej) => setTimeout(() => rej(new Error('evaluate超时')), 8000)),
    ]);
    console.log(`try${i} 游戏态:`, JSON.stringify(play));

    await p.keyboard.down('d'); await p.waitForTimeout(700); await p.keyboard.up('d');
    await p.keyboard.press('j'); await p.waitForTimeout(500);
    await p.screenshot({ path: '.smoke/abyss-engine.png', timeout: 15000 });
    console.log('截图成功');
    await b.close();
    console.log('ENGINE_OK');
    process.exit(0);
  } catch (e) {
    console.log(`try${i} FAIL: ${e.message.split('\n')[0].slice(0, 130)}`);
    try { await b?.close(); } catch {}
    await new Promise((r) => setTimeout(r, 400));
  }
}
console.log('ENGINE_GAVE_UP');
process.exit(1);
