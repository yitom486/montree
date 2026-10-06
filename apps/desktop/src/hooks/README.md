# src/hooks

渲染进程 React Hook。按产品域分子目录；组件通过 `@/hooks/<域>/useXxx` 引用。  
**不要**在根目录再堆新文件。IPC 封装在 `src/api/`，本地 UI 状态在 `src/stores/`，本目录只放「把数据接到组件」的胶水。

| 目录 | 管什么 |
|------|--------|
| `editor/` | Markdown 编辑：预览、草稿、自动保存、导出、粘贴图、滚动同步 |
| `preview/` | 预览 DOM 增强：代码块复制、hljs 主题、Mermaid（预览与 Agent 气泡共用） |
| `reader/` | EPUB / PDF / MOBI：二进制加载、侧栏、书签批注、高亮浮层、OCR/罗盘 |
| `workspace/` | 工作区壳：打开/保存文件、文件树、侧栏折叠、全局错误 |
| `quiz/` | AI 测验历史读取（TanStack Query） |
| `sync/` | 云同步配置/状态（配置种子 + 状态推送写回） |
| `agent/` | ACP Agent 会话（协议/传输/认证/MCP 纯逻辑已独立至 `@yitom/acp-client`） |

---

## editor/

| 文件 | 功能 |
|------|------|
| `useMarkdownPreview` | 把 Markdown debounce 渲染成消毒后的 HTML（含本地图片转 data URL） |
| `useScrollSync` | 编辑器 ↔ 预览滚动同步，并记住各文件滚动位置 |
| `usePasteImage` | 粘贴图片写入文档旁目录，返回 Markdown 相对路径 |
| `useExportDocument` | 当前文档导出 HTML / PDF |
| `useAutoSave` | 按设置间隔对已保存且 dirty 的文件自动保存 |
| `useDraftPersistence` | dirty 内容 debounce 写入本地草稿；`clearDraftForFile` 保存后清草稿 |
| `useDraftRecovery` | 启动时检测可恢复草稿（`useDraftRecoveryPrompt`） |

## preview/

| 文件 | 功能 |
|------|------|
| `useCodeBlockCopy` | 容器内 `.code-block-copy` 点击复制代码 |
| `useHighlightTheme` | 随亮/暗色切换 highlight.js 样式（预览与 Agent 共用） |
| `useMermaidInContainer` | 在容器内 hydrate `.mermaid` 节点。当前预览/Agent 已改独立块，此 Hook **暂无引用** |

## reader/

| 文件 | 功能 |
|------|------|
| `useReaderBinary` | TanStack Query 读电子书二进制 |
| `useReadingMarks` | 当前文档书签 / 高亮 / 批注的 list + create/update/delete |
| `useDeferredReaderLayout` | 等待 iframe 排版稳定后合并执行标记几何重算 |
| `useReadingMarkInspector` | 点击高亮后的浮层：命中栈、当前标记、位置 |
| `useReaderSidePanels` | 目录侧栏与标记侧栏互斥开关 |
| `useReaderSelectionActions` | 三阅读器划选工具条共享动作：复制/批注/高亮/加入对话/问 Agent |
| `useReaderExportMenu` | 三阅读器笔记与 Anki 导出菜单共享外壳（toc/当前章由各家传入） |
| `usePdfPageOcr` | PDF 单页 OCR 域：页缓存/识别去重/统一正文读取/当前页识别 |
| `useOcrComponent` | OCR 组件状态（初始 invoke + 推送写回 Query 缓存、下载/取消） |
| `useRosettaImport` | 罗盘导入视图状态：横幅按钮 + 进度 + 已索引信息（Query 按 fingerprint 缓存）+ 纯本地目录重建 |
| `useReaderWheelNavigation` | 滚轮到顶/底翻页。逻辑已抽出，Viewer 里仍有内联调用，此 Hook **暂无引用** |
| `useSyncProgressBridge` | 阅读进度 Store 与主进程云同步双向桥接 |

## quiz/

| 文件 | 功能 |
|------|------|
| `useQuizSessions` | TanStack Query 按书籍路径读取测验历史（JSONL 仓储）；`invalidateQuizSessions` 供落库后失效 |

## sync/

| 文件 | 功能 |
|------|------|
| `useSyncConfigStatus` | 云同步：`useSyncConfig`（配置表单种子）+ `useSyncStatus`（状态快照，`onStatusChanged` 推送经 `setQueryData` 写回缓存） |

## workspace/

| 文件 | 功能 |
|------|------|
| `useFileOperations` | 打开/保存/另存、工作区扫描、外部文件打开（工作区切到文件所在目录）；正文 `content` / `filePath` 的源头。另导出 `useAppMeta` |
| `useFileTreeActions` | 文件树新建、重命名、删除、复制粘贴、导出 |
| `useSidebarPanelSync` | 布尔可见性 ↔ `react-resizable-panels` 折叠（`useCollapsiblePanelSync`） |
| `useGlobalErrorHandlers` | 捕获未处理 Promise / `window.error`，并同步 verbose 日志开关 |

## agent/

| 文件 | 功能 |
|------|------|
| `useAcpSession` | 连接 ACP、发 prompt、流式消息、权限与配置；Agent 面板主状态机 |
| `useAcpPermissionIngest` | App 根订阅权限请求 → store（聊天内联审批卡数据源）；断开/出错清未决 |
| `useMontreeSnapshotHost` | App 根应答主进程快照请求（MCP 工具 / `fs/read .montree/agent/*`） |
| `useAcpStreamHost` | App 根 ACP 流式推送宿主（生命周期跟应用走，不跟面板挂载走；双面板曾致复读） |
| `useAnnotationAgentAssist` | 批注对话框：独立 ACP session；意图/写成批注 → 不进右侧时间线 |
| `useStickToBottomScroll` | Agent 消息列表贴底滚动；`streaming` 时 rAF 合并 ResizeObserver；返回 `pinned` / `scrollToBottom` |
| `useSmoothStreamingText` | 流式匀速揭示（常驻 rAF + 自适应消费 + 完成排空）+ `useThrottledValue` 低频重解析 |

---

新 Hook：先对号入座再新建文件。跨域共用的预览 DOM 行为放 `preview/`，不要复制一份到 `agent/`。  
各子目录另有短 README，文件表以**本文件**为准。
