/** 标准 XML 命名空间测试适配：补齐浏览器 Element 的便利方法。 */
import { DOMParser, XMLSerializer } from '@xmldom/xmldom'
import { vi } from 'vitest'

const decorated = new WeakSet<object>()
function decorate(node: object): void {
  if (decorated.has(node)) return
  decorated.add(node)
  const target = node as unknown as Element
  const browserChildren = Reflect.has(target, 'children')
  if (!browserChildren) Object.defineProperty(target, 'children', { get: () => Array.from(target.childNodes ?? []).filter((child) => child.nodeType === 1) })
  target.remove = () => { target.parentNode?.removeChild(target) }
  target.append = (...items) => { items.forEach((item) => target.appendChild(typeof item === 'string' ? target.ownerDocument.createTextNode(item) : item)) }
  target.prepend = (...items) => { items.reverse().forEach((item) => target.insertBefore(typeof item === 'string' ? target.ownerDocument.createTextNode(item) : item, target.firstChild)) }
  const clone = target.cloneNode.bind(target)
  target.cloneNode = (deep) => { const node = clone(deep); decorate(node); return node }
  Array.from(target.childNodes ?? []).forEach(decorate)
}

export function installXmlTestDom(): void {
  vi.stubGlobal('DOMParser', class {
    parseFromString(source: string): Document {
      const parsed = new DOMParser().parseFromString(source, 'application/xml')
      const doc = parsed as unknown as Document
      decorate(doc)
      doc.querySelector = ((name: string) => doc.getElementsByTagName(name)[0] ?? null) as Document['querySelector']
      const create = doc.createElementNS.bind(doc)
      doc.createElementNS = ((namespace: string | null, name: string) => { const node = create(namespace, name); decorate(node); return node }) as Document['createElementNS']
      return doc
    }
  })
  vi.stubGlobal('XMLSerializer', XMLSerializer)
}
