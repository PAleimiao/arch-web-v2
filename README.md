# Arch Web OS v2

> 浏览器里的 Arch Linux 桌面环境 · **Astro 5 + React 19 + Tailwind 4 + Zustand**

[![license](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![astro](https://img.shields.io/badge/astro-5.x-FF5D01.svg)](https://astro.build)
[![react](https://img.shields.io/badge/react-19.x-149eca.svg)](https://react.dev)

---

## 这是什么

一个完全跑在浏览器里的桌面环境：开机动画 → 锁屏 → 桌面 → 应用 → 关机/重启。
打开页面就像启动了一台 Linux 主机。

| 特性 | 实现 |
|---|---|
| **电源状态机** | `booting → locked → running → shutting-down → off` |
| **窗口管理** | z-index 栈、拖拽、缩放、最小化、最大化 |
| **应用懒加载** | `import.meta.glob` + `React.lazy`，首屏不打包应用代码 |
| **跨应用共享** | 虚拟文件系统（OPFS → IndexedDB 降级） |
| **持久化** | 设置走 localStorage，文件走 OPFS/IndexedDB |
| **快捷键** | `Ctrl+Alt+T` 终端、`Ctrl+L` 锁屏、`Alt+F4` 关窗、`Super` 启动器 |

## 内置应用

- **终端** — 模拟 Shell：`ls / cd / cat / echo / mkdir / rm / open / neofetch`
- **文件管理器** — 浏览与编辑虚拟文件系统
- **记事本** — 纯文本编辑，路径可改
- **计算器** — 四则运算 + 括号 + 键盘支持
- **设置** — 壁纸、窗口不透明度、自动锁屏
- **浏览器** — 沙箱 iframe 内嵌浏览（受 `X-Frame-Options` 限制）

## 快速开始

```bash
npm install --legacy-peer-deps
npm run dev          # 本地开发，默认 http://localhost:4321
npm run build        # 生产构建到 dist/
npm run preview      # 本地预览生产构建
```

> 用 `--legacy-peer-deps` 是因为 `@astrojs/check` 与 TS 5.9 之间的 peer 范围冲突；
> Astro CLI 不依赖它，可以忽略。

## 新建应用

```bash
node scripts/create-app.mjs music-player
```

会创建 `src/apps/music-player/index.tsx` 并在 `src/apps/registry.ts` 插入元数据。
然后挑一个 lucide-react 图标替换占位就行。

## 技术决策

| 选型 | 替代方案 | 理由 |
|---|---|---|
| Astro 5 | 纯 Vite | 首屏壳 + 后续可挂博客/文档页 |
| React 19 | Vue / Svelte | 生态最熟，AI 辅助友好 |
| Tailwind 4 | shadcn/ui（53 个 Radix 组件） | 原项目 53 个组件 90% 没用到，精简 |
| Zustand | Redux | 体量小、TS 友好、够用 |
| OPFS + IndexedDB | 纯 IndexedDB | 性能优先 + 兼容性兜底 |
| 不引入 shadcn/ui | — | 自己写小工具型组件更快 |

## 在线预览

GitHub Pages 自动部署：触发 push 到 `main` → Astro build → 部署到
`https://PAleimiao.github.io/arch-web-v2/`。

首次启用：仓库 **Settings → Pages → Build and deployment → Source** 选
**GitHub Actions**，之后每次 push 都会自动部署。

## 路线图

- [x] 骨架（壳、状态机、窗口管理）
- [x] 6 个核心应用
- [x] 虚拟文件系统
- [ ] 多窗口 / 拖入 Dock
- [ ] 主题切换（亮色 / 暗色）
- [ ] 应用商店（远程注册表）
- [ ] 后端：登录、云同步、设置跨设备
- [ ] 终端命令扩展：`wget`、`git`（模拟）

## 目录结构

```
arch-web-v2/
├── src/
│   ├── apps/                # 每个应用一个目录 + index.tsx
│   ├── pages/index.astro    # Astro 壳
│   ├── shell/               # 桌面环境 UI
│   │   ├── components/      # Boot / Lock / TopBar / Dock / Launcher
│   │   ├── window/          # WindowFrame + WindowManager + drag hook
│   │   ├── App.tsx          # 根组件 + 全局快捷键
│   │   └── Desktop.tsx      # 桌面容器
│   ├── services/filesystem/ # OPFS / IndexedDB
│   ├── stores/              # Zustand: useOSStore + useWindowStore
│   ├── styles/global.css    # Tailwind + 主题变量
│   └── lib/cn.ts
├── public/wallpapers/       # 内置壁纸 SVG
├── scripts/create-app.mjs   # 一键新建应用
└── astro.config.mjs
```

## 许可

MIT
