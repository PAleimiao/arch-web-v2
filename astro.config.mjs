import { defineConfig } from 'astro/config';
import react from '@astrojs/react';
import tailwindcss from '@tailwindcss/vite';

// GitHub Pages 部署在子路径：https://PAleimiao.github.io/arch-web-v2/
// 不配置的话，所有静态资源用绝对路径 /_astro/...，到子路径下就 404 了
export default defineConfig({
  site: 'https://PAleimiao.github.io',
  base: '/arch-web-v2',
  integrations: [react()],
  vite: {
    plugins: [tailwindcss()],
  },
  build: {
    // 单页应用式输出：桌面环境只有一个入口
    format: 'directory',
  },
});
