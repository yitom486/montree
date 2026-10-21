import { RangeSetBuilder, StateEffect, StateField, type EditorState, type Extension, type Range } from '@codemirror/state'
import { Decoration, EditorView, ViewPlugin, WidgetType, type DecorationSet, type ViewUpdate } from '@codemirror/view'
import type { ProposalManager } from './proposal-manager'
import type { EditProposal } from './proposal-types'
import { wordDiff } from './proposal-diff'
import { splitIntoHunks } from './proposal-hunks'

/**
 * AI 修改建议可视化：独立 CodeMirror 扩展（不混入 live-preview）。
 * 删除文本用删除线 mark，替换文本用行内 widget；多行建议用行装饰 + 块级 widget。
 */
export const setProposalsEffect = StateEffect.define<readonly EditProposal[]>()

export interface ProposalActions {
  accept: (id: string) => void
  reject: (id: string) => void
  startHunks: (id: string) => void
  decideHunk: (id: string, index: number, accepted: boolean) => void
  commitHunks: (id: string) => void
  cancelHunks: (id: string) => void
}

type ButtonAction = 'accept' | 'reject' | 'hunks' | 'hunk-accept' | 'hunk-reject' | 'hunks-commit' | 'hunks-cancel'
const TITLES: Record<ButtonAction, string> = {
  accept: '接受此修改', reject: '拒绝此修改', hunks: '逐句审阅', 'hunk-accept': '采纳此句', 'hunk-reject': '不采纳此句',
  'hunks-commit': '应用所选句子', 'hunks-cancel': '退出逐句审阅',
}

function button(label: string, action: ButtonAction, proposal: EditProposal, run: () => void, extra?: { index?: number; pressed?: boolean }): HTMLButtonElement {
  const el = document.createElement('button')
  el.type = 'button'
  el.className = `cm-ai-proposal-btn cm-ai-proposal-btn-${action}`
  el.textContent = label
  el.title = TITLES[action]
  el.dataset.proposalAction = action
  el.dataset.proposalId = proposal.id
  if (extra?.index !== undefined) el.dataset.hunkIndex = String(extra.index)
  if (extra?.pressed !== undefined) el.setAttribute('aria-pressed', String(extra.pressed))
  el.setAttribute('aria-label', el.title)
  // mousedown 阻止编辑器夺焦/移动光标；click 才执行，避免拖选误触。
  el.addEventListener('mousedown', (event) => { event.preventDefault(); event.stopPropagation() })
  el.addEventListener('click', (event) => { event.preventDefault(); event.stopPropagation(); run() })
  return el
}

const hunkCountCache = new WeakMap<EditProposal, number>()
function hunkCount(proposal: EditProposal): number {
  let count = hunkCountCache.get(proposal)
  if (count === undefined) {
    count = proposal.expectedText.length + proposal.replacement.length > 20_000 ? 0 : splitIntoHunks(proposal.expectedText, proposal.replacement).length
    hunkCountCache.set(proposal, count)
  }
  return count
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
      other.proposal.replacement === this.proposal.replacement && other.block === this.block &&
      other.proposal.hunkDecisions === this.proposal.hunkDecisions && other.proposal.hunks === this.proposal.hunks
  }
  toDOM(): HTMLElement {
    if (this.proposal.hunks && this.proposal.hunkDecisions) return this.hunkDOM()
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
    const { id } = this.proposal
    if (this.proposal.status === 'pending') bar.append(button('✓ 接受', 'accept', this.proposal, () => this.actions.accept(id)))
    bar.append(button(this.proposal.status === 'invalid' ? '忽略' : '✕ 拒绝', 'reject', this.proposal, () => this.actions.reject(id)))
    if (this.proposal.status === 'pending' && hunkCount(this.proposal) >= 2) bar.append(button('逐句', 'hunks', this.proposal, () => this.actions.startHunks(id)))
    root.append(body, bar)
    return root
  }
  /** 逐句审阅：每句原文/新文并列，单独采纳或不采纳，最后一次提交。 */
  private hunkDOM(): HTMLElement {
    const { id, hunks, hunkDecisions } = this.proposal as Required<Pick<EditProposal, 'hunks' | 'hunkDecisions'>> & EditProposal
    const root = document.createElement('div')
    root.className = 'cm-ai-proposal cm-ai-proposal-block cm-ai-proposal-hunks'
    root.dataset.proposalId = id
    root.setAttribute('contenteditable', 'false')
    const list = document.createElement('div')
    list.className = 'cm-ai-hunk-list'
    hunks.forEach((hunk, index) => {
      const row = document.createElement('div')
      const decision = hunkDecisions[index]
      row.className = `cm-ai-hunk ${decision === true ? 'cm-ai-hunk-accepted' : decision === false ? 'cm-ai-hunk-rejected' : ''}`
      row.dataset.hunkIndex = String(index)
      const before = document.createElement('span'); before.className = 'cm-ai-hunk-original'; before.textContent = hunk.original || '（插入）'
      const arrow = document.createElement('span'); arrow.className = 'cm-ai-hunk-arrow'; arrow.textContent = '→'
      const after = document.createElement('span'); after.className = 'cm-ai-hunk-insert'; after.textContent = hunk.insert || '（删除）'
      const actions = document.createElement('span'); actions.className = 'cm-ai-proposal-actions'
      actions.append(
        button('✓', 'hunk-accept', this.proposal, () => this.actions.decideHunk(id, index, true), { index, pressed: decision === true }),
        button('✕', 'hunk-reject', this.proposal, () => this.actions.decideHunk(id, index, false), { index, pressed: decision === false }),
      )
      row.append(before, arrow, after, actions)
      list.append(row)
    })
    const footer = document.createElement('div')
    footer.className = 'cm-ai-hunk-footer'
    const chosen = hunkDecisions.filter((value) => value === true).length
    const label = document.createElement('span'); label.textContent = `已采纳 ${chosen}/${hunks.length} 句`
    footer.append(label,
      button(`应用所选（${chosen}）`, 'hunks-commit', this.proposal, () => this.actions.commitHunks(id)),
      button('退出逐句', 'hunks-cancel', this.proposal, () => this.actions.cancelHunks(id)))
    root.append(list, footer)
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
    if (proposal.status === 'pending' && proposal.hunks && proposal.hunkDecisions) {
      proposal.hunks.forEach((hunk, index) => {
        if (hunk.from === hunk.to) return
        const decision = proposal.hunkDecisions![index]
        const cls = decision === true ? 'cm-ai-proposal-del' : decision === false ? 'cm-ai-hunk-kept' : 'cm-ai-hunk-undecided'
        ranges.push(Decoration.mark({ class: cls, attributes: { ...attributes, 'data-hunk-index': String(index) } }).range(proposal.from + hunk.from, proposal.from + hunk.to))
      })
      ranges.push(Decoration.widget({ widget: new ProposalWidget(proposal, true, actions), block: true, side: 1 }).range(state.doc.lineAt(proposal.to).to))
      continue
    }
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
  '.cm-ai-hunks': { flexDirection: 'column', alignItems: 'stretch' },
  '.cm-ai-hunk-list': { display: 'flex', flexDirection: 'column', gap: '2px' },
  '.cm-ai-hunk': { display: 'flex', alignItems: 'baseline', gap: '6px', padding: '1px 4px', borderRadius: '3px', whiteSpace: 'pre-wrap' },
  '.cm-ai-hunk-accepted': { backgroundColor: 'rgba(34, 197, 94, 0.16)' },
  '.cm-ai-hunk-rejected': { opacity: '0.55' },
  '.cm-ai-hunk-original': { textDecoration: 'line-through', textDecorationColor: 'rgba(220, 38, 38, 0.85)', flex: '1', minWidth: '0' },
  '.cm-ai-hunk-rejected .cm-ai-hunk-original': { textDecoration: 'none' },
  '.cm-ai-hunk-rejected .cm-ai-hunk-insert': { textDecoration: 'line-through' },
  '.cm-ai-hunk-insert': { color: 'rgb(21, 128, 61)', flex: '1', minWidth: '0' },
  '.cm-ai-hunk-arrow': { opacity: '0.5' },
  '.cm-ai-hunk-footer': { display: 'flex', alignItems: 'center', gap: '6px', marginTop: '4px', fontSize: '11px', opacity: '0.9' },
  '.cm-ai-hunk-undecided': { backgroundColor: 'rgba(234, 179, 8, 0.16)' },
  '.cm-ai-hunk-kept': { backgroundColor: 'rgba(127, 127, 127, 0.1)' },
  '.cm-ai-proposal-btn[aria-pressed="true"]': { backgroundColor: 'rgba(34, 197, 94, 0.25)', borderColor: 'rgba(22, 163, 74, 0.7)' },
  '.cm-ai-proposal-btn-hunk-reject[aria-pressed="true"]': { backgroundColor: 'rgba(239, 68, 68, 0.2)', borderColor: 'rgba(220, 38, 38, 0.7)' },
  '.cm-ai-proposal-btn-reject:hover': { backgroundColor: 'rgba(239, 68, 68, 0.18)', borderColor: 'rgba(220, 38, 38, 0.7)' },
})

/** 编辑器扩展：订阅 ProposalManager，变化时以 effect 推送；IME 组合输入期间延后推送，避免打断输入法。 */
const safely = (label: string, run: () => unknown) => { try { run() } catch (error) { console.warn(`[proposals] ${label} failed`, error) } }
export function defaultProposalActions(manager: ProposalManager): ProposalActions {
  return {
    accept: (id) => safely('accept', () => manager.accept(id)),
    reject: (id) => safely('reject', () => manager.reject(id)),
    startHunks: (id) => safely('hunks', () => manager.startHunkReview(id)),
    decideHunk: (id, index, accepted) => safely('hunk', () => {
      const current = manager.get(id)?.hunkDecisions?.[index]
      manager.setHunkDecision(id, index, current === accepted ? null : accepted)
    }),
    commitHunks: (id) => safely('commit', () => manager.commitHunks(id)),
    cancelHunks: (id) => safely('cancel', () => manager.cancelHunkReview(id)),
  }
}
export function proposalExtension(manager: ProposalManager, actions: ProposalActions = defaultProposalActions(manager)): Extension {
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
