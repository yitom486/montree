import type { SlideChart } from '@yitom/contracts'
import * as XLSX from 'xlsx'
import { SpreadsheetDocument } from './spreadsheet-document'
import { A, C, R, child, children, descendants, parsePart, relation, encodeXml, object, color, string, number, insertOrdered, type PresentationFiles } from './presentation-xml'

const palette = ['#2563eb', '#ea580c', '#16a34a', '#9333ea', '#dc2626', '#0891b2']
const dataText = (node?: Element): string => node?.textContent ?? ''
const cache = (node?: Element): Element | undefined => node && (descendants(node, C, 'strCache')[0] ?? descendants(node, C, 'numCache')[0] ?? descendants(node, C, 'multiLvlStrCache')[0] ?? child(node, C, 'strLit') ?? child(node, C, 'numLit'))
function points(node?: Element): string[] {
  const values = cache(node)
  if (!values) return []
  const count = Number(child(values, C, 'ptCount')?.getAttribute('val'))
  if (!Number.isInteger(count) || count < 0 || count > 5000) return []
  const result = Array.from({ length: count }, () => '')
  const source = values.localName === 'multiLvlStrCache' ? child(values, C, 'lvl') : values
  if (!source) return []
  const entries = children(source, C, 'pt'); const seen = new Set<number>()
  if (entries.length !== count) return []
  for (const point of entries) {
    const index = Number(point.getAttribute('idx'))
    if (!point.hasAttribute('idx') || !Number.isInteger(index) || index < 0 || index >= count || seen.has(index) || !child(point, C, 'v')) return []
    seen.add(index); result[index] = dataText(child(point, C, 'v'))
  }
  return result
}
function chartNodes(doc: Document) {
  const area = descendants(doc, C, 'plotArea')[0]
  const types = area && Array.from(area.children).filter((node) => node.localName.endsWith('Chart'))
  const chart = types?.length === 1 ? types[0] : undefined
  return { chart, series: chart ? children(chart, C, 'ser') : [] }
}
export function readChart(files: PresentationFiles, slidePath: string, shape: Element): SlideChart | undefined {
  const rid = descendants(shape, C, 'chart')[0]?.getAttributeNS(R, 'id')
  if (!rid) return
  const path = relation(files, slidePath, rid, true)
  if (!path || !files[path]) return { partId: '', type: 'bar', direction: 'column', title: '', categories: [], series: [], legendVisible: false, editable: false, unsupported: ['外部链接或缺失的图表部件'] }
  const doc = parsePart(files, path); const { chart, series } = chartNodes(doc)
  const unsupported: string[] = []
  const type = ({ barChart: 'bar', lineChart: 'line', pieChart: 'pie' } as const)[chart?.localName as 'barChart' | 'lineChart' | 'pieChart']
  if (!type) unsupported.push('仅支持单一二维柱状/条形、折线、饼图')
  if (chart && child(chart, C, 'grouping') && !['clustered', 'standard'].includes(child(chart, C, 'grouping')!.getAttribute('val') ?? '')) unsupported.push('堆叠图表暂不支持')
  if (descendants(doc, C, 'multiLvlStrCache').some((node) => children(node, C, 'lvl').length !== 1) || descendants(doc, C, 'pivotSource').length || descendants(doc, C, 'errBars').length || descendants(doc, C, 'trendline').length) unsupported.push('多层分类、透视、误差线或趋势线暂不支持')
  const categories = points(series[0] && child(series[0], C, 'cat'))
  const data = series.map((node, index) => {
    const names = points(child(node, C, 'tx')); const val = points(child(node, C, 'val'))
    const rawColor = child(child(child(node, C, 'spPr'), A, 'solidFill'), A, 'srgbClr')?.getAttribute('val')
    if (!val.length || val.length !== categories.length || val.some((value) => value.trim() === '' || !Number.isFinite(Number(value)))) unsupported.push(`系列 ${index} 缺少有效缓存或数量不匹配`)
    if (points(child(node, C, 'cat')).join('\0') !== categories.join('\0')) unsupported.push('各系列分类不一致')
    return { id: `s${child(node, C, 'idx')?.getAttribute('val') ?? index}`, name: names[0] ?? dataText(child(child(node, C, 'tx'), C, 'v')), values: val.map(Number), color: rawColor && /^[a-f\d]{6}$/i.test(rawColor) ? `#${rawColor.toLowerCase()}` : palette[index % palette.length] }
  })
  if (new Set(data.map((item) => item.id)).size !== data.length || !data.length || categories.length > 500 || data.length > 20) unsupported.push('系列 ID 不唯一、为空或数据量超限（500分类/20系列）')
  if (type === 'pie' && (data.length !== 1 || data[0].values.some((value) => value < 0))) unsupported.push('饼图仅支持单系列非负数值')
  const external = descendants(doc, C, 'externalData')[0]
  const embeddedPath = external && relation(files, path, external.getAttributeNS(R, 'id') ?? '', true)
  if (external && !embeddedPath) unsupported.push('外部链接的数据源暂不支持编辑')
  if (embeddedPath && Object.keys(files).some((other) => {
    if (other === path || !/^ppt\/charts\/[^/]+\.xml$/.test(other)) return false
    const data = descendants(parsePart(files, other), C, 'externalData')[0]
    return data && relation(files, other, data.getAttributeNS(R, 'id') ?? '', true) === embeddedPath
  })) unsupported.push('多个图表共享内嵌工作簿，暂不支持编辑以避免缓存不一致')
  const title = descendants(doc, C, 'title')[0]
  return { partId: path, type: type ?? 'bar', direction: child(chart, C, 'barDir')?.getAttribute('val') === 'bar' ? 'bar' : 'column',
    title: title ? descendants(title, A, 't').map((node) => node.textContent).join('') || points(child(title, C, 'tx'))[0] || '' : '',
    categories, series: data, legendVisible: Boolean(descendants(doc, C, 'legend')[0]), editable: !unsupported.length, unsupported: [...new Set(unsupported)] }
}
function setCache(parent: Element, values: Array<string | number>): void {
  const node = cache(parent)
  if (!node) throw new Error('图表缓存缺失')
  const source = node.localName === 'multiLvlStrCache' ? child(node, C, 'lvl') : node
  if (!source) throw new Error('分类缓存结构缺失')
  children(source, C, 'pt').forEach((point) => point.remove())
  const count = child(node, C, 'ptCount')
  if (!count) throw new Error('图表缓存计数缺失')
  count.setAttribute('val', String(values.length))
  for (const [index, value] of values.entries()) { const point = node.ownerDocument.createElementNS(C, 'c:pt'); point.setAttribute('idx', String(index)); const v = node.ownerDocument.createElementNS(C, 'c:v'); v.textContent = String(value); point.append(v); source.insertBefore(point, child(source, C, 'extLst') ?? null) }
}
/** Return a detached multi-part transaction; nothing is committed on validation failure. */
export function editChart(files: PresentationFiles, slidePath: string, shape: Element, input: unknown): PresentationFiles {
  const before = readChart(files, slidePath, shape)
  if (!before?.editable) throw new Error(`图表不支持编辑：${before?.unsupported.join('；') ?? '不是图表'}`)
  const patch = object(input, ['title', 'categories', 'series', 'legendVisible'])
  if (!Object.keys(patch).length) throw new Error('图表 patch 不能为空')
  const doc = parsePart(files, before.partId); const { series } = chartNodes(doc)
  const embeddedId = descendants(doc, C, 'externalData')[0]?.getAttributeNS(R, 'id')
  const embeddedPath = embeddedId && relation(files, before.partId, embeddedId, true)
  const workbook = embeddedPath ? new SpreadsheetDocument(embeddedPath, files[embeddedPath]) : undefined
  const cells = new Map<string, string | number>()
  const writeData = (node: Element, values: Array<string | number>): void => {
    const formula = descendants(node, C, 'f')[0]?.textContent
    if (formula) {
      if (!workbook) throw new Error('图表引用了数据公式但没有可编辑内嵌表格')
      const match = /^(?:'((?:[^']|'')+)'|([^'!]+))!\$?([A-Z]+)\$?(\d+)(?::\$?([A-Z]+)\$?(\d+))?$/.exec(formula)
      if (!match) throw new Error('图表数据公式仅支持内嵌表格的连续行或列')
      const sheet = (match[1]?.replace(/''/g, "'") ?? match[2]); const range = `${match[3]}${match[4]}:${match[5] ?? match[3]}${match[6] ?? match[4]}`
      const bounds = XLSX.utils.decode_range(range)
      const count = (bounds.e.r - bounds.s.r + 1) * (bounds.e.c - bounds.s.c + 1)
      if (!workbook.workbook.SheetNames.includes(sheet) || bounds.s.r !== bounds.e.r && bounds.s.c !== bounds.e.c || count !== values.length) throw new Error('图表数据与内嵌表格范围数量不匹配')
      values.forEach((value, i) => { const address = XLSX.utils.encode_cell({ r: bounds.s.r + (bounds.s.r === bounds.e.r ? 0 : i), c: bounds.s.c + (bounds.s.c === bounds.e.c ? 0 : i) }); const key = `${sheet}\0${address}`
        if (cells.has(key) && cells.get(key) !== value) throw new Error('图表共享数据区域修改冲突')
        cells.set(key, value)
      })
    }
    setCache(node, values)
  }
  if (patch.categories !== undefined) {
    if (!Array.isArray(patch.categories) || patch.categories.length !== before.categories.length) throw new Error('categories 数量必须与读取结果一致')
    const values = patch.categories.map((value) => string(value, 1000))
    series.forEach((node) => writeData(child(node, C, 'cat')!, values))
  }
  if (patch.series !== undefined) {
    if (!Array.isArray(patch.series) || !patch.series.length || patch.series.length > before.series.length) throw new Error('series 需要现有系列')
    const seen = new Set<string>()
    for (const value of patch.series) {
      const edit = object(value, ['id', 'name', 'values', 'color'], ['id'])
      const id = String(edit.id); const index = before.series.findIndex((item) => item.id === id)
      if (index < 0 || seen.has(id) || Object.keys(edit).length === 1) throw new Error('系列未唯一匹配或修改为空')
      seen.add(id); const node = series[index]
      if (edit.values !== undefined) {
        if (!Array.isArray(edit.values) || edit.values.length !== before.categories.length) throw new Error('values 数量必须与分类数量一致')
        const values = edit.values.map((value) => number(value, before.type === 'pie' ? 0 : -1e12, 1e12))
        writeData(child(node, C, 'val')!, values)
      }
      if (edit.name !== undefined) {
        const name = string(edit.name, 1000); const tx = child(node, C, 'tx')
        if (!tx) throw new Error('系列名称结构缺失')
        if (cache(tx)) writeData(tx, [name])
        else { const v = child(tx, C, 'v'); if (!v) throw new Error('系列名称结构不支持'); v.textContent = name }
      }
      if (edit.color !== undefined) {
        const hex = color(edit.color); let props = child(node, C, 'spPr')
        if (!props) { props = doc.createElementNS(C, 'c:spPr'); insertOrdered(node, props, ['idx', 'order', 'tx', 'spPr', 'invertIfNegative', 'pictureOptions', 'marker', 'dPt', 'dLbls', 'trendline', 'errBars', 'cat', 'val', 'smooth', 'extLst']) }
        children(props, A, 'solidFill').concat(children(props, A, 'gradFill'), children(props, A, 'noFill')).forEach((item) => item.remove())
        const fill = doc.createElementNS(A, 'a:solidFill'); const rgb = doc.createElementNS(A, 'a:srgbClr'); rgb.setAttribute('val', hex.slice(1)); fill.append(rgb); props.prepend(fill)
        if (before.type === 'line') { let line = child(props, A, 'ln'); if (!line) { line = doc.createElementNS(A, 'a:ln'); props.append(line) }; children(line, A, 'solidFill').forEach((item) => item.remove()); line.prepend(fill.cloneNode(true)) }
      }
    }
  }
  const chart = descendants(doc, C, 'chart')[0]
  if (patch.title !== undefined) {
    const titleText = string(patch.title, 1000); const old = child(chart, C, 'title')
    // Linked titles require a separate data source edit; do not silently sever links.
    if (old && descendants(old, C, 'strRef').length) throw new Error('引用数据的图表标题暂不支持修改')
    const title = old ?? doc.createElementNS(C, 'c:title')
    const textNodes = descendants(title, A, 't')
    if (textNodes.length) { textNodes[0].textContent = titleText; textNodes.slice(1).forEach((node) => { node.textContent = '' }) }
    else {
      const tx = doc.createElementNS(C, 'c:tx'); const rich = doc.createElementNS(C, 'c:rich'); rich.append(doc.createElementNS(A, 'a:bodyPr'), doc.createElementNS(A, 'a:lstStyle'))
      const p = doc.createElementNS(A, 'a:p'); const r = doc.createElementNS(A, 'a:r'); const t = doc.createElementNS(A, 'a:t'); t.textContent = titleText; r.append(t); p.append(r); rich.append(p); tx.append(rich); title.prepend(tx)
    }
    if (!old) chart.prepend(title)
    child(chart, C, 'autoTitleDeleted')?.setAttribute('val', '0')
  }
  if (patch.legendVisible !== undefined) {
    if (typeof patch.legendVisible !== 'boolean') throw new Error('legendVisible 必须为布尔值')
    const old = child(chart, C, 'legend')
    if (!patch.legendVisible) old?.remove()
    else if (!old) { const legend = doc.createElementNS(C, 'c:legend'); const position = doc.createElementNS(C, 'c:legendPos'); position.setAttribute('val', 'r'); legend.append(position); insertOrdered(chart, legend, ['title', 'autoTitleDeleted', 'pivotFmts', 'view3D', 'floor', 'sideWall', 'backWall', 'plotArea', 'legend', 'plotVisOnly', 'dispBlanksAs', 'showDLblsOverMax', 'extLst']) }
  }
  if (workbook) for (const [key, value] of cells) { const [sheet, address] = key.split('\0'); workbook.edit({ revision: workbook.revision, sheet, target: { range: address }, operation: 'set', values: [[value]], expectedCount: 1 }) }
  return { [before.partId]: encodeXml(doc), ...(embeddedPath && workbook && cells.size ? { [embeddedPath]: workbook.serializeBinary() } : {}) }
}
