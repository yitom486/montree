import { EditorState, Transaction, type ChangeDesc, type EditorStateConfig, type Extension, type TransactionSpec } from '@codemirror/state'
import { history, historyField, isolateHistory, undo } from '@codemirror/commands'
import type { EditorView } from '@codemirror/view'
import MarkdownIt from 'markdown-it'
import type { TextSelection } from '@yitom/contracts'
import { ProposalManager } from './ai-proposals/proposal-manager'
import type { ProposalOrigin } from './ai-proposals/proposal-types'
import { proposalAcceptEffect, proposalHistoryField, proposalStateExtension } from './ai-proposals/proposal-history'

const parser = new MarkdownIt()
let nextRevision = 0
const MAX_TEXT = 20_000
/** 编辑器扩展工厂（建议可视化），由 ai-proposals/proposal-extension 注入，避免数据层依赖视图层。 */
let proposalExtensionFactory: ((document: TextDocument) => Extension) | null = null
export function setProposalExtensionFactory(factory: ((document: TextDocument) => Extension) | null): void { proposalExtensionFactory = factory }
/** 审阅模式开关：开启时 edit() 改为创建待确认建议。 */
let reviewModeSource: () => boolean = () => false
export function setProposalReviewModeSource(source: () => boolean): void { reviewModeSource = source }

function integer(value: unknown, name: string, min: number, max: number): number {
  if (!Number.isSafeInteger(value) || (value as number) < min || (value as number) > max) throw new Error(`${name} 越界或不是整数`)
  return value as number
}
function keys(args: Record<string, unknown>, allowed: string[]): void {
  for (const key of Object.keys(args)) if (!allowed.includes(key)) throw new Error(`不支持的参数：${key}`)
}
function boundary(text: string, offset: number): void {
  if (offset > 0 && offset < text.length && /[\uD800-\uDBFF]/.test(text[offset - 1]) && /[\uDC00-\uDFFF]/.test(text[offset])) throw new Error('字符范围不能拆开 Unicode 字符')
}

/** One CodeMirror document/history, also retained while the editor pane is unmounted. */
export class TextDocument {
  state: EditorState
  revision = ++nextRevision
  private view: EditorView | null = null
  private saving = false
  private savedText: string
  private diskText: string
  private unitCache?: { revision: number; units: ReturnType<TextDocument['buildUnits']> }
  previewUnitIndex?: () => number
  onSelectionChange?: () => void
  readonly proposals: ProposalManager

  constructor(public filePath: string, text: string, savedText: string, diskText: string,
    private readonly changed: (text: string) => void,
    private readonly notify: () => void,
    private readonly persist: (text: string, expectedContent: string) => Promise<void>) {
    this.state = EditorState.create({ doc: text, extensions: [history(), EditorState.allowMultipleSelections.of(true), proposalStateExtension] })
    this.savedText = savedText
    this.diskText = diskText
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    const self = this
    this.proposals = new ProposalManager({
      get filePath() { return self.filePath },
      get revision() { return self.revision },
      get doc() { return self.state.doc },
      applyProposalChanges: (changes, ids) => this.dispatch({ changes, effects: proposalAcceptEffect.of(ids), annotations: [Transaction.userEvent.of('input.montree.proposal'), isolateHistory.of('full')] }),
    })
  }
  get text(): string { return this.state.doc.toString() }
  isDirty = (): boolean => this.text !== this.savedText
  markSaved(text: string, diskText: string): void { this.savedText = text; this.diskText = diskText; this.notify() }

  createEditorState(config: EditorStateConfig = {}): EditorState {
    const extra = proposalExtensionFactory?.(this)
    const withProposals = { ...config, extensions: [config.extensions ?? [], proposalStateExtension, extra ?? []] }
    return EditorState.fromJSON(this.state.toJSON({ history: historyField }), withProposals, { history: historyField })
  }
  attach(view: EditorView): () => void {
    this.view = view
    this.accept(view.state)
    return () => { if (this.view === view) { this.accept(view.state); this.view = null } }
  }
  /** changes 为 startState→state 的变更；缺省时按原文核对建议（兜底）。 */
  accept(state: EditorState, changes?: ChangeDesc): void {
    const changed = !this.state.doc.eq(state.doc)
    const previousLog = this.state.field(proposalHistoryField, false)
    const log = state.field(proposalHistoryField, false)
    const selectionChanged = !this.state.selection.eq(state.selection)
    this.state = state
    // 新状态链（重新挂载编辑器）从头计数；只消费同一条链上新增的事件
    const events = log && previousLog && changes ? log.events.filter((event) => event.seq > previousLog.seq) : []
    if (changed) {
      if (changes) this.proposals.handleUpdate(changes, events)
      else this.proposals.revalidate(state.doc)
      this.revision = ++nextRevision; this.unitCache = undefined; this.changed(this.text); this.notify()
    } else {
      if (events.length && changes) this.proposals.handleUpdate(changes, events)
      if (selectionChanged) this.onSelectionChange?.()
    }
  }
  private dispatch(spec: TransactionSpec): void {
    if (this.view) this.view.dispatch(spec)
    else { const tr = this.state.update(spec); this.accept(tr.state, tr.changes) }
  }
  sync(text: string): void {
    if (text !== this.text) this.dispatch({ changes: { from: 0, to: this.state.doc.length, insert: text }, annotations: [Transaction.remote.of(true), isolateHistory.of('full')] })
  }
  /** LSP 行列均为零基 UTF-16；交由同一事务定位，支持未挂载编辑面板。 */
  revealPosition(line: number, character: number): void {
    const target = this.state.doc.line(Math.min(this.state.doc.lines, Math.max(1, Math.floor(line) + 1)))
    const anchor = target.from + Math.min(target.length, Math.max(0, Math.floor(character)))
    this.dispatch({ selection: { anchor }, scrollIntoView: true })
    this.view?.focus()
  }
  undo = (): void => {
    const undone = undo({ state: this.state, dispatch: (transaction) => {
      if (this.view) this.view.dispatch(transaction)
      else this.accept(transaction.state, transaction.changes)
    } })
    if (!undone) throw new Error('当前没有可撤销的文本修改')
  }
  save = async (): Promise<void> => {
    if (this.saving) throw new Error('文档正在保存，请稍后重试')
    const text = this.text
    this.saving = true
    try { await this.persist(text, this.diskText); this.markSaved(text, text) }
    finally { this.saving = false }
  }
  selection = (): TextSelection | null => {
    const ranges = this.state.selection.ranges.filter((range) => !range.empty).map(({ from, to }) => ({ from, to, text: this.state.sliceDoc(from, to) }))
    if (!ranges.length) return null
    const { from, to } = this.state.selection.main
    return { kind: 'text', documentPath: this.filePath, revision: this.revision, from, to, ranges,
      selectionId: `text:${this.revision}:${ranges.map((range) => `${range.from}-${range.to}`).join(',')}` }
  }
  selectionSnapshot = (): TextSelection | null => {
    const selection = this.selection()
    if (!selection) return null
    let budget = MAX_TEXT
    return { ...selection, ranges: selection.ranges.map((range) => {
      let end = Math.min(range.text.length, budget)
      if (end > 0 && end < range.text.length && /[\uD800-\uDBFF]/.test(range.text[end - 1]) && /[\uDC00-\uDFFF]/.test(range.text[end])) end--
      budget -= end
      return { ...range, text: range.text.slice(0, end), textTruncated: end < range.text.length }
    }) }
  }
  private buildUnits() {
    const doc = this.state.doc
    if (/\.(txt|typ)$/i.test(this.filePath)) return Array.from({ length: Math.ceil(doc.lines / 200) }, (_, index) => {
      const startLine = index * 200 + 1, endLine = Math.min(doc.lines, startLine + 199)
      return { label: `第 ${startLine}–${endLine} 行`, level: 0, from: doc.line(startLine).from, to: doc.line(endLine).to }
    })
    const tokens = parser.parse(this.text, {})
    const headings = tokens.flatMap((token, index) => token.type === 'heading_open' && token.map ? [{
      label: tokens[index + 1]?.content ?? '', level: Number(token.tag.slice(1)), from: doc.line(token.map[0] + 1).from,
    }] : [])
    const starts = headings.length ? (headings[0].from > 0 ? [{ label: '前言', level: 0, from: 0 }, ...headings] : headings) : [{ label: this.filePath.split(/[/\\]/).pop() ?? '正文', level: 0, from: 0 }]
    const units = starts.map((heading) => ({ ...heading, to: doc.length }))
    const parents: number[] = []
    units.forEach((unit, index) => {
      while (parents.length && (units[parents.at(-1)!].level === 0 || unit.level <= units[parents.at(-1)!].level)) units[parents.pop()!].to = unit.from
      parents.push(index)
    })
    return units
  }
  units = () => {
    if (!this.unitCache || this.unitCache.revision !== this.revision) this.unitCache = { revision: this.revision, units: this.buildUnits() }
    return this.unitCache.units
  }
  currentIndex = (): number => {
    if (!this.view && this.previewUnitIndex) return this.previewUnitIndex()
    const from = this.view ? this.view.lineBlockAtHeight(this.view.scrollDOM.scrollTop).from : 0
    return Math.max(0, this.units().findLastIndex((unit) => unit.from <= from))
  }
  unit = (index: number) => {
    const unit = this.units()[index]
    return unit ? { label: unit.label, text: this.state.sliceDoc(unit.from, unit.to) } : null
  }
  read = (args: Record<string, unknown>) => {
    keys(args, ['documentPath', 'target', 'from', 'to', 'startLine', 'endLine', 'flatIndex', 'title', 'maxChars'])
    const doc = this.state.doc
    const base = { documentPath: this.filePath, format: /\.typ$/i.test(this.filePath) ? 'typst' : /\.txt$/i.test(this.filePath) ? 'txt' : 'markdown', revision: this.revision,
      source: 'editor-buffer', offsetUnit: 'UTF-16', lineBase: 1, length: doc.length, lineCount: doc.lines, dirty: this.isDirty(), selection: this.selectionSnapshot() }
    const target = args.target ?? 'metadata'
    const maxChars = args.maxChars === undefined ? MAX_TEXT : integer(args.maxChars, 'maxChars', 1, MAX_TEXT)
    const targetFields: Record<string, string[]> = { metadata: [], document: [], range: ['from', 'to'], lines: ['startLine', 'endLine'], section: ['flatIndex', 'title'], selection: [], viewport: [] }
    if (typeof target !== 'string' || !targetFields[target]) throw new Error('未知文本查询 target')
    keys(args, ['documentPath', 'target', 'maxChars', ...targetFields[target]])
    if (target === 'metadata') return { ...base, unitCount: this.units().length, units: this.units().slice(0, 600).map((unit, index) => ({ ...unit, index })), truncated: this.units().length > 600 }
    let from = 0, to = doc.length, label: string | undefined
    if (target === 'range') {
      from = integer(args.from, 'from', 0, doc.length); to = integer(args.to, 'to', from, doc.length)
    } else if (target === 'lines') {
      const first = integer(args.startLine, 'startLine', 1, doc.lines), last = integer(args.endLine, 'endLine', first, doc.lines)
      from = doc.line(first).from; to = doc.line(last).to
    } else if (target === 'section') {
      let index: number
      if (args.flatIndex !== undefined) index = integer(args.flatIndex, 'flatIndex', 0, this.units().length - 1)
      else {
        if (typeof args.title !== 'string' || !args.title.trim()) throw new Error('请提供 flatIndex 或完整 title')
        const matches = this.units().map((unit, index) => ({ unit, index })).filter(({ unit }) => unit.label === args.title)
        if (matches.length !== 1) throw new Error('章节标题不存在或不唯一，请使用目录 flatIndex')
        index = matches[0].index
      }
      const unit = this.units()[index]; ({ from, to, label } = unit)
    } else if (target === 'selection') {
      const selected = this.selection()
      if (!selected) throw new Error('当前没有选中文本')
      from = selected.from; to = selected.to
    } else if (target === 'viewport') {
      if (this.view) {
        const first = this.view.lineBlockAtHeight(this.view.scrollDOM.scrollTop).from
        const last = this.view.lineBlockAtHeight(this.view.scrollDOM.scrollTop + this.view.scrollDOM.clientHeight).to
        from = doc.lineAt(first).from; to = doc.lineAt(last).to
      } else {
        const unit = this.units()[this.currentIndex()]
        from = unit.from; to = unit.to; label = unit.label
      }
    } else if (target !== 'document') throw new Error('未知文本查询 target')
    boundary(this.text, from); boundary(this.text, to)
    let returnedTo = Math.min(to, from + maxChars)
    if (returnedTo < to && /[\uD800-\uDBFF]/.test(this.text[returnedTo - 1]) && /[\uDC00-\uDFFF]/.test(this.text[returnedTo])) returnedTo--
    if (returnedTo === from && from < to) throw new Error('maxChars 无法容纳完整 Unicode 字符，请增加读取长度')
    return { ...base, target, label, from, to: returnedTo, requestedTo: to, startLine: doc.lineAt(from).number, endLine: doc.lineAt(returnedTo).number,
      text: doc.sliceString(from, returnedTo), truncated: returnedTo < to,
      scope: target === 'viewport' && !this.view ? 'section-fallback' : target }
  }
  /** 校验 montree_text_edit / montree_text_propose 共用的参数，返回按位置排序的修改。 */
  private prepareEdits(args: Record<string, unknown>) {
    keys(args, ['documentPath', 'revision', 'selectionId', 'edits', 'expectedCount'])
    if (args.revision !== this.revision) throw new Error('文档版本已变化，请重新读取')
    if (!Array.isArray(args.edits) || !args.edits.length || args.edits.length > 100 || args.expectedCount !== args.edits.length) throw new Error('expectedCount 必须与 edits 数量完全匹配（1–100）')
    const selected = args.selectionId === undefined ? null : this.selection()
    if (args.selectionId !== undefined && (!selected || args.selectionId !== selected.selectionId)) throw new Error('选区已变化，请重新读取')
    const text = this.text
    let total = 0
    const changes = args.edits.map((raw) => {
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('edit 必须是对象')
      const row = raw as Record<string, unknown>
      keys(row, ['from', 'to', 'expectedText', 'text'])
      const from = integer(row.from, 'from', 0, text.length), to = integer(row.to, 'to', from, text.length)
      boundary(text, from); boundary(text, to)
      if (typeof row.expectedText !== 'string' || text.slice(from, to) !== row.expectedText) throw new Error('expectedText 与目标原文不匹配')
      if (typeof row.text !== 'string') throw new Error('text 必须是字符串')
      if (selected && !selected.ranges.some((range) => from >= range.from && to <= range.to)) throw new Error('编辑目标不在当前选区内')
      total += row.text.length + to - from
      if (total > 200_000) throw new Error('单批文本超过 200000 字符')
      return { from, to, expectedText: row.expectedText, insert: row.text.replace(/\r\n?/g, '\n') }
    }).sort((a, b) => a.from - b.from || a.to - b.to)
    for (let i = 1; i < changes.length; i++) {
      const a = changes[i - 1], b = changes[i]
      if (b.from < a.to || (b.from === a.to && (a.from === a.to || b.from === b.to))) throw new Error('同批编辑范围重叠或插入位置重复')
    }
    return changes
  }
  /** 直接编辑；审阅模式下改为创建待确认建议（需用户确认后才落入文档）。 */
  edit = (args: Record<string, unknown>, origin?: ProposalOrigin) => {
    if (reviewModeSource()) return this.propose(args, { ...origin, source: 'text-edit' })
    const changes = this.prepareEdits(args)
    this.dispatch({ changes: changes.map(({ from, to, insert }) => ({ from, to, insert })), annotations: [Transaction.userEvent.of('input.montree'), isolateHistory.of('full')] })
    return { ...this.read({}), editedCount: changes.length }
  }
  /** 创建修改建议：不改动文档，等待用户在编辑器内接受/拒绝。 */
  propose = (args: Record<string, unknown>, origin?: ProposalOrigin) => {
    const changes = this.prepareEdits(args)
    const created = this.proposals.create(changes, { source: 'text-propose', ...origin })
    return {
      status: 'proposal_created', awaiting: 'user', message: '修改建议已创建，等待用户在编辑器中接受或拒绝；文档尚未改动。',
      documentPath: this.filePath, revision: this.revision, proposedCount: created.length,
      proposals: created.map(({ id, from, to, status }) => ({ id, from, to, status })),
    }
  }
  /** 定位到某条建议（导航用）。 */
  revealRange(from: number, to: number): void {
    const length = this.state.doc.length
    this.dispatch({ selection: { anchor: Math.min(from, length), head: Math.min(to, length) }, scrollIntoView: true })
    this.view?.focus()
  }
}
