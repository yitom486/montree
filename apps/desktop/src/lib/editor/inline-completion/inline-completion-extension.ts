import { Prec, StateEffect, StateField, type EditorState, type Extension } from '@codemirror/state'
import { Decoration, EditorView, ViewPlugin, WidgetType, keymap, type DecorationSet, type ViewUpdate } from '@codemirror/view'
import { syntaxTree } from '@codemirror/language'

/**
 * Copilot 式行内补全（ghost text）：停顿后在光标处显示灰色建议。
 * Tab 接受、Esc/继续输入消失、Ctrl/Cmd+→ 逐词接受、Alt+] / Alt+[ 切换候选。
 * 输入法组合期间不请求；继续输入会取消在途请求；代码块内仅在声明了语言时触发。
 */
export interface InlineCompletionContext { prefix: string; suffix: string; language: string; pos: number }
export interface InlineCompletionOptions {
  fetch: (context: InlineCompletionContext, signal: AbortSignal) => Promise<string[]>
  enabled: () => boolean
  /** 文档主语言：markdown / typst */
  language: 'markdown' | 'typst'
  debounceMs?: number
  maxPrefix?: number
  maxSuffix?: number
}

interface Ghost { pos: number; items: readonly string[]; index: number }
const setGhost = StateEffect.define<Ghost | null>()

class GhostWidget extends WidgetType {
  constructor(readonly text: string, readonly hint: string) { super() }
  eq(other: GhostWidget) { return other.text === this.text && other.hint === this.hint }
  toDOM() {
    const span = document.createElement('span')
    span.className = 'cm-ai-ghost'
    span.dataset.testid = 'inline-completion-ghost'
    span.setAttribute('aria-hidden', 'true')
    span.textContent = this.text
    if (this.hint) {
      const hint = document.createElement('span')
      hint.className = 'cm-ai-ghost-hint'
      hint.textContent = this.hint
      span.append(hint)
    }
    return span
  }
  ignoreEvent() { return false }
}

export const ghostField = StateField.define<Ghost | null>({
  create: () => null,
  update(value, tr) {
    for (const effect of tr.effects) if (effect.is(setGhost)) return effect.value
    if (!value) return value
    if (tr.docChanged) {
      // 用户键入的正是建议开头 → 保留剩余部分（类型穿透）
      const inserts: Array<{ from: number; to: number; text: string }> = []
      tr.changes.iterChanges((fromA, toA, _fromB, _toB, inserted) => { inserts.push({ from: fromA, to: toA, text: inserted.toString() }) })
      const only = inserts.length === 1 ? inserts[0] : null
      if (only && only.from === value.pos && only.to === only.from && only.text) {
        const rest = value.items.filter((item) => item.startsWith(only.text) && item.length > only.text.length).map((item) => item.slice(only.text.length))
        if (rest.length) return { pos: value.pos + only.text.length, items: rest, index: 0 }
      }
      return null
    }
    if (tr.selection && tr.state.selection.main.head !== value.pos) return null
    return value
  },
  provide: (field) => EditorView.decorations.from(field, (ghost): DecorationSet => {
    if (!ghost || !ghost.items.length) return Decoration.none
    const hint = ghost.items.length > 1 ? ` ${ghost.index + 1}/${ghost.items.length}` : ''
    return Decoration.set([Decoration.widget({ widget: new GhostWidget(ghost.items[ghost.index], hint), side: 1 }).range(ghost.pos)])
  }),
})

/** 光标处所在的代码块语言（Markdown 围栏）；不在代码块返回 undefined，无语言的代码块返回 ''。 */
export function fenceLanguageAt(state: EditorState, pos: number): string | undefined {
  const node = syntaxTree(state).resolveInner(pos, -1)
  for (let cur: typeof node | null = node; cur; cur = cur.parent) {
    if (cur.name === 'FencedCode' || cur.name === 'CodeBlock') {
      if (cur.name === 'CodeBlock') return ''
      const info = cur.getChild('CodeInfo')
      return info ? state.sliceDoc(info.from, info.to).trim().toLowerCase() : ''
    }
  }
  return undefined
}

/** 是否适合在此处触发：单光标、行尾或后随空白/标点、不在空行开头连续空白中。 */
export function shouldTrigger(state: EditorState): boolean {
  const range = state.selection.main
  if (!range.empty || state.selection.ranges.length > 1) return false
  const line = state.doc.lineAt(range.head)
  const after = state.sliceDoc(range.head, line.to)
  if (after && !/^[\s)\]}>"'”’，。,.;；:：!?！？]*$/.test(after)) return false
  const before = state.sliceDoc(line.from, range.head)
  return before.trim().length > 0 || line.number > 1
}

const acceptWord = (text: string): string => {
  const match = text.match(/^\s*[\p{L}\p{N}_]+|^\s*[^\s\p{L}\p{N}_]|^\s+/u)
  // CJK 无空格：逐字（按词段）接受
  if (match && /[\u3400-\u9fff]/.test(match[0])) {
    const segmenter = typeof Intl !== 'undefined' && 'Segmenter' in Intl ? new Intl.Segmenter('zh', { granularity: 'word' }) : null
    const first = segmenter ? segmenter.segment(text)[Symbol.iterator]().next().value?.segment : text[0]
    return first || text
  }
  return match ? match[0] : text
}

export function inlineCompletion(options: InlineCompletionOptions): Extension {
  const debounceMs = options.debounceMs ?? 450
  const maxPrefix = options.maxPrefix ?? 3000, maxSuffix = options.maxSuffix ?? 1000

  const plugin = ViewPlugin.fromClass(class {
    timer: ReturnType<typeof setTimeout> | null = null
    controller: AbortController | null = null
    constructor(readonly view: EditorView) {}
    update(update: ViewUpdate) {
      const typed = update.transactions.some((tr) => tr.isUserEvent('input.type'))
      if (update.docChanged || update.selectionSet) this.cancel()
      if (!typed || update.view.composing || update.state.field(ghostField)) return
      this.schedule()
    }
    schedule() {
      this.timer = setTimeout(() => { this.timer = null; void this.request() }, debounceMs)
    }
    cancel() {
      if (this.timer) { clearTimeout(this.timer); this.timer = null }
      if (this.controller) { this.controller.abort(); this.controller = null }
    }
    async request() {
      const { state } = this.view
      if (!options.enabled() || this.view.composing || !shouldTrigger(state)) return
      const pos = state.selection.main.head
      let language: string = options.language
      if (options.language === 'markdown') {
        const fence = fenceLanguageAt(state, pos)
        if (fence === '') return
        if (fence) language = fence
      }
      const controller = new AbortController()
      this.controller = controller
      try {
        const items = await options.fetch({ prefix: state.sliceDoc(Math.max(0, pos - maxPrefix), pos), suffix: state.sliceDoc(pos, Math.min(state.doc.length, pos + maxSuffix)), language, pos }, controller.signal)
        if (controller.signal.aborted || this.view.state.doc !== state.doc || this.view.state.selection.main.head !== pos || this.view.composing) return
        const usable = items.filter((item) => item && item.trim())
        if (usable.length) this.view.dispatch({ effects: setGhost.of({ pos, items: usable, index: 0 }) })
      } catch { /* 补全失败静默 */ }
      finally { if (this.controller === controller) this.controller = null }
    }
    destroy() { this.cancel() }
  }, {
    eventHandlers: {
      compositionstart() { this.cancel(); if (this.view.state.field(ghostField)) this.view.dispatch({ effects: setGhost.of(null) }) },
      blur() { this.cancel() },
    },
  })

  const insert = (view: EditorView, text: string, ghost: Ghost, rest: Ghost | null) => {
    view.dispatch({ changes: { from: ghost.pos, insert: text }, selection: { anchor: ghost.pos + text.length }, userEvent: 'input.complete', scrollIntoView: true, effects: setGhost.of(rest) })
  }
  const keys = Prec.highest(keymap.of([
    { key: 'Tab', run: (view) => {
      const ghost = view.state.field(ghostField)
      if (!ghost) return false
      insert(view, ghost.items[ghost.index], ghost, null)
      return true
    } },
    { key: 'Escape', run: (view) => {
      if (!view.state.field(ghostField)) return false
      view.dispatch({ effects: setGhost.of(null) })
      return true
    } },
    { key: 'Mod-ArrowRight', run: (view) => {
      const ghost = view.state.field(ghostField)
      if (!ghost) return false
      const current = ghost.items[ghost.index]
      const word = acceptWord(current)
      const remaining = current.slice(word.length)
      insert(view, word, ghost, remaining ? { pos: ghost.pos + word.length, items: [remaining], index: 0 } : null)
      return true
    } },
    { key: 'Alt-]', run: (view) => cycle(view, 1) },
    { key: 'Alt-[', run: (view) => cycle(view, -1) },
  ]))
  const cycle = (view: EditorView, step: number): boolean => {
    const ghost = view.state.field(ghostField)
    if (!ghost || ghost.items.length < 2) return false
    view.dispatch({ effects: setGhost.of({ ...ghost, index: (ghost.index + step + ghost.items.length) % ghost.items.length }) })
    return true
  }

  return [ghostField, plugin, keys, EditorView.baseTheme({
    '.cm-ai-ghost': { color: 'rgba(127, 127, 127, 0.75)', fontStyle: 'normal', whiteSpace: 'pre-wrap', pointerEvents: 'none' },
    '.cm-ai-ghost-hint': { marginLeft: '6px', fontSize: '10px', padding: '0 4px', borderRadius: '3px', border: '1px solid rgba(127,127,127,0.35)', opacity: '0.8' },
  })]
}
