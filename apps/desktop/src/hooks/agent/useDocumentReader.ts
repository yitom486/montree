import { useEffect, useRef } from 'react'
import { registerReaderContent, type ReaderUnitText } from '@/lib/agent/context/reader-content-registry'
import { clearReaderSelection, commitReaderSelection, registerSelectionProvider } from '@/lib/agent/context/reader-selection-registry'
import { collectDomImages } from '@/lib/agent/context/reader-visual-context'

export interface DocumentReaderOptions {
  filePath: string
  root: () => HTMLElement | null
  text?: () => string
  units?: () => ReaderUnitText[]
  currentIndex?: () => number
  viewportText?: () => string
  iterateUnits?: () => AsyncIterable<ReaderUnitText>
  selectionManaged?: boolean
}

export function useDocumentReader(options: DocumentReaderOptions): void {
  const latest = useRef(options)
  latest.current = options
  useEffect(() => {
    const root = (): HTMLElement => {
      if (latest.current.filePath !== options.filePath) throw new Error('文档刚刚切换，请重新读取')
      const node = latest.current.root()
      if (!node) throw new Error('文档正在加载，请稍后重试')
      return node
    }
    const text = (): string => {
      if (latest.current.filePath !== options.filePath) throw new Error('文档刚刚切换，请重新读取')
      return latest.current.text?.() ?? root().innerText ?? root().textContent ?? ''
    }
    const units = (): ReaderUnitText[] => latest.current.units?.() ?? [{ label: '正文', text: text() }]
    const disposeContent = registerReaderContent({
      filePath: options.filePath,
      getCurrentText: text,
      getUnits: () => units().map(({ label, level, href }) => ({ label, ...(level !== undefined ? { level } : {}), ...(href ? { href } : {}) })),
      getCurrentUnitIndex: () => latest.current.currentIndex?.() ?? 0,
      getUnitByIndex: (index) => units()[index] ?? null,
      iterateUnits: async function* () {
        if (latest.current.iterateUnits) yield* latest.current.iterateUnits()
        else for (const unit of units()) yield unit
      },
      getImages: (scope) => collectDomImages([root()], scope),
      getImageCount: () => { try { return collectDomImages([root()], 'current').length } catch { return 0 } },
      getViewportText: () => {
        if (latest.current.viewportText) return latest.current.viewportText()
        const node = root()
        const win = node.ownerDocument.defaultView
        const host = node.getBoundingClientRect()
        const walker = node.ownerDocument.createTreeWalker(node, NodeFilter.SHOW_TEXT)
        const lines: string[] = []
        let visited = 0
        while (walker.nextNode() && visited++ < 20000) {
          const textNode = walker.currentNode
          const element = textNode.parentElement
          const text = textNode.textContent?.trim()
          if (!element || !text || element.closest('button, script, style, textarea, select')) continue
          const range = node.ownerDocument.createRange()
          range.selectNodeContents(textNode)
          const visible = Array.from(range.getClientRects()).some((rect) => rect.width > 0 && rect.height > 0 && rect.bottom > Math.max(0, host.top) && rect.top < Math.min(host.bottom, win?.innerHeight ?? 0) && rect.right > Math.max(0, host.left) && rect.left < Math.min(host.right, win?.innerWidth ?? 0))
          if (visible && win?.getComputedStyle(element).visibility !== 'hidden') lines.push(text)
        }
        return lines.join('\n')
      },
    })
    if (options.selectionManaged) return disposeContent
    const disposeSelection = registerSelectionProvider({ filePath: options.filePath,
      getSelectionText: () => {
        const node = latest.current.root()
        const selection = node?.ownerDocument.getSelection()
        return selection && node?.contains(selection.anchorNode) && node.contains(selection.focusNode) ? selection.toString() : null
      } })
    const select = (): void => {
      const node = latest.current.root()
      const selection = node?.ownerDocument.getSelection()
      if (selection && node?.contains(selection.anchorNode) && node.contains(selection.focusNode) && selection.toString().trim()) commitReaderSelection(options.filePath, selection.toString())
    }
    // iframe 的选区在自己的 document 中，轮询绑定仅用于首次加载/刷新后的文档替换。
    let bound: Document | null = null
    const bind = (): void => {
      const doc = latest.current.root()?.ownerDocument ?? null
      if (doc === bound) return
      bound?.removeEventListener('mouseup', select)
      bound = doc
      bound?.addEventListener('mouseup', select)
    }
    bind()
    const timer = setInterval(bind, 500)
    return () => { clearInterval(timer); bound?.removeEventListener('mouseup', select); disposeContent(); disposeSelection(); clearReaderSelection() }
  }, [options.filePath, options.selectionManaged])
}
