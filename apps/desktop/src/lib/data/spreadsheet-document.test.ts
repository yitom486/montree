// @vitest-environment happy-dom
import { beforeAll, describe, expect, it } from 'vitest'
import { installXmlTestDom } from './xml-test-dom'
beforeAll(installXmlTestDom)
import * as XLSX from 'xlsx'
import { unzipSync, zipSync, strFromU8, strToU8 } from 'fflate'
import { SpreadsheetDocument } from './spreadsheet-document'

const edit = (doc: SpreadsheetDocument, overrides: Record<string, unknown> = {}) => doc.edit({ revision: doc.revision, sheet: doc.activeSheet, target: { range: 'A1:B2' }, operation: 'set', values: [['name', 'value'], ['a', 42]], expectedCount: 4, ...overrides })
describe('表格文档编辑', () => {
  it('矩形数量/形状严格匹配，错误参数不产生部分修改', () => {
    const doc = new SpreadsheetDocument('/a.csv', 'a,b\nc,d')
    expect(() => edit(doc, { values: [['changed']] })).toThrow('完全匹配')
    expect(() => edit(doc, { expectedCount: 3 })).toThrow('expectedCount')
    expect(() => edit(doc, { values: [['a', 'b'], ['c', { wrong: 1 }]] })).toThrow('单元格值')
    expect(doc.revision).toBe(0)
    expect(doc.cell(doc.activeSheet, 0, 0).value).toBe('a')
    edit(doc)
    expect(doc.cell(doc.activeSheet, 1, 1).value).toBe(42)
    expect(doc.dirty).toBe(true)
    doc.undo()
    expect(doc.cell(doc.activeSheet, 1, 1).value).toBe('d')
    expect(doc.dirty).toBe(false)
  })
  it('行/列范围、空白选区、版本和选区变化均准确校验', () => {
    const doc = new SpreadsheetDocument('/a.csv', 'a,b\nc,d')
    const selection = doc.select(doc.activeSheet, ['C3:D3'])
    edit(doc, { target: { selectionId: selection.selectionId }, operation: 'fill', value: 'x', expectedCount: 2 })
    expect(doc.cell(doc.activeSheet, 2, 2).value).toBe('x')
    expect(() => edit(doc, { revision: 0 })).toThrow('版本')
    expect(() => edit(doc, { target: { selectionId: selection.selectionId } })).toThrow('过期')
    edit(doc, { target: { column: 'D', start: 1, count: 2 }, operation: 'clear', expectedCount: 2 })
    expect(doc.cell(doc.activeSheet, 0, 3).value).toBe(null)
    edit(doc, { target: { row: 4, start: 2, count: 2 }, operation: 'fill', value: true, expectedCount: 2 })
    expect(doc.cell(doc.activeSheet, 3, 1).value).toBe(true)
  })
  it('重叠选区、非法地址和大范围拒绝，TSV保留分隔符/换行/前导零', () => {
    const doc = new SpreadsheetDocument('/a.tsv', '\uFEFFcode\tvalue\r\n001\t"multi\tvalue"')
    expect(doc.cell(doc.activeSheet, 1, 0).value).toBe('001')
    edit(doc, { target: { range: 'B2' }, operation: 'fill', value: 'updated', expectedCount: 1 })
    expect(doc.serializeText()).toContain('\uFEFFcode\tvalue\r\n001\tupdated')
    expect(() => edit(doc, { target: { ranges: ['A1:B2', 'B2'] }, operation: 'fill', value: '', expectedCount: 5 })).toThrow('重叠')
    expect(() => doc.read({ sheet: doc.activeSheet, target: { range: 'A1:ZZ999' } })).toThrow('最多')
    expect(() => edit(doc, { target: { range: 'A0' } })).toThrow('范围')
    expect(() => edit(doc, { target: { range: 'A1' }, operation: 'fill', value: { formula: '1+1' }, expectedCount: 1 })).toThrow('不支持公式')
  })
  it('局部XLSX编辑保留其他ZIP部件与公式，保存后重新解析值正确', () => {
    const wb = XLSX.utils.book_new()
    const sheet = XLSX.utils.aoa_to_sheet([['a', 3], ['b', 4]])
    sheet.C1 = { t: 'n', f: 'SUM(B1:B2)', v: 7 }
    sheet['!ref'] = 'A1:C2'
    XLSX.utils.book_append_sheet(wb, sheet, 'Data')
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['untouched']]), 'Other')
    const zip = unzipSync(new Uint8Array(XLSX.write(wb, { type: 'array', bookType: 'xlsx' })))
    zip['xl/media/keep.png'] = new Uint8Array([1, 2, 3])
    zip['xl/custom/keep.xml'] = strToU8('<keep value="yes"/>')
    const doc = new SpreadsheetDocument('/a.xlsx', zipSync(zip))
    edit(doc, { target: { range: 'B2' }, operation: 'fill', value: 20, expectedCount: 1 })
    const result = doc.serializeBinary()
    const after = unzipSync(result)
    expect(after['xl/media/keep.png']).toEqual(zip['xl/media/keep.png'])
    expect(after['xl/custom/keep.xml']).toEqual(zip['xl/custom/keep.xml'])
    expect(after['xl/worksheets/sheet2.xml']).toEqual(zip['xl/worksheets/sheet2.xml'])
    const reopened = XLSX.read(result, { type: 'array' })
    expect(reopened.Sheets.Data.B2.v).toBe(20)
    expect(reopened.Sheets.Data.C1.f).toBe('SUM(B1:B2)')
    edit(doc, { target: { range: 'D4' }, operation: 'fill', value: { formula: 'B2*2' }, expectedCount: 1 })
    expect(XLSX.read(doc.serializeBinary(), { type: 'array' }).Sheets.Data.D4.f).toBe('B2*2')
    expect(strFromU8(unzipSync(doc.serializeBinary())['xl/workbook.xml'])).toContain('fullCalcOnLoad="1"')
    doc.undo()
    expect(XLSX.read(doc.serializeBinary(), { type: 'array' }).Sheets.Data.D4?.f).toBeUndefined()
  })
  it('合并单元格拒绝修改', () => {
    const wb = XLSX.utils.book_new(); const sheet = XLSX.utils.aoa_to_sheet([['merged']])
    sheet['!merges'] = [{ s: { r: 0, c: 0 }, e: { r: 0, c: 1 } }]
    XLSX.utils.book_append_sheet(wb, sheet, 'Data')
    const doc = new SpreadsheetDocument('/a.xlsx', new Uint8Array(XLSX.write(wb, { type: 'array', bookType: 'xlsx' })))
    expect(() => edit(doc, { target: { range: 'A1' }, operation: 'clear', expectedCount: 1 })).toThrow('合并')
  })
})
