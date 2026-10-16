// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  DiagramViewerCard,
  type DiagramPayload,
} from './diagram-viewer-card'

;(globalThis as unknown as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

describe('DiagramViewerCard', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(() => {
    act(() => {
      root.unmount()
    })
    container.remove()
  })

  const samplePayload: DiagramPayload = {
    diagramId: 'diag-100',
    diagramType: 'flowchart',
    title: '义和团研究的两种史学范式',
    summary: '从价值评价转向微观社会史发生逻辑',
    anchorExcerpt: '在我个人对义和团运动的研究过程中',
    mermaidCode: 'flowchart TD; A-->B;',
    visualSteps: [
      {
        from: 'Client',
        to: 'Agent',
        action: '传统史学视角',
        desc: '关注功过褒贬',
        anchorExcerpt: '传统评价习惯',
      },
      {
        from: 'Client',
        to: 'Agent',
        action: '微观社会史还原',
        desc: '关注乡村与灾害生态',
        anchorExcerpt: '深入鲁西北乡村',
      },
    ],
  }

  it('渲染标题、标签与流转步骤', async () => {
    await act(async () => {
      root.render(createElement(DiagramViewerCard, { payload: samplePayload }))
    })

    expect(container.textContent).toContain('义和团研究的两种史学范式')
    expect(container.textContent).toContain('流程图')
    expect(container.textContent).toContain('从价值评价转向微观社会史发生逻辑')
    expect(container.textContent).toContain('传统史学视角')
    expect(container.textContent).toContain('微观社会史还原')
  })

  it('点击存为知识卡片按钮触发 onSaveAsKnowledgeCard 并展示保存态', async () => {
    const onSave = vi.fn(async () => true)

    await act(async () => {
      root.render(
        createElement(DiagramViewerCard, {
          payload: samplePayload,
          onSaveAsKnowledgeCard: onSave,
        }),
      )
    })

    const saveBtn = Array.from(container.querySelectorAll('button')).find((b) =>
      b.textContent?.includes('存为知识卡片'),
    )
    expect(saveBtn).toBeDefined()

    await act(async () => {
      saveBtn?.click()
    })

    expect(onSave).toHaveBeenCalledWith(samplePayload)
    expect(container.textContent).toContain('已存为卡片')
  })

  it('点击流转步骤透传原文定位（anchorExcerpt 优先步骤级）', async () => {
    const onHighlight = vi.fn()
    await act(async () => {
      root.render(
        createElement(DiagramViewerCard, {
          payload: samplePayload,
          onHighlightAnchor: onHighlight,
        }),
      )
    })
    const step = Array.from(container.querySelectorAll('div.cursor-pointer')).find((d) =>
      d.textContent?.includes('传统史学视角'),
    ) as HTMLElement
    expect(step).toBeTruthy()
    await act(async () => {
      step.click()
    })
    expect(onHighlight).toHaveBeenCalledWith('传统评价习惯')
  })

  it('固定至正文透传完整 payload（剪贴板写入由调用方完成）', async () => {
    const onPin = vi.fn()
    await act(async () => {
      root.render(
        createElement(DiagramViewerCard, {
          payload: samplePayload,
          onPinToDoc: onPin,
        }),
      )
    })
    const pinBtn = Array.from(container.querySelectorAll('button')).find((b) =>
      b.textContent?.includes('固定至正文'),
    ) as HTMLElement
    expect(pinBtn).toBeTruthy()
    await act(async () => {
      pinBtn.click()
    })
    expect(onPin).toHaveBeenCalledWith(samplePayload)
  })

  it('Mermaid 视图复制按钮写入源码原文', async () => {
    const writeText = vi.fn(async () => undefined)
    Object.defineProperty(window.navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    })
    await act(async () => {
      root.render(createElement(DiagramViewerCard, { payload: samplePayload }))
    })
    const mermaidTab = Array.from(container.querySelectorAll('button')).find((b) =>
      b.textContent?.includes('Mermaid 图'),
    ) as HTMLElement
    await act(async () => {
      mermaidTab.click()
    })
    const copyBtn = Array.from(container.querySelectorAll('button')).find((b) =>
      b.textContent?.includes('复制代码'),
    ) as HTMLElement
    expect(copyBtn).toBeTruthy()
    await act(async () => {
      copyBtn.click()
    })
    expect(writeText).toHaveBeenCalledWith(samplePayload.mermaidCode)
  })
})
