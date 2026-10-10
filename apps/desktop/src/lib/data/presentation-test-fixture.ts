import PptxGenJS from 'pptxgenjs'
import { unzipSync, zipSync, strFromU8, strToU8 } from 'fflate'

/** Test-only PPTX parts and embedded chart workbooks, with nested groups/placeholder inheritance. */
export async function advancedPptFixture() {
  const ppt = new PptxGenJS(); ppt.layout = 'LAYOUT_WIDE'
  ppt.defineSlideMaster({ title: 'COMMON', background: { color: 'F8FAFC' }, objects: [{ text: { text: 'Montree 母版标识', options: { x: 0.4, y: 0.15, w: 4, h: 0.3, fontSize: 12, color: '64748B' } } }] })
  const data = [{ name: '收入', labels: ['一季度', '二季度'], values: [10, 20] }, { name: '支出', labels: ['一季度', '二季度'], values: [6, 12] }]
  const first = ppt.addSlide('COMMON')
  first.addText('组合标题', { x: 0.5, y: 0.5, w: 4, h: 0.7, fontSize: 30, bold: true, color: '1E293B' })
  first.addText('组合说明', { x: 0.5, y: 1.5, w: 4, h: 0.7, fontSize: 20, color: '64748B' })
  first.addChart(ppt.ChartType.bar, data, { x: 6, y: 1, w: 6, h: 4.5, title: '季度报表', showTitle: true, showLegend: true, catAxisLabelFontSize: 12 })
  const second = ppt.addSlide('COMMON')
  second.addText('继承标题', { x: 0.7, y: 0.7, w: 8, h: 1, fontSize: 30 })
  second.addChart(ppt.ChartType.line, data, { x: 1, y: 2, w: 8, h: 4, showLegend: true })
  const third = ppt.addSlide('COMMON')
  third.addText('第三页', { x: 0.7, y: 0.7, w: 8, h: 1, fontSize: 30 })
  third.addChart(ppt.ChartType.pie, [data[0]], { x: 1, y: 2, w: 8, h: 4, showLegend: true })
  const files = unzipSync(new Uint8Array(await ppt.write({ outputType: 'arraybuffer' }) as ArrayBuffer))
  const firstXml = strFromU8(files['ppt/slides/slide1.xml'])
  const shapes = [...firstXml.matchAll(/<p:sp>.*?<\/p:sp>/gs)].slice(0, 2).map((match) => match[0])
  const group = (id: number, name: string, nested: string, outer: boolean) => `<p:grpSp><p:nvGrpSpPr><p:cNvPr id="${id}" name="${name}"/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="${outer ? 635000 : 0}" y="${outer ? 1270000 : 0}"/><a:ext cx="${outer ? 5080000 : 10160000}" cy="${outer ? 2540000 : 5080000}"/><a:chOff x="0" y="0"/><a:chExt cx="10160000" cy="5080000"/></a:xfrm></p:grpSpPr>${nested}</p:grpSp>`
  files['ppt/slides/slide1.xml'] = strToU8(firstXml.replace(shapes.join(''), group(100, '外层组合', group(101, '内层组合', shapes.join(''), false), true)))
  files['ppt/slides/slide2.xml'] = strToU8(strFromU8(files['ppt/slides/slide2.xml']).replace(/<p:sp>.*?<\/p:sp>/s, (shape) => shape.replace('<p:nvPr/>', '<p:nvPr><p:ph type="title" idx="0"/></p:nvPr>').replace(/<p:txBody>.*?<\/p:txBody>/s, '<p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:t>继承标题</a:t></a:r></a:p></p:txBody>')))
  files['ppt/custom/keep.xml'] = strToU8('<keep value="unchanged"/>')
  return { original: zipSync(files), files }
}
