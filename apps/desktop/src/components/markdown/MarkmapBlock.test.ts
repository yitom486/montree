// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MarkmapBlock } from './MarkmapBlock'

;(globalThis as unknown as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

// Mock Markmap view creation to isolate React component behavior from D3/DOM SVG rendering
vi.mock('markmap-view', () => {
  return {
    Markmap: {
      create: vi.fn(() => ({
        setData: vi.fn(),
        fit: vi.fn(),
        rescale: vi.fn(),
        destroy: vi.fn(),
      })),
    },
  }
})

describe('MarkmapBlock', () => {
  let host: HTMLDivElement
  let root: Root

  beforeEach(() => {
    host = document.createElement('div')
    document.body.append(host)
    root = createRoot(host)
  })

  afterEach(() => {
    act(() => root.unmount())
    host.remove()
  })

  it('渲染思维导图容器与 SVG 画布', async () => {
    const md = '# 核心主题\n## 分支 1\n## 分支 2'
    await act(async () => {
      root.render(
        createElement(MarkmapBlock, {
          source: md,
          title: '测试思维导图',
        }),
      )
    })

    const block = host.querySelector('[data-testid="markmap-block"]')
    expect(block).not.toBeNull()
    expect(block?.textContent).toContain('测试思维导图')
    expect(block?.querySelector('[data-testid="markmap-svg"]')).not.toBeNull()
  })

  it('支持在思维导图视图与 Markdown 源码视图间切换', async () => {
    const md = '# 知识大纲\n- 考点一\n- 考点二'
    await act(async () => {
      root.render(
        createElement(MarkmapBlock, {
          source: md,
        }),
      )
    })

    // 默认是图表视图，包含 markmap-svg
    expect(host.querySelector('[data-testid="markmap-svg"]')).not.toBeNull()

    // 找到切换源码按钮并点击
    const codeButton = host.querySelector('button[title="查看源码"]') as HTMLButtonElement
    expect(codeButton).not.toBeNull()

    await act(async () => {
      codeButton.click()
    })

    // 切换为代码视图后，渲染 pre 文本，markmap-svg 卸载
    expect(host.querySelector('[data-testid="markmap-svg"]')).toBeNull()
    expect(host.querySelector('pre')?.textContent).toContain('# 知识大纲')

    // 再次点击切回图表
    const diagramButton = host.querySelector('button[title="查看图谱"]') as HTMLButtonElement
    expect(diagramButton).not.toBeNull()

    await act(async () => {
      diagramButton.click()
    })

    expect(host.querySelector('[data-testid="markmap-svg"]')).not.toBeNull()
  })

  it('支持隐藏工具栏', async () => {
    const md = '# 极简导图'
    await act(async () => {
      root.render(
        createElement(MarkmapBlock, {
          source: md,
          showToolbar: false,
        }),
      )
    })

    expect(host.querySelector('button[title="查看源码"]')).toBeNull()
    expect(host.querySelector('[data-testid="markmap-svg"]')).not.toBeNull()
  })
})
