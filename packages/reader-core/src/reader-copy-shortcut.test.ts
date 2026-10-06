// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest'
import {
  isEditableCopyTarget,
  shouldHandleReaderCopyShortcut,
  type ReaderCopyShortcutKey,
} from '@montree/reader-core'

const ctrlC: ReaderCopyShortcutKey = {
  key: 'c',
  code: 'KeyC',
  ctrlKey: true,
  metaKey: false,
  shiftKey: false,
  altKey: false,
}
const metaC: ReaderCopyShortcutKey = { ...ctrlC, ctrlKey: false, metaKey: true }
const ctrlV: ReaderCopyShortcutKey = { ...ctrlC, key: 'v', code: 'KeyV' }

function el(html: string): Element {
  const host = document.createElement('div')
  host.innerHTML = html
  document.body.appendChild(host)
  const first = host.firstElementChild
  if (!first) throw new Error('bad fixture')
  return first
}

describe('shouldHandleReaderCopyShortcut', () => {
  it('有选区 + 焦点在页面 → 处理（Win/Mac）', () => {
    const page = el('<div><p>正文</p></div>')
    expect(shouldHandleReaderCopyShortcut(ctrlC, page.querySelector('p'), true)).toBe(true)
    expect(shouldHandleReaderCopyShortcut(metaC, document.body, true)).toBe(true)
  })

  it('有选区 + 空输入框（无划选）→ 处理（拷阅读快照）', () => {
    const panel = el('<aside><textarea></textarea></aside>')
    expect(shouldHandleReaderCopyShortcut(ctrlC, panel.querySelector('textarea'), true)).toBe(true)
  })

  it('有选区 + 输入框内有划选 → 不处理（原生优先）', () => {
    const panel = el('<aside><textarea>hello</textarea></aside>')
    const area = panel.querySelector('textarea')
    if (!area) throw new Error('bad fixture')
    area.focus()
    area.setSelectionRange(0, 5)
    expect(shouldHandleReaderCopyShortcut(ctrlC, area, true)).toBe(false)
  })

  it('无选区 → 不处理（editMenu 保底）', () => {
    expect(shouldHandleReaderCopyShortcut(ctrlC, document.body, false)).toBe(false)
  })

  it('Ctrl+V → 不处理', () => {
    expect(shouldHandleReaderCopyShortcut(ctrlV, document.body, true)).toBe(false)
  })

  it('Shift/Alt 修饰 → 不处理', () => {
    expect(shouldHandleReaderCopyShortcut({ ...ctrlC, shiftKey: true }, document.body, true)).toBe(
      false,
    )
    expect(shouldHandleReaderCopyShortcut({ ...ctrlC, altKey: true }, document.body, true)).toBe(
      false,
    )
  })
})

describe('isEditableCopyTarget', () => {
  it('空 textarea（无划选）不放行——拷阅读快照', () => {
    const panel = el('<aside><textarea></textarea></aside>')
    expect(isEditableCopyTarget(panel.querySelector('textarea'))).toBe(false)
  })

  it('textarea 自身有划选 → 放行原生', () => {
    const panel = el('<aside><textarea>hello</textarea></aside>')
    const area = panel.querySelector('textarea')
    if (!area) throw new Error('bad fixture')
    area.focus()
    area.setSelectionRange(1, 4)
    expect(isEditableCopyTarget(area)).toBe(true)
  })

  it('input 空框不放行、有划选放行', () => {
    const host = el('<div><input type="text" value="abc"></div>')
    const input = host.querySelector('input')
    if (!input) throw new Error('bad fixture')
    expect(isEditableCopyTarget(input)).toBe(false)
    input.focus()
    input.setSelectionRange(0, 3)
    expect(isEditableCopyTarget(input)).toBe(true)
  })

  it('contenteditable 有选字放行、空选区不放行', () => {
    const host = el('<div><div contenteditable="true">hello</div></div>')
    const editable = host.querySelector('[contenteditable]')
    if (!(editable instanceof HTMLElement)) throw new Error('bad fixture')
    expect(isEditableCopyTarget(editable)).toBe(false)
    const range = document.createRange()
    range.selectNodeContents(editable.firstChild ?? editable)
    const selection = document.getSelection()
    selection?.removeAllRanges()
    selection?.addRange(range)
    expect(isEditableCopyTarget(editable)).toBe(true)
    selection?.removeAllRanges()
    expect(isEditableCopyTarget(editable)).toBe(false)
  })

  it('对话框内批注正文有划选 → 放行；空框 → 接管', () => {
    const dialog = el('<div role="dialog"><textarea></textarea><p>说明</p></div>')
    const area = dialog.querySelector('textarea')
    if (!area) throw new Error('bad fixture')
    expect(isEditableCopyTarget(area)).toBe(false)
    area.value = '批注正文'
    area.focus()
    area.setSelectionRange(0, 4)
    expect(isEditableCopyTarget(area)).toBe(true)
  })

  it('contenteditable=false 不放行', () => {
    expect(isEditableCopyTarget(el('<div contenteditable="false">x</div>'))).toBe(false)
  })

  it('普通页面/工具条按钮不放行', () => {
    expect(isEditableCopyTarget(el('<div><button>复制</button></div>').querySelector('button'))).toBe(
      false,
    )
    expect(isEditableCopyTarget(null)).toBe(false)
  })
})
