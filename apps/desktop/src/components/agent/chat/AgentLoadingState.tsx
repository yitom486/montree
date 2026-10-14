import { useEffect, useState } from 'react'
import { BeuiAgentProgress } from './BeuiAgentProgress'
import { isToolActiveStatus, type AcpChatMessage } from '@/stores/acp-chat-types'
import { toToolDisplayModel } from '@/lib/agent/tool-display-model'

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
