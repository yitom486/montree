// @vitest-environment happy-dom
import { beforeAll, describe, expect, it } from 'vitest'
import { installXmlTestDom } from './xml-test-dom'
beforeAll(installXmlTestDom)
import { zipSync, strToU8, unzipSync, strFromU8 } from 'fflate'
import { PresentationDocument } from './presentation-document'

export function presentationFixture(animation = false): Uint8Array {
  return zipSync({
    'ppt/presentation.xml': strToU8('<p:presentation xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><p:sldIdLst><p:sldId id="256" r:id="rId2"/><p:sldId id="257" r:id="rId1"/></p:sldIdLst><p:sldSz cx="9144000" cy="6858000"/></p:presentation>'),
    'ppt/_rels/presentation.xml.rels': strToU8('<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Target="slides/slide1.xml"/><Relationship Id="rId2" Target="slides/slide2.xml"/></Relationships>'),
    ...Object.fromEntries([1, 2].map((i) => [`ppt/slides/slide${i}.xml`, strToU8(`<p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><p:cSld><p:spTree><p:sp><p:nvSpPr><p:cNvPr id="10" name="Title ${i}"/></p:nvSpPr><p:spPr><a:xfrm><a:off x="127000" y="254000"/><a:ext cx="2540000" cy="635000"/></a:xfrm></p:spPr><p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:rPr sz="2400"/><a:t>Slide ${i} &amp; text</a:t></a:r></a:p></p:txBody></p:sp><p:sp><p:nvSpPr><p:cNvPr id="20" name="Body"/></p:nvSpPr><p:spPr/><p:txBody><a:bodyPr/><a:p><a:r><a:t>Body</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld>${animation ? '<p:timing><p:spTgt spid="10"/></p:timing>' : ''}</p:sld>`)])),
    'ppt/theme/theme1.xml': strToU8('<theme keep="yes"/>'),
  })
}
describe('PPT元素操作', () => {
  it('保留段落默认字号/粗体/颜色、运行覆盖、换行及原稿背景，编辑和撤销刷新预览', () => {
    const files = unzipSync(presentationFixture())
    files['ppt/slides/slide2.xml'] = strToU8(`<p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><p:cSld><p:bg><p:bgPr><a:solidFill><a:srgbClr val="F1F5F9"/></a:solidFill></p:bgPr></p:bg><p:spTree><p:sp><p:nvSpPr><p:cNvPr id="10" name="Title"/></p:nvSpPr><p:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="8000000" cy="2000000"/></a:xfrm><a:solidFill><a:srgbClr val="E2E8F0"/></a:solidFill><a:ln w="25400"><a:solidFill><a:srgbClr val="2563EB"/></a:solidFill></a:ln></p:spPr><p:txBody><a:bodyPr wrap="none" anchor="ctr"/><a:lstStyle/><a:p><a:pPr algn="ctr"><a:defRPr sz="4000" b="1"><a:solidFill><a:srgbClr val="1E293B"/></a:solidFill></a:defRPr></a:pPr><a:r><a:t>Title</a:t></a:r><a:br/><a:r><a:rPr sz="1300" b="0"/><a:t>Date</a:t></a:r></a:p><a:p><a:pPr><a:spcBef><a:spcPts val="1400"/></a:spcBef><a:defRPr sz="2000"><a:solidFill><a:srgbClr val="64748B"/></a:solidFill></a:defRPr></a:pPr><a:r><a:t>Subtitle</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld></p:sld>`)
    const doc = new PresentationDocument('/styles.pptx', zipSync(files))
    const element = doc.elements(1)[0]
    expect(element).toMatchObject({ fontSize: 40, color: '#1e293b', text: 'Title\nDate\nSubtitle' })
    expect(element.appearance).toMatchObject({ fill: '#e2e8f0', lineWidth: 2, lineColor: '#2563eb', wrap: false, verticalAlign: 'center' })
    expect(element.appearance.paragraphs[0]).toMatchObject({ fontSize: 40, bold: true, align: 'center', runs: [{ text: 'Title', fontSize: 40, bold: true }, { text: '\n' }, { text: 'Date', fontSize: 13, bold: false }] })
    expect(element.appearance.paragraphs[1]).toMatchObject({ fontSize: 20, before: 14, color: '#64748b' })
    expect(doc.background(1)).toBe('#f1f5f9')
    expect(doc.dirty).toBe(false)
    doc.edit({ revision: 0, slide: 1, operation: 'update', elementIds: ['10'], expectedCount: 1, patch: { fontSize: 32, color: '#123456' } })
    expect(doc.elements(1)[0].appearance.paragraphs[0].runs[0]).toMatchObject({ fontSize: 32, color: '#123456', bold: true })
    doc.undo()
    expect(doc.elements(1)[0].fontSize).toBe(40)
    expect(doc.dirty).toBe(false)
  })
  it('背景和颜色沿当前幻灯片的版式/母版/主题关系解析，不使用其他主题', () => {
    const files = unzipSync(presentationFixture())
    files['ppt/slides/_rels/slide2.xml.rels'] = strToU8('<Relationships><Relationship Id="layout" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout" Target="../slideLayouts/slideLayout7.xml"/></Relationships>')
    files['ppt/slideLayouts/slideLayout7.xml'] = strToU8('<p:sldLayout xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"/>')
    files['ppt/slideLayouts/_rels/slideLayout7.xml.rels'] = strToU8('<Relationships><Relationship Id="master" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideMaster" Target="../slideMasters/slideMaster3.xml"/></Relationships>')
    files['ppt/slideMasters/slideMaster3.xml'] = strToU8('<p:sldMaster xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><p:cSld><p:bg><p:bgRef idx="1001"><a:schemeClr val="bg1"/></p:bgRef></p:bg></p:cSld><p:clrMap bg1="accent2" tx1="dk1"/></p:sldMaster>')
    files['ppt/slideMasters/_rels/slideMaster3.xml.rels'] = strToU8('<Relationships><Relationship Id="theme" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/theme" Target="../theme/theme3.xml"/></Relationships>')
    files['ppt/theme/theme3.xml'] = strToU8('<a:theme xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:themeElements><a:clrScheme><a:accent2><a:srgbClr val="112233"/></a:accent2></a:clrScheme></a:themeElements></a:theme>')
    expect(new PresentationDocument('/theme.pptx', zipSync(files)).background(1)).toBe('#112233')
  })
  it('按presentation关系排序，保留原始ID，正确解码文字实体与页尺寸', () => {
    const doc = new PresentationDocument('/a.pptx', presentationFixture())
    expect(doc.slidePaths[0]).toBe('ppt/slides/slide2.xml')
    expect(doc.elements(1)[0]).toMatchObject({ id: '10', text: 'Slide 2 & text', x: 10, y: 20, width: 200 })
    expect(doc.width).toBe(720)
    expect(doc.dirty).toBe(false)
  })
  it('修改文字位置样式后可撤销，其他ZIP部件保持原样', () => {
    const original = presentationFixture(); const doc = new PresentationDocument('/a.pptx', original)
    doc.edit({ revision: 0, slide: 1, operation: 'update', elementIds: ['10'], expectedCount: 1, patch: { text: 'Updated <text>\nnext', x: 30, fontSize: 32, color: '#123456' } })
    expect(doc.elements(1)[0]).toMatchObject({ text: 'Updated <text>\nnext', x: 30, fontSize: 32, color: '#123456' })
    const files = unzipSync(doc.serialize()); const before = unzipSync(original)
    expect(files['ppt/theme/theme1.xml']).toEqual(before['ppt/theme/theme1.xml'])
    expect(files['ppt/slides/slide1.xml']).toEqual(before['ppt/slides/slide1.xml'])
    expect(strFromU8(files['ppt/slides/slide2.xml'])).toContain('&lt;text&gt;')
    doc.undo(); expect(doc.elements(1)[0].text).toBe('Slide 2 & text'); expect(doc.dirty).toBe(false)
  })
  it('数量、唯一匹配、版本和选区校验在写入之前完成', () => {
    const doc = new PresentationDocument('/a.pptx', presentationFixture())
    const selection = doc.select(1, ['10'])
    expect(() => doc.edit({ revision: 0, slide: 1, operation: 'delete', elementIds: ['10', 'missing'], expectedCount: 2 })).toThrow('未唯一')
    expect(doc.revision).toBe(0)
    doc.edit({ revision: 0, slide: 1, operation: 'delete', selectionId: selection.selectionId, expectedCount: 1 })
    expect(doc.elements(1).map((element) => element.id)).toEqual(['20'])
    expect(() => doc.edit({ revision: 0, slide: 1, operation: 'delete', elementIds: ['20'], expectedCount: 1 })).toThrow('版本')
  })
  it('动画引用保护和不支持的主题修改不会破坏文件', () => {
    const doc = new PresentationDocument('/a.pptx', presentationFixture(true))
    expect(() => doc.edit({ revision: 0, slide: 1, operation: 'delete', elementIds: ['10'], expectedCount: 1 })).toThrow('动画')
    expect(() => doc.edit({ revision: 0, slide: 1, operation: 'update', elementIds: ['10'], expectedCount: 1, patch: { theme: 'dark' } })).toThrow('不支持')
    expect(doc.dirty).toBe(false)
  })
})
