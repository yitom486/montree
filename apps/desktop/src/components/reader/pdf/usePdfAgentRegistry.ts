import { useCallback, useEffect, useRef } from 'react'
import type { PDFDocumentProxy } from 'pdfjs-dist'
import type { RosettaBookInfo, RosettaImportState } from '@montree/contracts'
import type { ReaderUnit } from '@montree/reader-core'

declare global {
  interface Window {
    __montreeE2ePdfStructure?: {
      readCurrentPage: () => Promise<{ source: string; prefix: string }>
      status: () => { status: string; reason: string }
      inspectorStatus: () => { status: string; reason: string }
    }
  }
}
import { registerReaderContent } from '@/lib/agent/context/reader-content-registry'
import { formatPdfPageTextForAgent } from '@/lib/reader/pdf/pdf-page-text'
import { isStructuredPageTextUsable } from '@/lib/reader/pdf/pdf-structure'
import { pdfStructureClient } from '@/lib/reader/pdf/pdf-structure-client'
import { pdfInspectorClient } from '@/lib/reader/pdf/pdf-inspector-client'
import { rosettaApi } from '@/api/rosetta-api'
import { formatRosettaBlocksForAgent } from '@/lib/reader/rosetta/rosetta-agent-text'
import { resolvePdfAgentSearchBlock } from '@/lib/reader/pdf/pdf-agent-search-gate'
import { rosettaPageMissingError } from '@/lib/reader/rosetta/rosetta-read-guard'
import { iterateRosettaChapterUnits } from '@/lib/agent/context/rosetta-chapter-units'
import { useReaderNavigationStore } from '@/stores/reader-navigation-store'
import { useAppSettingsStore } from '@/stores/app-settings-store'
import { appApi } from '@/api/app-api'
import { isOk } from '@montree/contracts'

export interface UsePdfAgentRegistryOptions {
  filePath: string
  fileFingerprint: string
  numPages: number
  pageNumRef: React.RefObject<number>
  pdfDocRef: React.RefObject<PDFDocumentProxy | null>
  isScannedPdf: boolean
  isMixedPdf: boolean
  data: { data: Uint8Array } | null | undefined
  rosettaImport: { info: RosettaBookInfo | null; state: RosettaImportState }
  readPageText: (pageNumber: number, options?: { allowAutoOcr?: boolean }) => Promise<string>
}

export function usePdfAgentRegistry({
  filePath,
  fileFingerprint,
  numPages,
  pageNumRef,
  pdfDocRef,
  isScannedPdf,
  isMixedPdf,
  data,
  rosettaImport,
  readPageText,
}: UsePdfAgentRegistryOptions) {
  const rosettaInfoRef = useRef<RosettaBookInfo | null>(null)
  useEffect(() => {
    rosettaInfoRef.current = rosettaImport.info
  }, [rosettaImport.info])
  const rosettaImportStateRef = useRef<RosettaImportState>('idle')
  useEffect(() => {
    rosettaImportStateRef.current = rosettaImport.state
  }, [rosettaImport.state])

  const readRosettaPageText = useCallback(
    async (page: number): Promise<string | null> => {
      if (!fileFingerprint || !rosettaInfoRef.current) return null
      try {
        const result = await rosettaApi.queryBook({ kind: 'page', fingerprint: fileFingerprint, page })
        if (!isOk(result) || result.value.kind !== 'page' || result.value.blocks.length === 0) {
          return null
        }
        return formatRosettaBlocksForAgent(result.value.blocks)
      } catch {
        return null
      }
    },
    [fileFingerprint],
  )

  const readRosettaUnitText = useCallback(
    async (unit: ReaderUnit): Promise<{ label: string; text: string } | null> => {
      if (!fileFingerprint || !rosettaInfoRef.current) return null
      const page = Number.parseInt('href' in unit ? unit.href : '', 10)
      if (!Number.isFinite(page) || page < 1) return null
      const label = 'label' in unit && typeof unit.label === 'string' ? unit.label : ''
      try {
        const tocListResult = await rosettaApi.queryBook({ kind: 'tocEntries', fingerprint: fileFingerprint })
        if (isOk(tocListResult) && tocListResult.value.kind === 'tocEntries' && tocListResult.value.tocEntries.length > 0) {
          const entries = tocListResult.value.tocEntries
          const exact = entries.find((e) => e.title === label && e.startPage === page)
          const samePage = entries.filter((e) => e.startPage === page)
          let matched: (typeof entries)[number] | null =
            exact ?? samePage.find((e) => e.title === label) ?? samePage[0] ?? null
          if (!matched) {
            const sameTitle = [...entries].reverse().find((e) => e.startPage <= page && e.title === label)
            let nearest: (typeof entries)[number] | null = null
            for (const entry of entries) {
              if (entry.startPage <= page) nearest = entry
              else break
            }
            matched = sameTitle ?? nearest
          }
          if (matched) {
            const tocResult = await rosettaApi.queryBook({
              kind: 'toc',
              fingerprint: fileFingerprint,
              tocIndex: matched.tocIndex,
            })
            if (isOk(tocResult) && tocResult.value.kind === 'toc' && tocResult.value.blocks.length > 0) {
              return { label: tocResult.value.entry.title, text: formatRosettaBlocksForAgent(tocResult.value.blocks) }
            }
            return null
          }
          return null
        }
        const chaptersResult = await rosettaApi.queryBook({ kind: 'chapters', fingerprint: fileFingerprint })
        if (!isOk(chaptersResult) || chaptersResult.value.kind !== 'chapters') return null
        let current: { index: number; title: string } | null = null
        for (const chapter of chaptersResult.value.chapters) {
          if (chapter.startPage <= page) current = chapter
          else break
        }
        if (!current) return null
        const blocksResult = await rosettaApi.queryBook({
          kind: 'chapter',
          fingerprint: fileFingerprint,
          chapterIndex: current.index,
        })
        if (!isOk(blocksResult) || blocksResult.value.kind !== 'chapter' || blocksResult.value.blocks.length === 0) {
          return null
        }
        return { label: current.title, text: formatRosettaBlocksForAgent(blocksResult.value.blocks) }
      } catch {
        return null
      }
    },
    [fileFingerprint],
  )

  const readAgentPageTextWithSource = useCallback(
    async (page: number): Promise<{ text: string; source: 'inspector' | 'structured' | 'legacy' | 'rosetta' }> => {
      if (!Number.isFinite(page) || page < 1) {
        throw new Error(`无效的 PDF 页码：${page}`)
      }
      const total = numPages || pdfDocRef.current?.numPages || 0
      const rosettaText = await readRosettaPageText(page)
      if (rosettaText !== null) {
        return { text: formatPdfPageTextForAgent(page, total, rosettaText), source: 'rosetta' }
      }
      if (fileFingerprint && rosettaInfoRef.current) {
        throw rosettaPageMissingError(page)
      }
      const docKey = fileFingerprint || filePath
      const importRunning = rosettaImportStateRef.current === 'running'
      let inspected: string | null = pdfInspectorClient.getCachedPageText(docKey, page)
      if (inspected === null && !importRunning && !pdfInspectorClient.isUnavailable()) {
        const parsed = await pdfInspectorClient.parseDocument(docKey, filePath)
        if (parsed) inspected = pdfInspectorClient.getCachedPageText(docKey, page)
      }
      if (inspected !== null && isStructuredPageTextUsable(inspected)) {
        return { text: formatPdfPageTextForAgent(page, total, inspected), source: 'inspector' }
      }
      let structured: string | null = pdfStructureClient.getCachedPageText(docKey, page)
      if (structured === null && !importRunning && data && !pdfStructureClient.isUnavailable()) {
        const parsed = await pdfStructureClient.parseDocument(docKey, data.data.slice(0))
        if (parsed) structured = pdfStructureClient.getCachedPageText(docKey, page)
      }
      if (structured !== null && isStructuredPageTextUsable(structured)) {
        return { text: formatPdfPageTextForAgent(page, total, structured), source: 'structured' }
      }
      const allowAutoOcr = useAppSettingsStore.getState().pdfOcrAgentAutoOcr
      const text = await readPageText(page, { allowAutoOcr })
      return { text: formatPdfPageTextForAgent(page, total, text), source: 'legacy' }
    },
    [data, fileFingerprint, filePath, numPages, pdfDocRef, readPageText, readRosettaPageText],
  )

  const readAgentPageTextWithSourceRef = useRef(readAgentPageTextWithSource)
  readAgentPageTextWithSourceRef.current = readAgentPageTextWithSource

  const readAgentPageText = useCallback(
    (page: number): Promise<string> =>
      readAgentPageTextWithSource(page).then((result) => result.text),
    [readAgentPageTextWithSource],
  )

  useEffect(() => {
    const agentAutoOcr = () => useAppSettingsStore.getState().pdfOcrAgentAutoOcr
    return registerReaderContent({
      filePath,
      fileFingerprint: fileFingerprint || undefined,
      searchBlockedReason:
        resolvePdfAgentSearchBlock({
          isScannedPdf,
          isMixedPdf,
          indexed: Boolean(rosettaImport.info),
        }) ?? undefined,
      searchSource: Boolean(rosettaImport.info) ? 'index' : 'memory',
      getCurrentText: () => readAgentPageText(pageNumRef.current ?? 1),
      getViewportText: () => readAgentPageText(pageNumRef.current ?? 1),
      iterateUnits: async function* () {
        const total = pdfDocRef.current?.numPages ?? 0
        if (fileFingerprint && rosettaInfoRef.current) {
          yield* iterateRosettaChapterUnits(fileFingerprint)
          return
        }
        for (let page = 1; page <= total; page += 1) {
          try {
            const allowAutoOcr = agentAutoOcr()
            const text = await readPageText(page, { allowAutoOcr })
            yield {
              label: `第 ${page} 页`,
              text: formatPdfPageTextForAgent(page, total, text),
            }
          } catch {}
        }
      },
      getUnitByIndex: async (flatIndex) => {
        const units = useReaderNavigationStore.getState().units
        const unit = units[flatIndex]
        if (!unit) return null
        const page = Number.parseInt('href' in unit ? unit.href : '', 10)
        if (!Number.isFinite(page) || page < 1) {
          return null
        }
        const indexed = Boolean(fileFingerprint && rosettaInfoRef.current)
        try {
          const rosettaUnit = await readRosettaUnitText(unit)
          const total = pdfDocRef.current?.numPages ?? numPages
          if (rosettaUnit) {
            return {
              label: rosettaUnit.label,
              text: formatPdfPageTextForAgent(page, total, rosettaUnit.text),
            }
          }
          if (indexed) throw rosettaPageMissingError(page)
          const raw = await readPageText(page, { allowAutoOcr: agentAutoOcr() })
          return {
            label: unit.label || `第 ${page} 页`,
            text: formatPdfPageTextForAgent(page, total, raw),
          }
        } catch (cause) {
          if (indexed) throw cause
          return null
        }
      },
    })
  }, [fileFingerprint, filePath, isMixedPdf, isScannedPdf, numPages, pageNumRef, pdfDocRef, readAgentPageText, readPageText, readRosettaUnitText, rosettaImport.info])

  useEffect(() => {
    if (typeof window === 'undefined' || !appApi.isE2EPdfStructure()) return
    window.__montreeE2ePdfStructure = {
      readCurrentPage: async () => {
        const result = await readAgentPageTextWithSourceRef.current(pageNumRef.current ?? 1)
        return { source: result.source, prefix: result.text.slice(0, 200) }
      },
      status: () => pdfStructureClient.getState(),
      inspectorStatus: () => pdfInspectorClient.getState(),
    }
    return () => {
      delete window.__montreeE2ePdfStructure
    }
  }, [filePath, pageNumRef])

  return {
    readAgentPageTextWithSource,
    readAgentPageText,
    readRosettaPageText,
    readRosettaUnitText,
  }
}
