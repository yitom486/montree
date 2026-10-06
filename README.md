<div align="center">

<img src="./apps/desktop/resources/icon.png" alt="Montree Logo" width="96" height="96" />

# Montree

**取《庄子·山木》之意：在喧嚣算法之外，扎根属于自己的沉浸阅读与思维之树。**  
*Read Deeply. Think in Context. Own Your Knowledge.*

[![Release](https://img.shields.io/github/v/release/yitom486/montree?color=3b82f6&label=Release)](https://github.com/yitom486/montree/releases)
[![Platform](https://img.shields.io/badge/Platform-Windows%20%7C%20macOS%20%7C%20Linux-blue)](https://github.com/yitom486/montree/releases)
[![Package Manager](https://img.shields.io/badge/Bun-1.x-black?logo=bun)](https://bun.sh)

[寓意与初心](#-山木之意何为-montree) • [核心功能](#-你能用-montree-做什么) • [快速开始](#-快速开始) • [更新日志](./CHANGELOG.md)

</div>

---

## 🌲「山木」之意：何为 Montree？

> 庄子行于山中，见大木，枝叶盛茂，伐木者止其旁而不取也。  
> 问其故，曰：“无所可用。”  
> 庄子曰：“此木以不材得终其天年。”  
> ——《庄子·内篇·山木》

今天的数字阅读与知识工具，正陷入无止境的喧嚣与功利：算法推荐争夺你的注意力，云端平台将你的笔记撕裂在不同服务器中，碎片化的快餐式阅读让人疲惫不堪。

**Montree（山木）** 便诞生于对这种浮躁的反思。

我们取“山木”之名，正是向往那棵静立深山、不为外物所役的大树：
- **无用之用，方为大用**：不迎合快餐速成，只专注为你构筑一个不受干扰、沉静专注的**本地深度阅读空间**；
- **扎根泥土，自有枝叶**：所有的书本、笔记、卡片和图谱都 100% 留存在你的本地硬盘中，无需担心隐私泄漏或云端停摆；
- **从阅读到思考**：在山木的庇护下，把每一页读成自己的血肉，让思想在专注中自然抽枝散叶，终其天年。

---

## ✨ 你能用 Montree 做什么？

### 📚 1. 容纳全格式的一体化阅读空间
告别在阅读器、浏览器与笔记软件之间来回切换的烦恼：
- **海量电子书**：优雅支持 PDF、EPUB、MOBI、AZW3，翻页、排版与目录自如掌控；
- **沉浸式 Markdown**：支持双栏分屏、公式排版与图表预览，边读边记随心创作；
- **在线技术文档**：输入网页链接即可一键提取正文与目录大纲，像读电子书一样研读在线官方文档；
- **扫描版清晰阅读**：内置本地离线文字识别，即使是无文本层的扫描书也能自由划词、选段与搜索。

### 🏷️ 2. 真正有位置的批注与精美知识卡片
笔记不是断章取义的复制粘贴，它必须根植于原文的脉络之中：
- **精准锚定原文**：无论缩放、翻页还是跳转，高亮与批注牢牢锁定在原文对应的章节与几何坐标上；
- **微晶知识卡片流**：将阅读中的灵感与理解沉淀为右侧卡片流，支持概念、引文、方法与图谱分类筛选；
- **思维推演与图谱展开**：支持时序流转步骤折叠、Mermaid 架构图预览与**一键全屏弹窗放大检视**（支持 50%~200% 自由缩放与高清导出）。

### 🤖 3. 心有灵犀的上下文 AI 伴读（可选）
AI 应该像一位博学的同桌，而不是一个冷冰冰的外部聊天框：
- **身临其境的上下文**：无需反复复制粘贴，AI 随时清楚你翻到了哪一页、正看着哪段文字；
- **架构推演与知识提炼**：随时让伴读为你梳理复杂的论点逻辑、提炼核心解读并绘制思维导图；
- **主权永远在手**：AI 提出的任何划重点或批注建议，必须经你确认后才会写入，绝不擅自更改你的文献。

> 💡 **AI 伴读前置准备**：Montree 安装包遵循本地轻量原则，默认不内置厚重的 AI 运行时。若想使用 AI 伴读功能，需在系统中安装 **[Bun](https://bun.sh)**，Montree 会通过 Bun 自动按需拉取 **ACP（Agent Client Protocol）** 伴读客户端及协议运行时。未安装 Bun 时，所有本地离线阅读与批注功能 100% 正常使用。

### 🔒 4. 彻底的本地优先与数据自由
- **离线可用**：所有阅读进度、批注、文献与索引数据全部以开放标准保存在本地；
- **绝不绑架**：即使断网或离线，完整的阅读、笔记编辑、图表渲染与卡片导出功能依然 100% 完备。

---

## 🚀 快速开始

### 📥 1. 下载应用
访问 **[GitHub Releases](https://github.com/yitom486/montree/releases)** 下载对应操作系统的安装包：
- **Windows**：`.exe` 安装程序
- **macOS**：`.dmg`（Apple Silicon）
- **Linux**：`.AppImage`

### 🤖 2. 启用 AI 伴读（按需安装 Bun 拉取 ACP）

Montree 的 AI 伴读基于 **ACP（Agent Client Protocol）** 协议构建。若要启用 AI 伴读能力，只需在本机安装 **[Bun](https://bun.sh)** 环境：

```bash
# Windows (PowerShell)
powershell -c "irm bun.sh/install.ps1 | iex"

# macOS / Linux (Terminal)
curl -fsSL https://bun.sh/install | bash
```

安装完成后完全退出并重新打开 Montree，应用会在初次连接伴读时**通过 Bun 自动拉取并运行 ACP 客户端**。你只需在设置中填入 API Key（支持 DeepSeek、OpenAI 等兼容模型）或复用本机已有的 Codex 登录即可开启伴读。

*(未安装 Bun 时，所有本地离线阅读、排版、批注与导出功能均不受任何影响。)*

### 🛠️ 3. 本地开发与从源码构建

Montree 项目统一采用极速现代包管理工具 **[Bun](https://bun.sh)**（请勿使用 npm / yarn / pnpm）。

```bash
# 1. 克隆仓库（包含阅读后端子模块）
git clone --recurse-submodules https://github.com/yitom486/montree.git
cd montree

# 2. 安装依赖（使用 Bun）
bun install

# 3. 启动本地开发桌面应用
bun run dev

# 4. 构建打包
bun run build
bun run pack:win    # 打包 Windows 安装包
bun run pack:mac    # 打包 macOS 安装包
bun run pack:linux  # 打包 Linux 安装包
```

---

## 📜 许可证

本项目基于 [MIT License](./LICENSE) 开源。

*山木自寇也，膏火自煎也。在信息喧嚣的时代，愿 Montree 成为陪伴你静心阅读的那方净土。*
