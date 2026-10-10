// @vitest-environment happy-dom
import { beforeAll, describe, expect, it } from 'vitest'
import { unzipSync, zipSync, strFromU8, strToU8 } from 'fflate'
import * as XLSX from 'xlsx'
import { installXmlTestDom } from './xml-test-dom'
import { PresentationDocument } from './presentation-document'
import { advancedPptFixture } from './presentation-test-fixture'
import { animationGroups } from './presentation-animation'
import { C, descendants, parsePart, relation, encodeXml } from './presentation-xml'

beforeAll(installXmlTestDom)
const make = async () => { const fixture = await advancedPptFixture(); return { ...fixture, doc: new PresentationDocument('/advanced.pptx', fixture.original) } }
const apply = (doc: PresentationDocument, operation: string, edits: unknown[]) => doc.edit({ revision: doc.revision, operation, edits, expectedCount: edits.length })
describe('PPT组合、图表、设计及基础动画真实部件编辑', () => {
  it('递归组内ID、局部坐标、文字精细修改和删除，保留父组合与其他ZIP部件', async () => {
    const { doc, files } = await make()
    const title = doc.allElements(1).find((item) => item.text === '组合标题')!
    expect(title).toMatchObject({ parentId: '101', x: 36, width: 288 })
    expect(doc.allElements(1).find((item) => item.id === '100')!.children![0].id).toBe('101')
    doc.edit({ revision: doc.revision, slide: 1, operation: 'text', edits: [{ elementId: title.id, paragraphId: 'p1', expectedText: '组合标题', patch: { text: '精细组合标题', bold: false } }], expectedCount: 1 })
    doc.edit({ revision: doc.revision, slide: 1, operation: 'update', elementIds: [title.id], patch: { x: 80, width: 350 }, expectedCount: 1 })
    const saved = unzipSync(doc.serialize()); const reopened = new PresentationDocument('/again.pptx', doc.serialize())
    expect(reopened.allElements(1).find((item) => item.id === title.id)).toMatchObject({ text: '精细组合标题', x: 80, width: 350, parentId: '101' })
    for (const path of Object.keys(files)) if (path !== 'ppt/slides/slide1.xml') expect(saved[path], path).toEqual(files[path])
    doc.edit({ revision: doc.revision, slide: 1, operation: 'delete', elementIds: [title.id], expectedCount: 1 })
    expect(doc.allElements(1).some((item) => item.id === title.id)).toBe(false)
    expect(doc.allElements(1).some((item) => item.id === '101')).toBe(true)
    doc.undo(); expect(doc.allElements(1).find((item) => item.id === title.id)?.text).toBe('精细组合标题')
  })
  it('组合与子元素同时编辑整批拒绝，继承元素只读', async () => {
    const { doc } = await make(); const before = doc.serialize()
    expect(() => doc.edit({ revision: 0, slide: 1, operation: 'delete', elementIds: ['100', '101'], expectedCount: 2 })).toThrow('重叠')
    const inherited = doc.allElements(1).find((item) => item.sourcePart)!
    expect(inherited.capabilities).toEqual(['read'])
    expect(() => doc.edit({ revision: 0, slide: 1, operation: 'delete', elementIds: [inherited.id], expectedCount: 1 })).toThrow('未唯一')
    expect(doc.serialize()).toEqual(before)
  })
  it.each([1, 2, 3])('图表第%i页缓存、名称、颜色及内嵌工作簿同步，保存重开并可撤销', async (slide) => {
    const { doc, files } = await make(); const element = doc.allElements(slide).find((item) => item.chart)!
    const chart = element.chart!
    expect(chart.editable, chart.unsupported.join(',')).toBe(true)
    apply(doc, 'chart', [{ slide, elementId: element.id, expectedSlides: [slide], patch: { categories: ['第一季', '第二季'], title: '更新报表', legendVisible: false, series: [{ id: chart.series[0].id, name: '净收入', values: [30, 45], color: '#059669' }] } }])
    const updated = doc.allElements(slide).find((item) => item.id === element.id)!.chart!
    expect(updated).toMatchObject({ title: '更新报表', categories: ['第一季', '第二季'], legendVisible: false })
    expect(updated.series[0]).toMatchObject({ name: '净收入', values: [30, 45], color: '#059669' })
    const saved = unzipSync(doc.serialize()); const chartXml = parsePart(saved, chart.partId)
    const embedded = relation(saved, chart.partId, descendants(chartXml, C, 'externalData')[0].getAttribute('r:id')!, true)!
    const wb = XLSX.read(saved[embedded], { type: 'array' }); const sheet = wb.Sheets[wb.SheetNames[0]]
    expect(sheet.A2.v).toBe('第一季'); expect(sheet.B1.v).toBe('净收入'); expect(sheet.B2.v).toBe(30); expect(sheet.B3.v).toBe(45)
    for (const path of Object.keys(files)) if (![chart.partId, embedded].includes(path)) expect(saved[path], path).toEqual(files[path])
    expect(new PresentationDocument('/reopen.pptx', doc.serialize()).allElements(slide).find((item) => item.chart)?.chart).toEqual(updated)
    doc.undo(); expect(doc.serialize()).toEqual(new PresentationDocument('/original.pptx', zipSync(files)).serialize())
  })
  it('图表系列/数据量/受影响页/重复部件及批次后半错误均拒绝且保持原文', async () => {
    const { doc } = await make(); const chart = doc.allElements(1).find((item) => item.chart)!; const before = doc.serialize()
    const edit = { slide: 1, elementId: chart.id, expectedSlides: [1], patch: { title: 'valid' } }
    for (const bad of [{ ...edit, expectedSlides: [2] }, { ...edit, patch: { series: [{ id: chart.chart!.series[0].id, values: [1] }] } }, { ...edit, patch: { series: [{ id: 'missing', values: [1, 2] }] } }]) expect(() => apply(doc, 'chart', [edit, bad])).toThrow()
    expect(() => apply(doc, 'chart', [edit, edit])).toThrow('重叠'); expect(doc.revision).toBe(0); expect(doc.serialize()).toEqual(before)
  })
  it('共享图表核对全部受影响页，组内图表只归属 graphicFrame，缺损缓存与外部链接只读', async () => {
    const { files } = await make()
    const original = new PresentationDocument('/original.pptx', zipSync(files))
    const firstChart = original.allElements(1).find((item) => item.chart)!.chart!.partId
    const secondChart = original.allElements(2).find((item) => item.chart)!.chart!.partId
    files['ppt/slides/_rels/slide2.xml.rels'] = strToU8(strFromU8(files['ppt/slides/_rels/slide2.xml.rels']).replace(secondChart, firstChart))
    let xml = strFromU8(files['ppt/slides/slide1.xml']); const frame = xml.match(/<p:graphicFrame>.*?<\/p:graphicFrame>/s)![0]
    xml = xml.replace(frame, '').replace('</p:grpSp></p:grpSp>', `${frame}</p:grpSp></p:grpSp>`)
    files['ppt/slides/slide1.xml'] = strToU8(xml)
    const doc = new PresentationDocument('/shared.pptx', zipSync(files))
    const chart = doc.allElements(1).find((item) => item.chart)!
    expect(chart.parentId).toBe('101'); expect(doc.allElements(1).filter((item) => item.chart)).toHaveLength(1)
    expect(chart.chart!.affectedSlides).toEqual([1, 2]); expect((doc.read({}) as any).slides[0].title).toBe('组合标题')
    const edit = { slide: 1, elementId: chart.id, expectedSlides: [1], patch: { title: '共享图表' } }
    expect(() => apply(doc, 'chart', [edit])).toThrow('受影响页')
    expect(() => apply(doc, 'chart', [{ ...edit, elementId: '101', expectedSlides: [1, 2] }])).toThrow('未唯一')
    apply(doc, 'chart', [{ ...edit, expectedSlides: [1, 2] }])
    expect(doc.allElements(2).find((item) => item.chart)!.chart!.title).toBe('共享图表')
    doc.undo(); expect(doc.revision).toBe(2)
    const malformed = { ...files, [chart.chart!.partId]: strToU8(strFromU8(files[chart.chart!.partId]).replace('<c:pt idx="1">', '<c:pt idx="0">')) }
    expect(new PresentationDocument('/bad-cache.pptx', zipSync(malformed)).allElements(1).find((item) => item.chart)!.chart!.editable).toBe(false)
    const relPath = chart.chart!.partId.replace(/([^/]+)$/, '_rels/$1.rels')
    files[relPath] = strToU8(strFromU8(files[relPath]).replace(/Target="[^"]+"/, 'Target="https://example.com/external.xlsx" TargetMode="External"'))
    const external = new PresentationDocument('/external.pptx', zipSync(files)); const before = external.serialize()
    expect(external.allElements(1).find((item) => item.chart)!.chart!.editable).toBe(false)
    expect(() => apply(external, 'chart', [{ ...edit, expectedSlides: [1, 2] }])).toThrow('外部链接')
    expect(external.serialize()).toEqual(before)
  })
  it('外链/堆叠/组合图表明确拒绝，不覆盖已有部件', async () => {
    const { files } = await make(); const source = new PresentationDocument('/a.pptx', zipSync(files)); const chart = source.allElements(1).find((item) => item.chart)!
    files[chart.chart!.partId] = strToU8(strFromU8(files[chart.chart!.partId]).replace('val="clustered"', 'val="stacked"'))
    const doc = new PresentationDocument('/a.pptx', zipSync(files))
    expect(doc.allElements(1).find((item) => item.chart)!.chart!.editable).toBe(false)
    expect(() => apply(doc, 'chart', [{ slide: 1, elementId: chart.id, expectedSlides: [1], patch: { title: 'unsafe' } }])).toThrow('不支持')
    expect(doc.dirty).toBe(false)
  })
  it('不同图表共享工作簿时拒绝局部修改，避免另一张图表缓存过期', async () => {
    const { doc: original, files } = await make()
    const first = original.allElements(1).find((item) => item.chart)!.chart!.partId
    const second = original.allElements(2).find((item) => item.chart)!.chart!.partId
    const firstData = descendants(parsePart(files, first), C, 'externalData')[0].getAttribute('r:id')!
    const embedded = relation(files, first, firstData, true)!
    const secondData = descendants(parsePart(files, second), C, 'externalData')[0].getAttribute('r:id')!
    const relPath = second.replace(/([^/]+)$/, '_rels/$1.rels'); const rels = parsePart(files, relPath)
    Array.from(rels.getElementsByTagName('Relationship')).find((node) => node.getAttribute('Id') === secondData)!.setAttribute('Target', `/${embedded}`)
    files[relPath] = new Uint8Array(encodeXml(rels))
    const doc = new PresentationDocument('/shared-data.pptx', zipSync(files)); const before = doc.serialize()
    const chart = doc.allElements(1).find((item) => item.chart)!
    expect(chart.chart!.unsupported.join(',')).toContain('共享内嵌工作簿')
    expect(() => apply(doc, 'chart', [{ slide: 1, elementId: chart.id, expectedSlides: [1], patch: { series: [{ id: chart.chart!.series[0].id, values: [1, 2] }] } }])).toThrow('共享内嵌工作簿')
    expect(doc.serialize()).toEqual(before)
  })
  it('母版默认样式继承和背景预览、显式样式保留，受影响页须完全匹配', async () => {
    const { doc, files } = await make(); const design = doc.read({ target: 'design' }) as any
    const master = design.parts.find((item: any) => item.kind === 'master')
    expect(master.affectedSlides).toEqual([1, 2, 3])
    const title = doc.allElements(2).find((item) => item.text === '继承标题')!
    const explicit = doc.allElements(1).find((item) => item.text === '组合标题')!.appearance.paragraphs[0].runs[0]
    expect(() => apply(doc, 'design', [{ kind: 'style', partId: master.partId, expectedSlides: [1], patch: { color: '#059669' } }])).toThrow('expectedSlides')
    apply(doc, 'design', [{ kind: 'style', partId: master.partId, expectedSlides: [1, 2, 3], patch: { backgroundColor: '#E0F2FE', fontFamily: 'Arial', fontSize: 36, color: '#059669' } }])
    const readMaster = (doc.read({ target: 'design' }) as any).parts.find((item: any) => item.partId === master.partId)
    expect(readMaster.background).toBe('#e0f2fe'); expect(readMaster.defaultTextStyles.titleStyle[0]).toMatchObject({ level: 1, fontSize: 36, color: '#059669', fontFamily: 'Arial' })
    expect(doc.allElements(2).find((item) => item.id === title.id)!.appearance.paragraphs[0]).toMatchObject({ fontSize: 36, color: '#059669', fontFamily: 'Arial' })
    expect(doc.allElements(1).find((item) => item.text === '组合标题')!.appearance.paragraphs[0].runs[0]).toMatchObject({ fontSize: explicit.fontSize, color: explicit.color, bold: explicit.bold })
    expect(unzipSync(doc.serialize())['ppt/slides/slide1.xml']).toEqual(files['ppt/slides/slide1.xml'])
    // Layout's explicit background remains higher priority; modifying it changes these pages.
    const layout = design.parts.find((item: any) => item.kind === 'layout' && item.affectedSlides.length)
    apply(doc, 'design', [{ kind: 'style', partId: layout.partId, expectedSlides: layout.affectedSlides, patch: { backgroundColor: '#FEF3C7' } }])
    expect(doc.background(1)).toBe('#fef3c7')
    const reopened = new PresentationDocument('/again.pptx', doc.serialize()); expect(reopened.background(1)).toBe('#fef3c7')
    expect(unzipSync(doc.serialize())['ppt/custom/keep.xml']).toEqual(files['ppt/custom/keep.xml'])
  })
  it('母版段落文字修改/默认样式、应用现有版式保留正文及撤销', async () => {
    const { doc } = await make(); const inventory = doc.read({ target: 'design' }) as any
    const layout = inventory.parts.find((item: any) => item.kind === 'layout' && item.elements.some((element: any) => element.paragraphs.length))
    const element = layout.elements.find((element: any) => element.paragraphs.length)
    const old = element.paragraphs[0]
    apply(doc, 'design', [{ kind: 'style', partId: layout.partId, expectedSlides: layout.affectedSlides, elementId: element.id, paragraphId: old.id, expectedText: old.text, patch: { text: '新母版标识', color: '#DC2626' } }])
    expect((doc.read({ target: 'design' }) as any).parts.find((item: any) => item.partId === layout.partId).elements.find((item: any) => item.id === element.id).paragraphs[0].runs[0]).toMatchObject({ text: '新母版标识', color: '#dc2626' })
    expect(doc.allElements(1).some((element) => element.sourcePart === layout.partId && element.text === '新母版标识')).toBe(true)
    const before = doc.allElements(3).filter((element) => !element.sourcePart).map((element) => element.text)
    const another = inventory.parts.find((item: any) => item.kind === 'layout' && item.partId !== layout.partId)
    apply(doc, 'design', [{ kind: 'apply-layout', slide: 3, layoutId: another.partId, expectedLayoutId: layout.partId }])
    expect(doc.allElements(3).filter((element) => !element.sourcePart).map((element) => element.text)).toEqual(before)
    expect((doc.read({ target: 'design' }) as any).slides[2].layoutId).toBe(another.partId)
    doc.undo(); expect((doc.read({ target: 'design' }) as any).slides[2].layoutId).toBe(layout.partId)
  })
  it('动画出现/淡入时间线、三个触发方式、转场、保存重开和引用删除保护', async () => {
    const { doc } = await make(); const shapes = doc.allElements(1).filter((item) => !item.children && !item.sourcePart)
    const effects = shapes.map((shape, i) => ({ elementId: shape.id, effect: i ? 'fade' : 'appear', trigger: i === 0 ? 'onClick' : i === 1 ? 'withPrevious' : 'afterPrevious', delayMs: i === 0 ? 10 : 20, durationMs: 300 }))
    apply(doc, 'animation', [{ slide: 1, expectedEffectIds: [], effects, transition: { effect: 'push', direction: 'left', durationMs: 400, advanceOnClick: true, advanceAfterMs: 2000 } }])
    const animation = doc.animation(1); expect(animation.editable, animation.unsupported.join(',')).toBe(true)
    expect(animation.effects.map(({ id: _id, ...effect }) => effect)).toEqual(effects)
    expect(animationGroups(animation.effects)[0].effects.map((effect) => effect.startMs)).toEqual([10, 30, 350])
    expect(new PresentationDocument('/again.pptx', doc.serialize()).animation(1)).toEqual(animation)
    expect(() => doc.edit({ revision: doc.revision, slide: 1, operation: 'delete', elementIds: [shapes[0].id], expectedCount: 1 })).toThrow('动画')
    apply(doc, 'animation', [{ slide: 1, expectedEffectIds: animation.effects.map((item) => item.id), effects: [] }])
    expect(doc.animation(1).effects).toEqual([]); expect(doc.animation(1).transition.effect).toBe('push')
    doc.undo(); expect(doc.animation(1)).toEqual(animation)
  })
  it('错误动画目标、重复元素、ID过期、时长、复杂路径时间线及批量后半错误原子拒绝', async () => {
    const { doc, files } = await make(); const childId = doc.allElements(1).find((item) => item.text === '组合标题')!.id
    const effect = { elementId: childId, effect: 'fade', trigger: 'onClick', durationMs: 300, delayMs: 0 }
    const base = { slide: 1, expectedEffectIds: [], effects: [effect] }; const before = doc.serialize()
    for (const bad of [{ ...base, expectedEffectIds: ['stale'] }, { ...base, effects: [effect, effect] }, { ...base, effects: [{ ...effect, elementId: 'missing' }] }, { ...base, effects: [{ ...effect, durationMs: -1 }] }, { ...base, effects: [effect, { ...effect, elementId: '100' }] }]) expect(() => apply(doc, 'animation', [{ slide: 2, transition: { effect: 'fade', durationMs: 100, advanceOnClick: true } }, bad])).toThrow()
    expect(doc.serialize()).toEqual(before); expect(doc.revision).toBe(0)
    files['ppt/slides/slide1.xml'] = strToU8(strFromU8(files['ppt/slides/slide1.xml']).replace('</p:sld>', '<p:timing><p:tnLst><p:par><p:cTn id="1"><p:childTnLst><p:animMotion path="M 0 0 L 1 1"/></p:childTnLst></p:cTn></p:par></p:tnLst></p:timing></p:sld>'))
    const complex = new PresentationDocument('/complex.pptx', zipSync(files)); expect(complex.animation(1).editable).toBe(false)
    expect(() => apply(complex, 'animation', [base])).toThrow('复杂动画')
    apply(complex, 'animation', [{ slide: 1, transition: { effect: 'fade', durationMs: 200, advanceOnClick: true } }])
    expect(strFromU8(unzipSync(complex.serialize())['ppt/slides/slide1.xml'])).toContain('animMotion')
  })
  it('重复时间节点、循环及交互触发不伪装成基础动画，不允许覆盖原时间线', async () => {
    const { doc } = await make(); const elementId = doc.allElements(1).find((item) => item.text === '组合标题')!.id
    apply(doc, 'animation', [{ slide: 1, expectedEffectIds: [], effects: [{ elementId, effect: 'fade', trigger: 'onClick', durationMs: 300, delayMs: 0 }] }])
    const files = unzipSync(doc.serialize()); const source = strFromU8(files['ppt/slides/slide1.xml'])
    for (const xml of [source.replace('id="4" presetID', 'id="1" presetID'), source.replace('id="4" presetID', 'id="4" repeatCount="2000" presetID'), source.replace('<p:cond delay="0"/>', '<p:cond delay="0" evt="onClick"/>')]) {
      const complex = new PresentationDocument('/complex.pptx', zipSync({ ...files, 'ppt/slides/slide1.xml': strToU8(xml) })); const before = complex.serialize()
      expect(complex.animation(1).editable).toBe(false)
      expect(() => apply(complex, 'animation', [{ slide: 1, expectedEffectIds: complex.animation(1).effects.map((item) => item.id), effects: [] }])).toThrow('复杂动画')
      expect(complex.serialize()).toEqual(before)
    }
  })
})
