import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react'
import { Compartment, EditorState, StateEffect, StateField, Transaction } from '@codemirror/state'
import { EditorView, drawSelection, highlightActiveLine, hoverTooltip, keymap, lineNumbers, showTooltip, type Tooltip } from '@codemirror/view'
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands'
import { autocompletion, closeBrackets, closeBracketsKeymap, completionKeymap, pickedCompletion, snippet, type Completion, type CompletionContext } from '@codemirror/autocomplete'
import { bracketMatching, foldGutter, indentOnInput, indentUnit, LanguageSupport } from '@codemirror/language'
import { lintGutter, setDiagnostics } from '@codemirror/lint'
import { search, searchKeymap } from '@codemirror/search'
import { typst_lezer, typstLezerFoldService, typstLezerIndentService, typstLezerListKeymap } from 'codemirror-lang-typst/lezer'
import type { TypstRequestMethod } from '@montree/contracts'
import { buildThemeExtensions } from '@/lib/editor/codemirror-theme'
import type { TextDocument } from '@/lib/editor/text-document'
import { typstDiagnostics, typstDocumentation, typstEditChanges, typstOffset, typstPosition, type TypstDiagnostic, type TypstRange, type TypstTextEdit } from '@/lib/editor/typst-lsp'
import type { AppTheme } from '@/stores/editor-ui-store'

interface LspCompletion {
  label: string; detail?: string; kind?: number; insertText?: string; textEditText?: string; insertTextFormat?: number; documentation?: unknown
  textEdit?: { range?: TypstRange; insert?: TypstRange; replace?: TypstRange; newText: string }
  additionalTextEdits?: TypstTextEdit[]; data?: unknown; sortText?: string; filterText?: string
}
interface CompletionResponse {
  items: LspCompletion[]
  itemDefaults?: { editRange?: TypstRange | { insert: TypstRange; replace: TypstRange }; insertTextFormat?: number }
}
const signatureEffect = StateEffect.define<Tooltip | null>()
const signatureField = StateField.define<Tooltip | null>({
  create: () => null,
  update: (value, transaction) => {
    if (transaction.docChanged || transaction.selection) value = null
    for (const effect of transaction.effects) if (effect.is(signatureEffect)) value = effect.value
    return value
  },
  provide: (field) => showTooltip.from(field),
})
function tooltipText(text: string) {
  const dom = document.createElement('div')
  dom.className = 'max-w-lg max-h-72 overflow-auto whitespace-pre-wrap break-words p-3 text-sm'
  dom.textContent = text
  return dom
}
function snippetTemplate(value: string) {
  // LSP tabstops use $1; CodeMirror accepts ${1}. Keep choices at their first value.
  return value.replace(/\$\{(\d+)\|([^}]*)\|\}/g, (_, index: string, choices: string) => `\${${index}:${choices.split(',')[0]}}`)
    .replace(/\$(\d+)/g, (_, index: string) => `\${${index}}`)
}
const completionTypes: Record<number, string> = { 2: 'method', 3: 'function', 4: 'constructor', 5: 'property', 6: 'variable', 7: 'class', 9: 'namespace', 10: 'property', 12: 'constant', 14: 'keyword', 15: 'text', 17: 'text', 18: 'namespace', 21: 'constant' }

export interface TypstEditorHandle { format: () => Promise<void>; focus: () => void }
export interface TypstEditorProps {
  value: string
  filePath: string
  textDocument?: TextDocument
  uri: string | null
  sessionKey?: string
  capabilities?: Record<string, unknown>
  diagnostics: TypstDiagnostic[]
  theme: AppTheme
  fontSize: number
  tabSize: number
  onChange: (value: string) => void
  request: (method: TypstRequestMethod, params: unknown) => Promise<unknown>
  onError: (message: string) => void
  onOpenFile?: (path: string, line?: number, character?: number) => void
}

export const TypstEditor = forwardRef<TypstEditorHandle, TypstEditorProps>(function TypstEditor(props, ref) {
  const containerRef = useRef<HTMLDivElement>(null)
  const viewRef = useRef<EditorView | null>(null)
  const propsRef = useRef(props)
  propsRef.current = props
  const themeCompartment = useRef(new Compartment()).current
  const indentCompartment = useRef(new Compartment()).current

  const format = async () => {
    const view = viewRef.current, current = propsRef.current
    if (!view || view.composing || !current.uri || !current.capabilities?.documentFormattingProvider) return
    const doc = view.state.doc
    const edits = await current.request('textDocument/formatting', { textDocument: { uri: current.uri }, options: { tabSize: current.tabSize, insertSpaces: true } })
    if (!Array.isArray(edits) || viewRef.current !== view || current.uri !== propsRef.current.uri || current.sessionKey !== propsRef.current.sessionKey || !doc.eq(view.state.doc) || view.composing) return
    view.dispatch({ changes: typstEditChanges(doc, edits), userEvent: 'input.format' })
  }
  useImperativeHandle(ref, () => ({ format, focus: () => viewRef.current?.focus() }))

  useEffect(() => {
    if (!containerRef.current) return
    let disposed = false
    let signatureTimer: ReturnType<typeof setTimeout> | undefined
    const reportError = (error: unknown) => { if (!disposed) propsRef.current.onError(error instanceof Error ? error.message : String(error)) }
    const sessionIdentity = () => propsRef.current.sessionKey ?? propsRef.current.uri
    const requestAt = async (method: TypstRequestMethod, doc: EditorState['doc'], offset: number, extra: Record<string, unknown> = {}) => {
      const { uri, request, capabilities } = propsRef.current
      const identity = sessionIdentity()
      const capability = { 'textDocument/completion': 'completionProvider', 'textDocument/hover': 'hoverProvider',
        'textDocument/signatureHelp': 'signatureHelpProvider', 'textDocument/definition': 'definitionProvider' }[method as string]
      if (!uri || (capability && !capabilities?.[capability])) return null
      const result = await request(method, { textDocument: { uri }, position: typstPosition(doc, offset), ...extra })
      return disposed || identity !== sessionIdentity() ? null : result
    }
    const completionSource = async (context: CompletionContext) => {
      const doc = context.state.doc
      const identity = sessionIdentity()
      try {
        const value = await requestAt('textDocument/completion', doc, context.pos, { context: { triggerKind: 1 } }) as CompletionResponse | LspCompletion[] | null
        if (disposed || context.aborted || !value || !viewRef.current?.state.doc.eq(doc)) return null
        const items = Array.isArray(value) ? value : value.items
        const defaults = Array.isArray(value) ? undefined : value.itemDefaults
        if (!Array.isArray(items)) return null
        const word = context.matchBefore(/[\p{L}\p{N}_-]*/u)
        const from = word?.from ?? context.pos
        const options: Completion[] = items.filter((item) => typeof item.label === 'string').map((item) => ({
          label: item.filterText ?? item.label, displayLabel: item.label, detail: item.detail, type: completionTypes[item.kind ?? 0] ?? 'text',
          boost: item.sortText ? Math.max(-99, 20 - items.indexOf(item)) : undefined,
          info: async () => {
            if (disposed || identity !== sessionIdentity()) return tooltipText('')
            let resolved = item
            if (item.data && propsRef.current.uri) {
              const result = await propsRef.current.request('completionItem/resolve', item)
              if (result && typeof result === 'object') resolved = { ...item, ...result }
            }
            return tooltipText(identity === sessionIdentity() ? typstDocumentation(resolved.documentation) || resolved.detail || item.label : '')
          },
          apply: (view, completion, completionFrom, completionTo) => {
            void (async () => {
              if (disposed || identity !== sessionIdentity()) return
              let resolved = item
              if (item.data) {
                const result = await propsRef.current.request('completionItem/resolve', item)
                if (result && typeof result === 'object') resolved = { ...item, ...result }
              }
              if (disposed || identity !== sessionIdentity() || view.composing || !view.state.doc.eq(doc)) return
              const editRange = resolved.textEdit?.range ?? resolved.textEdit?.replace ?? defaults?.editRange
              const range = editRange && 'replace' in editRange ? editRange.replace : editRange
              const start = range ? typstOffset(doc, range.start) : completionFrom
              const end = range ? typstOffset(doc, range.end) : completionTo
              if (start === null || end === null || start > end) throw new Error('Typst 补全范围已失效')
              const text = resolved.textEdit?.newText ?? resolved.textEditText ?? resolved.insertText ?? resolved.label
              const additional = typstEditChanges(doc, resolved.additionalTextEdits ?? [])
              if (additional.some((change) => change.from < end && change.to > start)) throw new Error('Typst 补全修改范围重叠')
              if ((resolved.insertTextFormat ?? defaults?.insertTextFormat) === 2) {
                const beforeSnippet = view.state.update({ changes: additional })
                const mappedStart = beforeSnippet.changes.mapPos(start, 1), mappedEnd = beforeSnippet.changes.mapPos(end, -1)
                // Import edits and snippet placeholders must share one undo step.
                snippet(snippetTemplate(text))({ state: beforeSnippet.state, dispatch: (transaction) => {
                  view.dispatch({ changes: beforeSnippet.changes.compose(transaction.changes), selection: transaction.selection,
                    effects: transaction.effects, annotations: [pickedCompletion.of(completion), Transaction.userEvent.of('input.complete')], scrollIntoView: true })
                } }, completion, mappedStart, mappedEnd)
              } else {
                const changes = typstEditChanges(doc, [...(resolved.additionalTextEdits ?? []), {
                  range: { start: typstPosition(doc, start), end: typstPosition(doc, end) }, newText: text,
                }])
                view.dispatch({ changes, selection: { anchor: view.state.changes(changes).mapPos(end, 1) },
                  annotations: [pickedCompletion.of(completion), Transaction.userEvent.of('input.complete')] })
              }
            })().catch(reportError)
          },
        }))
        return { from, options }
      } catch (error) { reportError(error); return null }
    }
    const goToDefinition = async (view: EditorView) => {
      const doc = view.state.doc
      const value = await requestAt('textDocument/definition', doc, view.state.selection.main.head)
      if (disposed || !doc.eq(view.state.doc) || !value) return
      const location = (Array.isArray(value) ? value[0] : value) as { uri?: string; range?: TypstRange; targetUri?: string; targetSelectionRange?: TypstRange }
      const uri = location.targetUri ?? location.uri, range = location.targetSelectionRange ?? location.range
      if (!uri || !range) return
      if (uri === propsRef.current.uri) {
        const offset = typstOffset(doc, range.start)
        if (offset !== null) { view.dispatch({ selection: { anchor: offset }, effects: EditorView.scrollIntoView(offset, { y: 'center' }) }); view.focus() }
      } else {
        const url = new URL(uri)
        if (url.protocol !== 'file:' || url.hostname) return
        const path = decodeURIComponent(url.pathname).replace(/^\/(?=[A-Za-z]:)/, '')
        propsRef.current.onOpenFile?.(path, range.start.line, range.start.character)
      }
    }
    const extensions = [
      history(), lineNumbers(), drawSelection(), highlightActiveLine(), EditorView.lineWrapping, search({ top: true }),
      bracketMatching(), closeBrackets(), foldGutter(), indentOnInput(),
      new LanguageSupport(typst_lezer().language, [typstLezerFoldService, typstLezerIndentService, typstLezerListKeymap]), lintGutter(),
      themeCompartment.of(buildThemeExtensions(propsRef.current.theme, propsRef.current.fontSize)),
      indentCompartment.of([EditorState.tabSize.of(propsRef.current.tabSize), indentUnit.of(' '.repeat(propsRef.current.tabSize))]),
      EditorView.contentAttributes.of({ 'aria-label': 'Typst 源码编辑器', spellcheck: 'false' }),
      autocompletion({ override: [completionSource], activateOnTyping: true }), signatureField,
      hoverTooltip(async (view, pos) => {
        const doc = view.state.doc
        try {
          const value = await requestAt('textDocument/hover', doc, pos) as { contents?: unknown; range?: TypstRange } | null
          if (disposed || !doc.eq(view.state.doc) || !value?.contents) return null
          const text = typstDocumentation(value.contents)
          if (!text) return null
          const start = value.range ? typstOffset(doc, value.range.start) : pos
          const end = value.range ? typstOffset(doc, value.range.end) : pos
          return { pos: start ?? pos, end: end ?? pos, above: true, create: () => ({ dom: tooltipText(text) }) }
        } catch (error) { reportError(error); return null }
      }),
      keymap.of([
        { key: 'F12', run: (view) => { void goToDefinition(view).catch(reportError); return true } },
        { key: 'Mod-Shift-f', run: () => { void format().catch(reportError); return true } },
        ...closeBracketsKeymap, ...completionKeymap, ...searchKeymap, indentWithTab, ...defaultKeymap, ...historyKeymap,
      ]),
      EditorView.updateListener.of((update) => {
        propsRef.current.textDocument?.accept(update.state)
        if (update.docChanged && !update.transactions.every((transaction) => transaction.annotation(Transaction.remote))) propsRef.current.onChange(update.state.doc.toString())
        if (!update.docChanged && !update.selectionSet) return
        clearTimeout(signatureTimer)
        signatureTimer = setTimeout(() => {
          if (disposed || update.view.composing) return
          const doc = update.view.state.doc, offset = update.view.state.selection.main.head
          void requestAt('textDocument/signatureHelp', doc, offset).then((value) => {
            if (disposed || !doc.eq(update.view.state.doc) || offset !== update.view.state.selection.main.head) return
            const help = value as { signatures?: { label: string; documentation?: unknown }[]; activeSignature?: number } | null
            const signature = help?.signatures?.[help.activeSignature ?? 0]
            update.view.dispatch({ effects: signatureEffect.of(signature ? { pos: offset, above: true,
              create: () => ({ dom: tooltipText([signature.label, typstDocumentation(signature.documentation)].filter(Boolean).join('\n\n')) }) } : null) })
          }).catch(reportError)
        }, 180)
      }),
    ]
    const state = props.textDocument ? props.textDocument.createEditorState({ extensions }) : EditorState.create({ doc: props.value, extensions })
    const view = new EditorView({ state, parent: containerRef.current })
    viewRef.current = view
    const detach = props.textDocument?.attach(view)
    return () => { disposed = true; clearTimeout(signatureTimer); detach?.(); viewRef.current = null; view.destroy() }
  }, [props.filePath, props.textDocument, themeCompartment, indentCompartment])

  useEffect(() => {
    const view = viewRef.current
    if (view) view.dispatch({ effects: themeCompartment.reconfigure(buildThemeExtensions(props.theme, props.fontSize)) })
  }, [props.theme, props.fontSize, themeCompartment])
  useEffect(() => {
    const view = viewRef.current
    if (view) view.dispatch({ effects: indentCompartment.reconfigure([EditorState.tabSize.of(props.tabSize), indentUnit.of(' '.repeat(props.tabSize))]) })
  }, [props.tabSize, indentCompartment])
  useEffect(() => {
    const view = viewRef.current
    if (view && props.value !== view.state.doc.toString()) view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: props.value }, annotations: Transaction.remote.of(true) })
  }, [props.value])
  useEffect(() => {
    const view = viewRef.current
    if (view) view.dispatch(setDiagnostics(view.state, typstDiagnostics(view.state.doc, props.diagnostics)))
  }, [props.diagnostics])
  return <div ref={containerRef} className="h-full min-h-0 min-w-0 overflow-hidden" data-testid="typst-editor" />
})
