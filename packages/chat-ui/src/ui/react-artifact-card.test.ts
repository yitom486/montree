// @vitest-environment happy-dom
// M3d：`compileReactArtifact（主进程）→onCompile`、`fileApi.exportHtml+toast→onExport` props 化后，
// 编译改经 `onCompile` prop 注入（`Result` 原样透传），导出改经 `onExport(html,title)` 回调；包内不碰 IPC/文件。
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ReactArtifactCard } from './react-artifact-card'
import type { PresentReactArtifact } from '@montree/contracts'
import type { GenerativeSubmitPayload } from './component-ui-card'

;(globalThis as unknown as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

const SOURCE = 'import {useState} from "react"; export default function App(){return <button>按</button>}'

function result(overrides: Partial<PresentReactArtifact> = {}): PresentReactArtifact {
  return {
    schemaVersion: 1,
    kind: 'react-artifact',
    id: 'present-react-artifact-test01',
    title: '计数器',
    source: SOURCE,
    ...overrides,
  }
}

function okCompile(html: string) {
  return vi.fn(async () => ({ ok: true as const, value: html }))
}

function mount(value = result(), props: Record<string, unknown> = {}) {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  act(() => {
    root.render(createElement(ReactArtifactCard, { result: value, ...props } as never))
  })
  return { container, root }
}

describe('ReactArtifactCard', () => {
  const mounted: Array<{ container: HTMLDivElement; root: Root }> = []

  afterEach(() => {
    for (const h of mounted.splice(0)) {
      act(() => {
        h.root.unmount()
      })
      h.container.remove()
    }
    vi.restoreAllMocks()
  })

  it('编译失败卡内可读并可重试，不崩整聊', async () => {
    let calls = 0
    const onCompile = vi.fn(async () => {
      calls += 1
      return { ok: false as const, error: { code: 'COMPILE_ERROR', message: 'Unexpected token' } }
    })
    const h = mount(result({ id: 'present-react-fail-01' }), { onCompile })
    mounted.push(h)
    await act(async () => {})
    expect(h.container.textContent).toContain('编译失败')
    expect(h.container.textContent).toContain('Unexpected token')
    expect(h.container.querySelector('iframe')).toBeNull()
    const retry = [...h.container.querySelectorAll('button')].find((b) =>
      b.textContent?.includes('重试'),
    ) as HTMLElement
    await act(async () => {
      retry.click()
    })
    expect(calls).toBe(2)
  })

  it('工具运行中显示构建中，落定后转编译；历史恢复显示恢复中', async () => {
    let resolveCompile!: (value: { ok: true; value: string }) => void
    const onCompile = vi.fn(() => new Promise<{ ok: true; value: string }>((resolve) => { resolveCompile = resolve }))
    const h = mount(result({ id: 'present-react-build-01' }), { toolStreaming: true, toolStatus: 'in_progress', onCompile })
    mounted.push(h)
    expect(h.container.textContent).toContain('正在构建交互界面…')
    await act(async () => {
      resolveCompile({ ok: true, value: '<p>ok "__MONTREE_MOUNT_ID__"</p>' })
    })
    // 同一挂载再次渲染（源码展开等宿主更新）不重建 iframe
    const before = h.container.querySelector('iframe')
    expect(before).not.toBeNull()
    act(() => {
      h.root.render(createElement(ReactArtifactCard, { result: result({ id: 'present-react-build-01' }), onCompile } as never))
    })
    expect(h.container.querySelector('iframe')).toBe(before)
  })

  it('同 id 第二次挂载显示恢复中（会话级编译记忆）', async () => {
    const firstCompile = okCompile('<p>ok</p>')
    const first = mount(result({ id: 'present-react-restore-01' }), { onCompile: firstCompile })
    mounted.push(first)
    await act(async () => {})
    act(() => {
      first.root.unmount()
    })
    let secondResolve!: (value: { ok: true; value: string }) => void
    const secondCompile = vi.fn(() => new Promise<{ ok: true; value: string }>((resolve) => { secondResolve = resolve }))
    const second = mount(result({ id: 'present-react-restore-01' }), { onCompile: secondCompile })
    mounted.push(second)
    expect(second.container.textContent).toContain('正在恢复交互界面…')
    await act(async () => {
      secondResolve({ ok: true, value: '<p>ok</p>' })
    })
  })

  it('运行错误卡内降级，晚到 ready 不覆盖失败', async () => {
    const onCompile = okCompile('<div id="root"></div>')
    const h = mount(result({ id: 'present-react-runtime-01' }), { onCompile })
    mounted.push(h)
    await act(async () => {})
    const frame = h.container.querySelector('iframe[data-testid="react-inline-frame"]') as HTMLIFrameElement | null
    expect(frame).not.toBeNull()
    const srcDoc = frame?.getAttribute('srcdoc') ?? ''
    // 挂载占位已替换为本次 mountId
    expect(srcDoc).not.toContain('__MONTREE_MOUNT_ID__')
    const mountId = /var m="([^"]+)"/.exec(srcDoc)?.[1]
    const contentWindow = frame?.contentWindow ?? null
    if (!mountId || !contentWindow) return
    await act(async () => {
      window.dispatchEvent(
        new MessageEvent('message', {
          source: contentWindow as Window,
          data: { mountId, type: 'artifact-error', value: 'boom' },
        }),
      )
    })
    expect(h.container.textContent).toContain('运行失败')
    expect(h.container.textContent).toContain('boom')
    // 晚到的 react-ready 不得清掉失败
    await act(async () => {
      window.dispatchEvent(
        new MessageEvent('message', {
          source: contentWindow as Window,
          data: { mountId, type: 'artifact-react-ready', value: 1 },
        }),
      )
    })
    expect(h.container.textContent).toContain('运行失败')
    const rerun = [...h.container.querySelectorAll('button')].find((b) =>
      b.textContent?.includes('重新运行'),
    ) as HTMLElement
    await act(async () => {
      rerun.click()
    })
    expect(h.container.textContent).toContain('正在加载交互界面…')
  })

  it('源码视图展示模型源码，导出走宿主回调', async () => {
    const onCompile = okCompile('<div id="root">app</div>')
    const onExport = vi.fn()
    const h = mount(result({ id: 'present-react-export-01' }), { onCompile, onExport })
    mounted.push(h)
    await act(async () => {})
    const toggle = [...h.container.querySelectorAll('button')].find((b) =>
      b.textContent?.includes('查看源码'),
    ) as HTMLElement
    act(() => {
      toggle.click()
    })
    const pre = h.container.querySelector('[data-testid="react-artifact-source"]')
    expect(pre?.textContent).toContain('export default function App')
    expect(pre?.textContent).not.toContain('__artifactModules')
    const exp = [...h.container.querySelectorAll('button')].find((b) =>
      b.textContent?.includes('导出 HTML'),
    ) as HTMLElement
    await act(async () => {
      exp.click()
    })
    expect(onExport).toHaveBeenCalledOnce()
    expect(String(onExport.mock.calls[0]?.[0] ?? '')).toContain('<div id="root">app</div>')
    expect(onExport.mock.calls[0]?.[1]).toBe('计数器')
  })

  it('未注入 onCompile 时给可读编译失败，不崩整聊', async () => {
    const h = mount(result({ id: 'present-react-nocompile-01' }))
    mounted.push(h)
    await act(async () => {})
    expect(h.container.textContent).toContain('编译失败')
    expect(h.container.querySelector('iframe')).toBeNull()
  })

  it('页面只能提出请求，宿主确认后提交一次且不重建 iframe', async () => {
    const onCompile = okCompile('<p>test</p>')
    let finish!: () => void
    const onSubmit = vi.fn((_payload: GenerativeSubmitPayload) => new Promise<void>(resolve => { finish = resolve }))
    const h = mount(result({ id: 'present-react-request-01' }), { threadId: 'thread-r3', onSubmit, onCompile })
    mounted.push(h)
    await act(async () => {})
    const frame = h.container.querySelector('iframe')!
    const mountId = /var m="([^"]+)"/.exec(frame.srcdoc)![1]!
    const emit = (type: string, value: unknown) => window.dispatchEvent(new MessageEvent('message', { source: frame.contentWindow!, data: { mountId, type, value } }))
    act(() => {
      emit('artifact-react-ready', 1)
      emit('artifact-request-analysis', '请分析已选章节')
      emit('artifact-request-analysis', '偷偷替换正在审核的内容')
    })
    expect(onSubmit).not.toHaveBeenCalled()
    expect(h.container.textContent).toContain('请分析已选章节')
    expect(h.container.textContent).not.toContain('偷偷替换')
    const confirm = [...h.container.querySelectorAll('button')].find(button => button.textContent === '确认发送给 Agent')!
    act(() => { confirm.click(); confirm.click() })
    expect(onSubmit).toHaveBeenCalledTimes(1)
    expect(onSubmit.mock.calls[0]![0]).toMatchObject({ threadId: 'thread-r3', selections: { request: '请分析已选章节' } })
    expect(h.container.querySelector('iframe')).toBe(frame)
    await act(async () => { finish() })
    expect(h.container.querySelector('[data-testid="artifact-request-confirmation"]')).toBeNull()
  })
})
