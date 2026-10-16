import type { ReactNode } from 'react'
import {
  AgentPermissionCard,
  ChatActivityGroup,
  ChatMessageBubble,
  useChatTimeline,
  type ChatMarkdownTheme,
  type GenerativeSubmitPayload,
  type ResolveMarkProposal,
} from '@montree/chat-ui'
import { timelineRendersInlineApproval, type ChatMessage } from '@montree/chat-core'
import type { ChatSessionStore } from '../session/store'
import { useActiveThread, useChatActions, useChatSessionStore } from '../session/use-chat-session'
import { ChatComposer } from './ChatComposer'

export interface ChatRuntimeOption {
  id: string
  name: string
}

export interface ChatPanelProps {
  store: ChatSessionStore
  /** 聊天 Markdown 主题（透传给 `ChatMessageBubble`；缺省 `light`）。 */
  theme?: ChatMarkdownTheme
  /** 运行时下拉选项；切换经 `selectRuntime(optionId)` 直写 `modelConfig`。 */
  runtimes: ChatRuntimeOption[]
  /** 思考档下拉选项；缺省（`undefined`/空数组）时不渲染思考档下拉。 */
  thoughtOptions?: string[]
  /** 根节点 className 透传（包内只给最小可用结构，不写应用主题）。 */
  className?: string
  /**
   * 章级定位（宿主实现，如滚动到正文对应章句）：
   * 经 `ChatMessageBubble.onChapterPlanSelect` 适配（取 `payload.entry.flatIndex`）。
   */
  onLocateChapter?: (flatIndex: number, excerpt?: string) => void
  /**
   * 文件打开（宿主实现）：声明在先保证宿主透传不断；
   * 当前包内渲染件无文件点击位，暂不消费（富结果自定义槽由宿主自备）。
   */
  onOpenFile?: (path: string, line?: number) => void
  /**
   * 批注提议落库（必填语义的宿主侧实现）：`ChatMessageBubble.resolveMarkProposal`
   * 无 store fallback；缺省为空函数——提议点“采用/忽略”只落本地态、不写库，
   * 宿主必须传入真实写库实现（见包 README）。
   */
  onResolveMarkProposal?: ResolveMarkProposal
  /**
   * 富业务结果槽（G1）：宿主 `ToolBusinessResult`（`message + threadId/prompting/onGenerativeSubmit/compactResults`）。
   * 签名与包内 `ChatMessageBubble.renderBusinessResult` 一致，直接透传；缺省不渲染。
   */
  renderBusinessResult?: (
    message: ChatMessage,
    opts: {
      threadId?: string
      prompting?: boolean
      onGenerativeSubmit?: (payload: GenerativeSubmitPayload) => void
      compactResults?: boolean
    },
  ) => ReactNode
  /**
   * 计划卡槽（G1）：宿主 `AgentPlanCard`（`message`）。
   * 签名与包内 `ChatMessageBubble.renderPlanCard` 一致，直接透传；缺省不渲染。
   */
  renderPlanCard?: (message: ChatMessage) => ReactNode
  /**
   * 生成式提交（G2）：签名与包内 `ChatMessageBubble.onGenerativeSubmit` 一致，直接透传；
   * 缺省不 disturbing（包内只给结果入口壳，完整 present 卡由宿主槽自备）。
   */
  onGenerativeSubmit?: (payload: GenerativeSubmitPayload) => void
  /**
   * 用户消息“编辑后继续”（G6）：签名与包内 `ChatMessageBubble.onEditMessage` 一致，直接透传；
   * 缺省不渲染编辑按钮。
   */
  onEditMessage?: (text: string) => void
  /**
   * 运行时切换后钩（P3 可选）：默认行为不变——仅 `selectRuntime` 写 `modelConfig.runtimeId`；
   * 线程亲和（断开→重连→resume）由应用侧在该回调内经 transport/宿主 store 管理，包内不做连接。
   */
  onRuntimeChange?: (runtimeId: string) => void
}

/** `resolveMarkProposal` 缺省空函数（见上；文档注明，不静默失败：本地态照常流转）。 */
const NOOP_RESOLVE: ResolveMarkProposal = () => {}

const EMPTY_MESSAGES: ChatMessage[] = []

/**
 * 可工作的最小聊天面板（S2）：业务代码只调此组件即工作。
 * 壳级布局（侧栏/底栏/滚动容器）由应用自备，包内只给最小可用结构 + className 透传。
 *
 * - 时间线：`useChatTimeline(messages)` 分组；`message` 项用 `ChatMessageBubble`
 *   （回调全接 store/transport，见下）；`work-log` 复用 `ChatActivityGroup`，
 *   与宿主共用进度摘要、最新工具行与回合落定后的历史折叠行为。
 * - 审批：`AgentPermissionCard` 接 `respondPermission`（`transport.respondPermission
 *   + clearPermission`，见 `useChatActions`）。
 * - 顶部最小模型行：runtime `<select>`（`selectRuntime`）+ thinking `<select>`
 *   （`setThinking`，无 `thoughtOptions` 则不渲染）。
 * - 底部 `ChatComposer`。
 */
export function ChatPanel({
  store,
  theme = 'light',
  runtimes,
  thoughtOptions,
  className,
  onLocateChapter,
  onResolveMarkProposal,
  renderBusinessResult,
  renderPlanCard,
  onGenerativeSubmit,
  onEditMessage,
  onRuntimeChange,
}: ChatPanelProps) {
  const state = useChatSessionStore(store)
  const thread = useActiveThread(store)
  const actions = useChatActions(store)

  const messages = thread?.feed.messages ?? EMPTY_MESSAGES
  const timeline = useChatTimeline(messages, {
    pendingToolCallId: state.pendingPermission?.toolCallId ?? null,
    scopeKey: thread?.id ?? 'default',
  })

  const thinkingValue = state.modelConfig.thinkingLevel ?? thoughtOptions?.[0] ?? ''
  const resolveMarkProposal = onResolveMarkProposal ?? NOOP_RESOLVE

  return (
    <div className={className} data-testid="chat-panel">
      {runtimes.length > 0 ? (
        <div data-testid="chat-model-row">
          <select
            data-testid="chat-runtime-select"
            aria-label="运行时"
            value={state.modelConfig.runtimeId}
            onChange={(e) => {
              actions.selectRuntime(e.target.value)
              onRuntimeChange?.(e.target.value)
            }}
          >
            {runtimes.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
          </select>
          {thoughtOptions && thoughtOptions.length > 0 ? (
            <select
              data-testid="chat-thinking-select"
              aria-label="思考档"
              value={thinkingValue}
              onChange={(e) => actions.setThinking(e.target.value)}
            >
              {thoughtOptions.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          ) : null}
        </div>
      ) : null}
      <div data-testid="chat-timeline">
        {timeline.map((item) =>
          item.kind === 'message' ? (
            <ChatMessageBubble
              key={item.key}
              message={item.message}
              threadId={thread?.id}
              theme={theme}
              resolveMarkProposal={resolveMarkProposal}
              pendingPermission={state.pendingPermission}
              onPermissionRespond={actions.respondPermission}
              renderBusinessResult={renderBusinessResult}
              renderPlanCard={renderPlanCard}
              onGenerativeSubmit={onGenerativeSubmit}
              onEditMessage={onEditMessage}
              onChapterPlanSelect={
                onLocateChapter
                  ? (payload) => onLocateChapter(payload.entry.flatIndex)
                  : undefined
              }
            />
          ) : (
            <div key={item.key} data-testid="chat-work-log">
              <ChatActivityGroup
                group={item}
                theme={theme}
                threadId={thread?.id}
                resolveMarkProposal={resolveMarkProposal}
                pendingPermission={state.pendingPermission}
                onPermissionRespond={actions.respondPermission}
                renderBusinessResult={renderBusinessResult}
                renderPlanCard={renderPlanCard}
                onGenerativeSubmit={onGenerativeSubmit}
                onEditMessage={onEditMessage}
                onChapterPlanSelect={
                  onLocateChapter
                    ? (payload) => onLocateChapter(payload.entry.flatIndex)
                    : undefined
                }
              />
            </div>
          ),
        )}
      </div>
      {state.pendingPermission && !timelineRendersInlineApproval(timeline, state.pendingPermission.toolCallId) ? (
        <AgentPermissionCard
          pending={state.pendingPermission}
          onRespond={actions.respondPermission}
        />
      ) : null}
      <ChatComposer onSend={actions.sendText} />
    </div>
  )
}
