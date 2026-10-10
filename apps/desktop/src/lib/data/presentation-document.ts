import { unzipSync, zipSync, strFromU8, strToU8 } from 'fflate'
import type { SlideSelection } from '@montree/contracts'
import { presentationAppearance, presentationPreviewContext, type PresentationAppearance } from './presentation-preview'
import { editPresentationText } from './presentation-text-edit'

const P = 'http://schemas.openxmlformats.org/presentationml/2006/main'
const A = 'http://schemas.openxmlformats.org/drawingml/2006/main'
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'
const EMU_PER_POINT = 12700
function xml(bytes: Uint8Array): Document {
  const doc = new DOMParser().parseFromString(strFromU8(bytes), 'application/xml')
  if (doc.querySelector('parsererror')) throw new Error('PPT XML 无法解析')
  return doc
}
const nodes = (parent: Document | Element, ns: string, name: string): Element[] => Array.from(parent.getElementsByTagNameNS(ns, name))
const partPath = (base: string, target: string): string => new URL(target, `https://ppt.invalid/${base}`).pathname.slice(1)

export interface PresentationElement {
  id: string
  name: string
  type: string
  text: string
  x: number
  y: number
  width: number
  height: number
  fontSize?: number
  color?: string
  image?: string
  appearance: PresentationAppearance
  capabilities: string[]
}

export class PresentationDocument {
  private files: Record<string, Uint8Array>
  private history: Record<string, Uint8Array>[] = []
  private savedBytes: Uint8Array
  revision = 0
  activeSlide = 1
  navigationSlide = 1
  visibleSlides = [1]
  selection: SlideSelection | null = null
  private selectionSerial = 0
  private previewCache = new Map<number, { background: string; elements: PresentationElement[] }>()
  readonly slidePaths: string[]
  readonly width: number
  readonly height: number
  constructor(readonly filePath: string, bytes: Uint8Array) {
    this.files = unzipSync(bytes)
    this.savedBytes = this.serialize()
    const presentation = xml(this.files['ppt/presentation.xml'])
    const relationships = xml(this.files['ppt/_rels/presentation.xml.rels'])
    const size = nodes(presentation, P, 'sldSz')[0]
    this.width = Number(size?.getAttribute('cx') ?? 12192000) / EMU_PER_POINT
    this.height = Number(size?.getAttribute('cy') ?? 6858000) / EMU_PER_POINT
    this.slidePaths = nodes(presentation, P, 'sldId').map((slide) => {
      const rel = Array.from(relationships.getElementsByTagName('Relationship')).find((item) => item.getAttribute('Id') === slide.getAttributeNS(R, 'id'))
      const target = rel?.getAttribute('Target')
      if (!target) throw new Error('幻灯片关系缺失')
      return partPath('ppt/presentation.xml', target)
    })
    if (!this.slidePaths.length) throw new Error('PPT 没有幻灯片')
  }
  get dirty(): boolean {
    const current = this.serialize()
    return current.length !== this.savedBytes.length || current.some((value, i) => value !== this.savedBytes[i])
  }
  markSaved(bytes: Uint8Array): void { this.savedBytes = bytes.slice() }
  serialize(): Uint8Array { return zipSync(this.files, { level: 0, mtime: new Date('2000-01-01T00:00:00Z') }) }
  private slide(number: number): Document {
    if (!Number.isInteger(number) || number < 1 || number > this.slidePaths.length) throw new Error('幻灯片页码越界（从 1 开始）')
    return xml(this.files[this.slidePaths[number - 1]])
  }
  private shapeElements(doc: Document): Element[] {
    const tree = nodes(doc, P, 'spTree')[0]
    if (!tree) throw new Error('幻灯片缺少元素树')
    return Array.from(tree.children).filter((item) => ['sp', 'pic', 'graphicFrame', 'cxnSp', 'grpSp'].includes(item.localName))
  }
  private id(element: Element): string {
    return nodes(element, P, 'cNvPr')[0]?.getAttribute('id') ?? ''
  }
  elements(number: number): PresentationElement[] {
    const cached = this.previewCache.get(number)
    if (cached) return cached.elements
    const doc = this.slide(number)
    const context = presentationPreviewContext(this.files, this.slidePaths[number - 1], doc)
    const relPath = this.slidePaths[number - 1].replace(/([^/]+)$/, '_rels/$1.rels')
    const rels = this.files[relPath] ? xml(this.files[relPath]) : null
    const elements = this.shapeElements(doc).map((element) => {
      const transform = nodes(element, A, 'xfrm')[0] ?? nodes(element, P, 'xfrm')[0]
      const off = transform ? nodes(transform, A, 'off')[0] : undefined
      const ext = transform ? nodes(transform, A, 'ext')[0] : undefined
      const appearance = presentationAppearance(element, context)
      const text = element.localName === 'sp' ? appearance.paragraphs.map((paragraph) => paragraph.runs.map((run) => run.text).join('')).join('\n') : nodes(element, A, 'p').map((p) => nodes(p, A, 't').map((t) => t.textContent ?? '').join('')).join('\n')
      const firstRun = appearance.paragraphs[0]?.runs[0]
      const identity = nodes(element, P, 'cNvPr')[0]
      let image: string | undefined
      if (element.localName === 'pic') {
        const rid = nodes(element, A, 'blip')[0]?.getAttributeNS(R, 'embed')
        const rel = rels && Array.from(rels.getElementsByTagName('Relationship')).find((item) => item.getAttribute('Id') === rid)
        const target = rel?.getAttribute('Target')
        if (target && rel?.getAttribute('TargetMode') !== 'External') {
          const path = partPath(this.slidePaths[number - 1], target)
          const data = this.files[path]
          if (data && /\.(png|jpe?g|gif|svg|webp)$/i.test(path)) {
            const mime = /\.svg$/i.test(path) ? 'image/svg+xml' : /\.jpe?g$/i.test(path) ? 'image/jpeg' : /\.gif$/i.test(path) ? 'image/gif' : /\.webp$/i.test(path) ? 'image/webp' : 'image/png'
            let raw = ''; for (const byte of data) raw += String.fromCharCode(byte)
            image = `data:${mime};base64,${btoa(raw)}`
          }
        }
      }
      return { id: this.id(element), name: identity?.getAttribute('name') ?? '', type: element.localName, text,
        x: Number(off?.getAttribute('x') ?? 0) / EMU_PER_POINT, y: Number(off?.getAttribute('y') ?? 0) / EMU_PER_POINT,
        width: Number(ext?.getAttribute('cx') ?? 0) / EMU_PER_POINT, height: Number(ext?.getAttribute('cy') ?? 0) / EMU_PER_POINT,
        ...(firstRun?.fontSize ? { fontSize: firstRun.fontSize } : {}), ...(firstRun?.color ? { color: firstRun.color } : {}), appearance,
        ...(image ? { image } : {}), capabilities: element.localName === 'sp' ? ['text', 'position', 'font', 'delete'] : element.localName === 'pic' ? ['position', 'delete'] : ['delete'] }
    })
    this.previewCache.set(number, { background: context.background, elements })
    return elements
  }
  background(number: number): string { this.elements(number); return this.previewCache.get(number)!.background }
  select(slide: number, elementIds: string[], focus?: { paragraphId?: string; runId?: string }): SlideSelection {
    const elements = this.elements(slide)
    if (!elementIds.length || elementIds.some((id) => !elements.some((element) => element.id === id))) throw new Error('选中元素不存在')
    if (focus?.paragraphId) {
      if (elementIds.length !== 1) throw new Error('段落选区只能属于一个元素')
      const paragraph = elements.find((item) => item.id === elementIds[0])?.appearance.paragraphs.find((item) => item.id === focus.paragraphId)
      if (!paragraph || focus.runId && !paragraph.runs.some((run) => run.id === focus.runId)) throw new Error('段落或文字片段不存在')
    }
    this.selection = { kind: 'slide', documentPath: this.filePath, slide, elementIds, revision: this.revision, selectionId: `${this.filePath}:${++this.selectionSerial}:${this.revision}`, ...focus }
    return this.selection
  }
  context() { return { visibleSlide: this.activeSlide, visibleSlides: this.visibleSlides, navigationSlide: this.navigationSlide, selectionSlide: this.selection?.slide ?? null } }
  read(args: Record<string, unknown>) {
    if (args.slide === undefined) return { documentPath: this.filePath, revision: this.revision, slideCount: this.slidePaths.length,
      width: this.width, height: this.height, units: 'points', dirty: this.dirty, selection: this.selection, context: this.context(), textOffsets: 'UTF-16; start inclusive, end exclusive; relative to paragraph or selected run; IDs valid only at this revision',
      slides: this.slidePaths.map((_, i) => ({ slide: i + 1, title: this.elements(i + 1).find((element) => element.text)?.text.split('\n')[0] ?? `幻灯片 ${i + 1}` })),
      capabilities: ['read', 'edit-text', 'edit-paragraph', 'edit-run', 'edit-text-range', 'edit-position', 'edit-font', 'delete', 'undo', 'save'], unsupported: ['theme', 'master', 'animation', 'group-child-edit', 'chart-edit'] }
    const slide = Number(args.slide)
    const elements = this.elements(slide).map(({ image: _image, ...element }) => element)
    return { documentPath: this.filePath, revision: this.revision, slide, units: 'points', elements, context: this.context(), selection: this.selection, textOffsets: 'UTF-16; start inclusive, end exclusive; relative to paragraph or selected run; IDs valid only at this revision' }
  }
  edit(args: Record<string, unknown>) {
    if (args.revision !== this.revision) throw new Error('文档版本已变化，请重新读取')
    if (args.operation === 'text') {
      if (Object.keys(args).some((key) => !['documentPath', 'revision', 'slide', 'operation', 'edits', 'expectedCount', 'selectionId'].includes(key))) throw new Error('精细文字编辑包含不支持的参数')
      if (!Number.isInteger(args.slide)) throw new Error('slide 必须为整数')
      const slide = Number(args.slide); const doc = this.slide(slide)
      if (args.selectionId !== undefined) {
        if (this.selection?.selectionId !== args.selectionId || this.selection.slide !== slide || this.selection.revision !== this.revision) throw new Error('选区已过期，请重新读取')
        if (!Array.isArray(args.edits) || args.edits.some((edit) => !edit || !this.selection!.elementIds.includes(edit.elementId))) throw new Error('文字目标不属于当前选区')
      }
      const ids = editPresentationText(doc, this.shapeElements(doc), args.edits, args.expectedCount)
      return this.commit(doc, slide, ids, Number(args.expectedCount))
    }
    if (!['update', 'delete'].includes(String(args.operation))) throw new Error('operation 只能为 update、text 或 delete')
    let ids = args.elementIds
    const slide = Number(args.slide)
    if (args.selectionId !== undefined) {
      if (ids !== undefined || this.selection?.selectionId !== args.selectionId || this.selection.slide !== slide || this.selection.revision !== this.revision) throw new Error('选区已过期或目标参数冲突')
      ids = this.selection.elementIds
    }
    if (!Array.isArray(ids) || !ids.length || ids.length > 100 || ids.some((id) => typeof id !== 'string') || new Set(ids).size !== ids.length || args.expectedCount !== ids.length) throw new Error('elementIds 需要唯一元素 ID，数量必须与 expectedCount 一致（最多100）')
    const doc = this.slide(slide)
    const all = this.shapeElements(doc)
    const selected = ids.map((id) => {
      const matches = all.filter((element) => this.id(element) === id)
      if (matches.length !== 1) throw new Error(`元素 ${id} 未唯一匹配，请重新查询`)
      return matches[0]
    })
    const patch = args.patch as Record<string, unknown> | undefined
    if (args.operation === 'update') {
      if (!patch || !Object.keys(patch).length || Object.keys(patch).some((key) => !['text', 'x', 'y', 'width', 'height', 'fontSize', 'color'].includes(key))) throw new Error('patch 包含不支持的属性')
      if (patch.text !== undefined && (typeof patch.text !== 'string' || patch.text.length > 50000)) throw new Error('text 必须为不超过50000字的文本')
      if (patch.color !== undefined && (typeof patch.color !== 'string' || !/^#[a-f0-9]{6}$/i.test(patch.color))) throw new Error('color 必须为 #RRGGBB')
      for (const key of ['x', 'y', 'width', 'height', 'fontSize']) if (patch[key] !== undefined && (typeof patch[key] !== 'number' || !Number.isFinite(patch[key]) || Math.abs(patch[key] as number) > 10000 || (['width', 'height', 'fontSize'].includes(key) && (patch[key] as number) <= 0))) throw new Error(`${key} 无效，位置和尺寸单位为磅`)
      for (const element of selected) {
        if (!['sp', 'pic'].includes(element.localName)) throw new Error('该元素仅支持查询与删除')
        if ((patch.text !== undefined || patch.fontSize !== undefined || patch.color !== undefined) && element.localName !== 'sp') throw new Error('图片不支持文字或字体编辑')
        if (patch.text !== undefined) {
          const body = nodes(element, P, 'txBody')[0]
          if (!body) throw new Error('该形状没有可编辑文本体')
          if (nodes(body, A, 'p').length > 1) throw new Error('多段落文本框请使用 montree_ppt_edit_text，避免覆盖其他段落样式')
          const oldPara = nodes(body, A, 'p')[0]
          const oldProps = oldPara && nodes(oldPara, A, 'rPr')[0]
          const paraProps = oldPara && nodes(oldPara, A, 'pPr')[0]
          nodes(body, A, 'p').forEach((node) => node.remove())
          for (const line of (patch.text as string).split('\n')) {
            const p = doc.createElementNS(A, 'a:p'); if (paraProps) p.append(paraProps.cloneNode(true))
            const r = doc.createElementNS(A, 'a:r'); if (oldProps) r.append(oldProps.cloneNode(true))
            const t = doc.createElementNS(A, 'a:t'); t.textContent = line; r.append(t); p.append(r); body.append(p)
          }
        }
        if (['x', 'y', 'width', 'height'].some((key) => patch[key] !== undefined)) {
          const props = nodes(element, P, 'spPr')[0]
          if (!props) throw new Error('该元素没有可编辑的形状属性')
          let transform = nodes(props, A, 'xfrm')[0]
          if (!transform) { transform = doc.createElementNS(A, 'a:xfrm'); props.prepend(transform) }
          let off = nodes(transform, A, 'off')[0]; let ext = nodes(transform, A, 'ext')[0]
          if (!off) { off = doc.createElementNS(A, 'a:off'); off.setAttribute('x', '0'); off.setAttribute('y', '0'); transform.prepend(off) }
          if (!ext) { ext = doc.createElementNS(A, 'a:ext'); ext.setAttribute('cx', '0'); ext.setAttribute('cy', '0'); transform.append(ext) }
          for (const [key, attr, node] of [['x', 'x', off], ['y', 'y', off], ['width', 'cx', ext], ['height', 'cy', ext]] as const) if (patch[key] !== undefined) node.setAttribute(attr, String(Math.round((patch[key] as number) * EMU_PER_POINT)))
        }
        if (patch.fontSize !== undefined || patch.color !== undefined) {
          for (const run of nodes(element, A, 'r')) {
            let props = nodes(run, A, 'rPr')[0]
            if (!props) { props = doc.createElementNS(A, 'a:rPr'); run.prepend(props) }
            if (patch.fontSize !== undefined) props.setAttribute('sz', String(Math.round((patch.fontSize as number) * 100)))
            if (patch.color !== undefined) {
              Array.from(props.children).filter((node) => ['solidFill', 'gradFill', 'noFill', 'pattFill'].includes(node.localName)).forEach((node) => node.remove())
              const fill = doc.createElementNS(A, 'a:solidFill'); const color = doc.createElementNS(A, 'a:srgbClr')
              color.setAttribute('val', (patch.color as string).slice(1)); fill.append(color); props.append(fill)
            }
          }
        }
      }
    } else {
      // 动画和连接线引用原 shape ID；删除时拒绝悬空引用。
      const targets = selected.flatMap((element) => nodes(element, P, 'cNvPr').map((node) => node.getAttribute('id')))
      const remaining = nodes(doc, P, 'spTgt').concat(nodes(doc, A, 'stCxn'), nodes(doc, A, 'endCxn'))
      if (remaining.some((node) => targets.includes(node.getAttribute('spid') ?? node.getAttribute('id')))) throw new Error('元素被动画或连接线引用，暂不支持删除；请先处理对应关系')
      selected.forEach((element) => element.remove())
    }
    return this.commit(doc, slide, ids, ids.length)
  }
  private commit(doc: Document, slide: number, ids: string[], changedCount: number) {
    this.history.push({ ...this.files }); if (this.history.length > 30) this.history.shift()
    this.files = { ...this.files, [this.slidePaths[slide - 1]]: strToU8(new XMLSerializer().serializeToString(doc)) }
    this.previewCache.clear()
    this.revision++
    this.refreshSelection()
    return { documentPath: this.filePath, revision: this.revision, slide, elementIds: ids, changedCount, dirty: this.dirty, elements: this.read({ slide }).elements, context: this.context(), selection: this.selection }
  }
  private refreshSelection(): void {
    if (!this.selection) return
    const { slide, elementIds, paragraphId } = this.selection
    const ids = elementIds.filter((id) => this.elements(slide).some((element) => element.id === id))
    const focus = ids.length === 1 && paragraphId && this.elements(slide).find((item) => item.id === ids[0])?.appearance.paragraphs.some((item) => item.id === paragraphId) ? { paragraphId } : undefined
    this.selection = ids.length ? this.select(slide, ids, focus) : null
  }
  undo(): void { const files = this.history.pop(); if (!files) throw new Error('没有可撤销的 PPT 修改'); this.files = files; this.previewCache.clear(); this.revision++; this.refreshSelection() }
}
