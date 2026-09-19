// 主线程响应探针：崩了就重启浏览器重试，直到拿到结果
import { chromium } from '/home/paleimiao/.workbuddy/binaries/node/workspace/node_modules/playwright-core/index.mjs';

const EXE = '/host/opt/microsoft/msedge/msedge';
const URL = process.env.SMOKE_URL ?? 'http://127.0.0.1:8322/arch-web-v2/';
const ARGS = ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu', '--headless=old', '--disable-software-rasterizer'];

for (let i = 1; i <= 10; i++) {
  let b;
  try {
    b = await chromium.launch({ executablePath: EXE, args: ARGS });
    const p = await b.newPage({ viewport: { width: 1280, height: 800 } });
    p.on('pageerror', (e) => console.log('PAGEERROR:', String(e).slice(0, 200)));
    await p.goto(URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
    for (const ms of [3000, 6000, 10000]) {
      await p.waitForTimeout(ms === 3000 ? 3000 : 3000);
      const r = await Promise.race([
        p.evaluate(() => ({ n: 1 + 1, kids: document.querySelector('#root')?.children.length ?? -1, title: document.title })),
        new Promise((_, rej) => setTimeout(() => rej(new Error('evaluate超时=主线程卡死')), 8000)),
      ]);
      console.log(`try${i} ${ms}ms:`, JSON.stringify(r));
    }
    await b.close();
    console.log('PROBE_OK');
    process.exit(0);
  } catch (e) {
    console.log(`try${i} FAIL: ${e.message.split('\n')[0].slice(0, 120)}`);
    try { await b?.close(); } catch {}
    await new Promise((r) => setTimeout(r, 500));
  }
}
console.log('PROBE_GAVE_UP');
process.exit(1);
