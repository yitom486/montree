import { strFromU8, strToU8 } from 'fflate'

export const P = 'http://schemas.openxmlformats.org/presentationml/2006/main'
export const A = 'http://schemas.openxmlformats.org/drawingml/2006/main'
export const C = 'http://schemas.openxmlformats.org/drawingml/2006/chart'
export const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'
export const P14 = 'http://schemas.microsoft.com/office/powerpoint/2010/main'
export const POINT = 12700
export type PresentationFiles = Record<string, Uint8Array>
export const children = (node: Element | Document, ns: string, name: string): Element[] => Array.from(node.children).filter((item) => item.namespaceURI === ns && item.localName === name)
export const child = (node: Element | Document | undefined, ns: string, name: string): Element | undefined => node && children(node, ns, name)[0]
export const descendants = (node: Element | Document, ns: string, name: string): Element[] => Array.from(node.getElementsByTagNameNS(ns, name))
export function parsePart(files: PresentationFiles, path: string): Document {
  if (!files[path]) throw new Error(`PPT 部件不存在：${path}`)
  const doc = new DOMParser().parseFromString(strFromU8(files[path]), 'application/xml')
  if (doc.querySelector('parsererror')) throw new Error('PPT XML 无法解析')
  return doc
}
export const encodeXml = (doc: Document): Uint8Array => strToU8(new XMLSerializer().serializeToString(doc))
export const relationshipsPath = (path: string): string => path.replace(/([^/]+)$/, '_rels/$1.rels')
export function relation(files: PresentationFiles, path: string, key: string, byId = false): string | undefined {
  const relPath = relationshipsPath(path)
  if (!files[relPath]) return
  const doc = parsePart(files, relPath)
  const matches = Array.from(doc.getElementsByTagName('Relationship')).filter((node) => byId ? node.getAttribute('Id') === key : node.getAttribute('Type')?.endsWith(`/${key}`))
  if (matches.length !== 1 || matches[0].getAttribute('TargetMode') === 'External') return
  const target = matches[0].getAttribute('Target')
  const resolved = target && new URL(target, `https://ppt.invalid/${path}`)
  return resolved && resolved.host === 'ppt.invalid' ? resolved.pathname.slice(1) : undefined
}
export const shapeId = (node: Element): string => descendants(node, P, 'cNvPr')[0]?.getAttribute('id') ?? ''
export function shapeTree(doc: Document, recursive = false): Element[] {
  const tree = descendants(doc, P, 'spTree')[0]
  if (!tree) throw new Error('幻灯片缺少元素树')
  const walk = (node: Element): Element[] => Array.from(node.children).filter((item) => item.namespaceURI === P && ['sp', 'pic', 'graphicFrame', 'cxnSp', 'grpSp'].includes(item.localName)).flatMap((item) => [item, ...(recursive && item.localName === 'grpSp' ? walk(item) : [])])
  return walk(tree)
}
export function batches(args: Record<string, unknown>, allowed: string[]): Record<string, unknown>[] {
  if (Object.keys(args).some((key) => !['documentPath', 'revision', 'operation', 'edits', 'expectedCount', ...allowed].includes(key))) throw new Error('包含不支持的参数')
  if (!Array.isArray(args.edits) || !args.edits.length || args.edits.length > 100 || args.expectedCount !== args.edits.length) throw new Error('edits 数量必须与 expectedCount 一致（1至100）')
  if (args.edits.some((value) => !value || typeof value !== 'object' || Array.isArray(value))) throw new Error('edit 必须为对象')
  return args.edits as Record<string, unknown>[]
}
export function object(value: unknown, allowed: string[], required: string[] = []): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('参数必须为对象')
  const result = value as Record<string, unknown>
  if (Object.keys(result).some((key) => !allowed.includes(key)) || required.some((key) => result[key] === undefined)) throw new Error('参数缺失或包含不支持的属性')
  return result
}
export function color(value: unknown): string {
  if (typeof value !== 'string' || !/^#[a-f\d]{6}$/i.test(value)) throw new Error('color 必须为 #RRGGBB')
  return value
}
export function number(value: unknown, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) throw new Error(`数值必须为 ${min} 至 ${max}`)
  return value
}
export function string(value: unknown, max = 50000): string {
  if (typeof value !== 'string' || value.length > max || /[\u0000-\u0008\u000B-\u001F\uFFFE\uFFFF]|[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/.test(value)) throw new Error('文本无效或超出长度限制')
  return value
}
export function insertOrdered(parent: Element, node: Element, order: string[]): void {
  parent.insertBefore(node, Array.from(parent.children).find((item) => order.indexOf(item.localName) > order.indexOf(node.localName)) ?? null)
}
