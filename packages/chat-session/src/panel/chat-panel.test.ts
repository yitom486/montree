// @vitest-environment happy-dom
// S2 面板测试（消费者视角）：只从两包 barrel 进——
// `createChatSessionStore + ChatPanel + 类型` 经 `@montree/chat-session`，
// `ChatMessage` 类型经 `@montree/chat-core`；不用深路径、不用宿主。
// 渲染写法参照 chat-ui `agent-message-bubble.test.ts`（createRoot + act）。
import { act, createElement as h } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  ChatPanel,
  createChatSessionStore,
  type ChatTransportPort,
} from '@montree/chat-session'

;(globalThis as unknown as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

// 参照 chat-ui 单测：happy-dom 无布局，只给 observer；mermaid 走确定性桩。
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

function harness(transport?: ChatTransportPort) {
  let n = 0
  let t = 1000
  return {
    createId: (role: string) => `${role}-${n++}`,
    now: () => t++,
    ...(transport ? { transport } : {}),
  }
}

function mockTransport() {
  return {
    sendText: vi.fn(async (_threadId: string, _text: string) => {}),
    cancel: vi.fn(async (_threadId: string) => {}),
    respondPermission: vi.fn(async (_requestId: number, _optionId: string | null) => {}),
  }
}

let mounted: Array<{ container: HTMLDivElement; root: Root }>

beforeEach(() => {
  mounted = []
})

afterEach(() => {
  for (const m of mounted.splice(0)) {
    act(() => {
      m.root.unmount()
    })
    m.container.remove()
  }
})

function mountPanel(props: Parameters<typeof ChatPanel>[0]): HTMLDivElement {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  mounted.push({ container, root })
  act(() => {
    root.render(h(ChatPanel, props))
  })
  return container
}

function setTextarea(input: HTMLTextAreaElement, text: string): void {
  const setter = Object.getOwnPropertyDescriptor(
    window.HTMLTextAreaElement.prototype,
    'value',
  )!.set!
  setter.call(input, text)
  input.dispatchEvent(new Event('input', { bubbles: true }))
}

function composerInput(container: HTMLElement): HTMLTextAreaElement {
  const el = container.querySelector('[data-testid="chat-composer-input"]')
  if (!(el instanceof HTMLTextAreaElement)) throw new Error('composer input 缺失')
  return el
}

function composerSend(container: HTMLElement): HTMLButtonElement {
  const el = container.querySelector('[data-testid="chat-composer-send"]')
  if (!(el instanceof HTMLButtonElement)) throw new Error('composer send 缺失')
  return el
}

const RUNTIMES = [{ id: 'codex-acp', name: 'Codex' }]

describe('ChatPanel (a) composer 发送', () => {
  it('输入发送 → 本地 user 气泡出现 + transport.sendText 被调', () => {
    const transport = mockTransport()
    const store = createChatSessionStore({ ...harness(transport), transport })
    const container = mountPanel({ store, runtimes: RUNTIMES })

    const input = composerInput(container)
    act(() => {
      setTextarea(input, '你好面板')
    })
    act(() => {
      composerSend(container).click()
    })

    expect(container.textContent).toContain('你好面板')
    expect(transport.sendText).toHaveBeenCalledTimes(1)
    expect(transport.sendText).toHaveBeenCalledWith('thread-0', '你好面板')
  })

  it('Enter 发送、Shift+Enter 不发送', () => {
    const transport = mockTransport()
    const store = createChatSessionStore({ ...harness(transport), transport })
    const container = mountPanel({ store, runtimes: RUNTIMES })

    const input = composerInput(container)
    act(() => {
      setTextarea(input, '换行不发')
    })
    act(() => {
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', shiftKey: true, bubbles: true, cancelable: true }))
    })
    expect(transport.sendText).not.toHaveBeenCalled()

    act(() => {
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }))
    })
    expect(transport.sendText).toHaveBeenCalledTimes(1)
    expect(transport.sendText).toHaveBeenCalledWith('thread-0', '换行不发')
  })
})

describe('ChatPanel (b) agent 流 + 工具 + 审批', () => {
  // agent 正文走 streamdown 懒分块：放宽本用例时钟，只补等待不断言细节布局。
  it('渲染出 bubble/工具态/审批卡；点审批透传 respondPermission', { timeout: 20000 }, async () => {
    const transport = mockTransport()
    const store = createChatSessionStore({ ...harness(transport), transport })
    store.appendUser('查一下')
    store.beginReply()
    store.ingestTextChunk('正在查阅文档')
    store.ingestToolCall({ toolCallId: 't1', title: '删文件', kind: 'delete', status: 'pending' })
    store.requestPermission({
      requestId: 9,
      summary: '允许删除文件？',
      options: [
        { optionId: 'allow', name: '允许', kind: 'allow_once' },
        { optionId: 'reject', name: '拒绝', kind: 'reject_once' },
      ],
      toolCallId: 't1',
      toolCall: { title: '删文件', kind: 'delete', status: 'pending' },
    })

    // 正文懒分块先预热，再挂载等待落定（生产首屏不受影响）。
    await import('@montree/chat-ui/lazy')
    const container = mountPanel({ store, runtimes: RUNTIMES })
    await vi.waitFor(
      () => {
        expect(container.textContent).toContain('正在查阅文档')
      },
      { timeout: 20000 },
    )
    await act(async () => {})

    // 工具态（待审批工具单条提升为工具卡，不被 work-log 折叠吞掉）
    expect(container.textContent).toContain('删文件')
    // 审批卡（包内审批件）
    const card = container.querySelector('[data-testid="agent-permission-card"]')
    expect(card).not.toBeNull()

    act(() => {
      card!.querySelector('button')!.click()
    })
    expect(transport.respondPermission).toHaveBeenCalledTimes(1)
    expect(transport.respondPermission).toHaveBeenCalledWith(9, 'allow')
    // 本地 pending 已清（卡片撤下）
    expect(container.querySelector('[data-testid="agent-permission-card"]')).toBeNull()
  })
})

describe('ChatPanel (c) 模型行', () => {
  it('runtime select 切换 → store modelConfig 变；无 thoughtOptions 不渲染思考档', () => {
    const store = createChatSessionStore(harness())
    const container = mountPanel({
      store,
      runtimes: [
        { id: 'codex-acp', name: 'Codex' },
        { id: 'r2', name: 'R2' },
      ],
    })

    const runtime = container.querySelector('[data-testid="chat-runtime-select"]')
    if (!(runtime instanceof HTMLSelectElement)) throw new Error('runtime select 缺失')
    expect(runtime.value).toBe('codex-acp')
    act(() => {
      runtime.value = 'r2'
      runtime.dispatchEvent(new Event('change', { bubbles: true }))
    })
    expect(store.getState().modelConfig.runtimeId).toBe('r2')
    expect(store.getState().modelConfig.modelId).toBeUndefined()

    expect(container.querySelector('[data-testid="chat-thinking-select"]')).toBeNull()
  })

  it('思考档 select 切换 → thinkingLevel 变', () => {
    const store = createChatSessionStore(harness())
    const container = mountPanel({ store, runtimes: RUNTIMES, thoughtOptions: ['low', 'high'] })

    const thinking = container.querySelector('[data-testid="chat-thinking-select"]')
    if (!(thinking instanceof HTMLSelectElement)) throw new Error('thinking select 缺失')
    act(() => {
      thinking.value = 'high'
      thinking.dispatchEvent(new Event('change', { bubbles: true }))
    })
    expect(store.getState().modelConfig.thinkingLevel).toBe('high')
  })
})

describe('ChatPanel 无 transport 仅本地落子', () => {
  it('发送不抛、user 气泡 + agent 占位本地可见', () => {
    const store = createChatSessionStore(harness())
    const container = mountPanel({ store, runtimes: RUNTIMES })

    act(() => {
      setTextarea(composerInput(container), '离线消息')
    })
    act(() => {
      composerSend(container).click()
    })

    expect(container.textContent).toContain('离线消息')
    const state = store.getState()
    const thread = state.threads.find((t) => t.id === state.activeThreadId)!
    expect(thread.feed.messages.map((m) => m.role)).toEqual(['user', 'agent'])
    expect(thread.feed.messages[0]!.text).toBe('离线消息')
  })
})

describe('ChatPanel (P2a) slots 补齐', () => {
  it('富工具消息 + renderBusinessResult → slot 节点出现', () => {
    const transport = mockTransport()
    const store = createChatSessionStore({ ...harness(transport), transport })
    store.appendUser('画个架构图')
    store.ingestToolCall({
      toolCallId: 't-rich-p2a',
      title: 'montree_generate_diagram',
      kind: 'other',
      status: 'completed',
      contentText: JSON.stringify({ mermaidCode: 'graph TD; A-->B' }),
    })
    const container = mountPanel({
      store,
      runtimes: RUNTIMES,
      renderBusinessResult: (_message, opts) => h('div', { 'data-testid': 'slot-br', 'data-thread': opts.threadId }),
    })
    // 富结果走独立入口壳，宿主槽节点挂在入口内
    expect(container.querySelector('[data-acp-probe="result"]')).not.toBeNull()
    expect(container.querySelector('[data-testid="slot-br"]')).not.toBeNull()
    expect(container.querySelector('[data-testid="slot-br"]')?.getAttribute('data-thread')).toBe(store.getState().activeThreadId)
  })

  it('component-ui 工具 + onGenerativeSubmit → 结果入口存在（完整卡提交不断言）', () => {
    const transport = mockTransport()
    const store = createChatSessionStore({ ...harness(transport), transport })
    const present = {
      schemaVersion: 1,
      kind: 'component-ui',
      id: 'present-p2a-01',
      title: '两章对比选择',
      documentFingerprint: '/books/a.epub',
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
    store.appendUser('对比这两章')
    store.ingestToolCall({
      toolCallId: 't-present-p2a',
      title: 'montree_present',
      kind: 'other',
      status: 'completed',
      contentText: JSON.stringify(present),
    })
    const onGenerativeSubmit = vi.fn()
    const container = mountPanel({ store, runtimes: RUNTIMES, onGenerativeSubmit })
    // 包内只给结果入口壳，完整 component-ui 卡由宿主 renderBusinessResult 槽自备：
    // 此处只断言入口存在，不模拟卡内选择提交。
    expect(container.querySelector('[data-acp-probe="result"]')).not.toBeNull()
    expect(onGenerativeSubmit).not.toHaveBeenCalled()
  })
})

describe('ChatPanel (P3 追加) onRuntimeChange', () => {
  it('缺省不传：切换仅写 modelConfig（默认行为不变）', () => {
    const store = createChatSessionStore(harness())
    const container = mountPanel({
      store,
      runtimes: [
        { id: 'codex-acp', name: 'Codex' },
        { id: 'r2', name: 'R2' },
      ],
    })

    const runtime = container.querySelector('[data-testid="chat-runtime-select"]')
    if (!(runtime instanceof HTMLSelectElement)) throw new Error('runtime select 缺失')
    act(() => {
      runtime.value = 'r2'
      runtime.dispatchEvent(new Event('change', { bubbles: true }))
    })
    expect(store.getState().modelConfig.runtimeId).toBe('r2')
  })

  it('传入 onRuntimeChange：先 selectRuntime 再回调 runtimeId（线程亲和由应用侧管理）', () => {
    const store = createChatSessionStore(harness())
    const onRuntimeChange = vi.fn()
    const container = mountPanel({
      store,
      runtimes: [
        { id: 'codex-acp', name: 'Codex' },
        { id: 'r2', name: 'R2' },
      ],
      onRuntimeChange,
    })

    const runtime = container.querySelector('[data-testid="chat-runtime-select"]')
    if (!(runtime instanceof HTMLSelectElement)) throw new Error('runtime select 缺失')
    act(() => {
      runtime.value = 'r2'
      runtime.dispatchEvent(new Event('change', { bubbles: true }))
    })
    expect(store.getState().modelConfig.runtimeId).toBe('r2')
    expect(onRuntimeChange).toHaveBeenCalledTimes(1)
    expect(onRuntimeChange).toHaveBeenCalledWith('r2')
  })
})

describe('ChatPanel 共享工作记录接线', () => {
  it('完成后的工作记录可展开计划和工具详情，生成式提交携带当前线程且槽不重复', () => {
    const store = createChatSessionStore(harness())
    const threadId = store.getState().activeThreadId!
    store.appendUser('检查章节')
    store.ingestPlan([{ content: '阅读章节', status: 'completed' }], false)
    store.ingestToolCall({ toolCallId: 'work-tool', title: 'read_text_file', status: 'completed', contentText: '章节正文' })
    store.finishTurn()
    const submitted = vi.fn()
    const payload = { resultId: 'work-result', threadId, title: '章节结果', selections: { mode: 'brief' }, displayText: '继续', promptText: '继续分析章节' }
    const container = mountPanel({
      store, runtimes: RUNTIMES, onGenerativeSubmit: submitted,
      renderPlanCard: (message) => h('div', { 'data-testid': 'shared-plan-slot' }, message.text),
      renderBusinessResult: (_message, opts) => h('button', {
        'data-testid': 'shared-business-slot',
        'data-thread': opts.threadId,
        onClick: () => opts.onGenerativeSubmit?.(payload),
      }, '继续分析'),
    })
    const group = container.querySelector('[data-testid="chat-work-log"]')!
    const toggle = group.querySelector<HTMLButtonElement>('[data-slot="agent-activity"] > button')!
    expect(toggle.getAttribute('aria-expanded')).toBe('false')
    act(() => toggle.click())
    expect(container.querySelectorAll('[data-testid="shared-plan-slot"]')).toHaveLength(1)
    act(() => group.querySelector<HTMLButtonElement>('[data-slot="agent-activity-row"] > button')!.click())
    const slot = container.querySelector<HTMLButtonElement>('[data-testid="shared-business-slot"]')!
    expect(container.querySelectorAll('[data-testid="shared-business-slot"]')).toHaveLength(1)
    expect(slot.dataset.thread).toBe(threadId)
    act(() => slot.click())
    expect(submitted).toHaveBeenCalledExactlyOnceWith(payload)
  })
})
