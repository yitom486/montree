# ChatPanel 切流盘点（AgentPanel → `@montree/chat-session` ChatPanel）

> 只读审计，不改生产/测试代码。审计基线：工作树 `chat-render-init`。
> 包侧读：`packages/chat-session/src/panel/ChatPanel.tsx` + `session/use-chat-session.ts` + `session/store.ts` + `session/types.ts` + `panel/ChatComposer.tsx` + `packages/chat-session/README.md`。
> 宿主读：`apps/desktop/src/components/agent/AgentPanel.tsx` / `DockedAgentPane.tsx` / `FloatingAIHud.tsx` / `AgentComposer.tsx` / `chat/AgentMessageList.tsx` / `chat/AgentContextMenu.tsx` / `hooks/agent/useAcpSession.ts` / `hooks/agent/useAnnotationAgentAssist.ts`。
> 约束：测试文件一个不许动；凡有测试引用的宿主模块一律标 `stays`（只允许内部换线）。

## 1. 逐项对等表

### 1.1 消息列表 / 气泡 / 审批 / 提议 / 生成式提交 / 章节计划选择 / 引用 / 编辑回填 / 主题透传

| 宿主能力 | 包侧对等 | 结论 |
|---|---|---|
| 时间线分组 `groupChatTimeline(messages, {pendingToolCallId, nowMs, visibleIds, scopeKey})` | `useChatTimeline(messages, {pendingToolCallId, scopeKey})`（`packages/chat-session/src/panel/ChatPanel.tsx:92-95`） | **部分有**：缺 `nowMs` / `visibleIds`（历史分页窗口） |
| `ChatMessageBubble` 本体（含 user/agent/thought/tool/system 全分支） | 包内同名件已整搬（`agent-message-bubble.tsx:80-100` 全 props 仍在），`ChatPanel` 已渲染该件（`ChatPanel.tsx:135-147`） | **有**（件级） |
| `theme` 透传（宿主 `useEditorUiStore.theme`） | `ChatPanelProps.theme?: ChatMarkdownTheme` 缺省 `light`（`ChatPanel.tsx:20,80`），直传 `ChatMessageBubble`（`:139`） | **有**（宿主切流时必须显式透传 theme，不可依赖缺省） |
| 审批：`AgentPermissionCard + respondPermission` | 有：`ChatPanel.tsx:163-168` 接 `actions.respondPermission`（经 `transport.respondPermission + clearPermission`，见 `use-chat-session.ts:77-83`） | **有（最小）** |
| 内联审批 vs 兜底卡 `timelineRendersInlineApproval` + `pendingOrphan`（`AgentMessageList.tsx:315-318,449-454`） | 包无 `timelineRendersInlineApproval` 判断；只有无条件兜底卡 | **缺** |
| 工作日志 `AgentActivityGroup`（进度条/耗时/错误态，`AgentMessageList.tsx:398-406`） | 包内最小 `details/summary` 原生渲染（`ChatPanel.tsx:149-160` + 注释 `:70-71` 自认不如宿主完整） | **缺（已知 gap，包 README 已声明）** |
| 富结果槽 `renderBusinessResult=ToolBusinessResult` / `renderPlanCard=AgentPlanCard`（`AgentMessageList.tsx:425-434`） | 包 `ChatMessageBubble` 保留两可选槽（`agent-message-bubble.tsx:67-71`），但 `ChatPanel` 未传入（`:135-147` 无此两 prop） | **缺（接线缺，件能力有）** |
| 生成式提交 `onGenerativeSubmit` + 归属校验/防串线/busy 守卫（`AgentPanel.tsx:136-151` + `AgentMessageList.tsx:438`） | `ChatMessageBubble` 支持该 prop（`:56`），`ChatPanel` 未接（`:135-147` 无） | **缺** |
| 章节计划选择 `onChapterPlanSelect` | 有一半：`ChatPanelProps.onLocateChapter(flatIndex)` 经 payload 适配（`:28-32,142-146`）；宿主 `handleChapterPlanSelect` 还做 `selectChapterMarkPlan + sendPrompt(displayText/promptText)`（`AgentPanel.tsx:119-128`） | **部分有**：定位回调有，选中落库+发提示词缺 |
| 批注提议 `resolveMarkProposal` | 有但语义降级：`onResolveMarkProposal?` 缺省空函数 `NOOP_RESOLVE`（`:43-47`），包 README 明示“宿主必须传真实写库实现”（`README.md:16`） | **有（必填宿主注入，切流必传）** |
| 提议附带 `onDismissProposedMark / onRecoverChapter / onPromptSelectText / navFlatIndex`（`AgentMessageList.tsx:416,420-424`） | `ChatMessageBubble` 支持（`:46,73-75`），`ChatPanel` 未传 | **缺** |
| 内联 present `inlinePresentSlots / suppressPresentResult / runStatus`（`planInlinePresent` + `AgentMessageList.tsx:274,411-413`） | `ChatMessageBubble` 支持（`:38-40`），`ChatPanel` 未算未传 | **缺** |
| 用户消息编辑回填 `onEditMessage=setDraft`（`AgentPanel.tsx:559` → `AgentMessageList.tsx:439` → 气泡编辑钮 `:277-287`） | `ChatMessageBubble` 支持（`:61`），`ChatPanel` 未接 | **缺** |
| 引用 `onQuote`（`AgentPanel.tsx:560-563`：`> ` 前缀 + `requestComposerFocus`）+ `AgentContextMenu` 引用/复制/回到底部（`AgentContextMenu.tsx:10-67`） | 包无 `AgentContextMenu` 对等物；`ChatPanel` 无 `onQuote` | **缺** |
| 历史分页窗 `sliceChatWindow / CHAT_HISTORY_INITIAL_COUNT / PAGE_STEP` + 贴底/离底冻结/滚动快照落盘 `chatScrollByThread`（`AgentMessageList.tsx:199-313`） | 包无 | **缺** |
| `assistant-ui ThreadPrimitive.Viewport` 跟滚引擎 + `ViewportFooter/ScrollToBottom`（`:345-473`） | 包无（普通 div timeline `:132`） | **缺** |
| 空态（开始对话 + `authHint` 色块）/ `AgentLoadingState` / 系统消息 | 包无空态、无 loading 态（只有 timeline + permission + composer） | **缺** |
| 附件气泡展示（`AgentChatItem` 内 `message.attachments`，`agent-message-bubble.tsx:291-313`） | 件级有；包 `store.appendUser(text, {attachments})` 支持（`store.ts:232`），但 `ChatPanel` 路径发不出去（见 1.2） | **部分有** |

### 1.2 输入框（附件/粘贴/IME/发送停止/配置菜单/模型思考档）

| 宿主能力 | 包侧对等 | 结论 |
|---|---|---|
| IME：Enter 发送 / Shift+Enter 换行 / `isComposing + composition + keyCode229` 三重守卫 / 空白不发 | `ChatComposer` 全有（`ChatComposer.tsx:42-64`，注释 `:13-14`） | **有** |
| 发送/停止：`prompting` 流式 Stop（`AgentComposer.tsx:399-407`，`aria-label=停止`）+ `onCancel` | 包 `ChatComposer` 只有发送键（无 `prompting`）；`useChatActions.cancel()` 有（`use-chat-session.ts:57-63`）但 `ChatPanel` 未渲染停止位（`:169` 只传 `onSend`） | **缺（动作有，UI 无）** |
| 附件：拖入/粘贴/工作区路径校验/8MB/`base64/fileUri`/`PromptInputAttachments` 桥（`AgentComposer.tsx:109-311,364-372`，`lib/agent/acp-composer`） | 包无附件态；`useChatActions.sendText(text: string)` 只收文本（`:45-55`），`ChatComposerProps.onSend(text)`（`ChatComposer.tsx:4`）；store 层虽支持 `attachments`（`store.ts:232`）但动作层丢弃 | **缺（最大 gap 之一）** |
| 粘贴图片 `extractClipboardImage` + `savePastedImage` 回退 | 包无 | **缺** |
| `promptCapabilities / workspaceRoot / disabled` 三元语义（占位文/工作区外拦截） | 包 `ChatComposer` 只有 `disabled/placeholder`；`ChatPanel` 未传 workspace/capabilities | **缺** |
| 输入框右键菜单 `AgentContextMenu(textareaRef)`（剪切/粘贴/全选） | 包无 | **缺** |
| 配置菜单：`primary/secondary/fastToggle` + `CompactConfigMenu` + 底部设置 Dropdown（含代理/工作区/认证入口，`AgentPanel.tsx:626-872`） | 包只有顶部原生双 `<select>`（runtime + thinking，`ChatPanel.tsx:102-131`）；`thoughtOptions` 缺省不渲染 | **缺（大）** |
| 模型思考档完整链路：`selectModelThinkingControl/selectSuffixFastState/listed 门槛 + dash 候补 + setModel + 单 toast`（`AgentPanel.tsx:298-365`） | 包 `setThinking(level)` 只写 `modelConfig.thinkingLevel`（`use-chat-session.ts:73-75` → `store.ts:352-356`），不下发 Agent；包 `config/acp-model-thinking.ts` 逻辑已整搬但 `ChatPanel` 未用 | **缺（逻辑已搬，UI/下发未接）** |
| 快捷动作（跨章引证/全篇探针/续读脉络经 `sendPrompt` 真调 MCP） | 包无 | **缺（宿主 stairs 特性，包不应收编；切流时宿主保留）** |

### 1.3 会话管理（新对话/清空/历史线程/运行时切换/认证/横幅）与阅读器快照宿主挂载位

| 宿主能力 | 包侧对等 | 结论 |
|---|---|---|
| 新线程 `createThread(workspaceRoot)` + `syncAgentSessionToActiveThread`（`AgentPanel.tsx:519-522`） | `store.newThread(runtimeId?)` 有（`store.ts:206-220`，含 freeze + 40 上限），但无 workspace 绑定/无 session resume | **部分有** |
| 清空 `clearMessages`（含 `resetTurnContextTracker + resetRenderHintRefresh`，`useAcpSession.ts:705-709`） | 包无 `clearMessages`（store/types/actions 均无） | **缺** |
| 历史线程 `AgentHistoryMenu` + `switchWorkspace/activeThreadAgentSessionId/resume/load`（`useAcpSession.ts:470-632`） | 包 `switchThread(id)` 仅内存切换（`store.ts:222-230`）；`ChatThread` 被刻意剥掉 `workspaceRoot/agentSessionIds/createdAt/scroll`（`types.ts:11-23` 注释） | **缺（设计如此：包只做 feed，会话亲和留宿主）** |
| 运行时切换 `switchRuntime`（断开→重连→epoch 防线→resume，`useAcpSession.ts:392-454`；顶部+底部双切换器 `AgentPanel.tsx:392-446,642-657`） | `selectRuntime` 只写 `modelConfig.runtimeId`（`store.ts:346-350`），注释明示“线程亲和由应用侧管理” | **缺（需宿主 transport 层实现真切换）** |
| 认证 `AgentAuthDialog/AgentProviderDialog/authPreflight/getProvider` + Codex 专属分支（`AgentPanel.tsx:211-253,370-372,889-916`） | 包无 auth state/UI | **缺（宿主 stays）** |
| 横幅 `AgentBunInstallBanner/AgentAgyInstallBanner/statusError` + 无工作区横幅（`AgentPanel.tsx:546-550,875-884`） | 包无 | **缺（宿主 stays）** |
| 连接状态机 `connect/disconnect/epoch/sync`（`useAcpSession.ts:269-592`） | 包 `setConnectionStatus` 仅 disconnected/error 清 pending（`store.ts:332-338`）；无 connecting/awaiting_auth/needs_auth | **缺（大；包只做纯态子集）** |
| `useAcpPermissionIngest` / `useMontreeSnapshotHost` / `useAcpStreamHost` 挂 `App.tsx:139-140` 根 | 与 `ChatPanel` 无关；包 README 门禁禁 electron/`@/`（`README.md:28-29`），包不应收编 | **stays：挂载位不动，切流不碰** |
| `DockedAgentPane` 宽度拖拽（280~640 持久化）/ `FloatingAIHud` 四 Tab（对话/卡片/摘要/大纲）+ 胶囊/悬浮/停靠三态 | 包声明“壳级布局由应用自备”（`ChatPanel.tsx:64-66`） | **stays：壳留宿主，包只给芯** |

### 1.4 turn-context / 工作区绑定 / 批注对话等阅读器专属接线

| 宿主能力 | 包侧对等 | 结论 |
|---|---|---|
| `sendPrompt` 前缀 `buildMontreePromptPrefix(includeBootstrap/sessionPromptMode)` + `shouldSendSessionBootstrap/markSessionBootstrapSent`（`useAcpSession.ts:663-674`） | 包 `transport.sendText(threadId, text)` 无 prefix 参数（`types.ts:73-77`）；`useChatActions.sendText` 直接 `appendUser+beginReply+transport.sendText`（`:45-55`） | **缺（需宿主在 transport 注入层补前缀，包不改接口或经 opts 扩展）** |
| turn-context 追踪 `should-attach-turn-context / render-hint-refresh / collect-turn-context`（阅读器正文/批注上下文） | 包无 | **缺（stays 宿主；切流时 transport 适配层负责）** |
| 工作区绑定 `workspaceRoot/cwd/switchWorkspace/isSameWorkspace` + 离线沙箱语义（`useAcpSession.ts:595-632`） | 包 `ChatThread` 无 `workspaceRoot`（`types.ts:11-23`）；`ChatPanel` 无 workspace prop | **缺（stays 宿主）** |
| 批注对话 `useAnnotationAgentAssist`（独立 session/独立 store/与主时间线隔离，`useAnnotationAgentAssist.ts:52-55`） | 包无 | **stays：与 ChatPanel 并行存在，不切入包** |
| 子会话信令（制卡/测验/目录 `connectRequestedAt/runtimeSwitchRequestedAt/acp-subsession/card-studio/toc-ai-session`） | 包无 | **stays 宿主** |
| `ToolBusinessResult` 生成式提交回环（`deriveTocProposals`/`collectRfcHits` 在 `FloatingAIHud`） | 包 `ChatMessageBubble` 有 `onGenerativeSubmit` 槽但 `ChatPanel` 未接（见 1.1） | **缺（宿主 stays + 包缺接线）** |

### 1.5 测试引用核对（测试文件零改动 → 有引用者一律 stays）

> 证据为 `grep --include=*.test.ts`（生产引用为 `grep -v .test.ts` 交叉验证）。

| 候选模块 | 测试引用（→ stays） | 生产引用 | 裁决 |
|---|---|---|---|
| `components/agent/AgentPanel.tsx` | 无直接 `import AgentPanel` 的 `.test.ts`，但被有测试的 `DockedAgentPane/FloatingAIHud` 挂载；`AgentMessageList/AgentComposer` 测试覆盖其子树 | `DockedAgentPane` / `FloatingAIHud` / `WorkspaceShell` / `FoliateReaderViewer` / `PdfViewer` / `WebDocViewer` | **stays**（只允许内部换线） |
| `DockedAgentPane.tsx` | `DockedAgentPane.test.ts:5` 直接 import | 3 阅读器 viewers | **stays** |
| `FloatingAIHud.tsx` | `FloatingAIHud.test.ts:5`（`collectRfcHits/deriveTocProposals`） | `WorkspaceShell` | **stays** |
| `AgentComposer.tsx` | `AgentComposer.test.ts:5` 直接 import | `AgentPanel` | **stays** |
| `chat/AgentMessageList.tsx` | `AgentMessageList.test.ts:5` 直接 import | `AgentPanel` | **stays** |
| `chat/AgentContextMenu.tsx` | 无直接 import 的 `.test.ts`，但被 `AgentComposer.tsx:30` + `AgentMessageList.tsx:37` 生产引用（两者皆有测试） | `AgentComposer` / `AgentMessageList` | **stays**（间接测试覆盖，动即破键鼠/引用用例风险） |
| `chat/AgentActivityGroup.tsx` | `AgentWorkLog.test.ts:6` 直接 import | `AgentMessageList` | **stays** |
| `tools/ToolBusinessResult.tsx` | `ToolBusinessResult.test.ts:2` + `ToolBusinessResultPresent.test.ts:6` + `AgentWorkLog.test.ts:8` | `AgentActivityGroup` / `AgentMessageList`（经 `renderBusinessResult` 槽） | **stays** |
| `tools/AgentPlanCard.tsx` | 无直接 import，但被有测试的 `AgentActivityGroup.tsx:16` 生产引用 | `AgentActivityGroup` / `AgentMessageList`（经 `renderPlanCard` 槽） | **stays** |
| `stores/acp-ui-store` + `hooks/agent/useAcpSession` | `acp-ui-store.test.ts` / `acp-thread-runtime-bind.test.ts` / `acp-stream-host.test.ts` / `acp-workspace-integration.test.ts`（后者同时引 `useAcpSession`）等 | ~20+ 生产引用（面板/hook/lib/阅读器） | **stays** |
| `lib/agent/acp-composer` / `context/collect-turn-context` 等 | 各自 `*.test.ts`（`acp-composer.test.ts` / `collect-turn-context.test.ts` 等） | `AgentComposer` / `useAcpSession` | **stays** |
| `AgentHistoryMenu / AgentHeaderOverflowMenu / CompactConfigMenu / AgentAuthDialog / AgentProviderDialog / Banners` | `AgentHeaderOverflowMenu.test.ts` / `AgentAgyInstallBanner.test.ts` 等存在；无测试者也被 `AgentPanel` 生产引用 | `AgentPanel` | **stays** |
| `DiagramModal` | `DiagramModal.test.ts:5` | `WorkspaceShell.tsx:363` | **stays**（与切流无关，不动） |
| `AgentMark` | 无直接 `.test.ts`，但被 `AgentPanel.tsx:11` + `AgentMessageList.tsx:36` 生产引用 | 同左 | **stays** |

## 2. gap 清单（切流前必须补齐或明确留宿主）

- **G1 富结果槽未接**：`ChatPanel` 未传 `renderBusinessResult/renderPlanCard` → 富业务卡/`AgentPlanCard` 不渲染。包件能力已就绪，差一行接线。
- **G2 生成式提交未接**：`onGenerativeSubmit` 未透出；宿主归属校验（`isStaleGenerativeSubmit` + busy 守卫）无包侧对等。
- **G3 章节计划半接**：仅定位回调；`selectChapterMarkPlan` 落库 + `sendPrompt` 回环缺。
- **G4 提议善后缺**：`onDismissProposedMark/onRecoverChapter/onPromptSelectText/navFlatIndex` 未传；`onResolveMarkProposal` 缺省空函数（切流必传真实写库实现，否则采用/忽略只落本地态）。
- **G5 内联 present 缺**：`inlinePresentSlots/suppressPresentResult/runStatus` 未算（`planInlinePresent/splitInlinePresent` 链路缺）。
- **G6 编辑回填/引用缺**：`onEditMessage/onQuote` + `AgentContextMenu` 无包侧对等。
- **G7 工作日志降级**：包 `details/summary` vs 宿主 `AgentActivityGroup`（进度/耗时/错误态）。
- **G8 历史分页/滚动快照缺**：`sliceChatWindow + chatScrollByThread + ThreadPrimitive` 全缺；长会话切过去即退化为全量渲染。
- **G9 输入框附件全缺**：`sendText(text)` 单文本；附件态/粘贴/拖入/8MB/工作区校验/`messageAttachments` 全缺（store 层支持，动作/UI 层断）。
- **G10 发送/停止缺**：`cancel` 有动作无 UI（无 Stop 位、无 `prompting` 透传）。
- **G11 配置/思考档大缺**：包双原生 select vs 宿主 listed+dash+`setModel`+偏好落盘+单 toast 全链路。
- **G12 会话管理缺**：`clearMessages/HistoryMenu/switchWorkspace/resume/auth/banners/连接状态机` 全留宿主；包 `selectRuntime` 只是写配置。
- **G13 turn-context/前缀缺**：`transport.sendText` 无 `buildMontreePromptPrefix` 注入位；需宿主适配层补。
- **G14 空态/loading/系统消息缺**：包无空态（`authHint`）、无 `AgentLoadingState`、系统消息无入口。

## 3. 分阶段切流计划（每阶段只动内部实现，测试文件零改动）

> 验收通用门：`bun run test` 全绿 + `bun run test:e2e`（需先 build）通过；任一阶段只改非测试源码 + 本文档，测试文件零改动。

- **P0 适配层（不碰 AgentPanel 渲染树）**：宿主实现 `ChatTransportPort`（`sendText/cancel/respondPermission` 委托现有 `useAcpSession/acpApi`），在 `sendText` 内补 `buildMontreePromptPrefix + turn-context` 前缀；`ChatStoragePort` 委托现有 persist（若格式不一致则做单向迁移，旧键只读）。`ChatPanel` 仅在 Storybook/隐藏路由挂载对照。验收：既有测试全绿；对照页能发一句收到回流（transport 打通）。
- **P1 只读并跑（AgentPanel 内嵌包芯对照）**：`AgentPanel` 内部某折叠区/调试 Tab 挂 `ChatPanel(store=桥接store, runtimes=BUILTIN_ACP_RUNTIMES, theme)`，只读渲染；`onResolveMarkProposal` 传真实写库实现（与 `AgentMessageList` 同一 selector）。验收：对照区与主列表同内容；测试全绿。
- **P2 接线补齐（包侧加 prop/槽，宿主只换内部实现）**：按 G1→G6 顺序在包加可选 props（`renderBusinessResult/renderPlanCard/onGenerativeSubmit/onEditMessage/onQuote-ish/renderActivityGroup` 槽 + `prompting/onCancel/attachments` 输入扩展 + `onClearMessages/onNewThread` 会话槽），`ChatPanel` 内部换线；宿主 `AgentMessageList/AgentComposer` 内部改调包件（文件本身 stays）。验收：`AgentMessageList.test / AgentComposer.test / AgentWorkLog.test` 全绿 + E2E。
- **P3 会话/配置下沉（transport 真实现）**：`selectRuntime/switchRuntime` 真切换、`setModel` 下发、`clearMessages`（含 turn-context 重置）经 transport/store 落定；认证/横幅/快照宿主保持 App 根挂载不动。验收：切换运行时/清空/重连 E2E 通过；测试全绿。
- **P4 壳收敛（最后才动挂载点）**：`DockedAgentPane/FloatingAIHud/WorkspaceShell/三 viewers` 的 `AgentPanel` 挂载点逐个切为“壳（stays）+ 芯（ChatPanel）”；`AgentPanel.tsx` 本体瘦身为壳（头部/横幅/菜单留宿主，列表+输入委托包）。每步单点切换、可回滚。验收：全测试 + E2E；`FloatingAIHud.test / DockedAgentPane.test` 全绿。
- **P5 清理（另议，不在本轮）**：仅当某宿主模块零测试引用 + 零生产引用（双 grep 证据）时方可删除；本次审计无此候选（见 §4），故 P5 为空。

## 4. 真死码删除候选

**结论：无。本轮零删除。**

- 全部六个点名模块（`AgentPanel/DockedAgentPane/FloatingAIHud/AgentComposer/AgentMessageList/AgentContextMenu`）均有直接或间接测试引用（§1.5 表格）和生产引用，全部标 `stays`。
- `AgentActivityGroup/ToolBusinessResult/AgentPlanCard/acp-ui-store/useAcpSession/turn-context/*` 同理皆有测试引用。
- `DiagramModal/AgentMark/CompactConfigMenu/HistoryMenu` 经生产引用（`WorkspaceShell/AgentPanel/AgentMessageList`）与/或测试引用覆盖，亦 stays。
- 若后续出现候选，必须同时满足：`grep --include=*.test.ts <模块名> apps/desktop/src packages/*` 零命中 **且** `grep -v .test.ts` 生产引用零命中，凭双 grep 证据方可建删除项。

## 5. 风险点

- **附件链路断裂风险最高**：包动作层签名 `sendText(threadId, text)` 若不扩展，切流即丢附件；必须在 P2 前定 `attachments/messageAttachments` 透传方案（store 已支持，动作/UI 未支持）。
- **`onResolveMarkProposal` 缺省空函数是静默降级**：忘传则提议决议不写库；切流 checklist 必须把“传真实写库实现”列为阻塞项（包 README 已警示）。
- **运行时切换语义偷换**：包 `selectRuntime` 只是写配置，宿主是断开重连；直接替换即假切换不断连。必须走 P3 transport 真实现。
- **历史分页性能回退**：包全量渲染长会话；P4 前必须补 `sliceChatWindow` 或明确长会话不切。
- **认证/横幅/快照宿主不可入包**：包门禁禁 electron/`@/`；强行入包即破 `lint:deps`。永远留宿主。
- **测试零改动约束下重构半径受限**：所有 stays 模块只能内部换线；任何 prop 改名/删除都可能破 `*.test.ts`，需先跑单文件用例再合。
