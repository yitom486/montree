/**
 * 从编辑器等界面向当前 Agent 会话发送一条提示（如“润色选区”）。
 * AgentPanel 挂载后订阅并经原 sendPrompt 发送；未挂载时排队，挂载即发出。
 */
export interface AgentPromptRequest { displayText: string; promptText: string }
type Listener = (request: AgentPromptRequest) => void

let listener: Listener | null = null
const queue: AgentPromptRequest[] = []
let opener: (() => void) | null = null

export function setAgentPanelOpener(open: (() => void) | null): void { opener = open }

export function requestAgentPrompt(request: AgentPromptRequest): void {
  opener?.()
  if (listener) listener(request)
  else queue.push(request)
}

export function subscribeAgentPrompts(next: Listener): () => void {
  listener = next
  while (queue.length) next(queue.shift()!)
  return () => { if (listener === next) listener = null }
}

export function pendingAgentPromptCount(): number { return queue.length }
