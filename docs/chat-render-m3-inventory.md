# M3 盘点：聊天渲染 30 文件耦合清单（只读）

> 工作树 `chat-render-init`，基线 `master@551be1f`。计划见 `docs/chat-render-extraction-plan.md` §M3。
> 路径注：任务清单里的 `chat/*|tools/*|generative/*|propose/*|permission/*` 实际位于
> `apps/desktop/src/components/agent/chat|tools|generative|propose|permission/`；
> `markdown/*` 位于 `apps/desktop/src/components/markdown/`。下表“文件”用任务简称。
> 图例：`store 读取`只列**运行时**订阅（`type` 单独标）；`api/electron` 列 `@/api` + `window.electronAPI` + `node:`（30 文件均无后两者直接引用）；`裁决`：`pure` 直搬 / `props-ify` 需剪 store 改 props / `stays` 留宿主。

## 总表

| 文件 | store 读取 | api / electron | props 回调 | 测试 / mock | 裁决 |
|---|---|---|---|---|---|
| `markdown/AgentMarkdown.tsx` | `useEditorUiStore(s=>s.theme)`（运行时，1处）；`AppTheme` 类型 | 无 / 无 | 无回调（`{text, streaming, className?}`） | `AgentMarkdown.test.ts` 有；mock `@streamdown/mermaid` + `IntersectionObserver` stub，无 store mock | `props-ify`：`theme→prop`（如 `theme?: AppTheme`，默认浅色；`resolveMermaidTheme` 纯函数随包走） |
| `markdown/AgentMarkdown.lazy.tsx` | 无 | 无 / 无 | 无回调（Fallback `{text, className?}`；Lazy 无 props） | 无独立测试（经 Bubble 用例预热覆盖） | `pure` |
| `chat/BuiMessage.tsx` | 无 | 无 / 无 | 无回调（`{from, streaming?, actions?: ReactNode, className?, children}`，interface 未导出） | `BuiMessage.test.ts` 有；无 mock | `pure` |
| `chat/BuiThinking.tsx` | 无（仅同目录 `BeuiAgentProgress` 纯展示依赖） | 无 / 无 | `onToggle: () => void`（其余见详情） | `BuiThinking.test.ts` 有；仅 `vi.fn()` 断 `onToggle`，无 mock | `pure` |
| `chat/BeuiStreamingResponse.tsx` | 无 | 无 / 无 | 无回调（`{streaming, actions?, children}`，内联类型） | 无 | `pure` |
| `chat/BeuiCitations.tsx` | 无（`useState/useId` 本地展开态） | 无 / 无 | `BeuiCitationItem.onSelect?: () => void`（item 级；列表 props `{citations, label?}`） | `BeuiCitations.test.ts` 有；无 mock | `pure` |
| `chat/BeuiAgentActivity.tsx` | 无 | 无 / 无 | `BeuiAgentActivity.onToggle`、`BeuiActivityRow.onToggle`（均为 `() => void`；其余见详情） | 无 | `pure` |
| `chat/BeuiAgentProgress.tsx` | 无（纯计时展示，计时由调用方传 `elapsedSeconds`） | 无 / 无 | 无回调（`{label, elapsedSeconds, running?}`） | 无 | `pure` |
| `chat/AgentMessageBubble.tsx` | `useAcpUiStore(s=>s.resolveMarkProposal)`（fallback）、`useAcpPendingPermission()`；类型 `AcpChatMessage` | 无直接 `@/api` / 无 | `resolveMarkProposal?`、`onChapterPlanSelect?`、`onGenerativeSubmit?`、`onEditMessage?(text)`（全可选；`handleResolved` 内还调 `dismissProposedMark()` lib） | `AgentMessageBubble.test.ts` + `Bui` + `Approval` 变体有；`Approval` mock `ProposeMarkChatBlock`，其余无 mock（读真实 store 默认值） | `props-ify`：`resolveMarkProposal` 去 store fallback（必填或宿主默认传入）、`pendingPermission→prop`（或 `needsApproval` 布尔）、`dismissProposedMark` 副作用经 `onResolvedProposal` 回宿主 |
| `chat/AgentActivityGroup.tsx` | 运行时无（仅 `AcpChatMessage` 类型 + `formatDuration` 纯函数；`ChatTimelineItem/toToolDisplayModel` 来自 `@montree/chat-core`） | 无 / 无 | `onChapterPlanSelect?`、`onEditMessage?(text)`（`{group: WorkLogItem, running?, …}`） | `AgentWorkLog.test.ts` 有（覆盖本组；seed 真实 store 供子件，无 `vi.mock`） | `pure`（本体直搬；子件 Bubble/ToolCallCard 的 store 改 props 跟随各自项） |
| `chat/AgentChatItem.tsx` | 无（`logAcpLayoutProbe` 仅 DEV 日志，无 store） | 无 / 无 | 无回调（`{variant, tone?, align?, streaming?, bare?, probe?, messageId?, role?, className?, children}`） | 无 | `pure` |
| `chat/AgentMessageList.tsx` | 重：`useAcpUiStore(s=>s.activeThreadId)`、`useAcpActiveMessages()`、`useAcpPendingPermission()`、`useAcpUiStore(s=>s.prompting)`、`getState().chatScrollByThread` + `setChatScroll`（滚动落盘） | 无直接 `@/api` / 无 | `onChapterPlanSelect?`、`onGenerativeSubmit?`、`onEditMessage?`、`onQuote?`（另有 `bottomRef/messagesRef/authHint/runtimeName?` 非回调） | `AgentMessageList.test.ts` 有；seed 真实 store，无 mock | `stays`：视口引擎（assistant-ui Runtime/Viewport）+ 滚动跟随/分页/落盘编排留宿主；`groupChatTimeline/planInlinePresent` 已在 core，搬 Bubble/Group 后由宿主组装 |
| `chat/AgentLoadingState.tsx` | 运行时无（`isToolActiveStatus` + `AcpChatMessage` 类型，随 M1 换源；`toToolDisplayModel` 来自 core） | 无 / 无 | 无回调（`{label, seconds, awaitingApproval?}`；另导出纯 `currentRunStatus` + 纯 timer `useElapsedSeconds`） | `AgentLoadingState.test.ts` 有；纯函数用例，无 mock | `pure` |
| `tools/AgentToolCallCard.tsx` | `useAcpPendingPermission()`（1处）；类型 `AcpChatMessage/AcpToolLocation` | 无直接 `@/api` / 无（恢复操作走 `lib/agent/mark-proposal-failure`，间接碰 `acp-ui-store` + `reader-navigation-store`） | 无回调（`{message, suppressBusinessResult?, bare?, detailsOnly?}`） | `AgentToolCallCard.test.ts` 有；真实 store `setPendingPermission` + `QueryClientProvider`，无 `vi.mock` | `props-ify`：`pendingPermission→prop`（或 `needsApproval`）、恢复操作 `openChapterForMarkRecovery/promptSelectText→onRecoverChapter/onPromptSelect` props |
| `tools/AgentResultEntry.tsx` | 本体无（转调 ToolCallCard/ToolBusinessResult） | 无 / 无 | `onGenerativeSubmit?`（`{message, threadId?, prompting?, onGenerativeSubmit?}`） | 无独立测试（经 Bubble/业务结果用例覆盖） | `pure`（本体直搬；内嵌两卡的 store 改 props 跟随） |
| `tools/ToolBusinessResult.tsx` | 重：`useActiveDocumentStore(s=>s.filePath)`、`useWebDocStore`（`getState().pageUrl/openPage`）、`useAppSettingsStore`（`set*`）、`useReaderNavigationStore.getState()`、`useQueryClient`；类型 `AcpChatMessage` | `queryKeys`、`readingMarksApi.create` / 无 electron 直接引用 | `onGenerativeSubmit?`（`{message, compactResults?, threadId?, prompting?, onGenerativeSubmit?}`；其余定位/存卡/导航全是内部直调） | `ToolBusinessResult.test.ts` 有（纯 `hasBusinessResult`，无 mock）+ `ToolBusinessResultPresent.test.ts` 有（spy `openChapterForMarkRecovery`/`toast.message`/`emitAnchorHighlight`，动态 import store） | `stays`：文档归属校验 + 导航 + 落库（readingMarks）+ Query 失效的宿主编排器；纯解析（`hasBusinessResult/parse*/buildNoteFromDiagram`）可先行进 core，卡组装留 adapter |
| `tools/result-card.ts` | 无 | 无 / 无 | 无（常量 + `resultCardClassName(className?)`） | `result-card.test.ts` 有；无 mock | `pure` |
| `tools/ArtifactFrame.tsx` | 无（`registerThemeParticipant` 经查无 store） | 无 / 无（iframe `sandbox="allow-scripts"`，postMessage 白名单 + 2KiB 上限；注释中提到 Node/electronAPI 是“明确不要”，非引用） | `onBridgeMessage?(msg: ArtifactBridgeMessage)`（其余见详情） | `ArtifactFrame.test.ts` 有；仅 `vi.fn()` 收桥消息，无 mock | `pure`（安全语义原样带走；`colorScheme` 已是 prop） |
| `tools/ArtifactZoomSurface.tsx` | 无 | 无 / 无 | 无回调（`{title, children}` + `useArtifactZoom().close()`） | 无 | `pure` |
| `tools/HtmlArtifactCard.tsx` | `useEditorUiStore(s=>s.theme)`（透传 `ArtifactFrame colorScheme`） | `fileApi.exportHtml` / 无 | 无回调（`{result, className?, sourceText?}`；Dialog 内部 `{result, open, nonce, onOpenChange, onExport}`） | `HtmlArtifactCard.test.ts` 有；spy `fileApi.exportHtml`，无 store mock | `props-ify`：`theme→colorScheme` prop、`fileApi.exportHtml→onExport` prop（默认宿主实现） |
| `generative/ComponentUiCard.tsx` | 无 | 无 / 无 | `onSubmit?(payload: GenerativeSubmitPayload)`、`onLocateChapter?(flatIndex, excerpt?)` | `ComponentUiCard.test.ts` 有；无 mock | `pure` |
| `generative/ComponentUiCard.lazy.tsx` | 无 | 无 / 无 | 同上（`{result, threadId, prompting?, onSubmit?, onLocateChapter?, className?}`） | 无独立测试 | `pure` |
| `generative/ReactArtifactCard.tsx` | 运行时无（仅 `isToolActiveStatus` 类型级判活；`toolStreaming/toolStatus` 已是 props） | `fileApi.exportHtml` + `compileReactArtifact`（主进程 Sucrase 编译绑定） / 无 | `onSubmit?`（`{result, threadId?, prompting?, onSubmit?, toolStreaming?, toolStatus?}`；另有修错草稿确认链路复用 `onSubmit`） | `ReactArtifactCard.test.ts` 有；mock `@/api/react-artifact-api`（`compileMock`）+ spy `fileApi.exportHtml` | `props-ify`：`compileReactArtifact→onCompile(source,css)` prop、`fileApi.exportHtml→onExport` prop（M3 要求“编译器留主进程”即指这两个注入点） |
| `propose/ProposeMarkChatBlock.tsx` | 本体无直接 store（fallback `adoptProposedMark` 间接碰 `annotation-agent-store`；`toast`）；类型 `@montree/annotations` | 无 / 无 | `onNoteChange?`、`onAdopt?`、`onDismiss?`、`onResolved?`、`extraActions?`（List 版按 `proposalId` 透传，见详情） | 无独立测试（Bubble Approval 用例 mock 掉本文件） | `props-ify`：去 fallback（`onAdopt/onDismiss/onResolved` 必需化，`adoptProposedMark/toast` 移宿主） |
| `propose/ChapterMarkPlanCard.tsx` | 无；类型 `@montree/annotations` | 无 / 无 | `onSelectChapter?(payload: ChapterMarkPlanSelectPayload)` | 无 | `pure` |
| `permission/AgentPermissionCard.tsx` | `useAcpUiStore(s=>s.clearPendingPermission)` + `getState().pendingPermission`（跨卡幂等领取） | `acpApi.respondPermission` / 无 | 无回调（`{pending, compact?, className?}`；响应经内部 `respond()` 直发） | `AgentPermissionCard.test.ts` 有；seed 真实 store + spy `acpApi.respondPermission` | `props-ify`：领取 + 发送改 `onRespond(optionId \| null)` prop（`pending` 作纯数据保留，`clearPending` 回宿主） |
| `permission/BuiApprovalCard.tsx` | 无 | 无 / 无 | `onSelect(id)`（必填）、`onCancel()`（必填） | `BuiApprovalCard.test.ts` 有；无 mock | `pure` |
| `permission/ToolApprovalSlot.tsx` | `useAcpPendingPermission()` | 无 / 无（渲染 `AgentPermissionCard`，其 `acpApi` 绑定跟随上项） | 无回调（`{message: Pick<AcpChatMessage,'role'\|'toolCallId'>}`） | `ToolApprovalSlot.test.ts` 有；seed 真实 store + `QueryClientProvider`，无 mock | `props-ify`：`pendingPermission→prop`（`AgentPermissionCard` 的 `onRespond` 跟随） |
| `tools/DiagramViewerCard.tsx` | 本体无；**间接**：内嵌 `MermaidBlock` 读 `useEditorUiStore(theme)` + `useReaderHudUiStore` | 无 / 无 | `onHighlightAnchor?`、`onPinToDoc?`、`onSaveAsKnowledgeCard?`（均已 props 化） | `DiagramViewerCard.test.ts` 有；覆盖纯 `buildNoteFromDiagram`，卡渲染无 mock | `props-ify`：本体回调已齐，搬运时 `MermaidBlock` 主题依赖需切（prop 注入 Mermaid 渲染或同包搬运并 props 化主题） |
| `tools/ChapterComparisonCard.tsx` | 无（内嵌 `BeuiCitations` 纯） | 无 / 无 | `onLocateChapter?(flatIndex, excerpt?)` | `ChapterComparisonCard.test.ts` 有；无 mock | `pure` |

## props 接口全文（按文件）

### `markdown/AgentMarkdown.tsx`

```ts
export interface AgentMarkdownProps {
  text: string
  streaming: boolean
  className?: string
}
```

### `markdown/AgentMarkdown.lazy.tsx`

```ts
export function AgentMarkdownFallback({ text, className }: { text: string; className?: string })
export const AgentMarkdownLazy = lazy(() => import('@/components/markdown/AgentMarkdown') /* -> { default: AgentMarkdown } */)
```

### `chat/BuiMessage.tsx`

```ts
export type BuiMessageFrom = 'user' | 'assistant' | 'system'
interface BuiMessageProps { // 未导出
  from: BuiMessageFrom
  streaming?: boolean
  actions?: ReactNode
  className?: string
  children: ReactNode
}
```

### `chat/BuiThinking.tsx`

```ts
export interface BuiThinkingRow { primary: string; secondary?: string; mono?: boolean }
export interface BuiThinkingProps {
  state: 'running' | 'done'
  titleActive: string
  titleDone: string
  elapsedSeconds?: number | null
  rows: BuiThinkingRow[]
  expanded: boolean
  onToggle: () => void
  partKey: string
  body?: ReactNode
  className?: string
}
```

### `chat/BeuiStreamingResponse.tsx`

```tsx
export function BeuiStreamingResponse({ streaming, actions, children }: {
  streaming: boolean
  actions?: ReactNode
  children: ReactNode
})
```

### `chat/BeuiCitations.tsx`

```ts
export interface BeuiCitationItem { id: string; title: string; detail?: string; excerpt?: string; url?: string; onSelect?: () => void }
export function BeuiCitations({ citations, label = '引用来源' }: { citations: BeuiCitationItem[]; label?: string })
```

### `chat/BeuiAgentActivity.tsx`

```tsx
export type BeuiActivityStatus = 'working' | 'complete' | 'failed' | 'cancelled' | 'unknown' | 'approval'
export function BeuiAgentActivity({ status, heading, description, open, onToggle, children }: {
  status: BeuiActivityStatus; heading: string; description?: string; open: boolean; onToggle: () => void; children: ReactNode
})
export function BeuiActivityRow({ label, target, stateLabel, icon, meta, open, onToggle, failure, children }: {
  label: string; target?: string | null; stateLabel: string; icon: ReactNode; meta?: string;
  open: boolean; onToggle: () => void; failure?: string | null; children: ReactNode
})
```

### `chat/BeuiAgentProgress.tsx`

```tsx
export function BeuiThinkingShimmer({ children }: { children: ReactNode })
export function BeuiAgentProgress({ label, elapsedSeconds, running = true }: {
  label: string; elapsedSeconds: number | null; running?: boolean
})
```

### `chat/AgentMessageBubble.tsx`

```ts
interface AgentMessageBubbleProps {
  message: AcpChatMessage
  inlinePresentSlots?: Map<number, InlinePresentSlot>
  suppressPresentResult?: boolean
  runStatus?: ReturnType<typeof currentRunStatus>
  resolveMarkProposal?: ResolveMarkProposal
  onChapterPlanSelect?: (payload: ChapterMarkPlanSelectPayload) => void
  threadId?: string
  prompting?: boolean
  onGenerativeSubmit?: (payload: GenerativeSubmitPayload) => void
  onEditMessage?: (text: string) => void
}
```

需变 prop：`resolveMarkProposal` 去 store fallback；新增 `pendingPermission`（或 `needsApproval: boolean`）替代 `useAcpPendingPermission()`；`dismissProposedMark()` 经 `onResolvedProposal` 回宿主。

### `chat/AgentActivityGroup.tsx`

```ts
export type WorkLogItem = Extract<ChatTimelineItem, { kind: 'work-log' }>
interface AgentActivityGroupProps {
  group: WorkLogItem
  running?: boolean
  onChapterPlanSelect?: (payload: ChapterMarkPlanSelectPayload) => void
  onEditMessage?: (text: string) => void
}
```

### `chat/AgentChatItem.tsx`

```tsx
interface AgentChatItemProps {
  variant: AgentChatItemVariant // 'bubble' | 'card' | 'system'
  tone?: AgentChatItemTone
  align?: 'start' | 'end'
  streaming?: boolean
  bare?: boolean
  probe?: string
  messageId?: string
  role?: string
  className?: string
  children: ReactNode
}
export function AgentChatItemBody({ className, children }: { className?: string; children: ReactNode })
```

### `chat/AgentMessageList.tsx`

```ts
interface AgentMessageListProps {
  bottomRef: RefObject<HTMLDivElement | null>
  messagesRef: RefObject<HTMLDivElement | null>
  authHint: string | null
  runtimeName?: string
  onChapterPlanSelect?: (payload: ChapterMarkPlanSelectPayload) => void
  onGenerativeSubmit?: (payload: GenerativeSubmitPayload) => void
  onEditMessage?: (text: string) => void
  onQuote?: (text: string) => void
}
```

`stays`：`messages/prompting/pendingPermission/chatScrollByThread` 四处 store 订阅 + 落盘 + assistant-ui Runtime 全留宿主。

### `chat/AgentLoadingState.tsx`

```tsx
export function currentRunStatus(messages: AcpChatMessage[], awaitingApproval: boolean)
export function useElapsedSeconds(startedAt: number | undefined, active: boolean, endedAt?: number)
export function AgentLoadingState({ label, seconds, awaitingApproval = false }: {
  label: string; seconds: number | null; awaitingApproval?: boolean
})
```

### `tools/AgentToolCallCard.tsx`

```ts
interface AgentToolCallCardProps {
  message: AcpChatMessage
  suppressBusinessResult?: boolean
  bare?: boolean
  detailsOnly?: boolean
}
```

需变 prop：`pendingPermission`（或 `needsApproval`）+ `onRecoverChapter?(flatIndex)` / `onPromptSelectText?()`。

### `tools/AgentResultEntry.tsx`

```tsx
export function AgentResultEntry({ message, threadId, prompting, onGenerativeSubmit }: {
  message: AcpChatMessage; threadId?: string; prompting?: boolean;
  onGenerativeSubmit?: (payload: GenerativeSubmitPayload) => void
})
```

### `tools/ToolBusinessResult.tsx`

```tsx
export function ToolBusinessResult({ message, compactResults, threadId, prompting, onGenerativeSubmit }: {
  message: AcpChatMessage; compactResults?: boolean; threadId?: string; prompting?: boolean;
  onGenerativeSubmit?: (payload: GenerativeSubmitPayload) => void
})
export function hasBusinessResult(detail?: string, title?: string): boolean
export function isUnparsablePresentResult(detail?: string, title?: string): boolean
```

`stays` 原因：内部直调 `readingMarksApi.create`、`useActiveDocumentStore/useWebDocStore/useAppSettingsStore/useReaderNavigationStore`、`queryClient.invalidateQueries`、`openChapterForMarkRecovery/emitAnchorHighlight/toast`。

### `tools/result-card.ts`

```ts
export const RESULT_CARD_SHELL / RESULT_CARD_HEADER / RESULT_CARD_ICON / RESULT_CARD_SUMMARY: string
export function resultCardClassName(className?: string): string
```

### `tools/ArtifactFrame.tsx`

```ts
export type ArtifactBridgeMessage =
  | { kind: 'ready' } | { kind: 'react-ready' } | { kind: 'error'; message: string } | { kind: 'analysis-request'; text: string }
export interface ArtifactFrameProps {
  title: string
  html: string
  mountId: string
  initialHeight?: number
  minHeight?: number
  maxHeight?: number
  frameTestId?: string
  className?: string
  onBridgeMessage?: (message: ArtifactBridgeMessage) => void
  allowRequests?: boolean
  colorScheme?: ThemeTransitionTarget
}
export function buildArtifactDocument(source: string, mountId: string, allowRequests = false): string
export function newArtifactMountId(): string
```

### `tools/ArtifactZoomSurface.tsx`

```tsx
export function ArtifactZoomSurface({ title, children }: { title: string; children: ReactNode })
export const useArtifactZoom = () => { close: () => void } | null
```

### `tools/HtmlArtifactCard.tsx`

```ts
interface ArtifactPreviewDialogProps {
  result: PresentHtmlArtifact
  open: boolean
  nonce: number
  onOpenChange: (open: boolean) => void
  onExport: () => void
}
interface HtmlArtifactCardProps { // 未导出 interface，字段如下
  result: PresentHtmlArtifact
  className?: string
  sourceText?: string
}
```

需变 prop：`colorScheme`（替主题 store）、`onExport`（替 `fileApi.exportHtml`）。

### `generative/ComponentUiCard.tsx`

```ts
export interface GenerativeSubmitPayload {
  resultId: string; threadId: string; title: string
  selections: Record<string, string | string[]>
  displayText: string; promptText: string
}
interface ComponentUiCardProps {
  result: PresentComponentUi
  threadId: string
  prompting?: boolean
  onSubmit?: (payload: GenerativeSubmitPayload) => void | Promise<void>
  onLocateChapter?: (flatIndex: number, excerpt?: string) => void
  className?: string
}
```

### `generative/ComponentUiCard.lazy.tsx`

```ts
export function ComponentUiCardLazy(props: {
  result: PresentComponentUi; threadId: string; prompting?: boolean;
  onSubmit?: (payload: GenerativeSubmitPayload) => void;
  onLocateChapter?: (flatIndex: number, excerpt?: string) => void; className?: string
})
```

### `generative/ReactArtifactCard.tsx`

```ts
interface ReactArtifactCardProps {
  result: PresentReactArtifact
  threadId?: string
  prompting?: boolean
  onSubmit?: (payload: GenerativeSubmitPayload) => void | Promise<void>
  toolStreaming?: boolean
  toolStatus?: string
}
```

需变 prop：`onCompile?(source: string, css?: string) => Promise<string>`（替 `compileReactArtifact`）、`onExport?(html: string, title: string) => void`（替 `fileApi.exportHtml`）。

### `propose/ProposeMarkChatBlock.tsx`

```ts
export type ResolveMarkProposal = (proposalId: string, status: Exclude<MarkProposalStatus, 'pending'>) => void
interface ProposeMarkChatBlockProps {
  proposal: ProposedMark
  status?: MarkProposalStatus
  defaultExpanded?: boolean
  embedded?: boolean
  className?: string
  onNoteChange?: (note: string) => void
  onAdopt?: (note: string) => void | Promise<void>
  onDismiss?: () => void
  onResolved?: (status: Exclude<MarkProposalStatus, 'pending'>) => void
  extraActions?: ReactNode
}
interface ProposeMarkBlockListProps {
  proposals: Array<{ proposal: ProposedMark; status: MarkProposalStatus }>
  defaultExpanded?: boolean
  embedded?: boolean
  onResolved?: (proposalId: string, status: Exclude<MarkProposalStatus, 'pending'>) => void
  onNoteChange?: (proposalId: string, note: string) => void
  onAdopt?: (proposalId: string, note: string) => void | Promise<void>
  onDismiss?: (proposalId: string) => void
  extraActionsFor?: (proposalId: string) => ReactNode
}
```

### `propose/ChapterMarkPlanCard.tsx`

```ts
export interface ChapterMarkPlanSelectPayload { entry: ChapterMarkPlanEntry; promptText: string; displayText: string }
interface ChapterMarkPlanCardProps {
  entries: ChapterMarkPlanEntry[]
  embedded?: boolean
  className?: string
  onSelectChapter?: (payload: ChapterMarkPlanSelectPayload) => void
}
```

### `permission/AgentPermissionCard.tsx`

```ts
interface AgentPermissionCardProps {
  pending: AcpPendingPermission
  compact?: boolean
  className?: string
}
```

需变 prop：`onRespond?(optionId: string | null) => void`（替 `acpApi.respondPermission` + `clearPendingPermission` 领取）。

### `permission/BuiApprovalCard.tsx`

```ts
export interface BuiApprovalOption { id: string; label: string; kind?: string }
interface BuiApprovalCardProps {
  title: string
  options: Array<BuiApprovalOption>
  selectedId?: string | null
  busyId?: string | null
  busy?: boolean
  requestKey: string
  onSelect: (id: string) => void
  onCancel: () => void
}
```

### `permission/ToolApprovalSlot.tsx`

```tsx
export function ToolApprovalSlot({ message }: { message: Pick<AcpChatMessage, 'role' | 'toolCallId'> })
```

需变 prop：`pending: AcpPendingPermission | null`（替 `useAcpPendingPermission()`）+ 透传 `onRespond` 给内层卡。

### `tools/DiagramViewerCard.tsx`

```ts
export interface DiagramVisualStep { from: string; to: string; action: string; desc?: string; payload?: string; anchorExcerpt?: string }
export interface DiagramPayload {
  diagramId: string
  diagramType: 'sequence' | 'flowchart' | 'mindmap' | 'stateDiagram' | 'classDiagram' | 'erDiagram'
  title: string; mermaidCode: string; anchorExcerpt?: string; summary?: string; visualSteps?: DiagramVisualStep[]
}
export interface DiagramViewerCardProps {
  payload: DiagramPayload
  onHighlightAnchor?: (anchorExcerpt: string) => void
  onPinToDoc?: (payload: DiagramPayload) => void
  onSaveAsKnowledgeCard?: (payload: DiagramPayload) => Promise<boolean> | boolean
  isSavedAsCard?: boolean
  isPinned?: boolean
  className?: string
  defaultCompact?: boolean
}
```

间接耦合：`MermaidBlock` 读 `editor-ui-store(theme)` + `reader-hud-store`，搬运时切掉（Mermaid 渲染 prop 注入或同包搬运后主题 props 化）。

### `tools/ChapterComparisonCard.tsx`

```ts
interface ChapterComparisonCardProps { // 未导出
  result: PresentChapterComparison
  onLocateChapter?: (flatIndex: number, excerpt?: string) => void
  className?: string
}
```

## 按裁决分组

- `pure`（19，直搬，换 import 源即可）：`markdown/AgentMarkdown.lazy.tsx`、`chat/BuiMessage.tsx`、`chat/BuiThinking.tsx`、`chat/BeuiStreamingResponse.tsx`、`chat/BeuiCitations.tsx`、`chat/BeuiAgentActivity.tsx`、`chat/BeuiAgentProgress.tsx`、`chat/AgentActivityGroup.tsx`（本体；子件跟随各自项）、`chat/AgentChatItem.tsx`、`chat/AgentLoadingState.tsx`、`tools/AgentResultEntry.tsx`（本体）、`tools/result-card.ts`、`tools/ArtifactFrame.tsx`、`tools/ArtifactZoomSurface.tsx`、`generative/ComponentUiCard.tsx`、`generative/ComponentUiCard.lazy.tsx`、`propose/ChapterMarkPlanCard.tsx`、`permission/BuiApprovalCard.tsx`、`tools/ChapterComparisonCard.tsx`。
- `props-ify`（9，先剪后搬）：`markdown/AgentMarkdown.tsx`（theme）、`chat/AgentMessageBubble.tsx`（resolve+pending）、`tools/AgentToolCallCard.tsx`（pending+恢复操作）、`tools/HtmlArtifactCard.tsx`（theme+export）、`generative/ReactArtifactCard.tsx`（compile+export）、`propose/ProposeMarkChatBlock.tsx`（去 adopt fallback）、`permission/AgentPermissionCard.tsx`（onRespond）、`permission/ToolApprovalSlot.tsx`（pending）、`tools/DiagramViewerCard.tsx`（Mermaid 主题间接依赖）。
- `stays`（2，留宿主 adapter，不进包）：`chat/AgentMessageList.tsx`（视口/滚动/落盘/Runtime 编排）、`tools/ToolBusinessResult.tsx`（多 store + `readingMarksApi` + 导航落库编排；纯解析函数可先行进 core）。

补充：30 文件均无 `window.electronAPI` / `node:` 直接引用；`@/hooks/*` 直接引用 0 处（`useRevealText` 已是 `@montree/chat-ui` 头件、`useElapsedSeconds` 是同目录纯 timer）；`navigator.clipboard`（Bubble/Diagram 复制）与 `document/CSS/DOM` 定位属于 Web API，随包走。

## M3b / M3c / M3d 切分建议（互不重叠；stays 两件不进批）

- **M3b 气泡件（15）**：先 `markdown/AgentMarkdown.tsx` + `markdown/AgentMarkdown.lazy.tsx`（主题 props 化为 `ChatMarkdown`），再 `chat/BuiMessage.tsx`、`chat/BuiThinking.tsx`、`chat/BeuiStreamingResponse.tsx`、`chat/BeuiCitations.tsx`、`chat/BeuiAgentActivity.tsx`、`chat/BeuiAgentProgress.tsx`、`chat/AgentChatItem.tsx`、`chat/AgentLoadingState.tsx`、`chat/AgentMessageBubble.tsx`（本批唯一的 props-ify 大件）、`chat/AgentActivityGroup.tsx`、`permission/BuiApprovalCard.tsx`、`permission/AgentPermissionCard.tsx`（props-ify）、`permission/ToolApprovalSlot.tsx`（props-ify）。Bubble 的审批链在本批闭环；`BeuiCitations` 先行供 M3d 的比较卡复用。
- **M3c 工具卡（6）**：`tools/AgentToolCallCard.tsx`（props-ify）、`tools/AgentResultEntry.tsx`、`tools/result-card.ts`、`tools/DiagramViewerCard.tsx`（props-ify，Mermaid 依赖本批解决）、`propose/ProposeMarkChatBlock.tsx`（props-ify）、`propose/ChapterMarkPlanCard.tsx`。
- **M3d present 四件套（7）**：`tools/ArtifactFrame.tsx`、`tools/ArtifactZoomSurface.tsx`、`tools/HtmlArtifactCard.tsx`（props-ify）、`generative/ComponentUiCard.tsx`、`generative/ComponentUiCard.lazy.tsx`、`generative/ReactArtifactCard.tsx`（props-ify，编译/导出注入）、`tools/ChapterComparisonCard.tsx`。
- **留宿主（2，不进三批）**：`chat/AgentMessageList.tsx`、`tools/ToolBusinessResult.tsx`（M4 adapter 归宿）。
