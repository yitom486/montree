# src/components/layout

应用壳与主工作区布局（非阅读器内部工具栏）。已按结构分层（2026-09 重构）。

## 根目录：壳骨架（互为直接依赖）

| 文件 | 功能 |
|------|------|
| `AppTitleBar` | VS Code 风格统一自绘顶栏（无边框窗口融合、主题对齐、Command Center 居中胶囊标题、窗口控制三键与快捷工具） |
| `WorkspaceShell` | ActivityBar + 可折叠侧栏 + 主区 + Agent 面板 + AppTitleBar 顶栏 |
| `ActivityBar` | 左侧活动条 |
| `Sidebar` | 侧栏（装配 panels/ 的内容面板） |
| `SplitPane` | 通用分栏容器 |

## panels/ 侧栏内容面板

| 文件 | 功能 |
|------|------|
| `FileExplorer` | 文件树（新建/重命名/删除/拖拽等树操作见 `hooks/workspace/useFileTreeActions`；header 仅留 ⋯ 溢出菜单，设新建窗口/保存/导出/设置等入口） |
| `FileBreadcrumb` | 文件面包屑（编辑/阅读主区共用） |
| `DocumentOutline` | Markdown 大纲（侧栏消费） |

## main/ 主工作区（按文档模式）

| 文件 | 功能 |
|------|------|
| `EditorWorkspaceMain` | Markdown 编辑 + 预览分栏（含 `ViewModeToggle`、欢迎页回落） |
| `ReaderWorkspaceMain` | 电子书阅读主区入口 |
| `WelcomePage` | 无打开文件时的欢迎页（含在线文档 URL 入口，复用 `web-doc/WebDocUrlField`） |
| `ViewModeToggle` | 编辑/预览/分屏切换 |

## web-doc/ 在线文档壳件

| 文件 | 功能 |
|------|------|
| `WebDocWorkspaceMain` | 在线文档阅读主区（顶栏地址栏 + Viewer）；向侧栏上报本页标题大纲 |
| `WebDocAddressBar` | 在线文档 URL 输入与最近列表 |
| `WebDocUrlField` | URL 输入（欢迎页与侧栏共用） |
| `WebDocSidebarPanel` | 侧栏内嵌在线文档面板（无工作区时展示当前页/最近 URL） |

在线文档的正文/目录/站点谓词逻辑见 `@montree/web-doc`（`packages/web-doc/`）与 `lib/reader/web-doc/`。
