import type { ReaderImageReference, ReaderVisualContext, ReaderViewportRect } from '@yitom/contracts'
import { markdownParser } from '@/lib/editor/markdown'
import { getReaderContentProvider } from './reader-content-registry'

export const READER_IMAGE_LIMIT = 20

function shortText(value: string | null | undefined): string | undefined {
  return value?.replace(/\s+/g, ' ').trim().slice(0, 240) || undefined
}

function imageSource(src: string | null | undefined, baseUrl?: string): string | undefined {
  if (!src || src.startsWith('data:')) return undefined
  try {
    const url = new URL(src, baseUrl)
    return ['http:', 'https:', 'file:', 'blob:'].includes(url.protocol) && url.href.length <= 2000 ? url.href : undefined
  } catch {
    return undefined
  }
}

function isVisible(element: Element): boolean {
  const rect = element.getBoundingClientRect()
  const win = element.ownerDocument.defaultView
  if (!win || rect.width <= 0 || rect.height <= 0) return false
  const style = win.getComputedStyle(element)
  if (style.display === 'none' || style.visibility === 'hidden') return false
  if (rect.bottom <= 0 || rect.top >= win.innerHeight || rect.right <= 0 || rect.left >= win.innerWidth) return false
  const frame = win.frameElement
  return !frame || isVisible(frame)
}

export function collectDomImages(documents: readonly (Document | Element)[], scope: 'current' | 'viewport', baseUrl?: string): ReaderImageReference[] {
  const images: ReaderImageReference[] = []
  for (const doc of documents) {
    for (const element of doc.querySelectorAll('img, svg, canvas')) {
      if (element.tagName.toLowerCase() === 'svg' && element.parentElement?.closest('svg')) continue
      const kind = element.tagName.toLowerCase() as 'img' | 'svg' | 'canvas'
      if (kind !== 'img') {
        const rect = element.getBoundingClientRect()
        if (rect.width < 48 || rect.height < 48) continue
      }
      const visible = isVisible(element)
      if (scope === 'viewport' && !visible) continue
      const img = kind === 'img' ? element as HTMLImageElement : null
      const src = img?.currentSrc || element.getAttribute('src') || element.getAttribute('data-src')
      images.push({
        id: `image-${images.length + 1}`,
        kind: kind === 'img' ? 'image' : kind,
        src: imageSource(src, baseUrl ?? doc.baseURI),
        alt: shortText(element.getAttribute('alt') || element.getAttribute('aria-label') || element.querySelector('title')?.textContent),
        caption: shortText(element.closest('figure')?.querySelector('figcaption')?.textContent),
        visible,
        ...(img ? { loaded: img.complete && img.naturalWidth > 0 } : {}),
      })
    }
  }
  return images
}

export function collectMarkdownImages(markdown: string, filePath: string): ReaderImageReference[] {
  const normalized = filePath.replace(/\\/g, '/')
  const baseUrl = `file://${normalized.startsWith('/') ? '' : '/'}${normalized.split('/').map((part, index) =>
    index === 0 && /^[a-z]:$/i.test(part) ? part : encodeURIComponent(part)).join('/')}`
  const images: ReaderImageReference[] = []
  const visit = (tokens: ReturnType<typeof markdownParser.parse>): void => {
    for (const token of tokens) {
      if (token.type === 'image') {
        const rawSrc = token.attrGet('src')
        const srcStr = typeof rawSrc === 'string' ? rawSrc : null
        images.push({
          id: `image-${images.length + 1}`,
          kind: 'image',
          src: imageSource(srcStr, baseUrl),
          alt: shortText(token.content),
        })
      }
      if (token.children) visit(token.children)
    }
  }
  visit(markdownParser.parse(markdown, {}))
  return images
}

export function getReaderViewportRect(): ReaderViewportRect | null {
  if (typeof document === 'undefined') return null
  const elements = Array.from(document.querySelectorAll('[data-reader-viewport]'))
  const element = document.fullscreenElement?.matches('[data-reader-viewport]') ? document.fullscreenElement : elements.find(isVisible)
  if (!element) return null
  const rect = element.getBoundingClientRect()
  const x = Math.max(0, Math.ceil(rect.left))
  const y = Math.max(0, Math.ceil(rect.top))
  const width = Math.floor(Math.min(window.innerWidth, rect.right)) - x
  const height = Math.floor(Math.min(window.innerHeight, rect.bottom)) - y
  return width > 0 && height > 0 ? { x, y, width, height } : null
}

export async function readReaderVisualContext(scope: 'current' | 'viewport' = 'current'): Promise<ReaderVisualContext> {
  const provider = getReaderContentProvider()
  if (!provider) throw new Error('当前没有可读取的文档')
  const effectiveScope = provider.imageScope ?? scope
  const images = await provider.getImages?.(effectiveScope) ?? []
  if (getReaderContentProvider() !== provider) throw new Error('文档刚刚切换，请重新获取图片信息')
  return {
    documentPath: provider.filePath, scope: effectiveScope, total: images.length,
    truncated: images.length > READER_IMAGE_LIMIT, images: images.slice(0, READER_IMAGE_LIMIT),
    viewport: getReaderViewportRect(),
    note: `${scope !== effectiveScope ? '该格式的图片列表来自当前文档/页，无法精确筛选视口内图片；scope 已标为 current。' : ''}图片地址不是图片内容。blob 地址仅在当前应用会话有效；无地址的 SVG/canvas 可用 montree_capture_viewport 查看。PDF 图片列表仅统计栅格图片绘制，矢量图需查看截图。`,
  }
}
