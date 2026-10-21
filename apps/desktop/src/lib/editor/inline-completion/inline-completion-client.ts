import type { InlineCompletionStatus } from '../../../../contracts/inline-completion'
import type { InlineCompletionContext } from './inline-completion-extension'

let nextRequest = 0
let statusCache: { at: number; value: InlineCompletionStatus } | null = null
let statusPending: Promise<InlineCompletionStatus> | null = null
const STATUS_TTL = 30_000

function bridge() { return typeof window !== 'undefined' ? window.montreeInlineCompletion : undefined }

/** 是否已配置补全模型（缓存 30 秒；无桥接时为未配置）。同步读取最近一次结果，后台刷新。 */
export function inlineCompletionConfigured(): boolean {
  const api = bridge()
  if (!api) return false
  if (!statusCache || Date.now() - statusCache.at > STATUS_TTL) void refreshInlineCompletionStatus()
  return statusCache?.value.configured ?? false
}
export async function refreshInlineCompletionStatus(): Promise<InlineCompletionStatus> {
  const api = bridge()
  if (!api) return { configured: false }
  statusPending ??= api.status().then((value) => { statusCache = { at: Date.now(), value }; return value })
    .catch(() => ({ configured: false })).finally(() => { statusPending = null })
  return statusPending
}

export async function fetchInlineCompletions(filePath: string, context: InlineCompletionContext, signal: AbortSignal): Promise<string[]> {
  const api = bridge()
  if (!api) return []
  const requestId = `ic-${++nextRequest}`
  const onAbort = () => { void api.cancel(requestId) }
  signal.addEventListener('abort', onAbort, { once: true })
  try {
    const result = await api.complete({ requestId, filePath, language: context.language, prefix: context.prefix, suffix: context.suffix })
    if (result.reason === 'not-configured') statusCache = { at: Date.now(), value: { configured: false } }
    return signal.aborted ? [] : result.items
  } finally { signal.removeEventListener('abort', onAbort) }
}
