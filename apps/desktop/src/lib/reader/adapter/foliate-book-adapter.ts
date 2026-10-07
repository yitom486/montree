/**
 * foliate 统一后端：EPUB / MOBI / KF8 同一套实现。
 * - 入口统一用 `makeBook` 按魔数识别（不按扩展名分流，解决双格式 MOBI 误判整类问题）。
 * - `view.js` 动态导入：模块顶层执行 `customElements.define` 需要 DOM，
 *   且避免首屏 chunk 被拖入 foliate。
 * - 需要 DOM 全局（浏览器 / happy-dom 单测）；bun 纯脚本环境不可用。
 */
import { parse as parseCfi, isCFI as isCfiPattern } from '@foliate/epubcfi.js'
import type { FoliateBook, FoliateTocItem } from '@foliate/view.js'
import {
  detectAdapterBookKind,
  type AdapterBookKind,
  type AdapterLocation,
  type AdapterSectionInfo,
  type AdapterTocItem,
  type IReaderBookAdapter,
} from '@/lib/reader/reader-adapter'

function normalizeSectionId(id: string): string {
  const noFragment = id.split('#')[0] ?? id
  return decodeURI(noFragment).replace(/^\.\//, '')
}

function findSectionIndex(sectionIds: string[], href: string): number | null {
  const normalized = normalizeSectionId(href)
  if (!normalized) return null
  const exact = sectionIds.findIndex((id) => normalizeSectionId(id) === normalized)
  if (exact >= 0) return exact
  const base = normalized.split('/').pop() ?? normalized
  const byBase = sectionIds.findIndex((id) => {
    const idBase = normalizeSectionId(id).split('/').pop() ?? ''
    return idBase !== '' && idBase === base
  })
  return byBase >= 0 ? byBase : null
}

/**
 * CFI 包级路径首段（如 /6/4）→ spine 序号。IDPF 约定偶数步进：第 i 节 ⇔ 步进 (i+1)*2。
 * 越界/畸形返回 null；range 精度由 view.resolveCFI 在 live 文档上保证，此处只定章节。
 */
function spineIndexFromCfiParts(parts: unknown): number | null {
  const top: unknown = Array.isArray(parts)
    ? parts[0]
    : (parts as { parent?: unknown[] } | null)?.parent?.[0]
  const steps = Array.isArray(top) ? (top as Array<{ index?: unknown }>) : null
  const spineStep = steps && steps.length >= 2 ? steps[1] : null
  if (!spineStep || typeof spineStep.index !== 'number') return null
  const index = spineStep.index / 2 - 1
  return Number.isInteger(index) && index >= 0 ? index : null
}

function resolveSectionIndex(
  book: FoliateBook,
  sectionIds: string[],
  href: string | null | undefined,
): number | null {
  if (!href) return null
  const fromIds = findSectionIndex(sectionIds, href)
  if (fromIds !== null) return fromIds

  const anyBook = book as unknown as {
    splitTOCHref?: (href: string) => [unknown, unknown]
    resolveHref?: (href: string) => { index?: number } | Promise<{ index?: number }>
  }

  if (typeof anyBook.splitTOCHref === 'function') {
    try {
      const res = anyBook.splitTOCHref(href)
      if (Array.isArray(res) && typeof res[0] === 'number' && res[0] >= 0) {
        return res[0]
      }
    } catch {}
  }

  if (typeof anyBook.resolveHref === 'function') {
    try {
      const res = anyBook.resolveHref(href)
      if (res && !(res instanceof Promise) && typeof res.index === 'number' && res.index >= 0) {
        return res.index
      }
    } catch {}
  }

  return null
}

function mapTocItem(
  item: FoliateTocItem,
  book: FoliateBook,
  sectionIds: string[],
  level = 0,
): AdapterTocItem {
  return {
    label: item.label ?? '',
    href: item.href ?? null,
    sectionIndex: resolveSectionIndex(book, sectionIds, item.href),
    level,
    children: (item.subitems ?? []).map((child) => mapTocItem(child, book, sectionIds, level + 1)),
  }
}

export class FoliateBookAdapter implements IReaderBookAdapter {
  readonly kind: AdapterBookKind
  readonly title: string
  readonly language?: string
  readonly toc: AdapterTocItem[]
  readonly sections: AdapterSectionInfo[]

  private constructor(
    private readonly book: FoliateBook,
    kind: AdapterBookKind,
  ) {
    this.kind = kind
    this.title = book.metadata?.title ?? ''
    this.language = book.metadata?.language
    const sectionIds = book.sections.map((section) => String(section.id))
    this.toc = (book.toc ?? []).map((item) => mapTocItem(item, book, sectionIds))
    this.sections = book.sections.map((section, index) => ({
      index,
      id: String(section.id),
      linear: section.linear !== 'no',
    }))
    this.sectionIds = sectionIds
  }

  private readonly sectionIds: string[]

  get engineBook(): FoliateBook {
    return this.book
  }

  static async open(data: Uint8Array, fileName: string): Promise<FoliateBookAdapter> {
    const { makeBook } = await import('@foliate/view.js')
    const file = new File([data as BlobPart], fileName)
    const book = await makeBook(file)
    return new FoliateBookAdapter(book, detectAdapterBookKind(fileName))
  }

  async loadSectionText(index: number): Promise<string> {
    const section = this.book.sections[index]
    if (!section?.createDocument) return ''
    const doc = await section.createDocument()
    return doc.documentElement?.textContent?.replace(/\s+/g, ' ').trim() ?? ''
  }

  resolveHref(href: string): number | null {
    return resolveSectionIndex(this.book, this.sectionIds, href)
  }

  async resolveLegacyEpubCfi(cfi: string): Promise<AdapterLocation | null> {
    const normalized = cfi.trim()
    if (!isCfiPattern.test(normalized)) return null
    let index: number | null = null
    try {
      index = spineIndexFromCfiParts(parseCfi(normalized))
    } catch {
      return null
    }
    // 包级 spine 步进精确定位（试解因宽容语义不可靠，已移除）；range 精度由 view.resolveCFI 保证
    if (index === null || index >= this.book.sections.length) return null
    return { sectionIndex: index, cfi: normalized }
  }

  toLegacyEpubCfi(location: AdapterLocation): string | null {
    if (location.cfi && isCfiPattern.test(location.cfi)) return location.cfi
    const section = this.book.sections[location.sectionIndex]
    // spine 基线 CFI；range 级精度待 viewer 阶段（需渲染后 Range）补充
    return section?.cfi ?? null
  }

  destroy(): void {
    for (const section of this.book.sections) {
      try {
        section.unload?.()
      } catch {
        // 卸载失败不影响关闭流程
      }
    }
  }
}

export async function openFoliateBook(
  data: Uint8Array,
  fileName: string,
): Promise<FoliateBookAdapter> {
  return FoliateBookAdapter.open(data, fileName)
}
