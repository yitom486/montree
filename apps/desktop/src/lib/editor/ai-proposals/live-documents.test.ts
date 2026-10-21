import { describe, expect, it, vi } from 'vitest'
import { TextDocument } from '../text-document'
import { liveDocumentCount, registerLiveDocument, withdrawProposals } from './live-documents'
import { emitThreadLifecycle, onThreadLifecycle } from '@/lib/agent/thread-lifecycle'

const make = (path: string, text: string) => new TextDocument(path, text, text, text, vi.fn(), vi.fn(), vi.fn(async () => {}))

describe('live documents', () => {
  it('withdraws across documents, and releasing disposes after a tick unless re-registered (StrictMode)', async () => {
    const a = make('/a.md', 'aaa'), b = make('/b.md', 'bbb')
    const releaseA = registerLiveDocument(a), releaseB = registerLiveDocument(b)
    a.propose({ documentPath: '/a.md', revision: a.revision, expectedCount: 1, edits: [{ from: 0, to: 1, expectedText: 'a', text: 'A' }] }, { threadId: 't' })
    b.propose({ documentPath: '/b.md', revision: b.revision, expectedCount: 1, edits: [{ from: 0, to: 1, expectedText: 'b', text: 'B' }] }, { threadId: 'other' })
    const off = onThreadLifecycle(({ threadId, kind }) => { withdrawProposals((item) => item.threadId === threadId, kind) })
    emitThreadLifecycle({ kind: 'cancel', threadId: 't' })
    expect(a.proposals.list()[0]).toMatchObject({ status: 'rejected', note: 'cancel' })
    expect(b.proposals.list()[0].status).toBe('pending')
    off()
    releaseA(); registerLiveDocument(a) // StrictMode 卸载-重挂
    releaseB()
    await new Promise((resolve) => setTimeout(resolve, 5))
    expect(a.proposals.isDisposed).toBe(false)
    expect(b.proposals.isDisposed).toBe(true)
    expect(b.proposals.list()).toHaveLength(0)
    expect(liveDocumentCount()).toBe(1)
  })
})
