import type { InlineCompletionRequest, InlineCompletionResult, InlineCompletionStatus } from '../../../contracts/inline-completion'
import { buildInlineCompletionPrompt, cleanCompletion } from './inline-completion-prompt'

export interface InlineCompletionRunner {
  id: string
  generate: (input: { system: string; prompt: string; signal: AbortSignal }) => Promise<string>
}

export interface InlineCompletionModelSource {
  /** 当前可用模型；未配置返回 null */
  resolve: () => Promise<InlineCompletionRunner | null>
}

/**
 * 行内补全服务：每个 (owner, requestId) 一个 AbortController；
 * 新请求自动取消同一 owner 的旧请求（打字即取消在途请求）。
 */
export function createInlineCompletionService(source: InlineCompletionModelSource, options: { timeoutMs?: number } = {}) {
  const inflight = new Map<string, { requestId: string; controller: AbortController }>()
  const timeoutMs = options.timeoutMs ?? 8000

  async function status(): Promise<InlineCompletionStatus> {
    const resolved = await source.resolve().catch(() => null)
    return resolved ? { configured: true, model: resolved.id } : { configured: false }
  }

  function cancel(owner: string, requestId?: string): void {
    const current = inflight.get(owner)
    if (current && (!requestId || current.requestId === requestId)) { current.controller.abort(); inflight.delete(owner) }
  }

  async function complete(owner: string, request: InlineCompletionRequest): Promise<InlineCompletionResult> {
    cancel(owner)
    const controller = new AbortController()
    inflight.set(owner, { requestId: request.requestId, controller })
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    try {
      const resolved = await source.resolve()
      if (!resolved) return { requestId: request.requestId, items: [], reason: 'not-configured' }
      const { system, prompt } = buildInlineCompletionPrompt(request)
      const text = await resolved.generate({ system, prompt, signal: controller.signal })
      if (controller.signal.aborted) return { requestId: request.requestId, items: [], reason: 'cancelled' }
      const items = [...new Set(text.split(/\n?<ALT>\n?/).map((item) => cleanCompletion(item, request)).filter(Boolean))]
      return { requestId: request.requestId, items }
    } catch (error) {
      if (controller.signal.aborted) return { requestId: request.requestId, items: [], reason: 'cancelled' }
      return { requestId: request.requestId, items: [], reason: 'error', message: error instanceof Error ? error.message : String(error) }
    } finally {
      clearTimeout(timer)
      if (inflight.get(owner)?.controller === controller) inflight.delete(owner)
    }
  }

  return { status, complete, cancel, inflightCount: () => inflight.size }
}
