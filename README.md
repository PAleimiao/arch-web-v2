# Arch Web OS v2

> 浏览器里的 Arch Linux 桌面环境 · **Astro 5 + React 19 + Tailwind 4 + Zustand**

[![license](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![astro](https://img.shields.io/badge/astro-5.x-FF5D01.svg)](https://astro.build)
[![react](https://img.shields.io/badge/react-19.x-149eca.svg)](https://react.dev)

---

## 关于 v2 的稳定性（重要）

**v2 是整仓重写，不是 v1 的增量迭代** —— 相当于把地基换了一遍。

所以：**缺陷密度大概率明显高于原版**。而且很多不是「漏写」，是重构过程中新长出来的交叉问题 —— 应用注册、状态管理、资源回收、异步竞态这一类。已知的那批已经修过一轮，但没人走过的路径还很多。

**发现异常请直接传上来，别攒着。** 不用写得工整，能复现就行：

- **白屏 / 控制台报错** → 贴控制台报错原文
- **图标裂图 / 资源 404** → 说清是本地还是线上（线上是子路径 `/arch-web-v2/`）
- **某个应用行为不对** → 写清点的什么、期望什么、实际什么

开 issue 或直接提 PR 都行。提 PR 前麻烦跑一遍 `npm run check && npm run build`。

---

## 这是什么

一个完全跑在浏览器里的桌面环境：开机动画 → 锁屏 → 桌面 → 应用 → 关机/重启。
打开页面就像启动了一台 Linux 主机 —— 34 个应用、虚拟文件系统、包管理、通知中心、命令面板。

| 特性 | 实现 |
|---|---|
| **电源状态机** | `booting → locked → running → shutting-down → off` |
| **窗口管理** | z-index 栈、拖拽、八向缩放、最小化、最大化、**边缘吸附（半屏/最大化）** |
| **应用懒加载** | `import.meta.glob` + `React.lazy`，首屏不打包应用代码 |
| **命令面板** | `Ctrl+Shift+P`：模糊搜应用 / 搜文件 / 内联算式求值 / 系统操作 |
| **通知中心** | 顶栏铃铛 + 右上角浮层，四个等级，应用可主动 `notify()` |
| **剪贴板历史** | 记录 / 置顶 / 搜索，可选监听系统剪贴板 |
| **包管理** | `pacman -S / -R` 把应用当软件包装卸，卸载后从启动器隐藏 |
| **跨应用共享** | 虚拟文件系统（OPFS → IndexedDB 降级） |
| **持久化** | 设置走 localStorage，文件走 OPFS/IndexedDB，便签/日历/成绩各自落盘 |
| **主题** | 暗色/亮色、7 种强调色或自定义、动画开关、壁纸（含自定义上传） |
| **终端** | 40+ 命令、管道 `\|`、重定向 `>` `>>`、引号解析、Tab 补全、历史 |

## 内置应用（34 个）

**系统**
- **终端** — 模拟 Shell：`ls / cd / cat / echo / mkdir / rm / mv / cp / touch / tree / find / grep / head / tail / wc / stat / df / du / free / ps / top / date / uname / man / alias / history / neofetch / curl / sudo / pacman`
- **文件管理器** — 浏览与编辑虚拟文件系统
- **设置** — 桌面 / 外观 / 窗口 / 系统 / 应用五个分区，含存储用量与软件包管理
- **任务管理器** — 窗口即进程：结束 / 聚焦 / 最小化，实时 FPS、堆内存、运行时长
- **系统监视器** — 自绘 canvas 曲线：FPS / 内存 / 事件循环延迟，存储配额与持久化申请
- **存储分析** — 目录占用、大文件排行、**全盘导出备份与恢复**
- **帮助手册** — 应用清单、快捷键、命令速查、常见问题
- **时钟** — 时钟 / 世界时区 / 秒表（计次）/ 倒计时 / 番茄钟
- **日历** — 月视图与事件，支持增删改
- **剪贴板历史** — 历史、置顶、搜索，可选监听系统剪贴板

**开发**
- **Markdown 预览** — 手写迷你渲染器，三栏模式，存进虚拟磁盘
- **JSON 工具** — 格式化 / 压缩 / 校验（定位行列）/ 转 TS 接口 / 统计
- **正则测试** — 实时高亮、捕获组、替换预览、常用正则速查
- **编解码工具** — Base64 / URL / HTML 实体，中文不乱码
- **颜色工具** — HEX/RGB/HSL 互转、明暗阶梯、配色方案、WCAG 对比度检测

**工具**
- **记事本** — 纯文本编辑，路径可改
- **计算器** — 四则运算 + 括号，**自写解析器求值**（不走 `eval` / `new Function`）
- **单位换算** — 10 类单位，温度按公式换算
- **随机生成** — 随机数 / 密码（熵值评估）/ UUID / 抽签 / 掷骰
- **便签** — 多张便签，自动落盘到 `/home/arch/notes/`
- **画图** — 画笔 / 形状 / 油漆桶 / 吸管 / 撤销重做 / 导出 PNG
- **打字练习** — 中英文，实时 WPM 与准确率，历史成绩
- **画廊** — 浏览虚拟磁盘里的图片，支持批量导入

**影音 / 网络**
- **浏览器** — 沙箱 iframe 内嵌浏览（受 `X-Frame-Options` 限制）
- **音乐** — 本地音频播放，队列 / 循环模式
- **视频** — 本地文件或在线 URL，m3u8 自动挂 hls.js
- **在线音乐** — Meting API 搜索 / 播放
- **相机** — 摄像头拍照与录像
- **天气** — Open-Meteo 实时与 7 天预报（无需 API Key）

**游戏**
- **扫雷** — 三种难度，首点安全
- **2048**
- **贪吃蛇** — 三档速度，最高分本地保存
- **俄罗斯方块** — Next / Hold / 等级加速
- **五子棋** — 15×15，三档 AI 难度，可撤销

## 快捷键

| 按键 | 动作 |
|---|---|
| `Super` | 打开/关闭应用启动器 |
| `Ctrl+Shift+P` / `Ctrl+K` | 命令面板 |
| `Ctrl+Alt+T` | 打开终端 |
| `Ctrl+L` | 锁屏 |
| `Alt+F4` | 关闭当前窗口 |
| `Ctrl+Shift+W` | 关闭全部窗口 |
| `Esc` | 关闭启动器 / 命令面板 / 弹层 |
| 拖动窗口到左/右边缘 | 贴成半屏 |
| 拖动窗口到顶部 | 最大化 |
| 桌面右键 | 应用菜单（终端 / 命令面板 / 便签 / 换壁纸 / 包管理 / 帮助 / 锁屏 / 关机） |
| Dock 右键 | 打开新窗口 / 全部还原 / 全部最小化 / 关闭 / 卸载 |

## 快速开始

```bash
npm install --legacy-peer-deps
npm run dev          # 本地开发，默认 http://localhost:4321/arch-web-v2/
npm run build        # 生产构建到 dist/
npm run preview      # 本地预览生产构建
npm run check        # astro check（类型 + 模板）
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
| 不引入任何 UI / 图表 / markdown 库 | — | 全部手写，**运行时零新增依赖** |

## 在线预览

GitHub Pages 自动部署：触发 push 到 `main` → Astro build → 部署到
`https://PAleimiao.github.io/arch-web-v2/`。

首次启用：仓库 **Settings → Pages → Build and deployment → Source** 选
**GitHub Actions**，之后每次 push 都会自动部署。

## 路线图

- [x] 骨架（壳、状态机、窗口管理）
- [x] 12 个基础应用
- [x] 虚拟文件系统（OPFS / IndexedDB）
- [x] 边缘吸附、命令面板、通知中心、剪贴板历史
- [x] 主题系统（亮/暗 + 强调色 + 动画开关）
- [x] 包管理（pacman 模拟）
- [x] 扩充到 34 个应用（开发工具 / 系统监控 / 绘图 / 游戏等）
- [ ] 应用商店（远程注册表）
- [ ] 后端：登录、云同步、设置跨设备
- [ ] 终端命令扩展：`git`（模拟）、`ssh`（模拟）

## 目录结构

```
arch-web-v2/
├── src/
│   ├── apps/                # 34 个应用，每个一个目录 + index.tsx
│   ├── pages/index.astro    # Astro 壳
│   ├── shell/               # 桌面环境 UI
│   │   ├── components/      # TopBar / Dock / Launcher / CommandPalette
│   │   │                    # NotificationCenter / QuickSettings / ContextMenu
│   │   ├── window/          # WindowFrame + WindowManager + drag hook（含吸附）
│   │   ├── App.tsx          # 根组件 + 全局快捷键 + 主题注入
│   │   └── Desktop.tsx      # 桌面容器
│   ├── services/
│   │   ├── filesystem/      # OPFS → IndexedDB 降级
│   │   └── mediaStore.ts    # Blob 存储（画廊图片 / 音频）
│   ├── stores/              # Zustand: OS / Window / Media / Notify / Clipboard / Package
│   ├── lib/                 # cn、color（颜色换算）、expr（表达式求值）
│   └── styles/global.css    # Tailwind + 主题变量 + 亮色主题 + 动效开关
├── public/wallpapers/       # 内置壁纸 SVG
├── scripts/create-app.mjs   # 一键新建应用
└── astro.config.mjs
```

## 许可

MIT
