import type { ChangeDesc, Text } from '@codemirror/state'
import { mapProposal, rangesConflict, revalidateProposal } from './proposal-mapping'
import { isOpenProposal, type EditProposal, type ProposalEditInput, type ProposalOrigin } from './proposal-types'
import type { ProposalHistoryEvent } from './proposal-history'
import { applyHunks, splitIntoHunks } from './proposal-hunks'

/** ProposalManager 依赖的文档侧能力（由 TextDocument 实现）。 */
export interface ProposalHost {
  readonly filePath: string
  readonly revision: number
  readonly doc: Text
  /** 以单个可撤销事务应用修改，并携带 accept 历史效果（撤销时建议回到待审）。 */
  applyProposalChanges(changes: { from: number; to: number; insert: string }[], ids: readonly string[]): void
}

export interface ProposalNotice { id: number; text: string }

let nextId = 0
let nextNotice = 0
const MAX_HISTORY = 200

/**
 * 修改建议的状态机，绑定 TextDocument 生命周期（不随编辑器组件卸载/切预览丢失）。
 * 每个 TextDocument 一个实例，天然按窗口（渲染进程）与文档隔离。
 */
export class ProposalManager {
  private items: EditProposal[] = []
  private listeners = new Set<() => void>()
  private snapshot: readonly EditProposal[] = []
  private disposed = false
  private noticeValue: ProposalNotice | null = null
  /** 已处理过的 toolCallId（防同一工具调用的重复/迟到事件再次建议）。 */
  private seenToolCalls = new Map<string, string>()

  constructor(private readonly host: ProposalHost) {}

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }
  list = (): readonly EditProposal[] => this.snapshot
  notice = (): ProposalNotice | null => this.noticeValue
  pending = (): EditProposal[] => this.items.filter(isOpenProposal)
  get(id: string): EditProposal | undefined { return this.items.find((item) => item.id === id) }
  get isDisposed(): boolean { return this.disposed }

  private commit(next: EditProposal[]): void {
    const settled = next.filter((item) => !isOpenProposal(item) && item.status !== 'accepted')
    if (settled.length > MAX_HISTORY) {
      const drop = new Set(settled.slice(0, settled.length - MAX_HISTORY).map((item) => item.id))
      next = next.filter((item) => !drop.has(item.id))
    }
    this.items = next
    this.snapshot = Object.freeze([...next])
    this.listeners.forEach((listener) => listener())
  }
  private patch(id: string, patch: Partial<EditProposal>): void {
    this.commit(this.items.map((item) => (item.id === id ? { ...item, ...patch } : item)))
  }

  /**
   * 创建一批建议（同一工具调用）。edits 已由 TextDocument 按 revision / expectedText / Unicode 边界校验。
   * 同一 toolCallId 重复到达时返回已有批次而不新建。
   */
  create(edits: ProposalEditInput[], origin: ProposalOrigin = {}): EditProposal[] {
    if (this.disposed) throw new Error('文档已关闭，无法创建修改建议')
    const toolCallId = origin.toolCallId ?? null
    if (toolCallId) {
      const batchId = this.seenToolCalls.get(toolCallId)
      if (batchId) return this.items.filter((item) => item.batchId === batchId)
    }
    const doc = this.host.doc
    const open = this.pending()
    for (const edit of edits) {
      if (doc.sliceString(edit.from, edit.to) !== edit.expectedText) throw new Error('expectedText 与目标原文不匹配')
      if (open.some((item) => rangesConflict(item, edit))) throw new Error('与尚未处理的修改建议范围重叠，请等待用户处理后重新读取')
    }
    const batchId = `batch-${++nextId}`
    const now = Date.now()
    const created = edits.map((edit): EditProposal => ({
      id: `proposal-${++nextId}`, batchId, documentPath: this.host.filePath,
      threadId: origin.threadId ?? null, toolCallId, baseRevision: this.host.revision,
      from: edit.from, to: edit.to, expectedText: edit.expectedText, replacement: edit.insert,
      status: 'pending', source: origin.source ?? 'text-propose', createdAt: now,
    }))
    if (toolCallId) this.seenToolCalls.set(toolCallId, batchId)
    this.commit([...this.items, ...created].sort((a, b) => a.from - b.from || a.createdAt - b.createdAt))
    return created
  }

  /**
   * 文档变更后的唯一入口：先消费撤销/重做/接受的历史事件，再映射其余建议。
   * changes 为本次更新相对上一状态的变更。
   */
  handleUpdate(changes: ChangeDesc, events: readonly ProposalHistoryEvent[] = []): void {
    if (changes.empty && !events.length) return
    const handled = new Set<string>()
    let next = this.items
    for (const event of events) {
      next = next.map((item) => {
        if (!event.ids.includes(item.id)) return item
        handled.add(item.id)
        const from = changes.mapPos(item.from, -1), to = changes.mapPos(item.to, 1)
        const slice = this.host.doc.sliceString(from, to)
        if (event.kind === 'accept') {
          const applied = item.appliedText ?? item.replacement
          if (item.status === 'accepted') return { ...item, from, to }
          return slice === applied ? { ...item, status: 'accepted', from, to, appliedText: applied, invalidReason: undefined }
            : { ...item, status: 'invalid', invalidReason: '重做后目标文本不匹配' }
        }
        // 撤销接受：原文应回到映射后的区间
        return slice === item.expectedText ? { ...item, status: 'pending', from, to, hunks: undefined, hunkDecisions: undefined }
          : { ...item, status: 'invalid', from, to, invalidReason: '撤销后原文不匹配' }
      })
    }
    if (!changes.empty) {
      next = next.map((item) => {
        if (handled.has(item.id)) return item
        if (item.status === 'accepted') {
          // 跟踪已接受文本的位置，以便之后撤销时恢复
          return { ...item, from: changes.mapPos(item.from, -1), to: changes.mapPos(item.to, 1) }
        }
        return mapProposal(item, changes)
      })
    }
    if (next.some((item, i) => item !== this.items[i]) || next.length !== this.items.length) this.commit(next)
  }
  /** 兼容旧调用：仅映射。 */
  mapChanges(changes: ChangeDesc): void { this.handleUpdate(changes) }
  /** 拿不到 ChangeDesc 时的保守兜底：原文对不上就失效。 */
  revalidate(doc: Text): void {
    let dirty = false
    const next = this.items.map((item) => {
      const checked = revalidateProposal(item, doc)
      if (checked !== item) dirty = true
      return checked
    })
    if (dirty) this.commit(next)
  }

  private checkApplicable(item: EditProposal | undefined): asserts item is EditProposal {
    if (!item) throw new Error('修改建议不存在')
    if (item.status !== 'pending') throw new Error(item.status === 'invalid' ? '修改建议已失效' : '修改建议已处理')
    if (item.documentPath !== this.host.filePath) {
      this.patch(item.id, { status: 'invalid', invalidReason: '文档路径已变化' })
      throw new Error('文档路径已变化，修改建议已失效')
    }
    if (this.host.doc.sliceString(item.from, item.to) !== item.expectedText) {
      this.patch(item.id, { status: 'invalid', invalidReason: '目标文本已变化' })
      throw new Error('目标文本已变化，修改建议已失效')
    }
  }
  /** 以单事务落盘；状态由事务携带的 accept 效果在 handleUpdate 中切换为 accepted。 */
  private apply(entries: Array<{ item: EditProposal; appliedText: string; changes: { from: number; to: number; insert: string }[] }>): number {
    if (!entries.length) return 0
    const before = this.items
    const applied = new Map(entries.map((entry) => [entry.item.id, entry.appliedText]))
    this.commit(this.items.map((item) => (applied.has(item.id) ? { ...item, appliedText: applied.get(item.id) } : item)))
    const changes = entries.flatMap((entry) => entry.changes).sort((a, b) => a.from - b.from)
    try { this.host.applyProposalChanges(changes, entries.map((entry) => entry.item.id)) } catch (error) { this.commit(before); throw error }
    const stillPending = entries.filter((entry) => this.get(entry.item.id)?.status !== 'accepted')
    if (stillPending.length) {
      // 宿主未回传历史事件（例如被替换的状态链），直接标记，保证“恰好一次”
      this.commit(this.items.map((item) => (stillPending.some((entry) => entry.item.id === item.id) ? { ...item, status: 'accepted' } : item)))
    }
    return entries.length
  }

  /** 接受：恰好一次，单事务可撤销。 */
  accept(id: string): void { this.acceptMany([id]) }
  acceptMany(ids: string[]): number {
    const targets = [...new Set(ids)].map((id) => this.get(id))
    targets.forEach((item) => this.checkApplicable(item))
    return this.apply((targets as EditProposal[]).map((item) => ({ item, appliedText: item.replacement,
      changes: [{ from: item.from, to: item.to, insert: item.replacement }] })))
  }
  acceptAll = (): number => this.acceptMany(this.items.filter((item) => item.status === 'pending').map((item) => item.id))

  reject(id: string): void {
    const item = this.get(id)
    if (!item) throw new Error('修改建议不存在')
    if (!isOpenProposal(item) && item.status !== 'invalid') throw new Error('修改建议已处理')
    this.patch(id, { status: 'rejected', hunks: undefined, hunkDecisions: undefined })
  }
  rejectAll = (): number => {
    const ids = new Set(this.items.filter((item) => isOpenProposal(item) || item.status === 'invalid').map((item) => item.id))
    if (ids.size) this.commit(this.items.map((item) => (ids.has(item.id) ? { ...item, status: 'rejected' } : item)))
    return ids.size
  }
  /** 清理已失效项（用户在审阅栏中忽略）。 */
  dismissInvalid = (): void => {
    if (this.items.some((item) => item.status === 'invalid')) this.commit(this.items.map((item) => (item.status === 'invalid' ? { ...item, status: 'rejected' } : item)))
  }

  /* ---------- 逐句审阅 ---------- */
  /** 进入逐句审阅：按句拆分；少于 2 句时返回 false（无需拆分）。 */
  startHunkReview(id: string): boolean {
    const item = this.get(id)
    this.checkApplicable(item)
    const hunks = splitIntoHunks(item.expectedText, item.replacement)
    if (hunks.length < 2) return false
    this.patch(id, { hunks, hunkDecisions: hunks.map(() => null) })
    return true
  }
  setHunkDecision(id: string, index: number, accepted: boolean | null): void {
    const item = this.get(id)
    if (!item?.hunks || !item.hunkDecisions || index < 0 || index >= item.hunks.length) throw new Error('子修改不存在')
    this.patch(id, { hunkDecisions: item.hunkDecisions.map((value, i) => (i === index ? accepted : value)) })
  }
  cancelHunkReview(id: string): void { this.patch(id, { hunks: undefined, hunkDecisions: undefined }) }
  /** 提交逐句决定：所选子修改一次事务写入；未决定的视为拒绝；一句都没选则整条拒绝。 */
  commitHunks(id: string): number {
    const item = this.get(id)
    this.checkApplicable(item)
    if (!item.hunks || !item.hunkDecisions) throw new Error('该建议未在逐句审阅中')
    const chosen = item.hunks.filter((_, i) => item.hunkDecisions![i] === true)
    if (!chosen.length) { this.reject(id); return 0 }
    const appliedText = applyHunks(item.expectedText, chosen)
    this.apply([{ item, appliedText, changes: chosen.map((hunk) => ({ from: item.from + hunk.from, to: item.from + hunk.to, insert: hunk.insert })) }])
    return chosen.length
  }

  /* ---------- 撤回 / 生命周期 ---------- */
  /** 撤回符合条件的未处理建议（对话取消/删除、Agent 断开），附可见说明，不提交任何修改。 */
  withdraw(predicate: (item: EditProposal) => boolean, note: string): number {
    const ids = new Set(this.items.filter((item) => isOpenProposal(item) && predicate(item)).map((item) => item.id))
    if (!ids.size) return 0
    this.noticeValue = { id: ++nextNotice, text: `${note}，已撤回 ${ids.size} 处修改建议` }
    this.commit(this.items.map((item) => (ids.has(item.id) ? { ...item, status: 'rejected', note, hunks: undefined, hunkDecisions: undefined } : item)))
    return ids.size
  }
  /** 某线程的对话被删除/取消时撤下其未处理建议（不提交）。 */
  discardThread(threadId: string, note = '对话已结束'): number { return this.withdraw((item) => item.threadId === threadId, note) }
  dismissNotice = (): void => { if (this.noticeValue) { this.noticeValue = null; this.commit(this.items) } }
  /** 文档模型被丢弃（文件关闭）：清空列表，之后的创建全部拒绝。 */
  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    this.noticeValue = null
    this.commit([])
    this.listeners.clear()
  }
}
