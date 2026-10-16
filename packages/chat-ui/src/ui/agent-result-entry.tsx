import type { ReactNode } from 'react'
// 自宿主 `apps/desktop/src/components/agent/tools/AgentResultEntry.tsx` 整搬（M3c 工具卡批）：
// `AgentChatItem` 改 `./AgentChatItem`；`AgentToolCallCard` 改 `./agent-tool-call-card`；
// `AcpChatMessage` 即 core 的 `ChatMessage`；`GenerativeSubmitPayload` 改 `@montree/chat-ui`
// （M3d 新建 `ui/component-ui-card.lazy.tsx` 符号不变，barrel 由审核人统一接，缺导出时 typecheck 允许）；
// 宿主编排器 `ToolBusinessResult`（stays）改为可选 `businessResultSlot`（宿主传完整业务卡；缺省仅过程行）。
// 内嵌工具卡的 store 改 props 跟随：`pending/onRespond/onRecoverChapter/onPromptSelectText/navFlatIndex` 透传。
import { AgentChatItem } from './AgentChatItem'
import { AgentToolCallCard } from './agent-tool-call-card'
import type { AgentApprovalPending } from './agent-permission-card'
import type { GenerativeSubmitPayload } from './component-ui-card'
import type { ChatMessage as AcpChatMessage } from '@montree/chat-core'

/**
 * 富业务结果独立入口（U3）：紧凑过程行在上，业务卡独立在下，
 * 单次调用的结果只渲染一处，不再嵌进通用工具折叠详情。
 *
 * key 由调用方按 message.id 给定保持稳定；卡内交互状态
 * （筛选/定位/预览挂载）归结果自身，chunk/主题更新不重置。
 * component-ui 的选择提交经 onGenerativeSubmit 回到原 ACP 会话。
 */
export function AgentResultEntry({ message, threadId, prompting, onGenerativeSubmit, pending = null, onRespond, onRecoverChapter, onPromptSelectText, navFlatIndex, businessResultSlot }: { message: AcpChatMessage; threadId?: string; prompting?: boolean; onGenerativeSubmit?: (payload: GenerativeSubmitPayload) => void; pending?: AgentApprovalPending | null; onRespond?: (optionId: string | null) => void; onRecoverChapter?: (flatIndex?: number) => void; onPromptSelectText?: () => void; navFlatIndex?: number; businessResultSlot?: ReactNode }) {
  return (
    <AgentChatItem
      variant="card"
      tone="tool"
      streaming={Boolean(message.streaming)}
      probe="result"
      messageId={message.id}
      role="tool"
    >
      <AgentToolCallCard
        message={message}
        suppressBusinessResult
        bare
        pending={pending}
        onRespond={onRespond}
        onRecoverChapter={onRecoverChapter}
        onPromptSelectText={onPromptSelectText}
        navFlatIndex={navFlatIndex}
      />
      <div className="min-w-0 border-t border-border/40 px-2 py-2">
        {businessResultSlot}
      </div>
    </AgentChatItem>
  )
}
