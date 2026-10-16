# @montree/chat-session

聊天会话绑定层：让外部 App **对接 acp-client 直接工作**，业务代码只调聊天组件。

## 归属

- `session/`：线程/审批/模型配置状态（S1，纯 TS + React 绑定；Electron/store/API 零依赖，经 ports 注入）。
  - `session/types.ts`：`ChatThread`（id/hostThreadId/runtimeId/title/feed，提炼自宿主 `AcpChatThread`；可选 hostThreadId 随快照持久化关联）/ `ChatPendingPermission`（全抄 `AcpPendingPermission`）/ `ChatModelConfig`（S1 新增纯态，宿主无同名）/ `ChatStoragePort` + `ChatTransportPort`（S1 仅定接口）。
  - `session/store.ts`：`createChatSessionStore({ createId/now/storage/transport })`，全部 feed 变更经 core `applyChatEvent`；`requestPermission` 对应宿主 `ingestPermissionRequest` 纯态部分，`clearPermission(requestId?)` 对齐 requestId 守卫，`setConnectionStatus` 对齐 disconnected/error 清 pending。
    `ensureHostThread(hostThreadId, runtimeId?, activate?)` 复用持久关联，后台补建不改变 active；`reconcileHostThreads(threads, activeHostThreadId)` 在启动/宿主恢复时迁入权威历史（含附件和运行时），替换旧版无关联影子；切线程时模型配置运行时随线程归属同步。
- `ingest/`：acp-client 事件 → core `ChatFeedEvent` 归一化 + 审批 ingest（S1）。
  - `ingest/acp-events.ts`：`mapSessionUpdate`（对齐宿主 `chat-slice.applySessionUpdate` 分支；`montree_settle_complete` 字面量来源 `packages/contracts/src/types/acp.ts`）/ `mapPermissionRequest`（`toolCallId/tool_call_id/id` + `optionId/id` + `name/title` 三双兼容，对照宿主 `acp-permission.ts`）/ `mapConnectionStatus`（五值透传，未知回 disconnected）。
- `config/`：宿主 `lib/agent/acp-config-{preferences,menu}` + `acp-model-thinking` 整搬（字节一致，改名不改义；宿主原文件留单行重导出，测试随搬）。
- `panel/`：`<ChatPanel>`（S2，由 chat-ui 件组装；布局壳应用自备，slots/parts 自定义）。
  - `panel/ChatPanel.tsx`：`createChatSessionStore + <ChatPanel store runtimes>` 三行即工作；props `{ store; theme?; runtimes; thoughtOptions?; className?; onLocateChapter?; onOpenFile?; onResolveMarkProposal?; renderBusinessResult?; renderPlanCard?; onGenerativeSubmit?; onEditMessage? }`；内部 `useChatTimeline` 分组（`message` → `ChatMessageBubble`；`work-log` → 与宿主共享的 `ChatActivityGroup`，包含进度摘要、最新工具行、详情与完成历史折叠；两路都传递线程 ID 与业务/计划/提交回调）→ 审批接 `respondPermission`，仅无内联审批时补唯一兜底卡 → 顶部模型行（runtime `selectRuntime` + thinking `setThinking`，无 `thoughtOptions` 不渲染）→ 底部 `ChatComposer`。
  - `panel/ChatComposer.tsx`：textarea + 发送按钮；Enter 发送、Shift+Enter 换行、IME 组合中不发送；空白不发送。
  - `panel/chat-panel.test.ts` / `session/simulation.test.ts`：输入框 → mock 异步传输 → 原始 ACP → 真实 store → DOM 的多回合、失败重试、取消迟到输出、审批唯一性、恢复续聊与附件回归；工作记录交互另见 `chat-ui/src/ui/chat-activity-group.test.ts`。
  - `session/use-chat-session.ts`：`useChatSessionStore`（`useSyncExternalStore`）/ `useActiveThread` / `useChatActions`（`sendText` 先本地 `appendUser+beginReply` 再 `transport.sendText`，transport 缺省仅本地落子；`cancel/selectModel/setThinking/respondPermission` 直透 store/transport 见函数文档）。
  - 缺省行为：`onResolveMarkProposal` 缺省空函数（提议决议只落本地态、不写库，宿主必须传真实写库实现）；`onOpenFile` 暂不消费（包内渲染件无文件点击位，富结果自定义槽由宿主自备）；transport 缺省时发送/审批仅本地落子且不抛错。
- P3 会话/配置下沉（只加法）：`ChatTransportPort.setModelOption?(configId, value)`（按线程归属调 `acpApi.setConfigOption`，失败 false 不抛；宿主 `lib/agent/chat-transport-port.ts` 对照 `useAcpSession.setModel` 实现）/ `store.clearActiveThread()`（清空 active 线程 messages，线程保留并 emit）/ `<ChatPanel onRuntimeChange?>(runtimeId)`（缺省仅 `selectRuntime`，线程亲和由应用侧管理）。
- 持有/存储（P4c）：宿主经 `apps/desktop/src/lib/agent/chat-session-owner.ts` 正式持有单例（`getOwnedChatSessionStore()`，键 `montree-chat-session/v1`，JSON 快照整体 + 版本校验 + 缺失回落内存）；`ChatStoragePort` 只存线程/active/模型配置（pending 不落盘）。

## 用法（S2）

```tsx
const store = createChatSessionStore({ transport }) // 宿主注入 acp-client 端口
<ChatPanel store={store} runtimes={[{ id: 'codex-acp', name: 'Codex' }]} />
```

## 门禁

- 本包与 `chat-ui` 是 monorepo 内仅有的两个允许 react 的包（`lint:deps` R3 白名单）。
- 仍禁 electron / `node:` / `@/` / `apps/desktop`（R1/R2/R4/R5 无豁免）；`@yitom/acp-client` 只以类型 + 端口形式出现，不直连进程。
