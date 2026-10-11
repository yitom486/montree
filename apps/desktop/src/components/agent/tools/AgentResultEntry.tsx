import { AgentChatItem } from '@/components/agent/chat/AgentChatItem'
import { AgentToolCallCard } from '@/components/agent/tools/AgentToolCallCard'
import { ToolBusinessResult } from '@/components/agent/tools/ToolBusinessResult'
import type { AcpChatMessage } from '@/stores/acp-chat-types'

/**
 * 富业务结果独立入口（U3）：紧凑过程行在上，业务卡独立在下，
 * 单次调用的结果只渲染一处，不再嵌进通用工具折叠详情。
 *
 * key 由调用方按 message.id 给定保持稳定；卡内交互状态
 * （筛选/定位/预览挂载）归结果自身，chunk/主题更新不重置。
 */
export function AgentResultEntry({ message }: { message: AcpChatMessage }) {
  return (
    <AgentChatItem
      variant="card"
      tone="tool"
      streaming={Boolean(message.streaming)}
      probe="result"
      messageId={message.id}
      role="tool"
    >
      <AgentToolCallCard message={message} suppressBusinessResult bare />
      <div className="min-w-0 border-t border-border/40 px-2 py-2">
        <ToolBusinessResult message={message} compactResults />
      </div>
    </AgentChatItem>
  )
}
