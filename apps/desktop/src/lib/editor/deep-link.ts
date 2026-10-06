/**
 * 跨格式深度回跳协议解析与构建（montree://open?file=...）
 */

export interface DeepLinkTarget {
  /** 文件路径（绝对路径或工作区相对路径） */
  file: string
  /** PDF 等分页格式的页码（1-indexed） */
  page?: number
  /** EPUB 锚点 CFI */
  cfi?: string
  /** Markdown 目标行号（1-indexed） */
  line?: number
  /** 其它通用锚点标识 */
  anchor?: string
}

export const DEEP_LINK_PROTOCOL = 'montree'
export const DEEP_LINK_PREFIX = 'montree://open'

/**
 * 构建深度回跳 URL
 * 示例：montree://open?file=books%2Fdemo.pdf&page=12
 */
export function buildDeepLinkUrl(target: DeepLinkTarget): string {
  const params = new URLSearchParams()
  params.set('file', target.file)

  if (typeof target.page === 'number' && Number.isFinite(target.page)) {
    params.set('page', String(target.page))
  }
  if (target.cfi) {
    params.set('cfi', target.cfi)
  }
  if (typeof target.line === 'number' && Number.isFinite(target.line)) {
    params.set('line', String(target.line))
  }
  if (target.anchor) {
    params.set('anchor', target.anchor)
  }

  return `${DEEP_LINK_PREFIX}?${params.toString()}`
}

/**
 * 解析深度回跳 URL
 * 支持 montree://open?file=... 以及 http(s) 扩展伪协议
 */
export function parseDeepLinkUrl(rawUrl: string): DeepLinkTarget | null {
  const trimmed = rawUrl.trim()
  if (!trimmed.startsWith(`${DEEP_LINK_PROTOCOL}://`)) {
    return null
  }

  try {
    // 使用假协议头让 WHATWG URL 解析 query 参数；同时校验 path 必须为 /open，
    // 避免 montree://任意路径 被当作回跳链接处理（main 侧原样转发）。
    const parsed = new URL(trimmed.replace(/^montree:\/\//, 'http://localhost/'))
    if (parsed.pathname !== '/open') {
      return null
    }
    const file = parsed.searchParams.get('file')
    if (!file) {
      return null
    }

    const result: DeepLinkTarget = { file }

    const rawPage = parsed.searchParams.get('page')
    if (rawPage) {
      const pageNum = Number.parseInt(rawPage, 10)
      if (Number.isFinite(pageNum) && pageNum > 0) {
        result.page = pageNum
      }
    }

    const cfi = parsed.searchParams.get('cfi')
    if (cfi) {
      result.cfi = cfi
    }

    const rawLine = parsed.searchParams.get('line')
    if (rawLine) {
      const lineNum = Number.parseInt(rawLine, 10)
      if (Number.isFinite(lineNum) && lineNum > 0) {
        result.line = lineNum
      }
    }

    const anchor = parsed.searchParams.get('anchor')
    if (anchor) {
      result.anchor = anchor
    }

    return result
  } catch {
    return null
  }
}

/**
 * 判断链接是否为 montree 深度回跳链接
 */
export function isDeepLinkUrl(url: string): boolean {
  return url.trim().startsWith(`${DEEP_LINK_PROTOCOL}://`)
}
