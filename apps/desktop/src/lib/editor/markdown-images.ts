/**
 * Markdown 预览本地图片路径解析与 HTML 替换（纯函数，可单元测试）
 */

const EXTERNAL_SRC_PATTERN = /^(https?:|data:|blob:|mailto:|\/\/)/i

function normalizeSlashes(path: string): string {
  return path.replace(/\\/g, '/')
}

function detectPathSeparator(filePath: string): '\\' | '/' {
  if (filePath.includes('\\')) return '\\'
  if (/^[A-Za-z]:/.test(filePath)) return '\\'
  return '/'
}

function splitPathParts(filePath: string): string[] {
  const normalized = normalizeSlashes(filePath.trim())
  if (/^[A-Za-z]:\//.test(normalized)) {
    const drive = normalized.slice(0, 2)
    const rest = normalized.slice(3).split('/').filter(Boolean)
    return [drive, ...rest]
  }

  if (normalized.startsWith('/')) {
    return ['', ...normalized.slice(1).split('/').filter(Boolean)]
  }

  return normalized.split('/').filter(Boolean)
}

function joinPathParts(parts: string[], separator: '\\' | '/'): string {
  if (parts.length === 0) return ''

  const [first, ...rest] = parts
  if (first === '') {
    return `/${rest.join('/')}`
  }

  if (/^[A-Za-z]:$/.test(first!)) {
    return `${first}${separator}${rest.join(separator)}`
  }

  return parts.join(separator)
}

export function isExternalImageSrc(src: string): boolean {
  const trimmed = src.trim()
  if (!trimmed) return true
  return EXTERNAL_SRC_PATTERN.test(trimmed)
}

export function isAbsoluteImagePath(src: string): boolean {
  const trimmed = normalizeSlashes(src.trim())
  return trimmed.startsWith('/') || /^[A-Za-z]:\//.test(trimmed)
}

/** 从 Markdown 图片语法中提取 src（不含 title） */
export function parseMarkdownImageSrc(raw: string): string {
  const trimmed = raw.trim()
  const unquoted = trimmed.replace(/^<|>$/g, '')
  const spaceIndex = unquoted.search(/\s/)
  return (spaceIndex === -1 ? unquoted : unquoted.slice(0, spaceIndex)).trim()
}

export function resolveLocalImagePath(
  markdownFilePath: string | undefined,
  src: string,
  literalSrc = false,
): string | null {
  let imageSrc = literalSrc ? src.trim() : parseMarkdownImageSrc(src)
  if (!imageSrc || isExternalImageSrc(imageSrc)) return null
  if (!markdownFilePath) return null
  if (literalSrc) {
    try { imageSrc = decodeURIComponent(imageSrc) } catch { /* Keep literal malformed escapes. */ }
  }

  const separator = detectPathSeparator(markdownFilePath)

  if (isAbsoluteImagePath(imageSrc)) {
    const absoluteParts = splitPathParts(imageSrc)
    return joinPathParts(absoluteParts, separator)
  }

  const baseParts = splitPathParts(markdownFilePath)
  if (baseParts.length === 0) return null
  baseParts.pop()

  const relativeParts = splitPathParts(imageSrc)
  for (const part of relativeParts) {
    if (part === '.') continue
    if (part === '..') {
      if (baseParts.length === 0 || (baseParts.length === 1 && baseParts[0] === '')) {
        return null
      }
      baseParts.pop()
      continue
    }
    baseParts.push(part)
  }

  return joinPathParts(baseParts, separator)
}

export interface LocalImageRef {
  src: string
  absolutePath: string
}

/**
 * B2：远端文档相对图片 → 工作区相对路径（经宿主读取，不拼 UNC）。
 * 绝对路径（`/x.png`）在远端语义不明（工作区根？宿主根？），显式拒绝；
 * `..` 逃出工作区根返回 null（由服务端二次校验）。
 */
export function resolveWorkspaceImageRef(
  docRelativePath: string,
  src: string,
): string | null {
  const imageSrc = parseMarkdownImageSrc(src.trim())
  if (!imageSrc || isExternalImageSrc(imageSrc)) return null
  const normalized = imageSrc.replace(/\\/g, '/')
  if (normalized.startsWith('/') || /^[A-Za-z]:\//.test(normalized)) return null
  const base = docRelativePath.replace(/\\/g, '/').split('/').filter(Boolean)
  base.pop()
  for (const part of normalized.split('/')) {
    if (!part || part === '.') continue
    if (part === '..') {
      if (base.length === 0) return null
      base.pop()
      continue
    }
    base.push(part)
  }
  if (base.length === 0) return null
  return base.join('/')
}

export function extractLocalImageRefsFromHtml(
  html: string,
  markdownFilePath: string | undefined,
): LocalImageRef[] {
  const refs: LocalImageRef[] = []
  const seen = new Set<string>()
  const pattern = /<img\b[^>]*\bsrc="([^"]+)"[^>]*>/gi

  for (const match of html.matchAll(pattern)) {
    const src = match[1]
    if (!src || seen.has(src)) continue

    const absolutePath = resolveLocalImagePath(markdownFilePath, src)
    if (!absolutePath) continue

    seen.add(src)
    refs.push({ src, absolutePath })
  }

  return refs
}

export function replaceImageSrcInHtml(
  html: string,
  replacements: Record<string, string>,
): string {
  return html.replace(
    /(<img\b[^>]*\bsrc=")([^"]+)("[^>]*>)/gi,
    (full, prefix: string, src: string, suffix: string) => {
      const nextSrc = replacements[src]
      return nextSrc ? `${prefix}${nextSrc}${suffix}` : full
    },
  )
}

export function buildImageReplacements(
  refs: LocalImageRef[],
  dataUrlsByAbsolutePath: Record<string, string | undefined>,
): Record<string, string> {
  const replacements: Record<string, string> = {}

  for (const ref of refs) {
    const dataUrl = dataUrlsByAbsolutePath[ref.absolutePath]
    if (dataUrl) {
      replacements[ref.src] = dataUrl
    }
  }

  return replacements
}
