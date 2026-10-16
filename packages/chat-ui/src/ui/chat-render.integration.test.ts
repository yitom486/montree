// @vitest-environment happy-dom
// 包内渲染集成测试（消费者视角）：只从 `@montree/chat-ui` barrel 取渲染件，
// 类型取 `@montree/chat-core`；不用深路径、不用宿主、不改产品代码。
// happy-dom 渲染写法参照 `chat-markdown.test.ts`（IO 桩 + mermaid mock + waitFor 落定）。
import { act, createElement, type ReactElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  ChatMessageBubble,
  ComponentUiCard,
  HtmlArtifactCard,
  ReactArtifactCard,
  useChatTimeline,
  type AgentApprovalPending,
  type ChatMarkdownTheme,
  type GenerativeSubmitPayload,
  type ResolveMarkProposal,
} from '@montree/chat-ui'
import {
  groupChatTimeline,
  type ChatMessage,
  type ChatTimelineItem,
} from '@montree/chat-core'

;(globalThis as unknown as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

// 参照 chat-markdown.test.ts：happy-dom 无布局，只给 observer；mermaid 走确定性桩。
vi.stubGlobal('IntersectionObserver', class {
  constructor(private callback: IntersectionObserverCallback) {}
  observe(target: Element) { this.callback([{ isIntersecting: true, target } as IntersectionObserverEntry], this as unknown as IntersectionObserver) }
  disconnect() {}
  unobserve() {}
  takeRecords() { return [] }
})
vi.mock('@streamdown/mermaid', () => ({ createMermaidPlugin: () => ({
  name: 'mermaid', type: 'diagram', language: 'mermaid',
  getMermaid: () => ({ initialize() {}, render: async () => ({ svg: '<svg xmlns="http://www.w3.org/2000/svg"><text>A to B</text></svg>' }) }),
}) }))

const NOW = 1700000000000

let mounted: Array<{ container: HTMLDivElement; root: Root }>

beforeEach(() => {
  mounted = []
})

afterEach(() => {
  for (const h of mounted.splice(0)) {
    act(() => {
      h.root.unmount()
    })
    h.container.remove()
  }
})

function mount(node: ReactElement): HTMLDivElement {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  mounted.push({ container, root })
  act(() => {
    root.render(node)
  })
  return container
}

async function mountAsync(node: ReactElement): Promise<HTMLDivElement> {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  mounted.push({ container, root })
  await act(async () => {
    root.render(node)
  })
  return container
}

function toolMessage(overrides: Partial<ChatMessage>): ChatMessage {
  return {
    id: 'tool-base',
    role: 'tool',
    text: '',
    createdAt: NOW,
    updatedAt: NOW + 10,
    ...overrides,
  }
}

// work-log 组装留宿主：宿主侧按分组数据自渲染，此处只放占位并回传分组结果。
function TimelineView({
  messages,
  onItems,
  resolveMarkProposal,
}: {
  messages: ChatMessage[]
  onItems: (items: ChatTimelineItem[]) => void
  resolveMarkProposal: ResolveMarkProposal
}) {
  const items = useChatTimeline(messages, { nowMs: NOW })
  onItems(items)
  return createElement(
    'div',
    null,
    items.map((item) =>
      item.kind === 'message'
        ? createElement(ChatMessageBubble, {
            key: item.key,
            message: item.message,
            resolveMarkProposal,
            pendingPermission: null,
          })
        : createElement(
            'div',
            {
              key: item.key,
              'data-testid': 'work-log',
              'data-tool-count': String(item.toolCallCount),
              'data-turn': item.turnKey,
            },
            `工作记录:${item.toolCallCount}个调用`,
          ),
    ),
  )
}

describe('chat-render 集成（真实数据流）', () => {
  it('时间线：同一 user 回合多 tool 并为 work-log，message 项走真实气泡', { timeout: 25000 }, async () => {
    const messages: ChatMessage[] = [
      { id: 'u-tl-1', role: 'user', text: '查一下这两处实现', createdAt: NOW },
      toolMessage({
        id: 't-tl-1', toolCallId: 'tc-tl-1', toolKind: 'read',
        toolTitle: 'read_text_file', toolStatus: 'completed', toolContentText: 'const a = 1',
      }),
      toolMessage({
        id: 't-tl-2', toolCallId: 'tc-tl-2', toolKind: 'search', createdAt: NOW + 10, updatedAt: NOW + 20,
        toolTitle: 'search', toolStatus: 'completed', toolContentText: '命中 3 处',
      }),
      { id: 'a-tl-1', role: 'agent', text: '已查到两处实现细节。', createdAt: NOW + 30 },
    ]
    const resolveMarkProposal = vi.fn()
    let captured: ChatTimelineItem[] = []
    const container = await mountAsync(
      createElement(TimelineView, {
        messages,
        onItems: (items) => {
          captured = items
        },
        resolveMarkProposal,
      }),
    )

    // 分组数据：kind 序列 / count / 回合归属（与 core 纯函数 deep-equal，防 hook 漂移）
    expect(captured).toEqual(groupChatTimeline(messages, { nowMs: NOW }))
    expect(captured.map((i) => i.kind)).toEqual(['message', 'work-log', 'message'])
    const workLog = captured[1]
    expect(workLog?.kind).toBe('work-log')
    if (workLog?.kind !== 'work-log') throw new Error('work-log 项缺失')
    expect(workLog.toolCallCount).toBe(2)
    expect(workLog.completedCount).toBe(2)
    expect(workLog.messages.map((m) => m.id)).toEqual(['t-tl-1', 't-tl-2'])
    expect(workLog.turnKey).toBe('turn:default:u-tl-1')
    expect(workLog.lastEvent).toEqual({ title: '搜索文档', ok: true })
    expect(workLog.isActive).toBe(false)

    // work-log 占位（宿主侧渲染位）与 message 气泡真实挂载
    expect(container.querySelector('[data-testid="work-log"]')?.getAttribute('data-tool-count')).toBe('2')
    expect(container.querySelector('[data-testid="work-log"]')?.getAttribute('data-turn')).toBe('turn:default:u-tl-1')
    expect(container.textContent).toContain('查一下这两处实现')
    await vi.waitFor(
      () => {
        expect(container.textContent).toContain('已查到两处实现细节。')
      },
      { timeout: 20000 },
    )
    await act(async () => {})
    expect(resolveMarkProposal).not.toHaveBeenCalled()
  })

  it('富文本：代码围栏/表格渲染，流式经揭示最终落定全文', { timeout: 25000 }, async () => {
    const MARKER = '落定全文标记STREAMEND'
    const rich = [
      '结论先行：本轮已核对两处实现。',
      '',
      '```ts',
      'const answer = 42',
      '```',
      '',
      '```mermaid',
      'graph TD; A-->B',
      '```',
      '',
      '行内公式 $E=mc^2$ 如上。',
      '',
      '| 甲 | 乙 |',
      '|---|---|',
      '| 1 | 2 |',
      '',
      MARKER,
    ].join('\n')
    const message: ChatMessage = { id: 'a-rich-1', role: 'agent', text: rich, createdAt: NOW, streaming: true }
    const container = mount(
      createElement(ChatMessageBubble, {
        message,
        resolveMarkProposal: vi.fn(),
        pendingPermission: null,
      }),
    )
    // 只断言最终落定（揭示中间态不做 flicker 断言）
    await vi.waitFor(
      () => {
        expect(container.textContent).toContain(MARKER)
      },
      { timeout: 20000 },
    )
    // mermaid 插件异步挂载：补一拍再断言（参照 chat-markdown.test.ts 的等待模式）
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 500))
    })
    expect(container.querySelector('[data-streamdown=code-block] code')?.textContent).toContain('const answer = 42')
    expect(container.querySelector('table')).not.toBeNull()
    expect([...container.querySelectorAll('table td')].map((td) => td.textContent)).toContain('2')
    expect(container.querySelectorAll('.katex').length).toBeGreaterThan(0)
    expect(container.querySelector('[data-streamdown="mermaid-block"]')).not.toBeNull()
  })

  it('工具状态：四态中文可读且互不串味', () => {
    const cases: Array<{ message: ChatMessage; label: string; absent: string[] }> = [
      {
        message: toolMessage({
          id: 'tool-st-pending', toolCallId: 'tc-st-pending', toolKind: 'read',
          toolTitle: 'read_text_file', toolStatus: 'pending', streaming: true,
        }),
        label: '等待执行',
        absent: ['已完成', '失败'],
      },
      {
        message: toolMessage({
          id: 'tool-st-running', toolCallId: 'tc-st-running', toolKind: 'search',
          toolTitle: 'search_docs', toolStatus: 'in_progress', streaming: true,
        }),
        label: '执行中',
        absent: ['已完成', '失败'],
      },
      {
        message: toolMessage({
          id: 'tool-st-done', toolCallId: 'tc-st-done', toolKind: 'read',
          toolTitle: 'read_text_file', toolStatus: 'completed', toolContentText: 'const a = 1',
        }),
        label: '已完成',
        absent: ['失败', '执行中'],
      },
      {
        message: toolMessage({
          id: 'tool-st-failed', toolCallId: 'tc-st-failed', toolKind: 'edit',
          toolTitle: 'write_text_file', toolStatus: 'failed', toolContentText: '写入失败：磁盘只读',
        }),
        label: '失败',
        absent: ['已完成'],
      },
    ]
    for (const c of cases) {
      const container = mount(
        createElement(ChatMessageBubble, {
          message: c.message,
          resolveMarkProposal: vi.fn(),
          pendingPermission: null,
        }),
      )
      expect(container.textContent).toContain(c.label)
      for (const bad of c.absent) {
        expect(container.textContent).not.toContain(bad)
      }
    }
  })

  it('审批链：命中 toolCallId 浮出审批卡，点击上报选项 id', () => {
    const pending: AgentApprovalPending = {
      requestId: 9,
      summary: '删除文件确认',
      toolCallId: 'tc-approve-1',
      options: [
        { optionId: 'allow-once', name: '允许删除', kind: 'allow_once' },
        { optionId: 'reject-once', name: '拒绝', kind: 'reject_once' },
      ],
    }
    const message = toolMessage({
      id: 'tool-approve-1', toolCallId: 'tc-approve-1', toolKind: 'delete',
      toolTitle: 'delete_file', text: 'delete_file', toolStatus: 'pending',
    })
    // 分组侧：待审批工具提升为单条，不被 work-log 折叠吞掉
    const items = groupChatTimeline(
      [{ id: 'u-ap-1', role: 'user', text: '删了吧', createdAt: NOW }, message],
      { pendingToolCallId: 'tc-approve-1', nowMs: NOW },
    )
    expect(items.map((i) => i.kind)).toEqual(['message', 'message'])

    const onPermissionRespond = vi.fn()
    const container = mount(
      createElement(ChatMessageBubble, {
        message,
        resolveMarkProposal: vi.fn(),
        pendingPermission: pending,
        onPermissionRespond,
      }),
    )
    const card = container.querySelector('[data-testid="agent-permission-card"]')
    expect(card).not.toBeNull()
    expect(container.textContent).toContain('删除文件确认')
    expect(container.textContent).toContain('等待批准')
    expect(onPermissionRespond).not.toHaveBeenCalled()
    const firstOption = card!.querySelector('button') as HTMLElement
    act(() => {
      firstOption.click()
    })
    expect(onPermissionRespond).toHaveBeenCalledTimes(1)
    expect(onPermissionRespond).toHaveBeenCalledWith('allow-once')
    expect(typeof onPermissionRespond.mock.calls[0]![0]).toBe('string')
  })

  it('present：component-ui 真树渲染并提交选择载荷', () => {
    const uiResult: Parameters<typeof ComponentUiCard>[0]['result'] = {
      schemaVersion: 1,
      kind: 'component-ui',
      id: 'present-component-ui-integ01',
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
            { component: 'Button', props: { label: '继续分析', action: 'submit-selection' } },
          ],
        },
      },
    }
    const onSubmit = vi.fn()
    const onLocateChapter = vi.fn()
    const container = mount(
      createElement(ComponentUiCard, {
        result: uiResult,
        threadId: 'thread-integ-1',
        onSubmit,
        onLocateChapter,
      }),
    )
    // 真实 GenerativeUIRender 走官方渲染器：树按描述挂载（非硬编码断言见顺序无关的文本存在）
    expect(container.querySelector('[data-testid="component-ui-card"]')).not.toBeNull()
    expect(container.textContent).toContain('请选择对比维度')
    expect(container.textContent).toContain('论证方法')
    const option = [...container.querySelectorAll('button')].find((b) =>
      b.textContent?.includes('论证方法'),
    ) as HTMLElement
    act(() => {
      option.click()
    })
    const submit = [...container.querySelectorAll('button')].find((b) =>
      b.textContent?.includes('继续分析'),
    ) as HTMLElement
    act(() => {
      submit.click()
    })
    expect(onSubmit).toHaveBeenCalledTimes(1)
    const payload = onSubmit.mock.calls[0]![0] as GenerativeSubmitPayload
    expect(Object.keys(payload).sort()).toEqual(
      ['displayText', 'promptText', 'resultId', 'selections', 'threadId', 'title'].sort(),
    )
    expect(payload).toMatchObject({
      resultId: 'present-component-ui-integ01',
      threadId: 'thread-integ-1',
      title: '两章对比选择',
      selections: { dim: 'method' },
    })
    expect(payload.promptText).toContain('generative-ui-submit')
    expect(payload.displayText).toContain('两章对比选择')

    // 未知组件只降级当前卡（Fallback 路径真实存在）
    const unknown = mount(
      createElement(ComponentUiCard, {
        result: {
          ...uiResult,
          id: 'present-component-ui-integ02',
          ui: { root: { component: 'Map' as never, props: {} } },
        },
        threadId: 'thread-integ-1',
        onSubmit: vi.fn(),
      }),
    )
    expect(unknown.textContent).toContain('未知组件')
  })

  it('present：react-artifact 编译挂帧，导出携带 html 与标题', async () => {
    const SOURCE = 'export default function App(){ return "计数" }'
    const FIXED_HTML = '<div id="root">compiled-ok</div>'
    const onCompile = vi.fn(async (source: string) => ({ ok: true as const, value: FIXED_HTML }))
    const onExport = vi.fn()
    const container = mount(
      createElement(ReactArtifactCard, {
        result: {
          schemaVersion: 1,
          kind: 'react-artifact',
          id: 'present-react-integ-01',
          title: '计数器',
          source: SOURCE,
        },
        onCompile,
        onExport,
      }),
    )
    await act(async () => {})
    expect(onCompile).toHaveBeenCalledTimes(1)
    expect(onCompile.mock.calls[0]![0]).toBe(SOURCE)
    const frame = container.querySelector('iframe[data-testid="react-inline-frame"]')
    expect(frame).not.toBeNull()
    expect(frame?.getAttribute('srcdoc')).toContain('compiled-ok')

    const toggle = [...container.querySelectorAll('button')].find((b) =>
      b.textContent?.includes('查看源码'),
    ) as HTMLElement
    act(() => {
      toggle.click()
    })
    expect(container.querySelector('[data-testid="react-artifact-source"]')?.textContent).toContain(
      'export default function App',
    )
    const exp = [...container.querySelectorAll('button')].find((b) =>
      b.textContent?.includes('导出 HTML'),
    ) as HTMLElement
    await act(async () => {
      exp.click()
    })
    // 实际签名 onExport(html, title)：断言双参数形状
    expect(onExport).toHaveBeenCalledTimes(1)
    expect(onExport).toHaveBeenCalledWith(FIXED_HTML, '计数器')
  })

  it('present：html-artifact 卡渲染成功，导出走无参宿主回调', async () => {
    const onExport = vi.fn()
    const container = mount(
      createElement(HtmlArtifactCard, {
        result: {
          schemaVersion: 1,
          kind: 'html-artifact',
          id: 'present-html-integ-01',
          title: '计数器',
          summary: '离线小应用',
          documentFingerprint: '/books/a.epub',
          html: '<p>hi</p>',
        },
        onExport,
      }),
    )
    expect(container.querySelector('[data-testid="html-artifact-card"]')).not.toBeNull()
    expect(container.textContent).toContain('计数器')
    const exp = [...container.querySelectorAll('button')].find((b) =>
      b.textContent?.includes('导出 HTML'),
    ) as HTMLElement
    await act(async () => {
      exp.click()
    })
    // 实际签名 onExport()：无载荷，只断调用一次（与 react 卡签名不同，见包 README 回调表）
    expect(onExport).toHaveBeenCalledTimes(1)
    expect(onExport.mock.calls[0]).toEqual([])
  })

  it('主题：theme="dark" 渲染成功（颜色不断言，由 E2E 覆盖）', { timeout: 25000 }, async () => {
    const theme: ChatMarkdownTheme = 'dark'
    const container = await mountAsync(
      createElement(ChatMessageBubble, {
        message: {
          id: 'a-dark-1',
          role: 'agent',
          text: '深色主题下的**加粗**正文。',
          createdAt: NOW,
        },
        resolveMarkProposal: vi.fn(),
        pendingPermission: null,
        theme,
      }),
    )
    await vi.waitFor(
      () => {
        expect(container.querySelector('strong')?.textContent).toBe('加粗')
      },
      { timeout: 20000 },
    )
    await act(async () => {})
    expect(container.textContent).toContain('深色主题下的')
  })
})
