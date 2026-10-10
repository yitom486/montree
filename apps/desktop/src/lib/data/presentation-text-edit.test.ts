// @vitest-environment happy-dom
import { beforeAll, describe, expect, it } from 'vitest'
import { zipSync, strToU8, unzipSync, strFromU8 } from 'fflate'
import { installXmlTestDom } from './xml-test-dom'
import { PresentationDocument } from './presentation-document'
beforeAll(installXmlTestDom)

function fixture(): Uint8Array {
  return zipSync({
    'ppt/presentation.xml': strToU8('<p:presentation xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><p:sldIdLst><p:sldId r:id="s1"/></p:sldIdLst><p:sldSz cx="12192000" cy="6858000"/></p:presentation>'),
    'ppt/_rels/presentation.xml.rels': strToU8('<Relationships><Relationship Id="s1" Target="slides/slide1.xml"/></Relationships>'),
    'ppt/slides/slide1.xml': strToU8('<p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><p:cSld><p:spTree><p:sp><p:nvSpPr><p:cNvPr id="10" name="Mixed"/></p:nvSpPr><p:spPr/><p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:pPr><a:defRPr sz="4000" b="1"><a:solidFill><a:srgbClr val="1E293B"/></a:solidFill></a:defRPr></a:pPr><a:r><a:t>Title</a:t></a:r></a:p><a:p><a:pPr><a:spcBef><a:spcPts val="1400"/></a:spcBef><a:defRPr sz="2000"><a:solidFill><a:srgbClr val="64748B"/></a:solidFill></a:defRPr></a:pPr><a:r><a:t>Keep </a:t></a:r><a:r><a:rPr i="1"><a:solidFill><a:srgbClr val="2563EB"/></a:solidFill><a:hlinkClick xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" r:id="link1"/></a:rPr><a:t>old 😀 words</a:t></a:r><a:r><a:t> tail</a:t></a:r><a:br/><a:r><a:t>second line</a:t></a:r><a:endParaRPr lang="zh-CN"/></a:p><a:p><a:fld id="date" type="datetime"><a:t>2026</a:t></a:fld></a:p><a:p><a:pPr><a:defRPr sz="1600"/></a:pPr></a:p></p:txBody></p:sp></p:spTree></p:cSld></p:sld>'),
    'ppt/theme/theme1.xml': strToU8('<keep theme="yes"/>'), 'ppt/media/untouched.png': new Uint8Array([1, 2, 3]),
  })
}
const read = (doc: PresentationDocument) => doc.elements(1)[0].appearance.paragraphs
const apply = (doc: PresentationDocument, edits: unknown[], extra = {}) => doc.edit({ revision: doc.revision, slide: 1, operation: 'text', expectedCount: edits.length, edits, ...extra })
const target = (values: Record<string, unknown> = {}) => ({ elementId: '10', paragraphId: 'p2', runId: 'r2', expectedText: 'old 😀 words', patch: { text: 'new words' }, ...values })

describe('PPT精细文字编辑', () => {
  it('读取段落和片段编号，保留显式换行并标注只读字段', () => {
    const doc = new PresentationDocument('/a.pptx', fixture())
    expect(read(doc)[1]).toMatchObject({ id: 'p2', text: 'Keep old 😀 words tail\nsecond line', runs: [{ id: 'r1' }, { id: 'r2', italic: true }, { id: 'r3' }, { id: 'r4', kind: 'break', editable: false }, { id: 'r5' }] })
    expect(read(doc)[2].runs[0]).toMatchObject({ kind: 'field', editable: false })
  })
  it('只替换副标题段落，保留标题字号粗体和其他ZIP部件，保存重开一致', () => {
    const original = fixture(); const doc = new PresentationDocument('/a.pptx', original); const before = read(doc)
    const result = apply(doc, [target({ runId: undefined, expectedText: before[1].text, patch: { text: 'New subtitle', align: 'center', spaceAfter: 6 } })])
    expect(result.changedCount).toBe(1)
    expect(read(doc)[0]).toEqual(before[0]); expect(read(doc)[2]).toEqual(before[2])
    expect(read(doc)[1]).toMatchObject({ text: 'New subtitle', align: 'center', before: 14, after: 6, runs: [{ fontSize: 20, color: '#64748b' }] })
    const files = unzipSync(doc.serialize()); expect(files['ppt/theme/theme1.xml']).toEqual(unzipSync(original)['ppt/theme/theme1.xml'])
    expect(files['ppt/media/untouched.png']).toEqual(unzipSync(original)['ppt/media/untouched.png'])
    expect(read(new PresentationDocument('/a.pptx', doc.serialize()))).toEqual(read(doc))
    doc.undo(); expect(read(doc)).toEqual(before); expect(doc.dirty).toBe(false)
  })
  it('替换单个片段保留超链接/斜体/颜色，段落及范围外片段原样保留', () => {
    const doc = new PresentationDocument('/a.pptx', fixture()); const before = read(doc)
    apply(doc, [target()])
    expect(read(doc)[1].text).toBe('Keep new words tail\nsecond line')
    expect(read(doc)[1].runs[1]).toMatchObject({ italic: true, color: '#2563eb' })
    expect(read(doc)[1].runs.slice(2)).toEqual(before[1].runs.slice(2))
    expect(strFromU8(unzipSync(doc.serialize())['ppt/slides/slide1.xml'])).toContain('r:id="link1"')
  })
  it('跨片段范围的样式修改保留范围外样式和文本，支持false覆盖', () => {
    const doc = new PresentationDocument('/a.pptx', fixture())
    apply(doc, [target({ runId: undefined, start: 3, end: 8, expectedText: 'p old', patch: { bold: true, italic: false, underline: true, color: '#123456' } })])
    const runs = read(doc)[1].runs
    expect(runs[0]).toMatchObject({ text: 'Kee', color: '#64748b' })
    expect(runs[1]).toMatchObject({ text: 'p ', bold: true, color: '#123456', italic: false })
    expect(runs[2]).toMatchObject({ text: 'old', bold: true, color: '#123456', underline: true })
    expect(runs[3]).toMatchObject({ text: ' 😀 words', color: '#2563eb', italic: true })
    expect(read(doc)[1].text).toBe('Keep old 😀 words tail\nsecond line')
  })
  it('同一段落多个互不重叠范围按原始坐标原子替换', () => {
    const doc = new PresentationDocument('/a.pptx', fixture())
    apply(doc, [target({ start: 0, end: 3, expectedText: 'old', patch: { text: 'long replacement' } }), target({ start: 7, end: 12, expectedText: 'words', patch: { text: 'text', bold: true } })])
    expect(read(doc)[1].text).toBe('Keep long replacement 😀 text tail\nsecond line')
    expect(read(doc)[1].runs.some((run) => run.text === 'text' && run.bold)).toBe(true)
  })
  it('支持空段落插入、换行、空格保留和整段字体设置', () => {
    const doc = new PresentationDocument('/a.pptx', fixture())
    apply(doc, [target({ paragraphId: 'p4', runId: undefined, expectedText: '', patch: { text: '  new\nline  ', fontSize: 22, fontFamily: 'Arial', italic: true } })])
    expect(read(doc)[3]).toMatchObject({ text: '  new\nline  ', fontSize: 22, runs: [{ fontSize: 22, italic: true }, { kind: 'break' }, { italic: true }] })
    expect(strFromU8(unzipSync(doc.serialize())['ppt/slides/slide1.xml'])).toContain('xml:space="preserve"')
  })
  it.each([
    [target({ expectedText: 'wrong' }), 'expectedText'], [target({ paragraphId: 'p99' }), '段落'], [target({ runId: 'r99' }), '片段'],
    [target({ paragraphId: 'p3', runId: undefined, expectedText: '2026' }), '字段'], [target({ start: 5, end: 6, expectedText: '' }), '代理对'],
    [target({ start: 0, end: 100 }), '范围'], [target({ patch: { fontSize: NaN } }), 'fontSize'], [target({ patch: { bold: 'yes' } }), '布尔'],
    [target({ patch: { align: 'center' } }), '完整段落'], [target({ patch: { animation: 'fade' } }), '不支持'],
    [target({ patch: { text: '\uD800' } }), '有效文本'],
  ])('非法目标或patch拒绝整批修改：%s', (invalid, message) => {
    const doc = new PresentationDocument('/a.pptx', fixture()); const before = doc.serialize()
    expect(() => apply(doc, [target({ paragraphId: 'p1', runId: undefined, expectedText: 'Title', patch: { text: 'changed' } }), invalid])).toThrow(String(message))
    expect(doc.serialize()).toEqual(before); expect(doc.revision).toBe(0); expect(() => doc.undo()).toThrow('没有')
  })
  it('数量/重叠/版本/选区校验拒绝修改，成功后刷新选区版本', () => {
    const doc = new PresentationDocument('/a.pptx', fixture()); const selected = doc.select(1, ['10'], { paragraphId: 'p2', runId: 'r2' })
    expect(() => apply(doc, [target()], { expectedCount: 2 })).toThrow('数量')
    expect(() => apply(doc, [target(), target()])).toThrow('重叠')
    expect(() => apply(doc, [target()], { revision: 99 })).toThrow('版本')
    expect(() => apply(doc, [target()], { selectionId: 'stale' })).toThrow('选区')
    apply(doc, [target()], { selectionId: selected.selectionId })
    expect(doc.selection).toMatchObject({ paragraphId: 'p2', revision: 1 })
    expect(doc.selection?.selectionId).not.toBe(selected.selectionId)
    expect(() => apply(doc, [target()], { selectionId: selected.selectionId })).toThrow('选区')
  })
  it('旧的整文本框修改拒绝多段落覆盖', () => {
    const doc = new PresentationDocument('/a.pptx', fixture())
    expect(() => doc.edit({ revision: 0, slide: 1, operation: 'update', elementIds: ['10'], expectedCount: 1, patch: { text: 'all' } })).toThrow('montree_ppt_edit_text')
  })
})
