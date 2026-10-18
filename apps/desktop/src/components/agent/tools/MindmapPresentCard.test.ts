// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/components/markdown/MarkmapBlock', () => ({
  MarkmapBlock: ({ source, title }: { source: string; title?: string }) =>
    createElement('div', { 'data-testid': 'markmap-block-mock', 'data-title': title }, source),
}))

import { MindmapPresentCard } from './MindmapPresentCard'

;(globalThis as unknown as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

describe('MindmapPresentCard', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
  })

  async function render(artifact: Parameters<typeof MindmapPresentCard>[0]['artifact']) {
    await act(async () => {
      root.render(createElement(MindmapPresentCard, { artifact }))
      await Promise.resolve()
    })
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0))
    })
  }

  it('把解析出的大纲交给 MarkmapBlock，并暴露节点数', async () => {
    await render({
      title: '导图标题',
      source: '# 根\n- 分支\n',
      nodeCount: 2,
      detailNodeCount: 0,
    })
    const card = container.querySelector('[data-testid="mindmap-present-card"]')
    expect(card).not.toBeNull()
    expect(card?.getAttribute('data-node-count')).toBe('2')
    const block = container.querySelector('[data-testid="markmap-block-mock"]')
    expect(block).not.toBeNull()
    expect(block?.getAttribute('data-title')).toBe('导图标题')
    expect(block?.textContent).toContain('- 分支')
  })
})
