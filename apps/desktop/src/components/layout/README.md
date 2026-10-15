# src/components/layout

应用壳与主工作区布局（非阅读器内部工具栏）。已按结构分层（2026-09 重构）。

## 根目录：壳骨架（互为直接依赖）

| 文件 | 功能 |
|------|------|
| `AppTitleBar` | VS Code 风格统一自绘顶栏（无边框窗口融合、主题对齐、Command Center 居中胶囊标题、窗口控制三键与快捷工具） |
| `WorkspaceShell` | ActivityBar + 可折叠侧栏 + 主区 + Agent 面板 + AppTitleBar 顶栏 |
| `ActivityBar` | 左侧活动条（资源管理器、书库、札记与底部全局设置） |
| `Sidebar` | 侧栏（装配 panels/ 的手风琴内容面板，支持资源管理器、在线文档与大纲的折叠与拖拽分栏） |
| `SplitPane` | 通用分栏容器 |
| `StatusBar` | 底部状态栏（WSL 环境提示、Git 分支/变更计数/待推提交与一键推送、文档格式编码） |
| `RemoteConnectModal` | 远程环境连接器（应用内直达 WSL 分发版；经 Ubuntu 远端服务建连 + 浏览，确认目录后打开远端工作区并绑定本窗口，不再生成 UNC，SSH 探测，规避系统对话框） |

## panels/ 侧栏内容面板

| 文件 | 功能 |
|------|------|
| `FileExplorer` | 资源管理器（BeUI 风格右键菜单、边缘避让与 Shift+F10/方向键操作；新建/重命名/删除/拖拽等树操作见 `hooks/workspace/useFileTreeActions`；header 留折叠与 ⋯ 溢出菜单） |
| `FileBreadcrumb` | BeUI 风格文件面包屑：工作区相对路径、上级菜单、窄栏折叠与资源管理器定位（编辑/阅读主区共用） |
| `panels/FileBreadcrumb.test.ts` | Windows / POSIX 根路径与工作区边界回归 |
| `DocumentOutline` | Markdown 大纲（侧栏消费，支持手风琴折叠） |

## main/ 主工作区（按文档模式）

| 文件 | 功能 |
|------|------|
| `EditorWorkspaceMain` | Markdown 编辑 + 预览分栏（含 `ViewModeToggle`、欢迎页回落）；可等待的章节/摘录定位、原文选区、切档与版本过期保护 |
| `ReaderWorkspaceMain` | 电子书阅读主区入口 |
| `WelcomePage` | 无打开文件时的欢迎页（含在线文档 URL 入口，复用 `web-doc/WebDocUrlField`） |
| `ViewModeToggle` | 编辑/预览/分屏切换 |
| `EditorModeToggle` | “编辑源码 / 可视编辑”切换，独立预览也可进入编辑，保留 Ctrl+/ 快捷键 |

## web-doc/ 在线文档壳件

| 文件 | 功能 |
|------|------|
| `WebDocWorkspaceMain` | 在线文档阅读主区（顶栏地址栏 + Viewer）；向侧栏上报本页标题大纲 |
| `WebDocAddressBar` | 在线文档 URL 输入与最近列表 |
| `WebDocUrlField` | URL 输入（欢迎页使用） |
| `WebDocSidebarPanel` | 侧栏在线文档手风琴面板（支持可折叠、即时输入 URL 与最近列表快速切换） |

在线文档的正文/目录/站点谓词逻辑见 `@montree/web-doc`（`packages/web-doc/`）与 `lib/reader/web-doc/`。
