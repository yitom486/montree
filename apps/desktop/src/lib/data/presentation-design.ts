import { A, P, child, descendants, parsePart, relation, relationshipsPath, shapeTree, shapeId, encodeXml, object, string, color, number, insertOrdered, type PresentationFiles } from './presentation-xml'
import { applyPresentationFont, editPresentationText } from './presentation-text-edit'
import { presentationAppearance, presentationPreviewContext, presentationTextStyle } from './presentation-preview'

export interface PresentationDesignPart { partId: string; kind: 'master' | 'layout'; name: string; masterId?: string; affectedSlides: number[] }
export function designInventory(files: PresentationFiles, slides: string[]): PresentationDesignPart[] {
  const parts = new Map<string, PresentationDesignPart>()
  slides.forEach((path, index) => {
    const layout = relation(files, path, 'slideLayout'); const master = layout && relation(files, layout, 'slideMaster')
    for (const [id, kind] of [[layout, 'layout'], [master, 'master']] as const) if (id && files[id]) {
      const existing = parts.get(id)
      if (existing) existing.affectedSlides.push(index + 1)
      else { const doc = parsePart(files, id); parts.set(id, { partId: id, kind, name: descendants(doc, P, 'cSld')[0]?.getAttribute('name') || doc.documentElement.getAttribute('type') || id, ...(kind === 'layout' ? { masterId: master } : {}), affectedSlides: [index + 1] }) }
    }
  })
  for (const part of [...parts.values()].filter((item) => item.kind === 'master')) {
    const relPath = relationshipsPath(part.partId)
    if (!files[relPath]) continue
    for (const rel of Array.from(parsePart(files, relPath).getElementsByTagName('Relationship')).filter((node) => node.getAttribute('Type')?.endsWith('/slideLayout'))) {
      const path = relation(files, part.partId, rel.getAttribute('Id') ?? '', true)
      if (!path || !files[path] || parts.has(path) || relation(files, path, 'slideMaster') !== part.partId) continue
      const doc = parsePart(files, path)
      parts.set(path, { partId: path, kind: 'layout', name: descendants(doc, P, 'cSld')[0]?.getAttribute('name') || doc.documentElement.getAttribute('type') || path, masterId: part.partId, affectedSlides: [] })
    }
  }
  return [...parts.values()]
}
export function readDesign(files: PresentationFiles, slides: string[]) {
  return { parts: designInventory(files, slides).map((part) => {
    const doc = parsePart(files, part.partId); const context = presentationPreviewContext(files, part.partId, doc)
    const styles = child(doc.documentElement, P, 'txStyles')
    const levels = (style?: Element) => style ? Array.from(style.children).filter((node) => /^lvl\dpPr$/.test(node.localName)).map((node) => ({ level: Number(node.localName[3]), ...presentationTextStyle(child(node, A, 'defRPr'), context) })) : []
    return { ...part, background: context.background, units: 'points', defaultTextStyles: part.kind === 'master' ? Object.fromEntries(['titleStyle', 'bodyStyle', 'otherStyle'].map((name) => [name, levels(child(styles, P, name))])) : undefined,
      elements: shapeTree(doc, true).map((element) => ({ id: shapeId(element), type: element.localName, name: descendants(element, P, 'cNvPr')[0]?.getAttribute('name') ?? '',
      placeholder: descendants(element, P, 'ph')[0]?.getAttribute('type') ?? null,
      defaultTextStyles: levels(child(child(element, P, 'txBody'), A, 'lstStyle')), paragraphs: presentationAppearance(element, context).paragraphs })) }
  }), slides: slides.map((path, index) => ({ slide: index + 1, layoutId: relation(files, path, 'slideLayout') })),
  capabilities: ['background-color', 'default-text-style', 'element-text-style', 'apply-existing-layout'], unsupported: ['create-master', 'clone-master', 'delete-master', 'placeholder-restructure'] }
}
export function editDesign(files: PresentationFiles, slides: string[], edits: Record<string, unknown>[]): PresentationFiles {
  const inventory = designInventory(files, slides); const output: PresentationFiles = {}; const seen = new Set<string>()
  const ensureUnique = (key: string): void => { if (seen.has(key)) throw new Error('母版/版式目标重叠'); seen.add(key) }
  for (const value of edits) {
    if (value.kind === 'apply-layout') {
      const edit = object(value, ['kind', 'slide', 'layoutId', 'expectedLayoutId'], ['slide', 'layoutId', 'expectedLayoutId'])
      const slide = number(edit.slide, 1, slides.length)
      if (!Number.isInteger(slide)) throw new Error('slide 必须为整数')
      const path = slides[slide - 1]; const target = inventory.find((part) => part.kind === 'layout' && part.partId === edit.layoutId)
      if (!target || relation(files, path, 'slideLayout') !== edit.expectedLayoutId) throw new Error('版式不存在或 expectedLayoutId 不匹配')
      ensureUnique(`slide:${slide}`)
      const relPath = relationshipsPath(path); const rels = parsePart(files, relPath)
      const matches = Array.from(rels.getElementsByTagName('Relationship')).filter((node) => node.getAttribute('Type')?.endsWith('/slideLayout'))
      if (matches.length !== 1) throw new Error('幻灯片版式关系未唯一匹配')
      matches[0].setAttribute('Target', `/${target.partId}`); output[relPath] = encodeXml(rels)
      continue
    }
    const edit = object(value, ['kind', 'partId', 'expectedSlides', 'elementId', 'paragraphId', 'expectedText', 'patch'], ['kind', 'partId', 'expectedSlides', 'patch'])
    if (edit.kind !== 'style') throw new Error('设计操作只支持 style 或 apply-layout')
    const part = inventory.find((item) => item.partId === edit.partId)
    if (!part) throw new Error('母版/版式 partId 未匹配')
    if (!Array.isArray(edit.expectedSlides) || edit.expectedSlides.some((value) => !Number.isInteger(value)) || new Set(edit.expectedSlides).size !== edit.expectedSlides.length || [...edit.expectedSlides].sort((a, b) => Number(a) - Number(b)).join(',') !== part.affectedSlides.join(',')) throw new Error('expectedSlides 必须与受影响页完全一致')
    // A part is edited once per batch; this keeps defaults and element edits unambiguous.
    ensureUnique(part.partId); const doc = parsePart(files, part.partId)
    if (edit.elementId !== undefined) {
      editPresentationText(doc, shapeTree(doc, true), [{ elementId: edit.elementId, paragraphId: edit.paragraphId, expectedText: edit.expectedText, patch: edit.patch }], 1)
    } else {
      if (edit.paragraphId !== undefined || edit.expectedText !== undefined) throw new Error('段落参数需要 elementId')
      const patch = object(edit.patch, ['backgroundColor', 'fontFamily', 'fontSize', 'color'])
      if (!Object.keys(patch).length) throw new Error('设计 patch 不能为空')
      if (patch.backgroundColor !== undefined) {
        const hex = color(patch.backgroundColor); const common = descendants(doc, P, 'cSld')[0]
        if (!common) throw new Error('母版/版式缺少 cSld')
        child(common, P, 'bg')?.remove()
        const bg = doc.createElementNS(P, 'p:bg'); const props = doc.createElementNS(P, 'p:bgPr'); const fill = doc.createElementNS(A, 'a:solidFill'); const rgb = doc.createElementNS(A, 'a:srgbClr')
        rgb.setAttribute('val', hex.slice(1)); fill.append(rgb); props.append(fill); bg.append(props); common.prepend(bg)
      }
      if (patch.fontSize !== undefined) number(patch.fontSize, 1, 1000)
      if (patch.fontFamily !== undefined && !string(patch.fontFamily, 100).trim()) throw new Error('fontFamily 不能为空')
      if (patch.color !== undefined) color(patch.color)
      if (['fontSize', 'fontFamily', 'color'].some((key) => key in patch)) {
        const levelOrder = ['defPPr', ...Array.from({ length: 9 }, (_, i) => `lvl${i + 1}pPr`), 'extLst']
        const apply = (style: Element): void => {
          let props = child(style, A, 'defRPr')
          if (!props) { props = doc.createElementNS(A, 'a:defRPr'); style.insertBefore(props, child(style, A, 'extLst') ?? null) }
          applyPresentationFont(props, { fontSize: patch.fontSize as number | undefined, color: patch.color as string | undefined, fontFamily: patch.fontFamily as string | undefined })
        }
        if (part.kind === 'master') {
          let styles = child(doc.documentElement, P, 'txStyles')
          if (!styles) { styles = doc.createElementNS(P, 'p:txStyles'); doc.documentElement.insertBefore(styles, child(doc.documentElement, P, 'extLst') ?? null) }
          for (const name of ['titleStyle', 'bodyStyle', 'otherStyle']) { let style = child(styles, P, name); if (!style) { style = doc.createElementNS(P, `p:${name}`); insertOrdered(styles, style, ['titleStyle', 'bodyStyle', 'otherStyle', 'extLst']) }; for (let level = 1; level <= 9; level++) { let p = child(style, A, `lvl${level}pPr`); if (!p) { p = doc.createElementNS(A, `a:lvl${level}pPr`); insertOrdered(style, p, levelOrder) }; apply(p) } }
        } else {
          for (const shape of shapeTree(doc, true).filter((node) => child(node, P, 'txBody'))) {
            const body = child(shape, P, 'txBody')!
            let list = child(body, A, 'lstStyle'); if (!list) { list = doc.createElementNS(A, 'a:lstStyle'); body.insertBefore(list, child(body, A, 'p') ?? null) }
            for (let level = 1; level <= 9; level++) { let p = child(list, A, `lvl${level}pPr`); if (!p) { p = doc.createElementNS(A, `a:lvl${level}pPr`); insertOrdered(list, p, levelOrder) }; apply(p) }
          }
        }
      }
    }
    output[part.partId] = encodeXml(doc)
  }
  // Layout changes and edits to the same affected parts have order-dependent inheritance.
  if (seen.size && edits.some((edit) => edit.kind === 'apply-layout') && edits.some((edit) => edit.kind === 'style')) throw new Error('应用版式与修改母版需分批执行')
  return output
}
