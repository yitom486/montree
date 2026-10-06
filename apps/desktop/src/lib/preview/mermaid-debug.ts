/**
 * Mermaid 诊断日志。
 * - 默认开启（方便排查出图竞态）
 * - 关闭：localStorage.setItem('montree:mermaid-debug', '0') 后刷新
 * - 强制开：localStorage.setItem('montree:mermaid-debug', '1')
 */
export function isMermaidDebugEnabled(): boolean {
  if (typeof window === 'undefined') return false
  try {
    const flag = window.localStorage.getItem('montree:mermaid-debug')
    if (flag === '0') return false
    if (flag === '1') return true
  } catch {
    /* ignore */
  }
  // 未设置时：开发构建默认开
  return Boolean(import.meta.env?.DEV)
}

export function mermaidLog(stage: string, detail?: Record<string, unknown>): void {
  if (!isMermaidDebugEnabled()) return
  if (detail) {
    console.log(`[mermaid] ${stage}`, detail)
  } else {
    console.log(`[mermaid] ${stage}`)
  }
}

export function mermaidWarn(stage: string, detail?: Record<string, unknown>): void {
  if (!isMermaidDebugEnabled()) return
  if (detail) {
    console.warn(`[mermaid] ${stage}`, detail)
  } else {
    console.warn(`[mermaid] ${stage}`)
  }
}

/** 错误始终打印（不依赖 debug 开关） */
export function mermaidError(stage: string, error?: unknown, detail?: Record<string, unknown>): void {
  console.error(`[mermaid] ${stage}`, detail ?? {}, error ?? '')
}

export function summarizeMermaidSource(source: string): Record<string, unknown> {
  const firstLine = source.split(/\r?\n/, 1)[0] ?? ''
  return {
    chars: source.length,
    lines: source.split(/\r?\n/).length,
    firstLine,
    hasFlowchart: /^\s*flowchart\b/m.test(source) || /^\s*graph\b/m.test(source),
  }
}
