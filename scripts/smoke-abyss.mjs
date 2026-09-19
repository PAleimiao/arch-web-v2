// 用 playwright-core + 宿主 Edge 做冒烟测试（沙箱里浏览器有竞态崩溃/截图卡死，带重试）
// 用法：SMOKE_URL=http://127.0.0.1:8322/arch-web-v2/ node scripts/smoke-abyss.mjs
import { chromium } from '/home/paleimiao/.workbuddy/binaries/node/workspace/node_modules/playwright-core/index.mjs';

const EXE = '/host/opt/microsoft/msedge/msedge';
const URL = process.env.SMOKE_URL ?? 'http://127.0.0.1:4399/arch-web-v2/';
const ARGS = ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu', '--headless=old', '--disable-software-rasterizer'];

const errors = [];
let browser;
let page;

async function launch() {
  browser = await chromium.launch({ executablePath: EXE, args: ARGS });
  page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
}

// 截图：带超时与重试，失败不中断流程
async function shot(path, tries = 3) {
  for (let i = 1; i <= tries; i++) {
    try {
      await page.screenshot({ path, timeout: 12000 });
      console.log('shot ok:', path);
      return;
    } catch (e) {
      console.log(`[shot ${path}] 第 ${i} 次失败: ${e.message.split('\n')[0]}`);
      if (i === tries) return; // 截图失败不阻塞后续输入模拟
      await page.waitForTimeout(800);
    }
  }
}

// 浏览器崩溃重试
async function withRetry(fn, label, tries = 8) {
  for (let i = 1; i <= tries; i++) {
    try {
      await fn();
      return;
    } catch (e) {
      console.log(`[${label}] 第 ${i} 次失败: ${e.message.split('\n')[0]}`);
      try { await browser?.close(); } catch {}
      if (i === tries) throw e;
      await launch();
    }
  }
}

await launch();
await withRetry(async () => {
  await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
}, 'goto');
await page.waitForTimeout(4000); // 等开机动画 + 进锁屏
await shot('.smoke/abyss-1-boot.png');

// 锁屏回车进桌面
await page.keyboard.press('Enter');
await page.waitForTimeout(800);

// 用命令面板直接开游戏：Ctrl+K 输入 深渊
await page.keyboard.press('Control+k');
await page.waitForTimeout(500);
await page.keyboard.type('深渊');
await page.waitForTimeout(600);
await shot('.smoke/abyss-2-palette.png');
await page.keyboard.press('Enter');
await page.waitForTimeout(1500);
await shot('.smoke/abyss-3-title.png');

// 标题界面：开始新游戏（按 E）
await page.keyboard.press('e');
await page.waitForTimeout(1200);
await shot('.smoke/abyss-4-game.png');

// 走两步 + 砍一刀
await page.keyboard.down('d');
await page.waitForTimeout(600);
await page.keyboard.up('d');
await page.keyboard.press('j');
await page.waitForTimeout(400);
await shot('.smoke/abyss-5-play.png');

console.log('页面错误数:', errors.length);
errors.slice(0, 5).forEach((e) => console.log('ERR:', e.slice(0, 200)));
await browser.close().catch(() => {});
console.log('完成');
