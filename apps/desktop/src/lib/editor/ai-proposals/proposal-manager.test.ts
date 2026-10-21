// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ChangeSet, EditorState } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { history } from '@codemirror/commands'
import { TextDocument, setProposalExtensionFactory, setProposalReviewModeSource } from '../text-document'
import { proposalExtension } from './proposal-extension'
import { mapProposal, rangesConflict } from './proposal-mapping'
import type { EditProposal } from './proposal-types'
import { registerDocumentTools, requireDocumentTools } from '@/lib/agent/context/document-tool-registry'

function fixture(text: string, path = '/notes/book.md') {
  const doc = new TextDocument(path, text, text, text, vi.fn(), vi.fn(), vi.fn(async () => {}))
  const propose = (edits: Array<{ from: number; to: number; expectedText: string; text: string }>, origin = {}) =>
    doc.propose({ documentPath: path, revision: doc.revision, edits, expectedCount: edits.length }, origin)
  const type = (from: number, to: number, insert: string) => {
    const tr = doc.state.update({ changes: { from, to, insert }, userEvent: 'input.type' })
    doc.accept(tr.state, tr.changes)
  }
  return { doc, propose, type }
}

afterEach(() => { setProposalReviewModeSource(() => false); setProposalExtensionFactory(null) })

describe('ProposalManager data layer', () => {
  it('creates a pending proposal without touching the document or revision', () => {
    const { doc, propose } = fixture('hello world')
    const revision = doc.revision
    const result = propose([{ from: 6, to: 11, expectedText: 'world', text: 'there' }], { threadId: 't1', toolCallId: 'call-1' })
    expect(result).toMatchObject({ status: 'proposal_created', awaiting: 'user', proposedCount: 1, revision })
    expect(doc.text).toBe('hello world')
    expect(doc.revision).toBe(revision)
    const [proposal] = doc.proposals.list()
    expect(proposal).toMatchObject({ status: 'pending', from: 6, to: 11, expectedText: 'world', replacement: 'there', threadId: 't1', toolCallId: 'call-1', baseRevision: revision, documentPath: '/notes/book.md' })
  })

  it('rejects stale revision, wrong expectedText and split surrogate pairs like text_edit', () => {
    const { doc, propose } = fixture('a😀b')
    expect(() => doc.propose({ documentPath: doc.filePath, revision: doc.revision + 99, edits: [{ from: 0, to: 1, expectedText: 'a', text: 'x' }], expectedCount: 1 })).toThrow('文档版本已变化')
    expect(() => propose([{ from: 0, to: 1, expectedText: 'b', text: 'x' }])).toThrow('expectedText')
    expect(() => propose([{ from: 1, to: 2, expectedText: '\ud83d', text: 'x' }])).toThrow('Unicode')
    propose([{ from: 1, to: 3, expectedText: '😀', text: '🎉🎉' }])
    doc.proposals.accept(doc.proposals.list()[0].id)
    expect(doc.text).toBe('a🎉🎉b')
  })

  it('accepts exactly once in one undoable transaction', () => {
    const { doc, propose } = fixture('one two three')
    propose([{ from: 4, to: 7, expectedText: 'two', text: '2' }])
    const id = doc.proposals.list()[0].id
    const before = doc.revision
    doc.proposals.accept(id)
    expect(doc.text).toBe('one 2 three')
    expect(doc.revision).not.toBe(before)
    expect(() => doc.proposals.accept(id)).toThrow('已处理')
    expect(() => doc.proposals.reject(id)).toThrow('已处理')
    doc.undo()
    expect(doc.text).toBe('one two three')
    expect(doc.proposals.get(id)?.status).toBe('accepted')
  })

  it('rejects exactly once and leaves text unchanged', () => {
    const { doc, propose } = fixture('abc')
    propose([{ from: 0, to: 1, expectedText: 'a', text: 'A' }])
    const id = doc.proposals.list()[0].id
    doc.proposals.reject(id)
    expect(doc.text).toBe('abc')
    expect(() => doc.proposals.reject(id)).toThrow('已处理')
    expect(() => doc.proposals.accept(id)).toThrow('已处理')
  })

  it('maps positions through edits before the target and invalidates edits inside it', () => {
    const { doc, propose, type } = fixture('alpha beta gamma')
    propose([{ from: 6, to: 10, expectedText: 'beta', text: 'BETA' }, { from: 11, to: 16, expectedText: 'gamma', text: 'G' }])
    type(0, 0, '>> ')
    const [beta, gamma] = doc.proposals.list()
    expect([beta.from, beta.to, gamma.from, gamma.to]).toEqual([9, 13, 14, 19])
    type(15, 16, 'A') // inside "gamma"
    expect(doc.proposals.get(gamma.id)?.status).toBe('invalid')
    expect(() => doc.proposals.accept(gamma.id)).toThrow('失效')
    doc.proposals.accept(beta.id)
    expect(doc.text).toBe('>> alpha BETA gAmma')
  })

  it('treats duplicate passages by position, not by text', () => {
    const { doc, propose, type } = fixture('same\nsame\nsame')
    propose([{ from: 5, to: 9, expectedText: 'same', text: 'second' }])
    type(0, 4, 'SAME') // edit first duplicate only
    const proposal = doc.proposals.list()[0]
    expect(proposal.status).toBe('pending')
    doc.proposals.accept(proposal.id)
    expect(doc.text).toBe('SAME\nsecond\nsame')
  })

  it('invalidates an insertion proposal when the user types at the same point', () => {
    const { doc, propose, type } = fixture('ab')
    propose([{ from: 1, to: 1, expectedText: '', text: 'X' }])
    type(1, 1, 'y')
    expect(doc.proposals.list()[0].status).toBe('invalid')
  })

  it('handles multi-line proposals and keeps CRLF normalised', () => {
    const { doc, propose } = fixture('# T\n\nline 1\nline 2\n')
    propose([{ from: 5, to: 18, expectedText: 'line 1\nline 2', text: 'new 1\r\nnew 2\nnew 3' }])
    expect(doc.proposals.list()[0].replacement).toBe('new 1\nnew 2\nnew 3')
    doc.proposals.acceptAll()
    expect(doc.text).toBe('# T\n\nnew 1\nnew 2\nnew 3\n')
  })

  it('acceptAll applies every pending proposal as one undo step', () => {
    const { doc, propose } = fixture('a b c')
    propose([{ from: 0, to: 1, expectedText: 'a', text: 'A' }])
    propose([{ from: 4, to: 5, expectedText: 'c', text: 'C' }])
    expect(doc.proposals.acceptAll()).toBe(2)
    expect(doc.text).toBe('A b C')
    doc.undo()
    expect(doc.text).toBe('a b c')
  })

  it('rejectAll clears pending and invalid items', () => {
    const { doc, propose, type } = fixture('a b c')
    propose([{ from: 0, to: 1, expectedText: 'a', text: 'A' }, { from: 4, to: 5, expectedText: 'c', text: 'C' }])
    type(0, 1, 'z')
    expect(doc.proposals.rejectAll()).toBe(2)
    expect(doc.proposals.pending()).toHaveLength(0)
    expect(doc.text).toBe('z b c')
  })

  it('refuses overlapping proposals and ignores duplicate tool-call events', () => {
    const { doc, propose } = fixture('hello world')
    const first = propose([{ from: 0, to: 5, expectedText: 'hello', text: 'hi' }], { toolCallId: 'c1' })
    expect(() => propose([{ from: 3, to: 7, expectedText: 'lo w', text: '' }])).toThrow('重叠')
    const again = propose([{ from: 6, to: 11, expectedText: 'world', text: 'x' }], { toolCallId: 'c1' })
    expect(again.proposals.map((item) => item.id)).toEqual(first.proposals.map((item) => item.id))
    expect(doc.proposals.list()).toHaveLength(1)
  })

  it('survives editor unmount/remount and keeps mapping while unmounted', () => {
    const { doc, propose, type } = fixture('keep this text')
    const parent = document.createElement('div')
    let view = new EditorView({ state: doc.createEditorState({ extensions: [history()] }), parent })
    let detach = doc.attach(view)
    propose([{ from: 5, to: 9, expectedText: 'this', text: 'that' }])
    detach(); view.destroy()
    type(0, 0, 'please ') // preview mode: no view attached
    expect(doc.proposals.list()[0]).toMatchObject({ status: 'pending', from: 12, to: 16 })
    view = new EditorView({ state: doc.createEditorState({ extensions: [history()] }), parent })
    detach = doc.attach(view)
    doc.proposals.accept(doc.proposals.list()[0].id)
    expect(view.state.doc.toString()).toBe('please keep that text')
    detach(); view.destroy()
  })

  it('maps through edits dispatched in a mounted editor via update.changes', () => {
    const { doc, propose } = fixture('0123456789')
    const view = new EditorView({ state: doc.createEditorState({ extensions: [history(), EditorView.updateListener.of((update) => doc.accept(update.state, update.changes))] }), parent: document.createElement('div') })
    const detach = doc.attach(view)
    propose([{ from: 5, to: 7, expectedText: '56', text: 'X' }])
    view.dispatch({ changes: { from: 0, to: 2, insert: '' } })
    expect(doc.proposals.list()[0]).toMatchObject({ from: 3, to: 5, status: 'pending' })
    view.dispatch({ changes: { from: 4, to: 4, insert: '!' } })
    expect(doc.proposals.list()[0].status).toBe('invalid')
    detach(); view.destroy()
  })

  it('external whole-document sync without ChangeDesc revalidates by text', () => {
    const { doc, propose } = fixture('abc def')
    propose([{ from: 4, to: 7, expectedText: 'def', text: 'DEF' }])
    doc.accept(EditorState.create({ doc: 'abc xyz' }))
    expect(doc.proposals.list()[0].status).toBe('invalid')
  })

  it('isolates proposals per document and rejects late events after a document switch', () => {
    const a = fixture('doc a', '/a.md'), b = fixture('doc b', '/b.md')
    a.propose([{ from: 4, to: 5, expectedText: 'a', text: 'A' }])
    expect(b.doc.proposals.list()).toHaveLength(0)
    const disposeA = registerDocumentTools({ filePath: '/a.md', kind: 'text', isDirty: a.doc.isDirty, save: a.doc.save, undo: a.doc.undo, read: a.doc.read, edit: a.doc.edit, propose: a.doc.propose })
    disposeA()
    registerDocumentTools({ filePath: '/b.md', kind: 'text', isDirty: b.doc.isDirty, save: b.doc.save, undo: b.doc.undo, read: b.doc.read, edit: b.doc.edit, propose: b.doc.propose })
    // Agent 仍以 /a.md 为目标的迟到调用必须被拒绝，不能落到 /b.md
    expect(() => requireDocumentTools('text', { documentPath: '/a.md' })).toThrow('documentPath')
    expect(b.doc.proposals.list()).toHaveLength(0)
    expect(a.doc.text).toBe('doc a')
  })

  it('review mode turns montree_text_edit into a proposal requiring confirmation', () => {
    setProposalReviewModeSource(() => true)
    const { doc } = fixture('draft')
    const result = doc.edit({ documentPath: doc.filePath, revision: doc.revision, edits: [{ from: 0, to: 5, expectedText: 'draft', text: 'final' }], expectedCount: 1 }) as { status: string }
    expect(result.status).toBe('proposal_created')
    expect(doc.text).toBe('draft')
    expect(doc.proposals.list()[0].source).toBe('text-edit')
    doc.proposals.accept(doc.proposals.list()[0].id)
    expect(doc.text).toBe('final')
  })

  it('respects selectionId constraints just like text_edit', () => {
    const { doc } = fixture('abc def')
    doc.accept(doc.state.update({ selection: { anchor: 0, head: 3 } }).state)
    const selectionId = doc.selection()!.selectionId
    expect(() => doc.propose({ documentPath: doc.filePath, revision: doc.revision, selectionId, edits: [{ from: 4, to: 7, expectedText: 'def', text: 'x' }], expectedCount: 1 })).toThrow('选区')
    doc.propose({ documentPath: doc.filePath, revision: doc.revision, selectionId, edits: [{ from: 0, to: 3, expectedText: 'abc', text: 'x' }], expectedCount: 1 })
    expect(doc.proposals.pending()).toHaveLength(1)
  })

  it('a user edit after the proposal was created invalidates it when accept re-checks text', () => {
    const { doc, propose } = fixture('xx yy')
    propose([{ from: 3, to: 5, expectedText: 'yy', text: 'zz' }])
    // 无 ChangeDesc 的状态替换但原文仍在原位 → 保持有效
    doc.accept(EditorState.create({ doc: 'xx yy!' }))
    expect(doc.proposals.list()[0].status).toBe('pending')
    doc.proposals.accept(doc.proposals.list()[0].id)
    expect(doc.text).toBe('xx zz!')
  })

  it('dispose invalidates open proposals and blocks new ones', () => {
    const { doc, propose } = fixture('abc')
    propose([{ from: 0, to: 1, expectedText: 'a', text: 'A' }])
    doc.proposals.dispose()
    expect(doc.proposals.list()[0].status).toBe('invalid')
    expect(() => propose([{ from: 2, to: 3, expectedText: 'c', text: 'C' }])).toThrow('已关闭')
  })
})

describe('proposal mapping helpers', () => {
  const base: EditProposal = { id: 'p', batchId: 'b', documentPath: '/x', threadId: null, toolCallId: null, baseRevision: 1, from: 4, to: 8, expectedText: 'abcd', replacement: 'z', status: 'pending', source: 'text-propose', createdAt: 0 }
  it('maps after-target edits as no-ops and touching edits as invalid', () => {
    expect(mapProposal(base, ChangeSet.of({ from: 10, insert: 'q' }, 20))).toBe(base)
    expect(mapProposal(base, ChangeSet.of({ from: 8, insert: 'q' }, 20)).status).toBe('invalid')
    expect(mapProposal(base, ChangeSet.of({ from: 0, to: 2 }, 20))).toMatchObject({ from: 2, to: 6 })
    expect(mapProposal({ ...base, status: 'accepted' }, ChangeSet.of({ from: 5, to: 6 }, 20)).status).toBe('accepted')
  })
  it('detects conflicts the same way as batched text_edit', () => {
    expect(rangesConflict({ from: 0, to: 3 }, { from: 3, to: 5 })).toBe(false)
    expect(rangesConflict({ from: 0, to: 3 }, { from: 2, to: 5 })).toBe(true)
    expect(rangesConflict({ from: 3, to: 3 }, { from: 3, to: 5 })).toBe(true)
  })
})

describe('proposal CodeMirror extension', () => {
  function mount(text: string, path = '/x.md') {
    setProposalExtensionFactory((document) => proposalExtension(document.proposals))
    const f = fixture(text, path)
    const parent = document.createElement('div'); document.body.append(parent)
    const view = new EditorView({ state: f.doc.createEditorState({ extensions: [history(), EditorView.updateListener.of((u) => f.doc.accept(u.state, u.changes))] }), parent })
    const detach = f.doc.attach(view)
    return { ...f, view, cleanup: () => { detach(); view.destroy(); parent.remove() } }
  }
  const flush = () => new Promise((resolve) => setTimeout(resolve, 0))

  it('renders strikethrough + inline replacement with accept/reject buttons', async () => {
    const { doc, propose, view, cleanup } = mount('hello world')
    propose([{ from: 6, to: 11, expectedText: 'world', text: 'there' }])
    await flush()
    const del = view.contentDOM.querySelector('.cm-ai-proposal-del')
    expect(del?.textContent).toBe('world')
    expect(view.contentDOM.querySelector('.cm-ai-proposal-inline .cm-ai-proposal-ins')?.textContent).toBe('there')
    const accept = view.contentDOM.querySelector<HTMLButtonElement>('[data-proposal-action="accept"]')!
    accept.click()
    await flush()
    expect(doc.text).toBe('hello there')
    expect(view.contentDOM.querySelector('.cm-ai-proposal')).toBeNull()
    cleanup()
  })

  it('uses line decorations and a block widget for multi-line proposals (Typst too)', async () => {
    const { propose, view, cleanup, doc } = mount('= Title\n#let a = 1\n#let b = 2\n', '/paper.typ')
    propose([{ from: 8, to: 29, expectedText: '#let a = 1\n#let b = 2', text: '#let a = 10\n#let b = 20' }])
    await flush()
    expect(view.contentDOM.querySelectorAll('.cm-ai-proposal-del-line')).toHaveLength(2)
    expect(view.contentDOM.querySelector('.cm-ai-proposal-block')).not.toBeNull()
    view.contentDOM.querySelector<HTMLButtonElement>('[data-proposal-action="reject"]')!.click()
    await flush()
    expect(doc.text).toBe('= Title\n#let a = 1\n#let b = 2\n')
    expect(view.contentDOM.querySelector('.cm-ai-proposal')).toBeNull()
    cleanup()
  })

  it('defers decoration updates while an IME composition is active', async () => {
    const { propose, view, cleanup } = mount('输入法测试')
    Object.defineProperty(view, 'composing', { configurable: true, get: () => true })
    propose([{ from: 0, to: 2, expectedText: '输入', text: '键入' }])
    await flush()
    expect(view.contentDOM.querySelector('.cm-ai-proposal')).toBeNull()
    Object.defineProperty(view, 'composing', { configurable: true, get: () => false })
    view.contentDOM.dispatchEvent(new CompositionEvent('compositionend'))
    await flush()
    expect(view.contentDOM.querySelector('.cm-ai-proposal-ins')?.textContent).toBe('键入')
    cleanup()
  })
})
