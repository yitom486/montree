# src/components/layout

应用壳与主工作区布局（非阅读器内部工具栏）。已按结构分层（2026-09 重构）。

## 根目录：壳骨架（互为直接依赖）

| 文件 | 功能 |
|------|------|
| `AppTitleBar` | VS Code 风格统一自绘顶栏（无边框窗口融合、主题对齐、Command Center 居中胶囊标题、窗口控制三键与快捷工具） |
| `WorkspaceShell` | ActivityBar + 可折叠侧栏 + 主区内的正文右侧页内目录（有标题时）+ 共享辅助区 + AppTitleBar 顶栏 |
| `WorkspaceCompanionPanel` | 同一可调整宽度的辅助区切换 AI 对话 / 卡片流，隐藏页保留挂载与输入现场 |
| `WorkspaceDocumentArea` | 文档工具栏下的正文与右侧页内目录共享布局、背景；目录开关留在页内，Markdown 模式/预览/卡片入口位于文档左下角；宽度在主工作区内分配，不挤动聊天面板 |
| `WorkspaceCardRail` | 轻量 Context 与 Portal：阅读器保留卡片数据、批注和测验回调，展示统一交给外壳 |
| `ActivityBar` | 左侧活动条（资源管理器、书库、阅读时打开卡片流/其他模式打开札记、底部全局设置） |
| `Sidebar` | 左侧栏（资源管理器与在线文档手风琴面板；文档目录已移至右侧独立面板） |
| `SplitPane` | 通用分栏容器 |
| `StatusBar` | 底部状态栏（WSL 环境提示、Git 分支/变更计数/待推提交与一键推送、文档格式编码） |
| `TerminalPanel` | 按需加载 xterm.js 交互终端，多标签、Shell 选择、输入/粘贴、输出、退出状态与拖拽尺寸；状态栏或 Ctrl+反引号显示/隐藏，隐藏保留会话，切换工作区关闭旧终端 |
| `RemoteConnectModal` | 远程环境连接器（应用内直达 WSL 分发版；经 Ubuntu 远端服务建连 + 浏览，确认目录后打开远端工作区并绑定本窗口，不再生成 UNC，SSH 探测，规避系统对话框） |

## panels/ 侧栏内容面板

| 文件 | 功能 |
|------|------|
| `FileExplorer` | 资源管理器（BeUI 风格右键菜单、边缘避让与 Shift+F10/方向键操作；新建/重命名/删除/拖拽等树操作见 `hooks/workspace/useFileTreeActions`；header 留折叠与 ⋯ 溢出菜单；图片文件显示独立图标） |
| `FileBreadcrumb` | BeUI 风格文件面包屑：工作区相对路径、上级菜单、窄栏折叠与资源管理器定位（编辑/阅读主区共用） |
| `panels/FileBreadcrumb.test.ts` | Windows / POSIX 根路径与工作区边界回归 |
| `DocumentOutline` | Markdown / 在线文档工具栏下、正文右侧的页内目录：与正文共用背景，轻量标题与导航竖线；仅在有标题时出现，正文双向联动、当前标题加粗并自动滚入可视区，长目录独立滚动 |

## main/ 主工作区（按文档模式）

| 文件 | 功能 |
|------|------|
| `EditorWorkspaceMain` | Markdown 默认所见即所得，源码模式自动分栏、独立预览与持久卡片（底部入口）（顶部不再放视图切换；欢迎页回落）；图片文件按扩展名分流到懒加载 `ImageViewer`；Typst 按需加载独立 `typst/TypstWorkspace`，保留共享保存/冲突横幅和视图模式；可等待的章节/摘录定位、原文选区、切档与版本过期保护 |
| `ReaderWorkspaceMain` | 电子书阅读主区入口 |
| `WelcomePage` | 无打开文件时的欢迎页（含在线文档 URL 入口，复用 `web-doc/WebDocUrlField`） |
| `ViewModeToggle` | TXT / Typst 等非 Markdown 文档的编辑/预览/分屏切换 |
| `EditorModeToggle` | 文档左下角“编辑源码 / 返回所见即所得”切换；源码自动双栏、普通编辑单栏；保留 Ctrl+/ 快捷键 |

## web-doc/ 在线文档壳件

| 文件 | 功能 |
|------|------|
| `WebDocWorkspaceMain` | 在线文档阅读主区（顶栏地址栏 + Viewer）；向侧栏上报本页标题大纲 |
| `WebDocAddressBar` | 在线文档 URL 输入与最近列表 |
| `WebDocUrlField` | URL 输入（欢迎页使用） |
| `WebDocSidebarPanel` | 侧栏在线文档手风琴面板（支持可折叠、即时输入 URL 与最近列表快速切换） |

在线文档的正文/目录/站点谓词逻辑见 `@montree/web-doc`（`packages/web-doc/`）与 `lib/reader/web-doc/`。
