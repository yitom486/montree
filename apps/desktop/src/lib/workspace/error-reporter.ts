import { toast } from 'sonner'
import { appApi } from '@/api/app-api'
import { useErrorLogStore } from '@/stores/error-log-store'
import { isAppError, isCancelled, type AppError } from '@montree/contracts'
import type { RendererErrorPayload } from '@montree/contracts'

/** 非 CANCELLED 错误统一以 Sonner Toast 提示（A2：自 report-error.ts 搬入以断循环） */
export function reportAppError(error: AppError): void {
  if (isCancelled(error)) return
  toast.error('操作失败', { description: error.message })
}

export interface RuntimeErrorContext {
  source: string
  filePath?: string
  componentStack?: string
  /** 仅写入日志，不弹 Toast（用于已展示 fallback UI 的边界） */
  silentToast?: boolean
  level?: RendererErrorPayload['level']
  /** 失败的操作（透传进日志条目 op，便于聚合） */
  op?: string
  /** 结构化上下文（透传进日志条目 data，如 latencyMs） */
  data?: Record<string, unknown>
}

let lastToastKey = ''
let lastToastAt = 0

function normalizeError(reason: unknown): { message: string; stack?: string } {
  if (reason instanceof Error) {
    return { message: reason.message || reason.name, stack: reason.stack }
  }
  if (typeof reason === 'string') {
    return { message: reason }
  }
  try {
    return { message: JSON.stringify(reason) }
  } catch {
    return { message: String(reason) }
  }
}

function shouldShowToast(source: string, message: string, silentToast?: boolean): boolean {
  if (silentToast) return false

  const key = `${source}:${message}`
  const now = Date.now()
  if (key === lastToastKey && now - lastToastAt < 3000) {
    return false
  }

  lastToastKey = key
  lastToastAt = now
  return true
}

export function reportRuntimeError(reason: unknown, context: RuntimeErrorContext): void {
  if (isAppError(reason)) {
    reportAppError(reason)
    return
  }

  const { message, stack } = normalizeError(reason)
  const entry: RendererErrorPayload = {
    timestamp: new Date().toISOString(),
    level: context.level ?? 'error',
    source: context.source,
    message,
    stack,
    componentStack: context.componentStack,
    filePath: context.filePath,
    op: context.op,
    data: context.data,
  }

  useErrorLogStore.getState().addEntry(entry)
  console.error(`[${context.source}]`, reason, context.componentStack ?? '')

  void appApi.logRendererError(entry)

  if (shouldShowToast(context.source, message, context.silentToast)) {
    toast.error('运行出错', {
      description: `[${context.source}] ${message}`,
      duration: 8000,
    })
  }
}

export function formatErrorLogEntry(entry: RendererErrorPayload): string {
  const lines = [
    `[${entry.timestamp}] ${entry.level.toUpperCase()} · ${entry.source}${entry.op ? ` · op=${entry.op}` : ''}`,
    entry.message,
  ]
  if (entry.filePath) lines.push(`file: ${entry.filePath}`)
  if (entry.data && Object.keys(entry.data).length > 0) {
    try {
      lines.push(`data: ${JSON.stringify(entry.data)}`)
    } catch {
      lines.push('data: [unserializable]')
    }
  }
  if (entry.stack) lines.push(entry.stack)
  if (entry.componentStack) lines.push(entry.componentStack)
  return lines.join('\n')
}
