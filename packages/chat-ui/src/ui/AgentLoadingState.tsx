import { useEffect, useState } from 'react'
import { BeuiAgentProgress } from './BeuiAgentProgress'
// 自 `apps/desktop/src/components/agent/chat/AgentLoadingState.tsx` 整搬（M3b 纯展示批）：
// `AcpChatMessage` 即 `@montree/chat-core` 的 `ChatMessage`（宿主 `stores/acp-chat-types` 只是 M1 别名重导出），
// `isToolActiveStatus` 同源，合并为单包引用；`./BeuiAgentProgress` 同批随搬，相对路径不变。
import { isToolActiveStatus, toToolDisplayModel, type ChatMessage as AcpChatMessage } from '@montree/chat-core'

export function currentRunStatus(messages: AcpChatMessage[], awaitingApproval: boolean) {
  const current = messages.slice(messages.findLastIndex(message => message.role === 'user') + 1)
  if (awaitingApproval) return { phase: 'approval', label: '等待批准' }
  const tool = current.findLast(message => message.role === 'tool' && !message.turnEnded &&
    (message.streaming || isToolActiveStatus(message.toolStatus)))
  if (tool) return { phase: 'tool', label: toToolDisplayModel(tool).title }
  if (current.some(message => message.role === 'thought' && message.streaming)) {
    return { phase: 'thinking', label: '思考中' }
  }
  return { phase: 'waiting', label: '等待响应' }
}

export function useElapsedSeconds(startedAt: number | undefined, active: boolean, endedAt?: number) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!active) return
    setNow(Date.now())
    const timer = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [active, startedAt])
  const end = active ? now : endedAt
  return startedAt && end && end >= startedAt ? Math.floor((end - startedAt) / 1000) : null
}

/** 状态由真实 ACP 事件派生，视觉由 BeUI 受控 AgentProgress 接管。 */
export function AgentLoadingState({ label, seconds, awaitingApproval = false }: {
  label: string
  seconds: number | null
  awaitingApproval?: boolean
}) {
  return <BeuiAgentProgress label={label} elapsedSeconds={seconds} running={!awaitingApproval} />
}
