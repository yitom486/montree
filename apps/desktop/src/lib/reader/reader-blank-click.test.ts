// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { isReaderBlankClick } from './reader-blank-click'

afterEach(() => { vi.restoreAllMocks(); document.body.replaceChildren(); Reflect.deleteProperty(document, 'caretRangeFromPoint') })
function area(doc = document) {
  const root = doc.createElement('div')
  doc.body.appendChild(root)
  vi.spyOn(root, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 400, 300))
  return root
}
function click(root: HTMLElement, target: HTMLElement, init: MouseEventInit = {}) {
  const event = new MouseEvent('click', { bubbles: true, clientX: 50, clientY: 50, detail: 1, ...init })
  target.dispatchEvent(event)
  return isReaderBlankClick(event, root)
}
describe('reader blank dismissal scope', () => {
  it('accepts article whitespace, excludes controls/media and the surrounding application', () => {
    const root = area()
    expect(click(root, root)).toBe(true)
    const outside = document.createElement('div')
    document.body.appendChild(outside)
    expect(click(root, outside)).toBe(false)
    for (const tag of ['button', 'a', 'input', 'img', 'video']) {
      const element = document.createElement(tag)
      root.appendChild(element)
      expect(click(root, element)).toBe(false)
    }
    expect(click(root, root, { clientX: 450 })).toBe(false)
  })
  it('checks the clicked character rectangle rather than treating a paragraph as all text or all blank', () => {
    const root = area()
    root.textContent = 'Readable text'
    const caret = document.createRange()
    caret.setStart(root.firstChild!, 1)
    Object.defineProperty(document, 'caretRangeFromPoint', { configurable: true, value: () => caret })
    const create = document.createRange.bind(document)
    vi.spyOn(document, 'createRange').mockImplementation(() => {
      const range = create()
      vi.spyOn(range, 'getClientRects').mockReturnValue([new DOMRect(40, 40, 20, 20)] as unknown as DOMRectList)
      return range
    })
    expect(click(root, root)).toBe(false)
    expect(click(root, root, { clientX: 150 })).toBe(true)
  })
  it('preserves selections, modified clicks and scrollbar gestures', () => {
    const root = area()
    for (const init of [{ ctrlKey: true }, { button: 2 }, { detail: 2 }]) expect(click(root, root, init)).toBe(false)
    Object.defineProperty(root, 'offsetWidth', { value: 400 })
    Object.defineProperty(root, 'clientWidth', { value: 380 })
    expect(click(root, root, { clientX: 390 })).toBe(false)
    vi.spyOn(document, 'getSelection').mockReturnValue({ isCollapsed: false } as Selection)
    expect(click(root, root)).toBe(false)
  })
  it('uses an iframe document and ignores selections outside that reading document', () => {
    const iframe = document.createElement('iframe')
    document.body.appendChild(iframe)
    const doc = iframe.contentDocument!
    const root = area(doc)
    vi.spyOn(document, 'getSelection').mockReturnValue({ isCollapsed: false } as Selection)
    expect(click(root, root)).toBe(true)
    vi.spyOn(doc, 'getSelection').mockReturnValue({ isCollapsed: false } as Selection)
    expect(click(root, root)).toBe(false)
  })
})
