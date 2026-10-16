// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  ARTIFACT_MESSAGE_MAX_BYTES,
  ArtifactFrame,
  buildArtifactDocument,
} from './artifact-frame'

;(globalThis as unknown as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

function renderFrame(props: Record<string, unknown> = {}) {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  const onBridgeMessage = vi.fn()
  act(() => {
    root.render(
      createElement(ArtifactFrame, {
        title: '预览',
        html: '<p>hi</p>',
        mountId: 'mount-1',
        onBridgeMessage,
        ...props,
      } as never),
    )
  })
  return { container, root, onBridgeMessage }
}

describe('ArtifactFrame', () => {
  type Holder = { container: HTMLDivElement; root: Root; onBridgeMessage: ReturnType<typeof vi.fn> }
  let holders: Holder[] = []

  afterEach(() => {
    for (const h of holders) {
      act(() => {
        h.root.unmount()
      })
      h.container.remove()
    }
    holders = []
    vi.restoreAllMocks()
  })

  function track<H extends Holder>(h: H): H {
    holders.push(h)
    return h
  }

  it('挂载即隔离：仅 allow-scripts，宿主 CSP 在前', () => {
    const h = track(renderFrame())
    const frame = h.container.querySelector('iframe') as HTMLIFrameElement | null
    expect(frame?.getAttribute('sandbox')).toBe('allow-scripts')
    const srcDoc = frame?.getAttribute('srcdoc') ?? ''
    expect(srcDoc).toContain('Content-Security-Policy')
    expect(srcDoc).not.toContain('allow-same-origin')
  })

  it('伪造来源/挂载 ID/超限消息一律忽略', () => {
    const h = track(renderFrame())
    const frame = h.container.querySelector('iframe') as HTMLIFrameElement | null
    const before = frame?.style.height
    act(() => {
      window.dispatchEvent(
        new MessageEvent('message', {
          source: window,
          data: { mountId: 'forged', type: 'artifact-height', value: 900 },
        }),
      )
    })
    expect(frame?.style.height).toBe(before ?? '')
    act(() => {
      window.dispatchEvent(
        new MessageEvent('message', {
          source: window,
          data: { mountId: 'mount-1', type: 'artifact-height', value: 10 ** 9 },
        }),
      )
    })
    expect(frame?.style.height).toBe(before ?? '')
    expect(h.onBridgeMessage).not.toHaveBeenCalled()
  })

  it('合法高度钳制并忽略微差/非法值', () => {
    const h = track(renderFrame({ maxHeight: 640 }))
    const frame = h.container.querySelector('iframe') as HTMLIFrameElement | null
    const contentWindow = frame?.contentWindow ?? null
    if (!contentWindow) return
    act(() => {
      window.dispatchEvent(
        new MessageEvent('message', {
          source: contentWindow as Window,
          data: { mountId: 'mount-1', type: 'artifact-height', value: 99999 },
        }),
      )
    })
    expect(frame?.style.height).toBe('640px')
    // 微差（<2px）忽略，不抖动
    act(() => {
      window.dispatchEvent(
        new MessageEvent('message', {
          source: contentWindow as Window,
          data: { mountId: 'mount-1', type: 'artifact-height', value: 641 },
        }),
      )
    })
    expect(frame?.style.height).toBe('640px')
    // NaN/负数/超限体忽略
    act(() => {
      window.dispatchEvent(
        new MessageEvent('message', {
          source: contentWindow as Window,
          data: { mountId: 'mount-1', type: 'artifact-height', value: Number.NaN },
        }),
      )
      window.dispatchEvent(
        new MessageEvent('message', {
          source: contentWindow as Window,
          data: { mountId: 'mount-1', type: 'x'.repeat(ARTIFACT_MESSAGE_MAX_BYTES + 1) },
        }),
      )
    })
    expect(frame?.style.height).toBe('640px')
  })

  it('react-ready 与 ready/error 按白名单分发', () => {
    const h = track(renderFrame())
    const frame = h.container.querySelector('iframe') as HTMLIFrameElement | null
    const contentWindow = frame?.contentWindow ?? null
    if (!contentWindow) return
    act(() => window.dispatchEvent(new MessageEvent('message', {
      source: contentWindow as Window,
      data: { mountId: 'mount-1', type: 'artifact-error', value: '中'.repeat(800) },
    })))
    expect(h.onBridgeMessage).not.toHaveBeenCalled()
    act(() => {
      window.dispatchEvent(
        new MessageEvent('message', {
          source: contentWindow as Window,
          data: { mountId: 'mount-1', type: 'artifact-react-ready', value: 1 },
        }),
      )
    })
    expect(h.onBridgeMessage).toHaveBeenCalledWith({ kind: 'react-ready' })
    act(() => {
      window.dispatchEvent(
        new MessageEvent('message', {
          source: contentWindow as Window,
          data: { mountId: 'mount-1', type: 'artifact-error', value: 'boom' },
        }),
      )
    })
    expect(h.onBridgeMessage).toHaveBeenCalledWith({ kind: 'error', message: 'boom' })
  })

  it('srcDoc 按 html+mountId 记忆，props 同值不重建文档', () => {
    const first = buildArtifactDocument('<p>a</p>', 'm1')
    expect(buildArtifactDocument('<p>a</p>', 'm1')).toBe(first)
    expect(buildArtifactDocument('<p>a</p>', 'm2')).not.toBe(first)
  })

  it('卸载后移除监听，不再响应旧帧消息', () => {
    const h = track(renderFrame())
    const frame = h.container.querySelector('iframe') as HTMLIFrameElement | null
    const contentWindow = frame?.contentWindow ?? null
    act(() => {
      h.root.unmount()
    })
    holders.pop()?.container.remove()
    if (!contentWindow) return
    act(() => {
      window.dispatchEvent(
        new MessageEvent('message', {
          source: contentWindow as Window,
          data: { mountId: 'mount-1', type: 'artifact-ready', value: 1 },
        }),
      )
    })
    expect(h.onBridgeMessage).not.toHaveBeenCalled()
  })

  it('仅启用请求桥时接收有效文本，拒绝对象和越界请求', () => {
    const h = track(renderFrame({ allowRequests: true }))
    const frame = h.container.querySelector('iframe')!
    const send = (value: unknown) => window.dispatchEvent(new MessageEvent('message', { source: frame.contentWindow!, data: { mountId: 'mount-1', type: 'artifact-request-analysis', value } }))
    act(() => { send({ method: 'delete' }); send('x'.repeat(1537)); send('  继续分析  ') })
    expect(h.onBridgeMessage).toHaveBeenCalledTimes(1)
    expect(h.onBridgeMessage).toHaveBeenCalledWith({ kind: 'analysis-request', text: '继续分析' })
    expect(buildArtifactDocument('<p>hi</p>', 'm')).not.toContain('requestAnalysis')
    expect(buildArtifactDocument('<p>hi</p>', 'm', true)).toContain('requestAnalysis')
    const earlyBridge = buildArtifactDocument('<script>/* model-app-start */</script>', 'm', true)
    expect(earlyBridge.indexOf('requestAnalysis')).toBeLessThan(earlyBridge.indexOf('model-app-start'))
  })
})
