type WebDocLogDetail = Record<string, unknown>

/** 开发环境在线文档流程日志；控制台执行 localStorage.setItem('montree:webdoc:debug','1') 可强制开启 */
export function isWebDocDebugEnabled(): boolean {
  if (typeof window === 'undefined') return import.meta.env.DEV
  try {
    return import.meta.env.DEV || window.localStorage.getItem('montree:webdoc:debug') === '1'
  } catch {
    return import.meta.env.DEV
  }
}

export function logWebDoc(stage: string, detail?: WebDocLogDetail): void {
  if (!isWebDocDebugEnabled()) return
  if (detail) {
    console.info(`[web-doc] ${stage}`, detail)
    return
  }
  console.info(`[web-doc] ${stage}`)
}
