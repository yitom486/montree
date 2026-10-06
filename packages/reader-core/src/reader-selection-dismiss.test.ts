// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest'
import {
  isReaderOverlayUiTarget,
  isReaderSelectionToolbarTarget,
} from '@montree/reader-core'

function div(html: string): HTMLElement {
  const host = document.createElement('div')
  host.innerHTML = html
  document.body.appendChild(host)
  const first = host.firstElementChild
  if (!(first instanceof HTMLElement)) throw new Error('bad fixture')
  return first
}

describe('isReaderOverlayUiTarget', () => {
  it('Agent 面板根与其输入框不触发清选区', () => {
    const panel = div(
      '<aside aria-label="Agent 聊天" data-keep-reader-selection><div><textarea></textarea></div></aside>',
    )
    expect(panel.getAttribute('aria-label')).toBe('Agent 聊天')
    expect(isReaderOverlayUiTarget(panel)).toBe(true)
    const input = panel.querySelector('textarea')
    expect(isReaderOverlayUiTarget(input)).toBe(true)
  })

  it('普通侧栏节点仍触发清选区', () => {
    const tree = div('<div aria-label="文件树"><div><span>note.md</span></div></div>')
    const leaf = tree.querySelector('span')
    expect(isReaderOverlayUiTarget(tree)).toBe(false)
    expect(isReaderOverlayUiTarget(leaf)).toBe(false)
  })

  it('[role=dialog] 豁免回归', () => {
    const dialog = div('<div role="dialog"><button>确定</button></div>')
    expect(isReaderOverlayUiTarget(dialog.querySelector('button'))).toBe(true)
  })

  it('选区工具条仍走自己的豁免判定', () => {
    const bar = div('<div aria-label="选区操作"><button>问 Agent</button></div>')
    expect(isReaderSelectionToolbarTarget(bar.querySelector('button'))).toBe(true)
    expect(isReaderOverlayUiTarget(bar.querySelector('button'))).toBe(false)
  })
})
