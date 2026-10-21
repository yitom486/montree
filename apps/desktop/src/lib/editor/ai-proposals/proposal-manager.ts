import type { ChangeDesc, Text } from '@codemirror/state'
import { mapProposal, rangesConflict, revalidateProposal } from './proposal-mapping'
import { isOpenProposal, type EditProposal, type ProposalEditInput, type ProposalOrigin } from './proposal-types'

/** ProposalManager 依赖的文档侧能力（由 TextDocument 实现）。 */
export interface ProposalHost {
  readonly filePath: string
  readonly revision: number
  readonly doc: Text
  /** 以单个可撤销事务应用修改；调用方已核对 expectedText。 */
  applyProposalChanges(changes: { from: number; to: number; insert: string }[]): void
}

let nextId = 0
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
  /** 已处理过的 toolCallId（防同一工具调用的重复/迟到事件再次建议）。 */
  private seenToolCalls = new Map<string, string>()

  constructor(private readonly host: ProposalHost) {}

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }
  list = (): readonly EditProposal[] => this.snapshot
  pending = (): EditProposal[] => this.items.filter(isOpenProposal)
  get(id: string): EditProposal | undefined { return this.items.find((item) => item.id === id) }

  private commit(next: EditProposal[]): void {
    const settled = next.filter((item) => !isOpenProposal(item))
    if (settled.length > MAX_HISTORY) {
      const drop = new Set(settled.slice(0, settled.length - MAX_HISTORY).map((item) => item.id))
      next = next.filter((item) => !drop.has(item.id))
    }
    this.items = next
    this.snapshot = Object.freeze([...next])
    this.listeners.forEach((listener) => listener())
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

  /** 文档发生变更（用户输入、撤销、外部同步）后映射全部待审建议。 */
  mapChanges(changes: ChangeDesc): void {
    if (!this.items.some(isOpenProposal) || changes.empty) return
    let dirty = false
    const next = this.items.map((item) => {
      const mapped = mapProposal(item, changes)
      if (mapped !== item) dirty = true
      return mapped
    })
    if (dirty) this.commit(next)
  }
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

  private settle(ids: Set<string>, status: 'accepted' | 'rejected'): void {
    this.commit(this.items.map((item) => (ids.has(item.id) ? { ...item, status } : item)))
  }
  private checkApplicable(item: EditProposal | undefined): asserts item is EditProposal {
    if (!item) throw new Error('修改建议不存在')
    if (item.status !== 'pending') throw new Error(item.status === 'invalid' ? '修改建议已失效' : '修改建议已处理')
    if (this.host.doc.sliceString(item.from, item.to) !== item.expectedText) {
      this.commit(this.items.map((other) => (other.id === item.id ? { ...other, status: 'invalid', invalidReason: '目标文本已变化' } : other)))
      throw new Error('目标文本已变化，修改建议已失效')
    }
  }

  /** 接受：恰好一次，单事务可撤销。 */
  accept(id: string): void { this.acceptMany([id]) }
  acceptMany(ids: string[]): number {
    const targets = [...new Set(ids)].map((id) => this.get(id))
    targets.forEach((item) => this.checkApplicable(item))
    const items = targets as EditProposal[]
    if (!items.length) return 0
    const changes = items.map(({ from, to, replacement }) => ({ from, to, insert: replacement })).sort((a, b) => a.from - b.from)
    // 先置 accepted 再落盘，使事务引发的 mapChanges 不把自身判为失效；失败则回滚状态。
    const before = this.items
    this.settle(new Set(items.map((item) => item.id)), 'accepted')
    try { this.host.applyProposalChanges(changes) } catch (error) { this.commit(before); throw error }
    return items.length
  }
  acceptAll = (): number => this.acceptMany(this.items.filter((item) => item.status === 'pending').map((item) => item.id))

  reject(id: string): void {
    const item = this.get(id)
    if (!item) throw new Error('修改建议不存在')
    if (!isOpenProposal(item) && item.status !== 'invalid') throw new Error('修改建议已处理')
    this.settle(new Set([id]), 'rejected')
  }
  rejectAll = (): number => {
    const ids = this.items.filter((item) => isOpenProposal(item) || item.status === 'invalid').map((item) => item.id)
    if (ids.length) this.settle(new Set(ids), 'rejected')
    return ids.length
  }
  /** 清理已失效项（用户在审阅栏中忽略）。 */
  dismissInvalid = (): void => {
    if (this.items.some((item) => item.status === 'invalid')) this.settle(new Set(this.items.filter((item) => item.status === 'invalid').map((item) => item.id)), 'rejected')
  }
  /** 某线程的对话被删除/清空时撤下其未处理建议（不提交）。 */
  discardThread(threadId: string): void {
    const ids = this.items.filter((item) => item.threadId === threadId && isOpenProposal(item)).map((item) => item.id)
    if (ids.length) this.settle(new Set(ids), 'rejected')
  }
  /** 文档模型被丢弃：所有未处理建议失效，之后的创建全部拒绝。 */
  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    this.commit(this.items.map((item) => (isOpenProposal(item) ? { ...item, status: 'invalid', invalidReason: '文档已关闭' } : item)))
    this.listeners.clear()
  }
}
