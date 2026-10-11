import { describe, expect, it, vi } from 'vitest'
import { classifyMarkProposalFailure, openChapterForMarkRecovery } from './mark-proposal-failure'
import { registerReaderMarks, type ReaderMarksProvider } from './context/reader-marks-registry'
import { registerReaderContent } from './context/reader-content-registry'

describe('classifyMarkProposalFailure', () => {
  it('识别未找到摘录并可打开章 / 划词', () => {
    const guide = classifyMarkProposalFailure('未在当前页及相邻页找到该摘录，请翻到对应页后划词重试', 2)
    expect(guide.canSelectText).toBe(true)
    expect(guide.canOpenChapter).toBe(true)
    expect(guide.flatIndex).toBe(2)
  })

  it('识别阅读器未就绪', () => {
    const guide = classifyMarkProposalFailure('当前阅读器未就绪，无法定位标记')
    expect(guide.code).toBe('reader-not-ready')
    expect(guide.canOpenChapter).toBe(false)
    expect(guide.canSelectText).toBe(false)
  })

  it('U1：无字层人话归到可划词引导（不新 code）', () => {
    const guide = classifyMarkProposalFailure('本页未建立可定位文字层，请识别本页后重试', 2)
    expect(guide.message).toBe('本页未建立可定位文字层，请识别本页后重试')
    expect(guide.canSelectText).toBe(true)
  })
})

describe('openChapterForMarkRecovery 导航结果', () => {
  it('Markdown bridge waits, forwards the quote and rejects a replaced provider', async () => {
    let release!: (ok: boolean) => void
    const navigate = vi.fn(() => new Promise<boolean>(r => { release = r }))
    const offA = registerReaderContent({ filePath: '/a.md', getCurrentText: () => '', navigateToFlatIndex: navigate })
    const job = openChapterForMarkRecovery(1, '原文')
    expect(navigate).toHaveBeenCalledWith(1, '原文')
    const offB = registerReaderContent({ filePath: '/a.md', getCurrentText: () => '' })
    try { release(true); expect(await job).toBe(false) } finally { offB(); offA() }
  })
  it.each([true, false])('Markdown bridge returns actual navigation %s', async ok => {
    const off = registerReaderContent({ filePath: '/a.md', getCurrentText: () => '', navigateToFlatIndex: async () => ok })
    try { expect(await openChapterForMarkRecovery(1)).toBe(ok) } finally { off() }
  })
  const provider = (navigateToFlatIndex: ReaderMarksProvider['navigateToFlatIndex']): ReaderMarksProvider => ({
    filePath: '/a.epub', navigateToFlatIndex,
    createBookmark: vi.fn(), createNoteFromSelection: vi.fn(), createMarkAt: vi.fn(),
  })
  it('必须等待成功；期间替换同路径 provider 会拒绝旧结果', async () => {
    let release!: (value: boolean) => void
    const disposeA = registerReaderMarks(provider(() => new Promise<boolean>((r) => { release = r })))
    const job = openChapterForMarkRecovery(2)
    const disposeB = registerReaderMarks(provider(async () => true))
    try { release(true); expect(await job).toBe(false) }
    finally { disposeB(); disposeA() }
  })
  it.each([false, true])('诚实返回实际导航结果 %s', async (ok) => {
    const dispose = registerReaderMarks(provider(async () => ok))
    try { expect(await openChapterForMarkRecovery(2)).toBe(ok) } finally { dispose() }
  })
  it('导航 reject 被处理，不冒充成功', async () => {
    const dispose = registerReaderMarks(provider(async () => { throw new Error('read failed') }))
    try { expect(await openChapterForMarkRecovery(2)).toBe(false) } finally { dispose() }
  })
})
