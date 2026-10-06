import { getDocumentKind } from '@montree/contracts'
import { resolveWebDocDocumentId, resolveWebDocSiteId } from '@montree/web-doc'
import type { ReaderFormat } from '@montree/reader-core'
import { useActiveDocumentStore } from '@/stores/active-document-store'
import { useReaderNavigationStore } from '@/stores/reader-navigation-store'
import type { MontreeActiveDocument, MontreeReadingState } from './turn-context'

export const TOC_TOP_LEVEL_LIMIT = 10
export const TOC_TOP_LEVEL_LABEL_MAX = 40

/**
 * T2 阅读位置键（纯函数）：PDF 用页码（同章内 19→20 也变键，不用 flatIndex）；
 * 其他已就绪格式（epub / web，MOBI 在 store 里也是 epub）用 flatIndex；
 * 否则 null。不含 URL、路径、文件名。
 */
export function resolveReaderLocationKey(
  format: ReaderFormat | null,
  pageNum: number | null,
  flatIndex: number,
): string | null {
  if (format === 'pdf') {
    return typeof pageNum === 'number' && pageNum >= 1 ? `pdf:${pageNum}` : null
  }
  if (format === 'epub' || format === 'web') {
    return flatIndex >= 0 ? `${format}:${flatIndex}` : null
  }
  return null
}

/** 从 navigation store 读 format/pageNum/flatIndex，供 buildMontreePromptPrefix 使用 */
export function collectReaderLocationKey(): string | null {
  const reader = useReaderNavigationStore.getState()
  if (!reader.ready) return null
  return resolveReaderLocationKey(reader.format, reader.pageNum, reader.nav.flatIndex)
}

export function baseName(filePath: string): string {
  const index = Math.max(filePath.lastIndexOf('/'), filePath.lastIndexOf('\\'))
  return index === -1 ? filePath : filePath.slice(index + 1)
}

function activeDocumentDisplayName(path: string, kind: MontreeActiveDocument['kind']): string {
  if (kind === 'web') {
    try {
      const url = new URL(path)
      const pathname = url.pathname.replace(/\/$/, '') || '/'
      return pathname === '/' ? url.hostname : `${url.hostname}${pathname}`
    } catch {
      return path
    }
  }
  return baseName(path)
}

export function collectActiveDocument(): MontreeActiveDocument | null {
  const rawPath = useActiveDocumentStore.getState().filePath?.trim()
  if (!rawPath) return null
  const kind = getDocumentKind(rawPath)
  const path =
    kind === 'web' ? resolveWebDocDocumentId(rawPath, resolveWebDocSiteId(rawPath)) : rawPath
  return {
    path,
    kind,
    name: activeDocumentDisplayName(rawPath, kind),
  }
}

function clipLabel(label: string, max = TOC_TOP_LEVEL_LABEL_MAX): string {
  const trimmed = label.replace(/\s+/g, ' ').trim()
  if (trimmed.length <= max) return trimmed
  return `${trimmed.slice(0, max)}…`
}

/**
 * 取目录顶层标题（最少缩进那一层），最多 {@link TOC_TOP_LEVEL_LIMIT} 条。
 * 扁平目录则取前 N 条。无可用标题时返回 undefined。
 */
export function collectTocTopLevel(
  units: readonly { label: string; level?: number }[],
  limit = TOC_TOP_LEVEL_LIMIT,
): string[] | undefined {
  if (units.length === 0) return undefined

  const minLevel = Math.min(...units.map((unit) => unit.level ?? 0))
  const top = units.filter((unit) => (unit.level ?? 0) === minLevel)
  const source = top.length > 0 ? top : units

  const labels: string[] = []
  const seen = new Set<string>()
  for (const unit of source) {
    const label = clipLabel(unit.label)
    if (!label || seen.has(label)) continue
    seen.add(label)
    labels.push(label)
    if (labels.length >= limit) break
  }

  return labels.length > 0 ? labels : undefined
}

/** 阅读器进度：只有当阅读器确实停在同一个文件上时才给，避免报陈旧状态 */
export function collectReadingState(
  doc: MontreeActiveDocument | null,
): MontreeReadingState | undefined {
  if (!doc) return undefined
  const reader = useReaderNavigationStore.getState()
  if (!reader.ready || reader.filePath !== doc.path) return undefined

  const unitCount = reader.units.length
  const { flatIndex } = reader.nav
  const percent =
    unitCount > 0 && flatIndex >= 0
      ? Math.round(((flatIndex + 1) / unitCount) * 100)
      : undefined

  return {
    percent,
    current: reader.nav.current?.label,
    previous: reader.nav.previous?.label,
    next: reader.nav.next?.label,
    unitCount: unitCount > 0 ? unitCount : undefined,
    // T1：仅 PDF 写当前页；EPUB 连键都不给（不许编页码）
    ...(doc.kind === 'pdf' && typeof reader.pageNum === 'number' && reader.pageNum >= 1
      ? { page: reader.pageNum }
      : {}),
  }
}

/** 当前打开电子书的顶层目录；Markdown / 未就绪阅读器不附带 */
export function collectTocTopLevelForDocument(
  doc: MontreeActiveDocument | null,
): string[] | undefined {
  if (!doc) return undefined
  const reader = useReaderNavigationStore.getState()
  if (!reader.ready || reader.filePath !== doc.path) return undefined
  return collectTocTopLevel(reader.units)
}
