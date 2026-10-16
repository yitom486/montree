# Chat Feed 设计输入（ACP 事件 → ChatMessage 归约器用，全只读测绘）

> 来源：`chat-render-init` 工作树现状代码逐文件实测，非推测。
> 目标：E1 把"ACP 事件流 → ChatMessage append/patch/收尾冻结"抽成 core 纯 reducer 时的行为契约。
> 约定：`ChatMessage` 即 `@montree/chat-core` 的 `ChatMessage`
>（宿主别名 `AcpChatMessage`，见 `apps/desktop/src/stores/acp-chat-types.ts:1-20`）。

## 1. 事件源表（事件名 / 来源 / 载荷要点 / 宿主处理）

| # | 事件名（`sessionUpdate` 字面量） | 来源通道 | 载荷要点 | 宿主处理（现状位置） |
|---|---|---|---|---|
| 1 | `agent_message_chunk` | `acpApi.onSessionUpdate` → `acp-stream-host.ts:88-132` | `content`: string \| `{type:'text',text}` \| `[{type:'text',text}]`；只有纯文本块才可合并 | 可合并时进 `StreamCoalescer`（32ms 批量，`stream-coalescer.ts:2-22`），定时 `flushAcpStreamBuffer` 以 `agent_message_chunk` 回放进 store（`acp-stream-host.ts:43-57`）；不可合并（非文本块）走直达分支 |
| 2 | `agent_thought_chunk` | 同上 | 同上结构，`extractTextFromContent` 取 `text/delta/content` 嵌套（`chat-message.ts:69-82`） | 不进合并器；`flush` 后直达 `applySessionUpdate` → role=`thought` 分支（`chat-slice.ts:691-696`） |
| 3 | `user_message_chunk` | 同上（cursor load 回放把发过内容重播为 user chunk） | 同上 | 同上直达；但先过回放清洗 `consumeReplayUserChunk`（`chat-slice.ts:140-157,700-727`），三 outcome：append / defer（悬垂缓存） / drop（洗空丢弃） |
| 4 | `tool_call` / `tool_call_update` | 同上 | `toolCallId \| tool_call_id`（双拼兼容），`title/kind/status/content/rawOutput/locations` | `applyToolCallUpdate` 按 `toolCallId` 原位 patch 或新建（`chat-helpers.ts:240-311`）；`content` 走 `toolUpdateContentText`（display 优先 → rawOutput.result MCP 兜底，`chat-message.ts:102-120`），`content[]` 中 `type:'diff'` 另解析 `toolDiffs`，`locations[]` 解析 `toolLocations` |
| 5 | `tool_call_content_chunk` | 同上 | `toolCallId` + `content`（单块或数组，`flattenToolContent` 压平，diff 块压成 `path (~a→~b 行)` 摘要） | 追加语义：无此 id 则新建 `in_progress/streaming` 工具消息；有则 `toolContentText+text` 纯拼接（`chat-slice.ts:627-679`）；空文本直接丢弃；无 id 直接丢弃 |
| 6 | `plan` / `plan_update` | 同上 | `parseAcpPlanEntries(update)` entries 数组 | 全线程单例 role=`plan` 消息：`findIndex(role==='plan')` 复用 id，否则新建；`streaming = summary.active`；空 `plan_update` 视为清空卡片（`chat-slice.ts:543-575`） |
| 7 | `montree_settle_complete`（非 ACP 原生，主→渲染经同一 update 通道透传，`contracts/.../acp.ts:76`） | `onSessionUpdate` 快捷分支 + `applySessionUpdate` 内分支 | 无载荷（标记） | 宿主层：先 `flushAcpStreamBuffer` 再 `freezeSettledStreaming` 直接返回，不进分流/合并器（`acp-stream-host.ts:91-97`）；store 层：先把回放悬垂落定再冻结，不碰 `prompting`（`chat-slice.ts:522-537`） |
| 8 | `config_option_update` / `config_options_update` | 同上 | 模型/选项 | 聊天归约器直接忽略（`chat-slice.ts:539-541`），走 session-slice |
| 9 | `request_permission`（独立 IPC，非 session/update） | `acpApi.onPermissionRequest` → `useAcpPermissionIngest.ts:20-43` | `{requestId, sessionId, toolCall?, options[], summary?}`；`toolCallId` 取 `toolCallId/tool_call_id/id` 三兼容（`acp-permission.ts:71-79`）；options 兼容 `optionId/id`、`name/title`（`acp-permission.ts:9-32`） | `ingestPermissionRequest`：置 `pendingPermission` 单例 + 用内嵌 toolCall 合成一条 `tool_call` update 回放进 `applySessionUpdate`，保证审批卡能挂上工具气泡（`permission-slice.ts:34-52`） |
| 10 | `statusChanged`: `connected/connecting/awaiting_auth/disconnected/error` | `acpApi.onStatusChanged` 双订阅（stream-host + permission-ingest） | `{status, sessionId?, errorMessage?}` | `disconnected`：`setSession(null)` + flush + `finishStreaming` + 逐实例 `resetAuthUi` + 批注会话标 stale（`acp-stream-host.ts:74-87`）；`disconnected/error` 清 `pendingPermission`（`useAcpPermissionIngest.ts:45-51`，`session-slice.ts:135-146`） |
| 11 | 本地动作（非远端事件，但同写 messages，归约器必须建模为输入） | store 调用方 | — | `appendUserMessage`（清 snapshot+悬垂）、`appendSystemMessage`、`beginAgentReply`（空 agent 占位，新回合清 `turnSettled`）、`clearMessages`、`cancelActiveTools`、`attachMarkProposalsFromSnapshot`、`resolveMarkProposal`、`selectChapterMarkPlan`、`create/switch/delete/renameThread` |

未知 `sessionUpdate` 种类：落到通用文本分支（`chat-slice.ts:681-689`）——有文本按 agent 处理，无文本且非三 chunk 直接 return 丢弃。
`availableCommandsUpdate/currentModeUpdate` 等若出现且无文本，同样被丢弃（无分支即无消息变更）。

## 2. 消息生命周期与状态机

```
created（push/占位） → streaming=true（增量 append/合并）
  → updated（patch：tool 字段/enrich 挂载）
  → finalized（streaming=false，仍可发生：turnEnded 迟到内容合入、resolve/select 状态流转）
  → pruned（仅冻结时：中间 agent 气泡压缩；MAX 300 裁剪）
```

- 新建：
  - `beginAgentReply`：尾部已有 `role=agent && streaming` 则复用，否则 push 空文本 `agent/streaming` 占位；同时 `turnSettled=false`（`chat-slice.ts:241-264`）。
  - 文本分支：尾部同 role 且 streaming 则 `text += chunk`；否则若 role=agent 且存在空 agent 占位则填占位；否则 push 新消息，`streaming = !turnSettled`（冻结后迟到 chunk 照合正文但不点亮，`chat-slice.ts:729-776`）。thought 若有空 agent 占位则插到占位之前（`769-770`）。
  - 工具分支：`applyToolCallUpdate` 按 `toolCallId` 查找；命中则原位 patch（保留 `id/createdAt/markProposal*`），未命中则插到空 agent 占位之前，否则 push（`chat-helpers.ts:302-309`）。无 `toolCallId` 直接 no-op。
  - plan 分支：全线程只此一条，复用 id（`chat-slice.ts:552-570`）。
- `streaming` 点亮规则：
  - agent/thought/user 新消息：`streaming = !turnSettled`（回放重建时 `turnSettled=false` 不受影响）。
  - 工具 `applyToolCallUpdate`：`streaming = isToolActiveStatus(status)`（`pending/in_progress/缺省` 为 active，`chat-message.ts:178-180`）。
  - 工具 chunk 追加：`streaming = turnEnded ? false : isToolActiveStatus(prev.toolStatus)`（迟到内容不重亮，`chat-slice.ts:663`）。
  - plan：`streaming = summary.active`。
- `turnEnded` 打标：仅 `freezeSettledTurn` 对"收尾时仍 active 的 tool"打 `turnEnded:true`（`chat-slice.ts:103-113`）；agent/thought/user/plan 从不打。
- `updatedAt`：每次 append/patch/冻结都刷新为 `Date.now()`；`createdAt` 一旦生成永不改（tool patch 沿用 `prev.createdAt`）。

## 3. 收尾冻结规则（逐条，`freezeSettledTurn` + 调用点）

冻结函数：`chat-slice.ts:101-122`。调用点四类：

1. `finishStreaming`（prompt 回合正常收尾）：`prompting=false; turnSettled=true; patchActiveThread(freezeSettledTurn)`（`279-284`）。
2. `freezeSettledStreaming`（load 定居收尾）：同冻结语义，**不碰 `prompting`，不碰 `turnSettled`**（`288` + `acp-types.ts:151-156` 注释）。prompt 回合禁止走这条。
3. `disconnected`（`acp-stream-host.ts:78-86`）：先 flush 再 `finishStreaming`（即带 `prompting=false + turnSettled=true` 的冻结）。
4. `createThread/switchThread/switchWorkspace` 切走旧线程：轻量 `freezeMessages`（仅 `streaming=false` + blob URL 脱钩 + 尾部 300 裁剪，**不做** enrich/promote/prune，不打 `turnEnded`，不改 toolStatus，`chat-helpers.ts:78-91`）。

冻结体内逐条（`freezeSettledTurn`）：

- F1：非 streaming 消息原样保留（同一引用返回）。
- F2：`role=tool && isToolActiveStatus(toolStatus)` 的 streaming 消息：`streaming=false, updatedAt=now`；`toolStatus==='pending'` → 改写 `'cancelled'`；`in_progress`/未知状态**保留原值**，另打 `turnEnded:true`（内容落定可解析，结果未知，展示层标"状态未知"，绝不补 `completed`）。
- F3：其余 streaming 消息（agent/thought/user/plan）：仅 `streaming=false, updatedAt=now`。
- F4：随后 `finalizeThreadMessages(pruneIntermediateAgentReplies(frozen))`——顺序先行：先全员落定，再压缩中间 agent 气泡（自最后 user 起只保留最后一条非空 agent；空 agent 全删；thought/tool/plan 全保留，`acp-prune-agent-replies.ts:8-37`），再 `tool enrich → markProposal promote → chapterPlan promote`（`chat-helpers.ts:48-54`）。
- F5：`cancelActiveTools` 是独立显式动作（用户/服务端确认取消）：仅把 `streaming && active` 的 tool 置 `cancelled`（不碰 `streaming` 标志本身，留给随后冻结收敛，`chat-slice.ts:290-304`）。
- F6：冻结后迟到 chunk：agent 文本照常 `+=` 但 `streaming` 保持 false（`streaming:!turnSettled` 新建规则）；tool chunk 内容照常拼接但不重亮（F2 的 `turnEnded` 分支）；解析经 `turnEnded` 放行（见 §4）。

## 4. enrich 触发点（对消息形状的假设）

`enrichAcpToolMessage = markProposal ∘ chapterPlan ∘ presentResult`（`enrich-tool-message.ts:8-15`），三 enrich 同形门限：

- `(streaming || isToolActiveStatus(toolStatus)) && turnEnded!==true` → **跳过**（半截 JSON 不解析；`parse-mark-proposal.ts:145`，`parse-chapter-mark-plan.ts:75-76`，`parse-present-result.ts:36-38`）。
- 已挂载字段不再重复解析（`markProposal/markProposals`、`chapterMarkPlan`、`presentResult` 存在即 identity 返回）。
- 解析失败保持原样（不吞消息；present 要求文本含 `chapter-comparison/html-artifact/component-ui/react-artifact` 任一关键字才尝试 `parsePresentResult`）。
- id 派生：`tool:<toolCallId>[:<index>]`（单/批，`parse-mark-proposal.ts:81,101`）；章计划同式（`parse-chapter-mark-plan.ts:56`）。

触发点（何时调用）：

- E1：每次 `tool_call/tool_call_update` 经 `applyToolCallUpdate` 末尾立即 enrich 一次（`chat-helpers.ts:300`）——但门限决定 streaming 期间基本是 no-op。
- E2：`tool_call/tool_call_content_chunk/tool_call_update` 分支收尾时：若存在 streaming agent 则**延迟**（直接存裸消息）；若无 streaming agent 则立即 `finalizeThreadMessages`（即 enrich+promote，`chat-slice.ts:601-610,668-675`）。
- E3：所有冻结路径（`freezeSettledTurn` → `finalizeThreadMessages`）必 enrich 一次；此时 `streaming=false`，`turnEnded` 工具也被放行解析。
- E4：`attachMarkProposalsFromSnapshot`（MCP 快照旁路，见 §5）：同 E2 的延迟/立即二选一（`chat-slice.ts:314-322`）。
- E5：恢复旁路 `recoverPresentToolMessages`：只补 `completed && !presentResult && toolCallId` 且内容缺失/过大的工具消息，不新增消息（`parse-present-result.ts:9-24`）。
- promote（冻结/finalize 内）：提议/章计划从 tool 搬挂到最后一条落定 agent 下（`mark-promotion.ts`、`chapter-mark-plans.ts:39-69`，按 id 合并去重 `mergeChapterPlans`）；timeline 对"已 promote 的 tool 提议"不再单条展示（`chat-timeline.ts:124-136`）。

enrich 对归约器的形状要求：`toolTitle/toolContentText/text/toolCallId/toolStatus/streaming/turnEnded` 必须在 enrich **之前**就位；`markProposalStatus` 缺省 `pending`；enrich 必须幂等且只增字段。

## 5. 审批流（pending 结构与 tool 卡联动）

- 结构 `AcpPendingPermission {requestId, sessionId?, toolCallId?, summary, options[], toolCall?}`（`acp-types.ts:21-28`）；单例存放（同时刻只记一个，后到覆盖先到，`permission-slice.ts:34-35`）。
- ingest 双写：`set({pendingPermission})` + 若带 toolCall 则合成 `tool_call` update（title/kind/status/content/locations 透传，缺省 `kind:'other'/status:'pending'`）走 `applySessionUpdate`，保证时间线里先有对应 tool 气泡（`permission-slice.ts:36-52`）。
- 渲染联动：`groupChatTimeline({pendingToolCallId})` 命中 tool 提升为单条，不被 work-log 折叠吞掉审批按钮（`chat-timeline.ts:116-122,232-234`）；`isRichToolMessage/failed/未去重提议` 同属单条提升（`110-139`）。
- 清除：`clearPendingPermission(requestId?)` 带 requestId 守卫（id 不对则保留，`permission-slice.ts:22-32`）；`disconnected/error` 自动清；`create/switchThread/switchWorkspace/setSelectedRuntime` 清；响应路径（`permission-respond.ts` + Bubble `onPermissionRespond/onResolveProposal`）由宿主 adapter 负责，归约器只保证"清指定 id"语义。

快照旁路（同属审批/提议链）：MCP 结果不回传 session/update 时由快照直接补：`pendingMarkProposalSnapshotContents` 队列（`attachMarkProposalsFromSnapshot` 收，`attachPendingMarkProposals` 按序消费，`remaining` 只保留最后 3 条，`chat-slice.ts:306-331`）；匹配规则为"本 user 回合内倒序第一个无提议的 propose-title tool"（`chat-helpers.ts:163-219`，标题正则 `montree_propose_note/create_note/propose_mark/.../提议批注`）。

## 6. 排序 / 去重 / 重放假设

`acp-transport.ts` 的 `ensureAcpTransport` 只管**连接就绪等待**（connected/auth-required/unavailable 轮询机），不提供任何消息级序号/去重/重排序保证。归约器能依赖的全部顺序保证来自宿主 + store 的到达序约定：

- O1（无序号）：传输层无 seq/ack；归约器输入即事件到达序，不得假设因果序（prompt 结果可先于文本通知到达，即 `turnSettled` 竞态注释所指）。
- O2（合并器保序）：仅 `agent_message_chunk` 纯文本块进 `StreamCoalescer`（字符串拼接保序）；thought/user/tool/plan/非文本块永不进合并器。任何非可合并事件到达前先 `flushAcpStreamBuffer`，保证"文本在前、结构事件在后"的交错位置正确（`acp-stream-host.ts:124-131`）；`send/cancel/disconnect/settle/stop` 前同样先 flush，尾部 chunk 不丢失不错序。
- O3（单订阅）：`startAcpStreamHost` 进程内单例幂等，订阅与组件挂载脱钩，同一 chunk 不进两遍合并器（`acp-stream-host.ts:9-19,69-71`）。
- O4（会话隔离即过滤器）：`annotation副会话 → capturing短窗口 → subsessionOwnsSessionId/isSubsessionPrompting → 主会话id比对` 四层分流；带具体 sessionId 却非当前主会话的事件**丢弃**（`acp-stream-host.ts:98-122`）；线程↔运行时错位由 `patchActiveThread→ensureActiveThreadForRuntime` 纠偏，绝不把异 runtime 消息写入当前 thread（`chat-helpers.ts:136-154`）。
- O5（零去重）：全链路无内容去重——文本 chunk 无条件 `+=`，tool chunk 无条件拼接，timeline 注释明示"不改消息顺序、不去重、不合并文本"（`chat-timeline.ts:16`）。重复投递即重复拼接，调用方保证幂等（单订阅）而非归约器去重。
- O6（回放清洗只针对 user-chunk）：`prompting===true` 且无脚手架标记的 user chunk 原样通过；否则 `stripReplayScaffolding`，悬垂（未闭合 opening 结尾）则 defer 缓存等下一 chunk，洗空则 drop；有同线程悬垂时非 user chunk 先落定悬垂以保到达顺序；本地 `appendUserMessage` 永不清洗；`montree_settle_complete`/切线程/清空时落定或丢弃悬垂（`chat-slice.ts:126-180,700-727`）。
- O7（定居窗口）：load 回放期间 `hasLocalHistory=false` 的线程仅监视不限流，由回放重建时间线；有实质消息（任一非 system）则压制回放（`acp-types.ts:196-223`，`chat-helpers.ts:72-76`）。
- O8（容量）：`freezeMessages` 尾部保留 `MAX_MESSAGES_PER_THREAD=300`；线程数上限 40（`acp-types.ts:18-19`）；裁剪只发生在冻结/切换路径，流式中不裁。

## 7. 归约器必须保持的不变量（验收标准）

1. **Key 稳定**：消息 `id` 一旦分配永不改变、不复用；tool 身份键是 `toolCallId`（一 id 一消息，原位 patch）；timeline key 规则 `msg:<id>` / `work-log:<turnKey>` 不随尾部追加改变（`chat-timeline.ts:20-31,212-241`）。
2. **不合并文本、不去重、不重排**：只允许"尾部同 role streaming 消息 `text += chunk`"与"同 toolCallId 内容拼接"；永不跨 role/跨回合拼接，永不按内容去重，永不调整数组顺序（timeline 纯分组只读，输出引用+派生摘要）。
3. **streaming 只减不增（除新回合）**：除 `beginAgentReply`/新消息创建外，任何 update 不得把 `false` 翻回 `true`；冻结 path 全员 `streaming=false`；`turnEnded` 工具与 `turnSettled` 后的迟到 chunk 永不重亮。
4. **不推断工具执行结果**：冻结只允许 `pending→cancelled`；`in_progress`/未知保留原值 + `turnEnded:true`，展示层标"状态未知"；`cancelActiveTools` 与冻结语义正交（前者改 status，后者收 streaming）。
5. **enrich 纯 additive 且幂等**：只增 `markProposal/markProposals/chapterMarkPlan/presentResult`，门限（streaming/active/turnEnded）与失败-identity 语义原样保留；重复调用结果不变。
6. **审批单例 + requestId 守卫**：`pendingPermission` 同刻至多一个；`clearPendingPermission(id)` 仅当 id 匹配（或无参）才清；ingest 必须同时保证时间线里存在对应 tool 消息。
7. **回放清洗不碰用户原文**：仅 `sessionUpdate` 的 user-chunk 进清洗；`appendUserMessage` 直写；defer 缓存按线程 id 隔离，到达序落定。
8. **会话/线程隔离**：非本线程-runtime 的事件永不写入当前 messages；`patchActiveThread` 错位纠偏优先于写入；切换/新建线程先轻冻旧线程（`freezeMessages`，不打 `turnEnded`/不改 status）再切 active。

## 8. 附：文件→职责速查

- `lib/agent/acp-stream-host.ts`：单例订阅、分流四层、合并器调度、settle 快捷、断开收尾。
- `lib/agent/stream-coalescer.ts`：可合并判定（仅 agent 文本块）+ 拼接缓冲。
- `stores/acp/chat-slice.ts`：归约器本体（`applySessionUpdate` 全分支 + 冻结 + 回放清洗 + snapshot 队列）。
- `stores/acp/chat-helpers.ts`：`newId/createEmptyThread/finalizeThreadMessages/freezeMessages/patchActiveThread/applyToolCallUpdate/attach*MarkProposals`。
- `stores/acp/permission-slice.ts` + `hooks/agent/useAcpPermissionIngest.ts`：审批 ingest/clear。
- `lib/agent/acp-transport.ts`：连接就绪等待（无消息级保证，见 O1）。
- `packages/chat-core/src/enrich-tool-message.ts, parse-mark-proposal.ts, parse-chapter-mark-plan.ts, parse-present-result.ts`：enrich 三件套+门限。
- `packages/chat-core/src/chat-timeline.ts, mark-promotion.ts, chapter-mark-plans.ts`：分组/提升对形状的假设（回合按 user 切分；单条提升五类；work-log 计数整回合、渲染只放可见）。
