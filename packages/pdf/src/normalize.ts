import type {
  InspectorBookMarkdown,
  InspectorPdfClassification,
} from '@montree/contracts'
import type { NativePagesExtraction, NativePdfClassification } from './native-types'
import type { InspectorPagesMarkdown } from './models'

export function toOneIndexed(pages: readonly number[]): number[] {
  return pages
    .filter((page) => Number.isFinite(page) && page >= 0)
    .map((page) => Math.floor(page) + 1)
}

export function toZeroIndexed(
  pages: readonly number[] | undefined | null,
): number[] | undefined {
  return pages
    ?.filter((page) => Number.isFinite(page) && page >= 1)
    .map((page) => Math.floor(page) - 1)
}

export function mapClassification(
  result: NativePdfClassification,
): InspectorPdfClassification {
  return {
    pdfType: result.pdfType,
    pageCount: result.pageCount,
    pagesNeedingOcr: toOneIndexed(result.pagesNeedingOcr),
    confidence: result.confidence,
  }
}

export function mapPagesMarkdown(result: NativePagesExtraction): InspectorPagesMarkdown {
  return {
    pages: result.pages.map((page) => ({
      page: Math.floor(page.page) + 1,
      markdown: page.markdown ?? '',
    })),
    pagesWithTables: [...result.pagesWithTables],
    pagesWithColumns: [...result.pagesWithColumns],
    pagesNeedingOcr: [...result.pagesNeedingOcr],
    isComplex: result.isComplex,
  }
}

export function assembleBookMarkdown(
  result: NativePagesExtraction,
): InspectorBookMarkdown {
  const ordered = [...result.pages].sort((a, b) => a.page - b.page)
  const parts: string[] = []
  for (const page of ordered) {
    const pageNum = Math.floor(page.page) + 1
    const body = page.markdown ?? ''
    if (parts.length === 0) {
      parts.push(body)
    } else {
      parts.push(`<!-- Page ${pageNum} -->\n${body}`)
    }
  }
  return {
    markdown: parts.join('\n'),
    pageCount: ordered.length,
    pagesWithTables: [...result.pagesWithTables],
  }
}
