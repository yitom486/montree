import { describe, expect, it } from 'vitest'
import {
  beginPromptSelectionCycle,
  clearReaderSelection,
  commitReaderSelection,
  getTurnReaderSelection,
  hasActiveSelection,
  readSelectionText,
  registerSelectionProvider,
} from './reader-selection-registry'

describe('reader-selection-registry sticky', () => {
  it('commit 后 DOM 无选区仍能读到', () => {
    const dispose = registerSelectionProvider({
      filePath: '/book.epub',
      getSelectionText: () => null,
    })
    commitReaderSelection('/book.epub', '  战俘奴才  ')
    expect(readSelectionText('/book.epub')).toBe('战俘奴才')
    expect(hasActiveSelection()).toBe(true)
    dispose()
  })

  it('注销 provider 时清除同文件 sticky，但保留本轮已冻结快照', () => {
    const dispose = registerSelectionProvider({
      filePath: '/book.epub',
      getSelectionText: () => null,
    })
    commitReaderSelection('/book.epub', '段落')
    expect(beginPromptSelectionCycle()).toBe(true)
    dispose()
    expect(readSelectionText()).toBe('段落')
    expect(beginPromptSelectionCycle()).toBe(false)
  })

  it('clearReaderSelection 清空当前选区', () => {
    commitReaderSelection('/a.pdf', '页内文字')
    clearReaderSelection()
    expect(hasActiveSelection()).toBe(false)
  })

  it('无 sticky 时回退到 provider 实时选区', () => {
    const dispose = registerSelectionProvider({
      filePath: '/note.md',
      getSelectionText: () => '编辑器选区',
    })
    expect(readSelectionText()).toBe('编辑器选区')
    dispose()
  })

  it('getSelectionText 误调 readSelectionText 时不栈溢出', () => {
    const dispose = registerSelectionProvider({
      filePath: '/book.epub',
      getSelectionText: () => readSelectionText('/book.epub'),
    })
    expect(readSelectionText('/book.epub')).toBeNull()
    dispose()
  })
})

describe('selection turn snapshot', () => {
  it('发送时冻结本轮选区，AI 回答期间取消也不影响本轮', () => {
    commitReaderSelection('/book.epub', '共天下')
    expect(beginPromptSelectionCycle()).toBe(true)
    expect(getTurnReaderSelection()?.text).toBe('共天下')

    // 模拟 AI 回答期间用户取消选区
    clearReaderSelection()

    expect(readSelectionText()).toBe('共天下')
    expect(getTurnReaderSelection()?.text).toBe('共天下')
  })

  it('选区仍未取消时，下一轮继续通知同一段', () => {
    commitReaderSelection('/book.epub', '共天下')
    expect(beginPromptSelectionCycle()).toBe(true)
    expect(beginPromptSelectionCycle()).toBe(true)
    expect(readSelectionText()).toBe('共天下')
  })

  it('取消后下一轮不再通知，也不保留旧选区', () => {
    commitReaderSelection('/book.epub', '共天下')
    expect(beginPromptSelectionCycle()).toBe(true)
    clearReaderSelection()

    expect(beginPromptSelectionCycle()).toBe(false)
    expect(readSelectionText()).toBeNull()
    expect(hasActiveSelection()).toBe(false)
  })

  it('重新划选（含相同文字）再次通知', () => {
    commitReaderSelection('/book.epub', '共天下')
    expect(beginPromptSelectionCycle()).toBe(true)
    clearReaderSelection()

    commitReaderSelection('/book.epub', '共天下')
    expect(beginPromptSelectionCycle()).toBe(true)
    expect(readSelectionText()).toBe('共天下')
  })

  it('本轮冻结后新选区不污染当前轮，下一轮才生效', () => {
    commitReaderSelection('/book.epub', '旧选区')
    expect(beginPromptSelectionCycle()).toBe(true)

    commitReaderSelection('/book.epub', '新选区')
    expect(readSelectionText()).toBe('旧选区')
    expect(getTurnReaderSelection()?.text).toBe('旧选区')

    expect(beginPromptSelectionCycle()).toBe(true)
    expect(readSelectionText()).toBe('新选区')
  })
})
