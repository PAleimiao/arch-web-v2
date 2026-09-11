// Cloudflare Workers 专用配置（npm run build:cf）
// 与 GitHub Pages 的 astro.config.mjs 完全隔离：
// - base 改成 '/'，workers.dev 根路径直接访问，不需要子路径
// - 产物输出到 dist-cf/，不污染 GH Pages 用的 dist/
import { defineConfig } from 'astro/config';
import baseConfig from './astro.config.mjs';

export default defineConfig({
  ...baseConfig,
  base: '/',
  outDir: 'dist-cf',
});
