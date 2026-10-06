// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  DiagramViewerCard,
  type DiagramPayload,
} from './DiagramViewerCard'
import { buildNoteFromDiagram } from './AgentToolCallCard'

;(globalThis as unknown as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

describe('buildNoteFromDiagram', () => {
  it('正确将 DiagramPayload 整合为结构化 Markdown', () => {
    const payload: DiagramPayload = {
      diagramId: 'diag-1',
      diagramType: 'flowchart',
      title: '历史范式对比',
      summary: '对比两种史学视角',
      mermaidCode: 'graph TD; A-->B;',
      visualSteps: [
        { from: 'Client', to: 'Agent', action: '价值评价', desc: '传统视角' },
        { from: 'Client', to: 'Agent', action: '发生逻辑', desc: '现代微观史学' },
      ],
    }

    const note = buildNoteFromDiagram(payload)
    expect(note).toContain('> **核心解读**：对比两种史学视角')
    expect(note).toContain('### 推演流转步骤')
    expect(note).toContain('1. **价值评价**：传统视角')
    expect(note).toContain('2. **发生逻辑**：现代微观史学')
    expect(note).toContain('```mermaid\ngraph TD; A-->B;\n```')
  })
})

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
})
