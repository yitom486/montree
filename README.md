<div align="center">

<img src="./apps/desktop/resources/icon.png" alt="Inkdown Logo" width="100" height="100" />

# Inkdown

**把每一页读成自己的知识：阅读、标注、写作与 Agent 思考，全部在一个本地优先的桌面工作区完成。**  
*Read deeply. Mark precisely. Think with context. Keep your knowledge local.*

[![Release](https://img.shields.io/github/v/release/yitom486/inkdown?color=3b82f6&label=Release)](https://github.com/yitom486/inkdown/releases)
[![Version](https://img.shields.io/badge/Version-v0.4.0-blue)](./CHANGELOG.md)
[![Platform](https://img.shields.io/badge/Platform-Windows%20%7C%20macOS%20%7C%20Linux-blue)](https://github.com/yitom486/inkdown/releases)
[![Package Manager](https://img.shields.io/badge/Bun-1.x-black?logo=bun)](https://bun.sh)
[![Tests](https://img.shields.io/badge/Tests-1275%20passed-success)](./.github/workflows/ci.yml)

[为什么是 Inkdown](#-为什么是-inkdown) • [你可以用它做什么](#-你可以用它做什么) • [快速开始](#-快速开始) • [本地开发](#-本地开发) • [更新日志](./CHANGELOG.md)

</div>

---

## 💡 为什么是 Inkdown？

阅读、摘录、理解和整理知识，通常被拆在阅读器、浏览器、笔记软件和 AI 聊天窗口里。结果是：原文与笔记失去位置关系，AI 不知道你正在看哪一页，批注也很难回到真正的上下文。

**Inkdown 把“来源 → 理解 → 沉淀”连成一条链：**

- **打开来源**：一个工作区同时容纳 Markdown、PDF、EPUB、MOBI、AZW3 与在线技术文档。
- **保留位置**：目录、章节、页码、视口、选区和批注互相对得上，不只是把文字复制出来。
- **交给 AI**：可选的 AI 伴读可以读取当前文档、选区、目录和标注，在正确上下文里回答问题。
- **确认后沉淀**：Agent 可以提出高亮、批注和章节重点建议，但最终采用权在你，数据仍保存到本地。
- **不被云端绑架**：编辑、阅读、标注、OCR 缓存和索引都以本地为中心；Agent 也是可选能力。

## 🚀 0.4.0 带来的变化

- **自定义 AI 服务**：输入服务地址、API Key 和模型名称，即可使用 DeepSeek 等服务；也可以继续使用本机已有的 Codex 登录。
- **更聪明的阅读上下文**：Agent 首次连接获取环境说明，后续只接收短工具索引与变化中的阅读快照，减少无意义的上下文重复。
- **AI 阅读更稳**：独立的阅读查询可以同时处理；批注和目录修改仍然需要确认，不会擅自改动原文。
- **扫描书工作流更完整**：OCR、罗盘索引、目录整理、页级取证和 Agent 阅读形成完整链路，缺索引时明确报错而不是悄悄整书 OCR。
- **应用结构更清晰**：阅读、扫描书识别、在线文档和 AI 伴读的功能边界更清楚，后续升级更稳定。

---

## ✨ 你可以用 Inkdown 做什么？

### 📚 1. 把书和资料放在一起读

打开一个文件夹，就可以在同一个窗口管理笔记和资料：

- PDF、EPUB、MOBI、AZW3、AZW 电子书
- Markdown 笔记
- 在线技术文档
- 最近打开的文件和网页

阅读时可以调整字号、行距、缩放和阅读位置；目录、章节和页码都能快速跳转。

### 🖍️ 2. 边读边留下真正有位置的笔记

选中原文后，可以：

- 添加多种颜色的高亮
- 写书签和批注
- 按章节查看所有标记
- 点击标记跳回原文
- 把本章或全书笔记导出为 Markdown

PDF 的标记会跟随页面和文字位置，缩放后仍能准确贴合，不会变成一堆失去出处的复制文字。

### ✍️ 3. 写 Markdown，也能马上看到结果

- 编辑、预览、左右分屏随时切换
- 支持表格、任务列表、代码、数学公式和流程图
- 粘贴图片自动保存到文档资源目录
- 一键导出 HTML 或 PDF

### 🌐 4. 不离开阅读窗口浏览在线文档

输入一个网页地址，Inkdown 会提取适合阅读的正文：

- 自动整理页面标题和目录
- 代码块一键复制
- 同站文档可以前进/后退浏览
- 在线文档也支持高亮、批注和 AI 提问

### 🔎 5. 让扫描版 PDF 也能被阅读和搜索

没有文字层的扫描 PDF 可以按需进行文字识别：

- 识别当前页面并划词
- 识别目录并建立章节导航
- 为整本书建立本地索引
- 按章节阅读和全文搜索
- 识别结果缓存在本地，之后可以离线使用

### 🤖 6. 让 AI 读懂你正在看的内容（可选）

AI 伴读可以知道你正在看的文档、章节、页码和选区，而不是让你每次复制一大段文字：

- 解释当前页面或当前章节
- 回答选区问题
- 根据目录查找内容
- 查看已有书签和批注
- 提议高亮、批注和章节重点

所有修改建议都会先显示给你确认，不会未经同意改动原文。

> **使用 AI 伴读前的准备**：需要先安装 [Bun](https://bun.sh)，并准备好 Codex 登录或 API Key。Bun 用来启动 AI 运行环境；Codex 登录信息会复用本机配置。没有完成这些准备时，Inkdown 的 Markdown 编辑、电子书阅读、在线文档、标注和导出仍然可以正常使用。

---

## 🚀 快速开始

### 下载与安装

- 各平台正式安装包均发布于 **[GitHub Releases](https://github.com/yitom486/inkdown/releases)**（Windows `.exe` / macOS `.dmg`（Apple Silicon） / Linux `.AppImage`）。
- **应用内静默更新**：现版本 **v0.4.0** 已内置自动检查更新，启动时自动检测新版本；也可随时在「关于」或「设置 → 应用」中手动检查并一键更新。

> **从 v0.2.x 升级**：安装包 appId 已变更，旧版「轻量阅读器」无法原地自动升级，请下载新安装包覆盖或并行安装；此后同 Inkdown 安装包之间可走应用内更新。

### 基本使用

**编辑 Markdown 文档**
1. 点击“打开”选择 Markdown 文件，或打开一个工作区文件夹。
2. 在主区域编辑内容，通过顶栏切换编辑、分屏或预览视图。
3. 使用快捷键 `Ctrl+S` 保存，或通过菜单导出为 HTML / PDF。

**阅读电子书并整理笔记**
1. 在左侧文件树中点击打开任意 PDF、EPUB、MOBI、AZW3 或 AZW 文件。
2. 通过侧栏“目录”跳转章节，或使用底部导航键切换相邻正文单元。
3. 划选文本后呼出浮动工具栏，添加高亮重点、撰写批注或向 Agent 提问。
4. 打开右侧“书签与批注”面板回顾全部标记，点击“导出”生成 Markdown 笔记。

**浏览在线技术文档**
1. 在欢迎页输入目标文档 URL（如 `https://react.dev/learn`）或从最近列表直接进入。
2. 顶栏地址栏可切换同站路径，侧边栏自动提取大纲目录。
3. 享有与本地电子书完全一致的划词高亮、批注、导出与伴读提问体验。

### Agent 伴读（可选）

> Agent 是辅助增强能力，完全解耦。未配置 Agent 时，所有的本地编辑、阅读、标注与导出功能均 100% 正常使用。

#### 必须准备的两件事

1. **安装 Bun**：安装后请完全退出并重新打开 Inkdown，让系统 PATH 生效。Inkdown 会使用 Bun 按需启动 AI 运行环境。
2. **配置 Codex 认证**，任选一种方式：
   - 使用 Codex / ChatGPT 登录：准备好本机 `~/.codex` 登录信息
   - 使用 API Key：配置 `OPENAI_API_KEY` 或 `CODEX_API_KEY`
   - 使用其他模型服务：在 Agent 设置中填写服务地址、API Key 和模型名称

无需单独安装全局 Codex CLI。Bun 或 Codex 未准备好时，只有 Agent 伴读不可用，Inkdown 的编辑、阅读、在线文档、标注和导出功能不受影响。

### 常用快捷键

| 快捷键 | 功能说明 |
| :--- | :--- |
| `Ctrl+O` | 打开文件或工作区文件夹 |
| `Ctrl+S` | 保存当前 Markdown 文件 |
| `Ctrl+Shift+S` | 另存为文件 |
| `Ctrl+Shift+A` | 快速展开 / 收起 Agent 伴读面板 |
| `Ctrl+F` | 编辑器内搜索与替换 |
| `Ctrl+B` | 粗体文本格式 |
| `Ctrl+I` | 斜体文本格式 |
| `Ctrl+K` | 插入超链接 |
| `Ctrl+,` | 打开系统设置 |

### 隐私与规格

- **本地优先**：电子书、Markdown、阅读进度、书签和批注默认均以本地数据格式持久化，应用不收集上传个人文献数据。
- **Agent 数据流向**：仅在主动使用 Agent 对话时，问题、当前视口文本及必要上下文才会发送给用户自主配置的 Agent 运行时。
- **格式说明**：不支持商业 DRM 加密电子书；无文本层的扫描版 PDF 支持单页 OCR（含目录 OCR、划词、Agent 读页），首次使用需从 GitHub Release 下载 OCR 运行时与语言包；排版非常规或无目录的极早期 MOBI 将尽量依据正文层级构建基础导航。

---

## 🛠️ 开发者专区：本地开发

前置：**Bun 1.x**（禁用 npm / yarn / pnpm）+ Git（含 submodule，`third-party/foliate-js` 为阅读后端子模块，CI 以 `submodules: recursive` 检出）。

```bash
# 1. 克隆（含子模块；已克隆则用第二行补齐）
git clone --recurse-submodules https://github.com/yitom486/inkdown.git
git submodule update --init --recursive

# 2. 安装依赖（单一根 bun.lock，不建嵌套锁）
bun install

# 3. 启动开发热重载
bun run dev
```

| 命令 | 说明 |
|------|------|
| `bun run dev` | 开发热重载（根命令自带 `--config apps/desktop/electron.vite.config.ts`，勿另传） |
| `bun run build` | 构建主进程 / preload / 渲染器三端，产物落根 `out/` |
| `bun run typecheck` | `tsconfig.web.json` + `tsconfig.node.json` 双工程类型检查 |
| `bun run test` | Vitest 全量单测 |
| `bun run test:e2e` | Playwright E2E（需先 `build`，配置 `apps/desktop/playwright.config.ts`） |
| `bun run lint:docs` | 子目录 README 与文件清单一致性（`scripts/lint-docs.ts`，CI 门禁） |
| `bun run lint:deps` | Monorepo 依赖边界 R1–R6（`scripts/check-deps.ts`，CI 门禁） |
| `bun run check:bundle` | 体积预算 + 主进程打包白名单（需先 `build`，`scripts/check-bundle.ts`，CI 门禁） |
| `bun run pack:win` | 打包 Windows 安装包（另有 `pack` / `pack:mac` / `pack:linux`，配置 `apps/desktop/electron-builder.yml`） |

**产物声明**：`out/`（`main/` / `preload/` / `renderer/` 构建输出）与 `release/`（安装包）**均落在仓库根**，两者皆已 gitignore，不提交。`apps/desktop/` 下无独立 `out/` 与 `package.json`，单根锁保留。

---

## 🗺️ Monorepo 地图

```
inkdown/
├── apps/desktop/          # 桌面应用（Electron 主进程 + React 渲染进程 + E2E/资源/三配置）
├── packages/@inkdown/*    # 私有 workspace 包（纯逻辑与契约，不独立发版）
├── scripts/               # 发版 / 文档 lint / 依赖边界 / 打包门禁脚本
├── third-party/           # 第三方与教学归档（阅读后端子模块 + 手搓 JSON-RPC 教学快照，三无隔离，不进构建）
├── out/ + release/        # 构建与打包产物（根目录，gitignore）
└── package.json + bun.lock # 单根依赖与 workspace 声明（packages/*）
```

### apps/desktop 三配置（根命令已自带 `--config` 引用，直接跑根命令即可）

| 配置 | 被谁引用 | 职责 |
|------|----------|------|
| `apps/desktop/electron.vite.config.ts` | `dev` / `build` / `preview` | 三端构建入口、路径别名、preload CJS 打包、pdf.js 资源拷贝 |
| `apps/desktop/electron-builder.yml` | `pack` / `pack:win` / `pack:mac` / `pack:linux` | 安装包目标、文件白名单（主进程运行时依赖）、`output: release`（落根） |
| `apps/desktop/playwright.config.ts` | `test:e2e`（含 `test:e2e:web-doc`） | E2E 目录 `apps/desktop/e2e/`、已构建应用回归 |

### packages/@inkdown/* 一句话

| 包 | 一句话 |
|----|--------|
| `@inkdown/contracts` | 跨进程契约：`Result` / `AppError`、IPC 通道与 `electron-api.types`、跨边界 DTO、稳定常量 |
| `@inkdown/reader-core` | 阅读纯逻辑：导航 / TOC / 选区 / 标记几何 / 主题排版与阅读模型 |
| `@inkdown/pdf` | PDF 原生结果归一与拼装（页码归一 / 分类映射 / 整档拼装，`normalize` / `models` / `ports`） |
| `@inkdown/ocr-core` | OCR 纯逻辑：目录抽取与重组 / 水印清洗 / 页词与质量判断，另含 `pdf-bytes` 与缓存 `ports`、外部运行时版本 pin（`inspector-pins`） |
| `@inkdown/annotations` | 标注纯逻辑：标记合并 / 纯核 / Anki 构建 / Flashcard 模型与复习，另含标记提议模型（`mark-proposal` 单条·批量、`chapter-mark-plan` 章级建议） |
| `@inkdown/web-doc` | 在线文档纯逻辑：目录抽取（`extract-toc-links` / `extract-llms-toc`）与站点谓词（`hrtt` / `people-daily`） |

> 注：ACP 协议客户端纯逻辑已完全独立为外部包 `@yitom/acp-client`（stdio JSON-RPC 传输 / 认证决策链 / 会话能力与 registry / 终端缓冲 / MCP RPC 与工具表），不再作为内部 workspace 包维护。

### shared/ 已删声明

`shared/` **已清空**（仅剩无文件的空目录，阶段 10 删除）：全部契约与纯逻辑已分别迁入 `@inkdown/contracts` / `@inkdown/reader-core` / `@inkdown/pdf` / `@inkdown/ocr-core` / `@inkdown/annotations` / `@inkdown/web-doc`（ACP 已独立为外部包 `@yitom/acp-client`）。新代码一律走 `@inkdown/*`，**禁止引用 `@shared`**。各目录 README 中的“原 `shared/…`”仅为迁移溯源备注。

### 路径别名

| 别名 | 指向 | 说明 |
|------|------|------|
| `@/` | `apps/desktop/src/` | 渲染进程源码 |
| `@inkdown/*` | `packages/*/src/index.ts` | workspace 包（构建与测试均已接线） |
| `@foliate` | `third-party/foliate-js` | 阅读后端子模块 |
| `@shared` | `shared/` | **已废弃**：渲染与测试工程已剔除，仅主进程构建保留兼容，新代码禁用 |

---

## 📦 发版

约定：日常把本版要点写在 `CHANGELOG.md` 顶部 `## [未发布]`（至少一条 `- ` 要点）；发版脚本自动递增版本号、归档日志、本地 commit + 打 tag。写法以 `scripts/release.ts` 头注释与根 `package.json` 为准。

```bash
# 1. 在 CHANGELOG.md 的 [未发布] 中登记本次更新特性
# 2. 先预览（不写文件、不 commit）
bun run release -- --dry-run

# 3. 发版到本地（默认 patch 自动 +1，仅本地 commit/tag）
bun run release
bun run release -- minor      # 次版本
bun run release -- major      # 主版本
bun run release -- major --push  # 递增并直接推送

# 4. 确认后推送 tag，触发 GitHub Actions 多平台打包
bun run release:push
```

**单 `--` 与双 `--`**：Bun 用 `--` 向脚本传参。`-- minor` / `-- major` 传递递增种类；`-- --push` / `-- --dry-run` 传递 flag（`--` 后再接 `--push` 写法）。`bun run release:push` 即 `scripts/release.ts -- --push` 的快捷方式。

**分支警告**：请在 **`master` 稳定分支**发版，**勿在 `refactor/monorepo` 等迁移分支打 tag**；发版前工作区必须干净且目标 tag 不存在（脚本会自动校验，不满足则中断）。

---

## 📚 文档与规范

- 开发准则与架构：[AGENTS.md](./AGENTS.md)（技术栈、目录要点、Electron/IPC、状态管理、发版摘要）+ `.cursor/rules/`（Git 身份、Zustand、阅读器导航强制细则）。
- 渲染进程总览：[`apps/desktop/src/README.md`](./apps/desktop/src/README.md)；主进程：[`apps/desktop/electron/README.md`](./apps/desktop/electron/README.md)。各子目录另有短 README：**增删文件或改文件名后必须同步更新对应 README**（机器门禁 `bun run lint:docs`，EXIT 非零即不合规）。
- 依赖边界：`packages/*` 禁 `electron` / `node:` / `react` / `@/` / 跨包相对越界，渲染非 `api/` 禁直调 `window.electronAPI`（门禁 `bun run lint:deps`，豁免须行尾 `// check-deps:allow` 并注明理由）。
- 流水线：`.github/workflows/ci.yml`（检出 `submodules: recursive` → typecheck → lint:docs → lint:deps → test → build → check:bundle → E2E）；`.github/workflows/release.yml`（tag `v*` 触发三平台打包 + GitHub Release）。
- 版本历史：[CHANGELOG.md](./CHANGELOG.md)（版本号与 Git tag 对齐）。
