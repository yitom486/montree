import { describe, expect, it, vi } from 'vitest'
import { getDocumentTools, registerDocumentTools, requireDocumentTools } from './document-tool-registry'
import { commitDocumentSelection, clearReaderSelection, beginPromptSelectionCycle } from './reader-selection-registry'
import { readSelectionWithContext } from './read-selection-context'
describe('结构化文档桥接', () => {
  it('按文档路径和能力拒绝跨文件编辑，旧清理不会删除新provider', () => {
    const first = registerDocumentTools({ filePath: '/a.csv', kind: 'table', isDirty: () => false, read: vi.fn(), edit: vi.fn(), save: vi.fn(), undo: vi.fn() })
    const next = registerDocumentTools({ filePath: '/b.pptx', kind: 'slide', isDirty: () => false, read: vi.fn(), edit: vi.fn(), save: vi.fn(), undo: vi.fn() })
    first()
    expect(getDocumentTools()?.filePath).toBe('/b.pptx')
    expect(() => requireDocumentTools('table', { documentPath: '/a.csv' })).toThrow('不支持')
    expect(() => requireDocumentTools('slide', { documentPath: '/a.csv' })).toThrow('不匹配')
    next()
  })
  it('空白单元格以地址固定选区，并保留本轮可读取的坐标', async () => {
    const target = { kind: 'table' as const, documentPath: '/a.csv', sheet: 'Sheet1', ranges: ['C3:D4'], revision: 2, selectionId: 'selection-1' }
    commitDocumentSelection(target, 'Sheet1!C3:D4')
    expect(beginPromptSelectionCycle()).toBe(true)
    expect((await readSelectionWithContext()).target).toEqual(target)
    expect(beginPromptSelectionCycle()).toBe(false)
    clearReaderSelection()
  })
})
