import type { SlideTextEdit, SlideTextPatch } from '@montree/contracts'

const A = 'http://schemas.openxmlformats.org/drawingml/2006/main'
const P = 'http://schemas.openxmlformats.org/presentationml/2006/main'
const XML = 'http://www.w3.org/XML/1998/namespace'
const children = (node: Element, name: string): Element[] => Array.from(node.children).filter((item) => item.namespaceURI === A && item.localName === name)
const child = (node: Element, name: string): Element | undefined => children(node, name)[0]
const runs = (paragraph: Element): Element[] => Array.from(paragraph.children).filter((item) => item.namespaceURI === A && ['r', 'fld', 'br'].includes(item.localName))
const text = (run: Element): string => run.localName === 'br' ? '\n' : children(run, 't').map((node) => node.textContent ?? '').join('')
const splitSurrogate = (value: string, index: number): boolean => index > 0 && index < value.length && /[\uD800-\uDBFF]/.test(value[index - 1]) && /[\uDC00-\uDFFF]/.test(value[index])
const invalidXmlText = (value: string): boolean => /[\u0000-\u0008\u000B-\u001F\uFFFE\uFFFF]|[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/.test(value)

function validatePatch(value: unknown): SlideTextPatch {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('patch 必须为对象')
  const patch = value as Record<string, unknown>
  const allowed = ['text', 'fontSize', 'color', 'bold', 'italic', 'underline', 'fontFamily', 'align', 'spaceBefore', 'spaceAfter']
  if (!Object.keys(patch).length || Object.keys(patch).some((key) => !allowed.includes(key))) throw new Error('patch 包含不支持的文字属性')
  if (patch.text !== undefined && (typeof patch.text !== 'string' || patch.text.length > 50000 || invalidXmlText(patch.text))) throw new Error('text 必须为有效文本（最多50000字，换行使用 LF）')
  if (patch.color !== undefined && (typeof patch.color !== 'string' || !/^#[a-f\d]{6}$/i.test(patch.color))) throw new Error('color 必须为 #RRGGBB')
  for (const key of ['bold', 'italic', 'underline']) if (patch[key] !== undefined && typeof patch[key] !== 'boolean') throw new Error(`${key} 必须为布尔值`)
  if (patch.fontFamily !== undefined && (typeof patch.fontFamily !== 'string' || !patch.fontFamily.trim() || patch.fontFamily.length > 100 || /[\u0000-\u001f]/.test(patch.fontFamily) || invalidXmlText(patch.fontFamily))) throw new Error('fontFamily 无效')
  if (patch.align !== undefined && !['left', 'center', 'right', 'justify'].includes(String(patch.align))) throw new Error('align 无效')
  for (const key of ['fontSize', 'spaceBefore', 'spaceAfter']) if (patch[key] !== undefined && (typeof patch[key] !== 'number' || !Number.isFinite(patch[key]) || (patch[key] as number) < (key === 'fontSize' ? 1 : 0) || (patch[key] as number) > 1000)) throw new Error(`${key} 无效，单位为磅`)
  return patch as SlideTextPatch
}

const paragraphOrder = ['lnSpc', 'spcBef', 'spcAft', 'buClrTx', 'buClr', 'buSzTx', 'buSzPct', 'buSzPts', 'buFontTx', 'buFont', 'buNone', 'buAutoNum', 'buChar', 'buBlip', 'tabLst', 'defRPr', 'extLst']
const fontOrder = ['ln', 'noFill', 'solidFill', 'gradFill', 'blipFill', 'pattFill', 'grpFill', 'effectLst', 'effectDag', 'highlight', 'uLnTx', 'uLn', 'uFillTx', 'uFill', 'latin', 'ea', 'cs', 'sym', 'hlinkClick', 'hlinkMouseOver', 'rtl', 'extLst']
function orderedInsert(parent: Element, node: Element, order: string[]): void {
  parent.insertBefore(node, Array.from(parent.children).find((item) => order.indexOf(item.localName) > order.indexOf(node.localName)) ?? null)
}
function properties(node: Element, name: string): Element {
  let props = child(node, name)
  if (!props) { props = node.ownerDocument.createElementNS(A, `a:${name}`); if (name === 'defRPr') orderedInsert(node, props, paragraphOrder); else node.prepend(props) }
  return props
}
export function applyPresentationFont(props: Element, patch: SlideTextPatch): void {
  if (patch.fontSize !== undefined) props.setAttribute('sz', String(Math.round(patch.fontSize * 100)))
  if (patch.bold !== undefined) props.setAttribute('b', patch.bold ? '1' : '0')
  if (patch.italic !== undefined) props.setAttribute('i', patch.italic ? '1' : '0')
  if (patch.underline !== undefined) props.setAttribute('u', patch.underline ? 'sng' : 'none')
  if (patch.color !== undefined) {
    Array.from(props.children).filter((node) => ['solidFill', 'gradFill', 'noFill', 'pattFill'].includes(node.localName)).forEach((node) => node.remove())
    const fill = props.ownerDocument.createElementNS(A, 'a:solidFill'); const color = props.ownerDocument.createElementNS(A, 'a:srgbClr')
    color.setAttribute('val', patch.color.slice(1)); fill.append(color)
    orderedInsert(props, fill, fontOrder)
  }
  if (patch.fontFamily !== undefined) for (const name of ['latin', 'ea', 'cs']) {
    let node = child(props, name)
    if (!node) { node = props.ownerDocument.createElementNS(A, `a:${name}`); orderedInsert(props, node, fontOrder) }
    node.setAttribute('typeface', patch.fontFamily)
  }
}
function applyParagraph(paragraph: Element, patch: SlideTextPatch): void {
  if (patch.align === undefined && patch.spaceBefore === undefined && patch.spaceAfter === undefined) return
  const props = properties(paragraph, 'pPr')
  if (patch.align !== undefined) props.setAttribute('algn', { left: 'l', center: 'ctr', right: 'r', justify: 'just' }[patch.align])
  for (const [key, name] of [['spaceBefore', 'spcBef'], ['spaceAfter', 'spcAft']] as const) if (patch[key] !== undefined) {
    children(props, name).forEach((node) => node.remove())
    const spacing = paragraph.ownerDocument.createElementNS(A, `a:${name}`); const points = paragraph.ownerDocument.createElementNS(A, 'a:spcPts')
    points.setAttribute('val', String(Math.round(patch[key]! * 100))); spacing.append(points)
    orderedInsert(props, spacing, paragraphOrder)
  }
}

interface Plan { edit: SlideTextEdit; paragraph: Element; start: number; end: number; full: boolean }

/** Validate every target against the original revision before touching the detached XML. */
export function editPresentationText(doc: Document, shapes: Element[], values: unknown, expectedCount: unknown): string[] {
  if (!Array.isArray(values) || !values.length || values.length > 100 || expectedCount !== values.length) throw new Error('edits 数量必须与 expectedCount 一致（1至100）')
  let totalText = 0
  const plans: Plan[] = values.map((value): Plan => {
    if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some((key) => !['elementId', 'paragraphId', 'runId', 'start', 'end', 'expectedText', 'patch'].includes(key))) throw new Error('文字目标参数无效')
    const edit = value as SlideTextEdit
    const patch = validatePatch(edit.patch)
    totalText += patch.text?.length ?? 0
    if (totalText > 100000) throw new Error('单次文字修改总量最多100000字')
    if (typeof edit.elementId !== 'string' || typeof edit.paragraphId !== 'string' || !/^p[1-9]\d*$/.test(edit.paragraphId)) throw new Error('需要读取结果中的 elementId 和 paragraphId')
    const matches = shapes.filter((node) => node.getElementsByTagNameNS(P, 'cNvPr')[0]?.getAttribute('id') === edit.elementId)
    if (matches.length !== 1 || matches[0].localName !== 'sp') throw new Error(`元素 ${edit.elementId} 未唯一匹配或不是可编辑文本框`)
    const body = matches[0].getElementsByTagNameNS(P, 'txBody')[0]
    const paragraph = body && children(body, 'p')[Number(edit.paragraphId.slice(1)) - 1]
    if (!paragraph) throw new Error(`段落 ${edit.paragraphId} 不存在，请重新读取`)
    const parts = runs(paragraph)
    const fullText = parts.map(text).join('')
    let base = 0; let length = fullText.length
    if (edit.runId !== undefined) {
      if (typeof edit.runId !== 'string' || !/^r[1-9]\d*$/.test(edit.runId)) throw new Error('runId 无效')
      const index = Number(edit.runId.slice(1)) - 1
      if (!parts[index] || parts[index].localName !== 'r') throw new Error('文字片段不存在或属于只读字段/换行')
      base = parts.slice(0, index).reduce((sum, node) => sum + text(node).length, 0); length = text(parts[index]).length
    }
    const ranged = edit.start !== undefined || edit.end !== undefined
    const start = ranged ? edit.start : 0; const end = ranged ? edit.end : length
    if (!Number.isInteger(start) || !Number.isInteger(end) || start! < 0 || end! < start! || end! > length) throw new Error('start/end 必须为有效 UTF-16 范围，起点含、终点不含')
    const from = base + start!; const to = base + end!
    if (splitSurrogate(fullText, from) || splitSurrogate(fullText, to)) throw new Error('字符范围不能截断 emoji 等代理对')
    const expected = fullText.slice(from, to)
    if (patch.text !== undefined && typeof edit.expectedText !== 'string') throw new Error('修改文字需要 expectedText 与读取结果一致')
    if (edit.expectedText !== undefined && edit.expectedText !== expected) throw new Error('expectedText 不匹配，请重新读取')
    const full = edit.runId === undefined && !ranged
    if (!full && from === to && patch.text === undefined) throw new Error('空字符范围需要提供插入文字')
    if (!full && ['align', 'spaceBefore', 'spaceAfter'].some((key) => key in patch)) throw new Error('对齐和段落间距仅支持完整段落目标')
    let offset = 0
    for (const node of parts) { const end = offset + text(node).length
      if (node.localName === 'fld' && (from < end && to > offset || from === to && from >= offset && from < end)) throw new Error('范围包含只读字段，暂不支持修改')
      offset = end
    }
    return { edit: { ...edit, patch }, paragraph, start: from, end: to, full }
  })
  for (let i = 0; i < plans.length; i++) for (let j = i + 1; j < plans.length; j++) {
    const a = plans[i]; const b = plans[j]
    if (a.paragraph === b.paragraph && (a.full || b.full || a.start < b.end && b.start < a.end || a.start === a.end && a.start >= b.start && a.start <= b.end || b.start === b.end && b.start >= a.start && b.start <= a.end)) throw new Error('文字目标重叠，整批修改被拒绝')
  }
  // Later ranges first: earlier coordinates remain valid when replacement lengths differ.
  for (const plan of plans.sort((a, b) => b.start - a.start)) {
    const { paragraph, start, end, edit } = plan; const patch = edit.patch
    const parts = runs(paragraph); const output: Element[] = []
    let offset = 0; let inserted = false
    const makeRun = (source: Element | undefined, content: string, style?: SlideTextPatch): Element => {
      const run = doc.createElementNS(A, 'a:r'); const original = source && child(source, 'rPr')
      if (original) run.append(original.cloneNode(true))
      if (style && Object.keys(style).some((key) => ['fontSize', 'color', 'bold', 'italic', 'underline', 'fontFamily'].includes(key))) applyPresentationFont(properties(run, 'rPr'), style)
      const node = doc.createElementNS(A, 'a:t'); node.setAttributeNS(XML, 'xml:space', 'preserve'); node.textContent = content; run.append(node)
      return run
    }
    const insert = (source?: Element): void => {
      if (inserted || patch.text === undefined) return
      inserted = true
      patch.text.split('\n').forEach((line, index) => { if (index) output.push(doc.createElementNS(A, 'a:br')); if (line || patch.text === '') output.push(makeRun(source, line, patch)) })
    }
    for (const node of parts) {
      const content = text(node); const next = offset + content.length
      if (start === end && !inserted && patch.text !== undefined && start >= offset && start <= next) {
        if (node.localName === 'r') {
          const point = start - offset
          if (point > 0) output.push(makeRun(node, content.slice(0, point)))
          insert(node)
          if (point < content.length) output.push(makeRun(node, content.slice(point)))
        } else { insert(parts.find((item) => item.localName === 'r')); output.push(node) }
      } else if (next <= start || offset >= end) output.push(node)
      else {
        const from = Math.max(0, start - offset); const to = Math.min(content.length, end - offset)
        if (from > 0) output.push(makeRun(node, content.slice(0, from)))
        if (patch.text !== undefined) insert(node.localName === 'r' ? node : parts.find((item) => item.localName === 'r'))
        else if (node.localName === 'r') output.push(makeRun(node, content.slice(from, to), patch))
        else output.push(node)
        if (to < content.length) output.push(makeRun(node, content.slice(to)))
      }
      offset = next
    }
    if (!inserted && patch.text !== undefined) insert(parts.filter((item) => item.localName === 'r').at(-1))
    parts.forEach((node) => node.remove())
    const endProps = child(paragraph, 'endParaRPr')
    output.forEach((node) => paragraph.insertBefore(node, endProps ?? null))
    applyParagraph(paragraph, patch)
    if (plan.full && Object.keys(patch).some((key) => ['fontSize', 'color', 'bold', 'italic', 'underline', 'fontFamily'].includes(key))) applyPresentationFont(properties(properties(paragraph, 'pPr'), 'defRPr'), patch)
  }
  return Array.from(new Set(plans.map((plan) => plan.edit.elementId)))
}
