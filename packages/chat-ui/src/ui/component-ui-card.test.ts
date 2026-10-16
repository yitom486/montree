// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ComponentUiCard, buildGenerativeSubmitTexts } from './component-ui-card'
import type { PresentComponentUi } from '@montree/contracts'

;(globalThis as unknown as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

function result(overrides: Partial<PresentComponentUi> = {}): PresentComponentUi {
  return {
    schemaVersion: 1,
    kind: 'component-ui',
    id: 'present-component-ui-test01',
    title: '两章对比选择',
    documentFingerprint: '/books/a.epub',
    documentLabel: 'a.epub',
    chapters: [
      { key: 'c1', label: '第一章', flatIndex: 0 },
      { key: 'c2', label: '第二章', flatIndex: 1 },
    ],
    ui: {
      root: {
        component: 'Column',
        children: [
          { component: 'Text', props: { text: '请选择对比维度', variant: 'title' } },
          {
            component: 'Select',
            props: {
              id: 'dim',
              label: '对比维度',
              options: [
                { value: 'method', label: '论证方法' },
                { value: 'evidence', label: '证据运用' },
              ],
            },
          },
          {
            component: 'Row',
            children: [
              { component: 'Evidence', props: { excerpt: '甲论点原文', chapterKey: 'c1' } },
              { component: 'Evidence', props: { excerpt: '乙论点原文', chapterKey: 'c2' } },
            ],
          },
          { component: 'Button', props: { label: '继续分析', action: 'submit-selection' } },
        ],
      },
    },
    ...overrides,
  }
}

describe('ComponentUiCard', () => {
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

  function renderCard(value = result(), props: Record<string, unknown> = {}) {
    act(() => {
      root.render(
        createElement(ComponentUiCard, {
          result: value,
          threadId: 'thread-1',
          onSubmit: vi.fn(),
          onLocateChapter: vi.fn(),
          ...props,
        } as never),
      )
    })
  }

  it('树按描述渲染：布局来自模型而非硬编码（换顺序改变布局）', () => {
    renderCard()
    expect(container.textContent).toContain('请选择对比维度')
    expect(container.textContent).toContain('论证方法')
    expect(container.textContent).toContain('甲论点原文')
    expect(container.textContent).toContain('继续分析')
    // 换子组件顺序：Select 与 Evidence 对调后仍按树渲染
    const swapped = result({
      ui: {
        root: {
          component: 'Column',
          children: [
            { component: 'Evidence', props: { excerpt: '乙论点原文', chapterKey: 'c2' } },
            {
              component: 'Select',
              props: { id: 'dim', options: [{ value: 'x', label: 'X项' }] },
            },
          ],
        },
      },
    })
    renderCard(swapped)
    const order = container.textContent ?? ''
    expect(order.indexOf('乙论点原文')).toBeLessThan(order.indexOf('X项'))
  })

  it('选择后提交一次，携带 resultId 与选择', () => {
    const onSubmit = vi.fn()
    renderCard(result(), { onSubmit })
    const option = [...container.querySelectorAll('button')].find((b) =>
      b.textContent?.includes('论证方法'),
    ) as HTMLElement
    act(() => {
      option.click()
    })
    expect(option.isConnected).toBe(true)
    const submit = [...container.querySelectorAll('button')].find((b) =>
      b.textContent?.includes('继续分析'),
    ) as HTMLElement
    act(() => {
      submit.click()
    })
    expect(onSubmit).toHaveBeenCalledTimes(1)
    const payload = onSubmit.mock.calls[0]![0] as { resultId: string; selections: Record<string, string>; promptText: string }
    expect(payload.resultId).toBe('present-component-ui-test01')
    expect(payload.selections).toEqual({ dim: 'method' })
    expect(payload.promptText).toContain('generative-ui-submit')
  })

  it('busy 时提交禁用', () => {
    renderCard(result(), { prompting: true })
    const submit = [...container.querySelectorAll('button')].find((b) =>
      b.textContent?.includes('继续分析'),
    ) as HTMLButtonElement
    expect(submit.disabled).toBe(true)
  })

  it('异步提交未结束时快速点击不会重复发送', async () => {
    let finish!: () => void
    const onSubmit = vi.fn(() => new Promise<void>(resolve => { finish = resolve }))
    renderCard(result(), { onSubmit })
    const submit = [...container.querySelectorAll('button')].find(button => button.textContent?.includes('继续分析'))!
    act(() => { submit.click(); submit.click() })
    expect(onSubmit).toHaveBeenCalledTimes(1)
    expect(submit.disabled).toBe(true)
    await act(async () => { finish() })
    expect(submit.disabled).toBe(false)
  })

  it('同结果更新不重置选择（节点 key 稳定）', () => {
    const onSubmit = vi.fn()
    renderCard(result(), { onSubmit })
    const option = [...container.querySelectorAll('button')].find((b) =>
      b.textContent?.includes('证据运用'),
    ) as HTMLElement
    act(() => {
      option.click()
    })
    renderCard(result({ summary: '补充说明' }), { onSubmit })
    const submit = [...container.querySelectorAll('button')].find((b) =>
      b.textContent?.includes('继续分析'),
    ) as HTMLElement
    act(() => {
      submit.click()
    })
    expect(onSubmit.mock.calls[0]![0].selections).toEqual({ dim: 'evidence' })
  })

  it('证据定位走宿主回调，未知组件只降级当前卡', () => {
    const onLocateChapter = vi.fn()
    renderCard(result(), { onLocateChapter })
    const locate = [...container.querySelectorAll('button')].find((b) =>
      b.textContent?.includes('定位原文'),
    ) as HTMLElement
    act(() => {
      locate.click()
    })
    expect(onLocateChapter).toHaveBeenCalledWith(0, '甲论点原文')
    // 未知组件 Fallback
    renderCard(
      result({ ui: { root: { component: 'Map' as never, props: {} } } }),
    )
    expect(container.textContent).toContain('未知组件')
  })

  it('提交文案纯函数：可读说明与回写输入', () => {
    const { displayText, promptText } = buildGenerativeSubmitTexts(
      { id: 'r1', title: '对比' },
      { dim: 'method' },
    )
    expect(displayText).toContain('对比')
    expect(promptText).toContain('r1')
    expect(promptText).not.toContain('function')
  })
})
