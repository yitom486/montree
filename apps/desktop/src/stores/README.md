# src/stores

Zustand 本地状态（可 persist）。IPC / 服务端数据用 TanStack Query（`src/api/`），不要塞进这里。

Selector 返回对象时必须 `useShallow`：见 `.cursor/rules/zustand-selectors.mdc`。  
阅读器导航粒度：见 `.cursor/rules/reader-navigation.mdc`。

| 文件 | 功能 |
|------|------|
| `editor-ui-store.ts` | 主题、视图模式、侧栏、各文件滚动位置等编辑器 UI |
| `app-settings-store.ts` | 用户设置（自动保存间隔、verbose 日志等） |
| `active-document-store.ts` | 当前打开文档路径/类型（供 Agent turn-context 等） |
| `draft-store.ts` | 未保存草稿（localStorage） |
| `error-log-store.ts` | 渲染端错误日志列表 |
| `reader-navigation-store.ts` | 阅读器目录 / flatIndex / 当前章（侧栏与底栏共用）/ PDF 当前页 pageNum（仅 Agent 快照用） |
| `reading-progress-store.ts` | 阅读进度百分比等（含在线文档滚动比例） |
| `web-doc-store.ts` | 当前在线文档 URL、最近打开的文档站 |
| `reading-mark-panel-store.ts` | 标记侧栏筛选（重点/批注/书签，persist） |
| `acp-ui-store.ts` | Agent 线程、消息、连接状态、权限与配置偏好；线程会话 id 按运行时分桶（`agentSessionIds`） |
| `annotation-agent-store.ts` | 批注 AI 助手：按书线程、独立 agentSessionIds（按运行时分桶）、pendingDraft |
| `tts-store.ts` | 语音朗读听书：Google Gemini / Azure Speech / Local OpenAI / 系统语音；接收段号、排队、缓冲等待与播放完成分别维护，云端确认结束且播放队列耗尽才完成。主备容灾由主进程处理；接收中断后缓冲音频继续播放，耗尽后保留位置并暂停，按服务端额度恢复时间保护重试。未接收完的进度条显示已验证、可播放音频进度。按正文与语音配置指纹持久保存最近 100 章的实际播放秒数（每 2 秒、暂停/关闭/退出时保存），恢复时跳过已经听过的缓存 PCM，完整播放后清除位置。悬浮播放器、章节进度记忆。回归测试见 `tts-store-stream.test.ts`。 |
| `subsession-progress-store.ts` | 独立副会话（目录 AI 整理等）流式进度与实时看板状态（步骤计数、当前工具、思考摘要） |
| `acp-chat-types.ts` | Agent 聊天消息结构与解析辅助（非独立 store） |
| `acp/` | ACP 智能体交互与次世代伴读 HUD 专职子状态（见 `acp/README.md`） |

协议/传输/认证纯逻辑已独立至 `@yitom/acp-client`；本目录仅存 UI 与会话展示状态，不放 IPC 数据。
