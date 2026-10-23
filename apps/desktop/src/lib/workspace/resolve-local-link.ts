import { dirname } from '@yitom/contracts'

const pendingAnchors = new Map<string, string>()

function anchorKey(path: string): string {
  return /^[A-Za-z]:[\\/]/.test(path) || path.includes('\\')
    ? path.replace(/\//g, '\\').toLowerCase()
    : path
}

/** 记录跨文件跳转的目标锚点，由目标文档渲染完成后消费。 */
export function rememberLocalAnchor(path: string, anchor: string | undefined): void {
  if (anchor) pendingAnchors.set(anchorKey(path), anchor)
  else pendingAnchors.delete(anchorKey(path))
}

export function peekLocalAnchor(path: string): string | undefined {
  return pendingAnchors.get(anchorKey(path))
}

export function clearLocalAnchor(path: string): void {
  pendingAnchors.delete(anchorKey(path))
}

export function takeLocalAnchor(path: string): string | undefined {
  const anchor = peekLocalAnchor(path)
  clearLocalAnchor(path)
  return anchor
}

/**
 * 把 HTML/Markdown 中的相对链接解析为当前文档旁的本地文件路径。
 * - `#anchor`、纯查询串、http(s)/mailto/tel 等返回 null（交给页面/系统处理）
 * - 支持 `./`、`../`、百分号编码和同文件 query/hash
 * - 不访问文件系统；目标是否存在由打开文件的调用方判断
 */
export function resolveLocalLink(filePath: string, href: string): string | null {
  const value = href.trim()
  if (!value || value.startsWith('#') || value.startsWith('//')) return null
  if (/^(?:https?|mailto|tel|data|javascript):/i.test(value)) return null

  if (/^file:/i.test(value)) {
    try {
      const pathname = decodeURIComponent(new URL(value).pathname)
      if (/^\/[A-Za-z]:\//.test(pathname)) return pathname.slice(1).replace(/\//g, '\\')
      return pathname
    } catch {
      return null
    }
  }

  const target = value.split(/[?#]/, 1)[0]
  if (!target) return null

  let decoded: string
  try {
    decoded = decodeURIComponent(target)
  } catch {
    decoded = target
  }

  const sep = filePath.includes('\\') ? '\\' : '/'
  const parts = dirname(filePath).split(/[\\/]/)
  for (const part of decoded.replace(/\\/g, '/').split('/')) {
    if (!part || part === '.') continue
    if (part === '..') {
      if (parts.length > 1) parts.pop()
      continue
    }
    parts.push(part)
  }
  return parts.join(sep)
}
