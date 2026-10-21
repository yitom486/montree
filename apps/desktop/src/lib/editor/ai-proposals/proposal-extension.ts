import { RangeSetBuilder, StateEffect, StateField, type EditorState, type Extension, type Range } from '@codemirror/state'
import { Decoration, EditorView, ViewPlugin, WidgetType, type DecorationSet, type ViewUpdate } from '@codemirror/view'
import type { ProposalManager } from './proposal-manager'
import type { EditProposal } from './proposal-types'
import { wordDiff } from './proposal-diff'

/**
 * AI 修改建议可视化：独立 CodeMirror 扩展（不混入 live-preview）。
 * 删除文本用删除线 mark，替换文本用行内 widget；多行建议用行装饰 + 块级 widget。
 */
export const setProposalsEffect = StateEffect.define<readonly EditProposal[]>()

export interface ProposalActions {
  accept: (id: string) => void
  reject: (id: string) => void
}

function button(label: string, action: 'accept' | 'reject', proposal: EditProposal, actions: ProposalActions): HTMLButtonElement {
  const el = document.createElement('button')
  el.type = 'button'
  el.className = `cm-ai-proposal-btn cm-ai-proposal-btn-${action}`
  el.textContent = label
  el.title = action === 'accept' ? '接受此修改' : '拒绝此修改'
  el.dataset.proposalAction = action
  el.dataset.proposalId = proposal.id
  el.setAttribute('aria-label', `${el.title}`)
  // mousedown 阻止编辑器夺焦/移动光标；click 才执行，避免拖选误触。
  el.addEventListener('mousedown', (event) => { event.preventDefault(); event.stopPropagation() })
  el.addEventListener('click', (event) => {
    event.preventDefault(); event.stopPropagation()
    if (action === 'accept') actions.accept(proposal.id)
    else actions.reject(proposal.id)
  })
  return el
}

function renderReplacement(proposal: EditProposal, into: HTMLElement): void {
  if (!proposal.replacement) {
    const empty = document.createElement('span')
    empty.className = 'cm-ai-proposal-empty'
    empty.textContent = '（删除）'
    into.append(empty)
    return
  }
  for (const part of wordDiff(proposal.expectedText, proposal.replacement)) {
    if (part.kind === 'delete') continue
    const span = document.createElement('span')
    span.className = part.kind === 'insert' ? 'cm-ai-proposal-ins-word' : 'cm-ai-proposal-same-word'
    span.textContent = part.text
    into.append(span)
  }
}

class ProposalWidget extends WidgetType {
  constructor(readonly proposal: EditProposal, readonly block: boolean, readonly actions: ProposalActions) { super() }
  eq(other: ProposalWidget): boolean {
    return other.proposal.id === this.proposal.id && other.proposal.status === this.proposal.status &&
      other.proposal.replacement === this.proposal.replacement && other.block === this.block
  }
  toDOM(): HTMLElement {
    const root = document.createElement(this.block ? 'div' : 'span')
    root.className = `cm-ai-proposal ${this.block ? 'cm-ai-proposal-block' : 'cm-ai-proposal-inline'}`
    root.dataset.proposalId = this.proposal.id
    root.dataset.proposalStatus = this.proposal.status
    root.setAttribute('contenteditable', 'false')
    const body = document.createElement(this.block ? 'div' : 'span')
    body.className = 'cm-ai-proposal-ins'
    if (this.proposal.status === 'invalid') {
      body.classList.add('cm-ai-proposal-invalid-text')
      body.textContent = `建议已失效：${this.proposal.invalidReason ?? '目标文本已变化'}`
    } else renderReplacement(this.proposal, body)
    const bar = document.createElement('span')
    bar.className = 'cm-ai-proposal-actions'
    if (this.proposal.status === 'pending') bar.append(button('✓ 接受', 'accept', this.proposal, this.actions))
    bar.append(button(this.proposal.status === 'invalid' ? '忽略' : '✕ 拒绝', 'reject', this.proposal, this.actions))
    root.append(body, bar)
    return root
  }
  ignoreEvent(): boolean { return true }
}

function isMultiline(state: EditorState, proposal: EditProposal): boolean {
  return proposal.replacement.includes('\n') || state.doc.lineAt(proposal.from).number !== state.doc.lineAt(proposal.to).number
}

export function buildProposalDecorations(state: EditorState, proposals: readonly EditProposal[], actions: ProposalActions): DecorationSet {
  const ranges: Range<Decoration>[] = []
  const length = state.doc.length
  for (const proposal of proposals) {
    if (proposal.status !== 'pending' && proposal.status !== 'invalid') continue
    if (proposal.to > length || proposal.from > proposal.to) continue
    const attributes = { 'data-proposal-id': proposal.id }
    const multiline = isMultiline(state, proposal)
    if (proposal.from < proposal.to && proposal.status === 'pending') {
      ranges.push(Decoration.mark({ class: 'cm-ai-proposal-del', attributes, inclusiveStart: false, inclusiveEnd: false }).range(proposal.from, proposal.to))
    }
    if (multiline) {
      if (proposal.from < proposal.to && proposal.status === 'pending') {
        const first = state.doc.lineAt(proposal.from).number, last = state.doc.lineAt(proposal.to).number
        for (let line = first; line <= last; line++) ranges.push(Decoration.line({ class: 'cm-ai-proposal-del-line', attributes }).range(state.doc.line(line).from))
      }
      ranges.push(Decoration.widget({ widget: new ProposalWidget(proposal, true, actions), block: true, side: 1 }).range(state.doc.lineAt(proposal.to).to))
    } else {
      ranges.push(Decoration.widget({ widget: new ProposalWidget(proposal, false, actions), side: 1 }).range(proposal.to))
    }
  }
  ranges.sort((a, b) => a.from - b.from || a.value.startSide - b.value.startSide)
  const builder = new RangeSetBuilder<Decoration>()
  for (const range of ranges) builder.add(range.from, range.to, range.value)
  return builder.finish()
}

const proposalTheme = EditorView.baseTheme({
  '.cm-ai-proposal-del': { textDecoration: 'line-through', textDecorationColor: 'rgba(220, 38, 38, 0.85)', backgroundColor: 'rgba(239, 68, 68, 0.14)', color: 'inherit' },
  '.cm-ai-proposal-del-line': { backgroundColor: 'rgba(239, 68, 68, 0.07)' },
  '.cm-ai-proposal': { fontFamily: 'inherit' },
  '.cm-ai-proposal-inline': { marginLeft: '2px', whiteSpace: 'pre-wrap' },
  '.cm-ai-proposal-block': { margin: '2px 0 4px', padding: '4px 8px', borderLeft: '3px solid rgba(22, 163, 74, 0.7)', backgroundColor: 'rgba(34, 197, 94, 0.08)', borderRadius: '4px', display: 'flex', alignItems: 'flex-start', gap: '8px' },
  '.cm-ai-proposal-block .cm-ai-proposal-ins': { whiteSpace: 'pre-wrap', flex: '1', minWidth: '0', backgroundColor: 'transparent' },
  '.cm-ai-proposal-ins': { backgroundColor: 'rgba(34, 197, 94, 0.14)', borderRadius: '2px' },
  '.cm-ai-proposal-ins-word': { backgroundColor: 'rgba(34, 197, 94, 0.28)', textDecoration: 'underline', textDecorationColor: 'rgba(22, 163, 74, 0.6)' },
  '.cm-ai-proposal-invalid-text': { backgroundColor: 'rgba(234, 179, 8, 0.15)', fontStyle: 'italic', fontSize: '0.85em' },
  '.cm-ai-proposal-empty': { fontStyle: 'italic', opacity: '0.7', fontSize: '0.85em' },
  '.cm-ai-proposal-actions': { display: 'inline-flex', gap: '2px', marginLeft: '4px', verticalAlign: 'baseline', userSelect: 'none' },
  '.cm-ai-proposal-btn': { font: '500 11px/1.4 system-ui, sans-serif', padding: '0 6px', border: '1px solid rgba(127,127,127,0.35)', borderRadius: '4px', background: 'var(--background, #fff)', color: 'inherit', cursor: 'pointer' },
  '.cm-ai-proposal-btn-accept:hover': { backgroundColor: 'rgba(34, 197, 94, 0.2)', borderColor: 'rgba(22, 163, 74, 0.7)' },
  '.cm-ai-proposal-btn-reject:hover': { backgroundColor: 'rgba(239, 68, 68, 0.18)', borderColor: 'rgba(220, 38, 38, 0.7)' },
})

/** 编辑器扩展：订阅 ProposalManager，变化时以 effect 推送；IME 组合输入期间延后推送，避免打断输入法。 */
export function proposalExtension(manager: ProposalManager, actions: ProposalActions = {
  accept: (id) => { try { manager.accept(id) } catch (error) { console.warn('[proposals] accept failed', error) } },
  reject: (id) => { try { manager.reject(id) } catch (error) { console.warn('[proposals] reject failed', error) } },
}): Extension {
  const field = StateField.define<DecorationSet>({
    create: (state) => buildProposalDecorations(state, manager.list(), actions),
    update(value, tr) {
      for (const effect of tr.effects) if (effect.is(setProposalsEffect)) return buildProposalDecorations(tr.state, effect.value, actions)
      return tr.docChanged ? value.map(tr.changes) : value
    },
    provide: (f) => EditorView.decorations.from(f),
  })
  const sync = ViewPlugin.fromClass(class {
    private pending = false
    private scheduled = false
    private readonly unsubscribe: () => void
    constructor(readonly view: EditorView) {
      this.unsubscribe = manager.subscribe(() => this.schedule())
    }
    schedule(): void {
      this.pending = true
      if (this.scheduled) return
      this.scheduled = true
      // 不能在 update 过程中 dispatch：延到微任务；组合输入中则等 compositionend。
      queueMicrotask(() => { this.scheduled = false; this.flush() })
    }
    flush(): void {
      if (!this.pending || this.destroyed) return
      if (this.view.composing || this.view.compositionStarted) return
      this.pending = false
      this.view.dispatch({ effects: setProposalsEffect.of(manager.list()) })
    }
    update(update: ViewUpdate): void {
      if (this.pending && !update.view.composing) this.schedule()
    }
    destroyed = false
    destroy(): void { this.destroyed = true; this.unsubscribe() }
  }, {
    eventHandlers: { compositionend() { this.schedule() } },
  })
  return [field, sync, proposalTheme]
}
