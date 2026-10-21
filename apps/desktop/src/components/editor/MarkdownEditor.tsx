import {
  defaultKeymap,
  history,
  historyKeymap,
  indentWithTab,
} from '@codemirror/commands'
import { closeBrackets, closeBracketsKeymap } from '@codemirror/autocomplete'
import { languages } from '@codemirror/language-data'
import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { GFM, Table, TaskList, Strikethrough } from '@lezer/markdown'
import { livePreviewExtension } from '@/lib/editor/live-preview'
import type { TextDocument } from '@/lib/editor/text-document'
import {
  bracketMatching,
  foldGutter,
  indentOnInput,
  indentUnit,
} from '@codemirror/language'
import { highlightSelectionMatches, search } from '@codemirror/search'
import { buildThemeExtensions } from '@/lib/editor/codemirror-theme'
import {
  buildImagePasteChange,
  handlePasteImageEvent,
} from '@/lib/editor/codemirror-paste-image'
import { markdownFormattingKeymap } from '@/lib/editor/markdown-editor-commands'
import { markdownLintGutter, markdownSyntaxLinter } from '@/lib/editor/codemirror-syntax-linter'
import { wikilinkAutocomplete, type WikilinkCandidate } from '@/lib/editor/wikilink-completion'
import { reportRuntimeError } from '@/lib/workspace/error-reporter'
import { Compartment, EditorState, Transaction } from '@codemirror/state'
import {
  drawSelection,
  dropCursor,
  EditorView,
  highlightActiveLine,
  highlightActiveLineGutter,
  keymap,
  lineNumbers,
  placeholder,
} from '@codemirror/view'
import { applyScrollRatio, scrollRatio } from '@/lib/editor/markdown-headings'
import type { AppTheme } from '@/stores/editor-ui-store'
import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
} from 'react'

export interface MarkdownEditorHandle {
  getView: () => EditorView | null
  getTopVisibleLine: () => number
  getLineScrollRatio: () => number
  scrollToLine: (line: number) => void
  scrollToLineRatio: (ratio: number) => void
  getScrollRatio: () => number
  setScrollRatio: (ratio: number) => void
  getScrollElement: () => HTMLElement | null
  getSelectionText: () => string | null
}

interface MarkdownEditorProps {
  value: string
  filePath?: string
  theme?: AppTheme
  tabSize?: number
  fontSize?: number
  onChange: (value: string) => void
  onScroll?: () => void
  onPasteImage?: (blob: Blob, mimeType: string) => Promise<string | null>
  getWikilinkCandidates?: () => WikilinkCandidate[]
  livePreview?: boolean
  textDocument?: TextDocument
}

const themeCompartment = new Compartment()
const tabSizeCompartment = new Compartment()
const indentUnitCompartment = new Compartment()
const livePreviewCompartment = new Compartment()

export const MarkdownEditor = forwardRef<MarkdownEditorHandle, MarkdownEditorProps>(
  function MarkdownEditor(
    {
      value,
      filePath,
      theme = 'dark',
      tabSize = 2,
      fontSize = 15,
      livePreview = true,
      textDocument,
      onChange,
      onScroll,
      onPasteImage,
      getWikilinkCandidates,
    },
    ref,
  ) {
    const containerRef = useRef<HTMLDivElement>(null)
    const viewRef = useRef<EditorView | null>(null)
    const onChangeRef = useRef(onChange)
    const onScrollRef = useRef(onScroll)
    const onPasteImageRef = useRef(onPasteImage)
    const getWikilinkCandidatesRef = useRef(getWikilinkCandidates)

    onChangeRef.current = onChange
    onScrollRef.current = onScroll
    onPasteImageRef.current = onPasteImage
    getWikilinkCandidatesRef.current = getWikilinkCandidates

    useImperativeHandle(ref, () => ({
      getView: () => viewRef.current,
      getTopVisibleLine: () => {
        const view = viewRef.current
        if (!view) return 0

        const block = view.lineBlockAtHeight(view.scrollDOM.scrollTop + 8)
        return view.state.doc.lineAt(block.from).number - 1
      },
      getLineScrollRatio: () => {
        const view = viewRef.current
        if (!view) return 0

        const totalLines = view.state.doc.lines
        if (totalLines <= 1) return 0

        const block = view.lineBlockAtHeight(view.scrollDOM.scrollTop + 8)
        const visibleLine = view.state.doc.lineAt(block.from).number - 1
        return visibleLine / (totalLines - 1)
      },
      scrollToLine: (line) => {
        const view = viewRef.current
        if (!view) return

        const safeLine = Math.max(1, Math.min(view.state.doc.lines, line + 1))
        const lineInfo = view.state.doc.line(safeLine)
        view.dispatch({
          effects: EditorView.scrollIntoView(lineInfo.from, { y: 'start', yMargin: 16 }),
        })
        view.focus()
      },
      scrollToLineRatio: (ratio) => {
        const view = viewRef.current
        if (!view) return

        const totalLines = view.state.doc.lines
        if (totalLines <= 1) return

        const clamped = Math.max(0, Math.min(1, ratio))
        const targetLine = Math.round(clamped * (totalLines - 1))
        const lineInfo = view.state.doc.line(targetLine + 1)
        view.dispatch({
          effects: EditorView.scrollIntoView(lineInfo.from, { y: 'start', yMargin: 16 }),
        })
      },
      getScrollRatio: () => {
        const scroller = viewRef.current?.scrollDOM
        return scroller ? scrollRatio(scroller) : 0
      },
      setScrollRatio: (ratio) => {
        const scroller = viewRef.current?.scrollDOM
        if (scroller) applyScrollRatio(scroller, ratio)
      },
      getScrollElement: () => viewRef.current?.scrollDOM ?? null,
      getSelectionText: () => {
        const view = viewRef.current
        if (!view) return null
        const { from, to } = view.state.selection.main
        if (from === to) return null
        const text = view.state.sliceDoc(from, to).trim()
        return text || null
      },
    }))

    useEffect(() => {
      if (!containerRef.current) return

      const updateListener = EditorView.updateListener.of((update) => {
        textDocument?.accept(update.state, update.changes)
        if (!update.docChanged) return
        // 外部 setValue 同步时不回写，避免 CRLF→LF 等归一化造成误判 dirty
        if (update.transactions.every((tr) => tr.annotation(Transaction.remote))) return
        onChangeRef.current(update.state.doc.toString())
      })

      const createState = textDocument ? (config: Parameters<typeof EditorState.create>[0]) => textDocument.createEditorState(config) : EditorState.create
      const state = createState({
        doc: value,
        extensions: [
          tabSizeCompartment.of(EditorState.tabSize.of(tabSize)),
          indentUnitCompartment.of(indentUnit.of(' '.repeat(tabSize))),
          lineNumbers(),
          highlightActiveLineGutter(),
          highlightActiveLine(),
          history(),
          EditorState.allowMultipleSelections.of(true),
          indentOnInput(),
          bracketMatching(),
          closeBrackets(),
          markdownLintGutter(),
          markdownSyntaxLinter(),
          foldGutter({
            openText: '▾',
            closedText: '▸',
          }),
          drawSelection(),
          dropCursor(),
          markdown({
            base: markdownLanguage,
            codeLanguages: languages,
            extensions: [GFM, Table, TaskList, Strikethrough],
          }),
          livePreviewCompartment.of(livePreview ? livePreviewExtension({ filePath }) : []),
          search({ top: false }),
          highlightSelectionMatches(),
          themeCompartment.of(buildThemeExtensions(theme, fontSize, livePreview)),
          keymap.of([
            ...markdownFormattingKeymap,
            ...closeBracketsKeymap,
            indentWithTab,
            ...defaultKeymap,
            ...historyKeymap,
          ]),
          wikilinkAutocomplete(() => getWikilinkCandidatesRef.current?.() ?? []),
          placeholder('在此输入 Markdown 内容…'),
          updateListener,
          EditorView.lineWrapping,
          EditorView.domEventHandlers({
            paste(event, view) {
              return handlePasteImageEvent(event, onPasteImageRef.current, (markdown) => {
                const range = view.state.selection.main
                view.dispatch(buildImagePasteChange(range, markdown))
                view.focus()
              })
            },
          }),
        ],
      })

      const view = new EditorView({
        state,
        parent: containerRef.current,
      })

      viewRef.current = view
      const detachDocument = textDocument?.attach(view)

      const handleScroll = () => onScrollRef.current?.()
      view.scrollDOM.addEventListener('scroll', handleScroll, { passive: true })

      return () => {
        view.scrollDOM.removeEventListener('scroll', handleScroll)
        detachDocument?.()
        view.destroy()
        viewRef.current = null
      }
    }, [textDocument])

    useEffect(() => {
      const view = viewRef.current
      if (!view) return

      view.dispatch({
        effects: themeCompartment.reconfigure(buildThemeExtensions(theme, fontSize, livePreview)),
      })
    }, [theme, fontSize, livePreview])

    useEffect(() => {
      const view = viewRef.current
      if (!view) return

      view.dispatch({
        effects: [
          tabSizeCompartment.reconfigure(EditorState.tabSize.of(tabSize)),
          indentUnitCompartment.reconfigure(indentUnit.of(' '.repeat(tabSize))),
        ],
      })
    }, [tabSize])

    useEffect(() => {
      const view = viewRef.current
      if (!view) return

      view.dispatch({
        effects: livePreviewCompartment.reconfigure(livePreview ? livePreviewExtension({ filePath }) : []),
      })
    }, [livePreview, filePath])

    useEffect(() => {
      const view = viewRef.current
      if (!view) return

      const current = view.state.doc.toString()
      if (value === current) return

      try {
        view.dispatch({
          changes: { from: 0, to: current.length, insert: value },
          annotations: Transaction.remote.of(true),
        })
      } catch (error) {
        reportRuntimeError(error, { source: 'editor', filePath, silentToast: true })
      }
    }, [value])

    useEffect(() => {
      if (!filePath) return
      viewRef.current?.focus()
    }, [filePath])

    return <div ref={containerRef} className="h-full min-h-0 bg-editor" />
  },
)
