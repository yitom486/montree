import { strFromU8 } from 'fflate'

const A = 'http://schemas.openxmlformats.org/drawingml/2006/main'
const P = 'http://schemas.openxmlformats.org/presentationml/2006/main'
const POINT = 12700
const children = (node: Element | undefined, name: string): Element[] => Array.from(node?.children ?? []).filter((child) => child.localName === name)
const child = (node: Element | undefined, name: string): Element | undefined => children(node, name)[0]
const descendants = (node: Document | Element | undefined, ns: string, name: string): Element[] => Array.from(node?.getElementsByTagNameNS(ns, name) ?? [])

export interface PresentationTextStyle {
  fontSize?: number
  color?: string
  bold?: boolean
  italic?: boolean
  underline?: boolean
  fontFamily?: string
}
export interface PresentationParagraph extends PresentationTextStyle {
  runs: Array<PresentationTextStyle & { text: string }>
  align: 'left' | 'center' | 'right' | 'justify'
  before: number
  after: number
  lineSpacing?: number
  lineHeight?: number
  indent: number
  bullet?: string
}
export interface PresentationAppearance {
  paragraphs: PresentationParagraph[]
  fill?: string
  lineColor?: string
  lineWidth: number
  geometry?: string
  rotation: number
  flipH: boolean
  flipV: boolean
  inset: { left: number; top: number; right: number; bottom: number }
  verticalAlign: 'start' | 'center' | 'end'
  wrap: boolean
}
export interface PresentationPreviewContext {
  background: string
  color: (node: Element | undefined) => string | undefined
  font: (name: string) => string
}

/** Resolve a slide's own layout/master/theme relationships, never an arbitrary theme1.xml. */
export function presentationPreviewContext(files: Record<string, Uint8Array>, slidePath: string, slide: Document): PresentationPreviewContext {
  const parse = (path: string): Document | undefined => files[path] ? new DOMParser().parseFromString(strFromU8(files[path]), 'application/xml') : undefined
  const related = (path: string, type: string): string | undefined => {
    const rels = parse(path.replace(/([^/]+)$/, '_rels/$1.rels'))
    const rel = Array.from(rels?.getElementsByTagName('Relationship') ?? []).find((node) => node.getAttribute('Type')?.endsWith(`/${type}`) && node.getAttribute('TargetMode') !== 'External')
    const target = rel?.getAttribute('Target')
    return target ? new URL(target, `https://ppt.invalid/${path}`).pathname.slice(1) : undefined
  }
  const layoutPath = related(slidePath, 'slideLayout')
  const masterPath = layoutPath && related(layoutPath, 'slideMaster')
  const themePath = related(slidePath, 'theme') ?? (layoutPath && related(layoutPath, 'theme')) ?? (masterPath && related(masterPath, 'theme'))
  const layout = layoutPath ? parse(layoutPath) : undefined
  const master = masterPath ? parse(masterPath) : undefined
  const theme = themePath ? parse(themePath) : undefined
  const scheme = descendants(theme, A, 'clrScheme')[0]
  const map = descendants(slide, A, 'overrideClrMapping')[0] ?? descendants(layout, A, 'overrideClrMapping')[0] ?? descendants(master, P, 'clrMap')[0]
  const aliases: Record<string, string> = { bg1: 'lt1', tx1: 'dk1', bg2: 'lt2', tx2: 'dk2' }
  const color = (parent: Element | undefined): string | undefined => {
    if (!parent) return undefined
    const node = ['srgbClr', 'sysClr', 'schemeClr'].includes(parent.localName) ? parent : Array.from(parent.children).find((item) => ['srgbClr', 'sysClr', 'schemeClr'].includes(item.localName))
    if (!node) return undefined
    let value = node.getAttribute(node.localName === 'sysClr' ? 'lastClr' : 'val') ?? ''
    if (node.localName === 'schemeClr') {
      const key = map?.getAttribute(value) || aliases[value] || value
      const entry = child(scheme, key)?.children[0]
      value = entry?.getAttribute(entry.localName === 'sysClr' ? 'lastClr' : 'val') ?? ({ lt1: 'FFFFFF', dk1: '000000' }[key as 'lt1' | 'dk1'] ?? '')
    }
    if (!/^[a-f\d]{6}$/i.test(value)) return undefined
    let rgb = [0, 2, 4].map((index) => parseInt(value.slice(index, index + 2), 16))
    for (const transform of Array.from(node.children)) {
      const amount = Number(transform.getAttribute('val')) / 100000
      if (transform.localName === 'tint') rgb = rgb.map((channel) => channel + (255 - channel) * amount)
      if (transform.localName === 'shade' || transform.localName === 'lumMod') rgb = rgb.map((channel) => channel * amount)
      if (transform.localName === 'lumOff') rgb = rgb.map((channel) => channel + 255 * amount)
    }
    const hex = `#${rgb.map((channel) => Math.round(Math.max(0, Math.min(255, channel))).toString(16).padStart(2, '0')).join('')}`
    const alpha = child(node, 'alpha')
    return alpha ? `rgba(${rgb.map(Math.round).join(',')},${Number(alpha.getAttribute('val')) / 100000})` : hex
  }
  const font = (name: string): string => {
    if (!name.startsWith('+')) return name
    const kind = name.startsWith('+mj') ? 'majorFont' : 'minorFont'
    return child(descendants(theme, A, kind)[0], name.endsWith('-ea') ? 'ea' : 'latin')?.getAttribute('typeface') || 'Arial'
  }
  let background = '#ffffff'
  for (const doc of [slide, layout, master]) {
    const bg = descendants(doc, P, 'bg')[0]
    if (!bg) continue
    const fill = child(child(bg, 'bgPr'), 'solidFill') ?? child(bg, 'bgRef')
    background = color(fill) ?? background
    break
  }
  return { background, color, font }
}

function textStyle(props: Element | undefined, context: PresentationPreviewContext): PresentationTextStyle {
  if (!props) return {}
  const style: PresentationTextStyle = {}
  if (props.hasAttribute('sz')) style.fontSize = Number(props.getAttribute('sz')) / 100
  if (props.hasAttribute('b')) style.bold = props.getAttribute('b') === '1'
  if (props.hasAttribute('i')) style.italic = props.getAttribute('i') === '1'
  if (props.hasAttribute('u')) style.underline = props.getAttribute('u') !== 'none'
  const color = context.color(child(props, 'solidFill'))
  if (color) style.color = color
  const font = child(props, 'latin')?.getAttribute('typeface')
  if (font) style.fontFamily = context.font(font)
  return style
}

/** Paragraph defaults and explicit line breaks are part of the visual text model. */
export function presentationAppearance(element: Element, context: PresentationPreviewContext): PresentationAppearance {
  const props = child(element, 'spPr')
  const body = child(element, 'txBody')
  const bodyProps = child(body, 'bodyPr')
  const listStyle = child(body, 'lstStyle')
  const paragraphs = children(body, 'p').map((paragraph): PresentationParagraph => {
    const pPr = child(paragraph, 'pPr')
    const level = child(listStyle, `lvl${Number(pPr?.getAttribute('lvl') ?? 0) + 1}pPr`)
    const style = { fontSize: 18, ...textStyle(child(level, 'defRPr'), context), ...textStyle(child(pPr, 'defRPr'), context) }
    const runs: PresentationParagraph['runs'] = []
    for (const run of Array.from(paragraph.children)) {
      if (run.localName === 'br') runs.push({ ...style, text: '\n' })
      else if (['r', 'fld'].includes(run.localName)) runs.push({ ...style, ...textStyle(child(run, 'rPr'), context), text: children(run, 't').map((node) => node.textContent ?? '').join('') })
    }
    const attr = (name: string): string | null | undefined => pPr?.getAttribute(name) || level?.getAttribute(name)
    const space = (name: string): number => Number(child(child(pPr, name) ?? child(level, name), 'spcPts')?.getAttribute('val') ?? 0) / 100
    const spacing = child(pPr, 'lnSpc') ?? child(level, 'lnSpc')
    return { ...style, runs, align: ({ ctr: 'center', r: 'right', just: 'justify' } as const)[attr('algn') as 'ctr' | 'r' | 'just'] ?? 'left', before: space('spcBef'), after: space('spcAft'),
      ...(child(spacing, 'spcPts') ? { lineSpacing: Number(child(spacing, 'spcPts')!.getAttribute('val')) / 100 } : {}),
      ...(child(spacing, 'spcPct') ? { lineHeight: Number(child(spacing, 'spcPct')!.getAttribute('val')) / 100000 } : {}),
      indent: Number(attr('marL') ?? 0) / POINT,
      bullet: child(pPr, 'buNone') ? undefined : child(pPr, 'buChar')?.getAttribute('char') ?? child(level, 'buChar')?.getAttribute('char') ?? undefined }
  })
  const line = child(props, 'ln')
  const transform = child(props, 'xfrm')
  const inset = (name: string, fallback: number): number => Number(bodyProps?.getAttribute(name) ?? fallback * POINT) / POINT
  return { paragraphs, fill: child(props, 'noFill') ? undefined : context.color(child(props, 'solidFill')),
    lineColor: child(line, 'noFill') ? undefined : context.color(child(line, 'solidFill')), lineWidth: Number(line?.getAttribute('w') ?? POINT) / POINT,
    geometry: child(props, 'prstGeom')?.getAttribute('prst') ?? undefined, rotation: Number(transform?.getAttribute('rot') ?? 0) / 60000,
    flipH: transform?.getAttribute('flipH') === '1', flipV: transform?.getAttribute('flipV') === '1',
    inset: { left: inset('lIns', 7.2), top: inset('tIns', 3.6), right: inset('rIns', 7.2), bottom: inset('bIns', 3.6) },
    verticalAlign: bodyProps?.getAttribute('anchor') === 'ctr' ? 'center' : bodyProps?.getAttribute('anchor') === 'b' ? 'end' : 'start', wrap: bodyProps?.getAttribute('wrap') !== 'none' }
}
