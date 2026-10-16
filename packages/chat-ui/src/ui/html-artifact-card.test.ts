// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
// M3d：`fileApi.exportHtml+toast→onExport` props 化后，导出断言改为宿主回调；`theme` 改 `colorScheme` prop（本用例不传，覆盖缺省不同步路径）。
import { buildArtifactDocument } from './artifact-frame'
import { HtmlArtifactCard, sanitizeArtifactFileName } from './html-artifact-card'
import type { PresentHtmlArtifact } from '@montree/contracts'

;(globalThis as unknown as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

const SOURCE = '<style>p{color:red}</style><p id="c">计数：0</p><button id="b">按</button><script>document.getElementById("b").addEventListener("click",function(){document.getElementById("c").textContent="计数：1"})</script>'

function result(): PresentHtmlArtifact {
  return {
    schemaVersion: 1,
    kind: 'html-artifact',
    id: 'present-html-artifact-test01',
    title: '计数器',
    summary: '离线小应用',
    documentFingerprint: '/books/a.epub',
    html: SOURCE,
  }
}

describe('buildArtifactDocument', () => {
  it('保留内联 SVG 的可访问标题', () => {
    const doc = buildArtifactDocument('<html><head><title>文档标题</title></head><body><svg role="img" aria-labelledby="label"><title id="label">流程图</title></svg></body></html>', 'test-mount')
    expect(doc).toContain('<title id="label">流程图</title>')
    expect(doc).not.toContain('文档标题')
  })
  it('宿主 CSP 唯一生效，脚本样式保留', () => {
    const doc = buildArtifactDocument(SOURCE, 'mount-1')
    expect(doc).toContain('Content-Security-Policy')
    expect(doc).toContain("script-src 'unsafe-inline'")
    expect(doc).toContain("connect-src 'none'")
    expect(doc).toContain('<button id="b">按</button>')
  })

  it('片段套壳为完整文档，整文档注入 CSP', () => {
    expect(buildArtifactDocument('<p>hi</p>', 'm')).toContain('<!DOCTYPE html>')
    const full = buildArtifactDocument('<html><head><title>t</title></head><body><p>x</p></body></html>', 'm')
    expect(full).toContain('Content-Security-Policy')
    expect(full).not.toContain('<head><head>')
  })

  it('完整文档同样获得宿主桥接（ready/error/height）', () => {
    const doc = buildArtifactDocument(
      '<!doctype html><html><head><title>x</title></head><body><button>x</button></body></html>',
      'review',
    )
    expect(doc).toContain('artifact-ready')
    expect(doc).toContain('artifact-error')
    expect(doc).toContain('artifact-height')
  })

  it('前置脚本被收入 body 且 CSP 在前', () => {
    const doc = buildArtifactDocument(
      '<script>fetch("https://example.com/early")</script><html><head><title>t</title></head><body><p>x</p></body></html>',
      'review',
    )
    const cspAt = doc.indexOf('Content-Security-Policy')
    const fetchAt = doc.indexOf('example.com/early')
    expect(cspAt).toBeGreaterThan(-1)
    expect(fetchAt).toBeGreaterThan(cspAt)
    expect(doc).not.toMatch(/<script>fetch[\s\S]*<\/script>\s*<html/i)
  })

  it('body 内脚本原地保留（依赖解析顺序）', () => {
    const doc = buildArtifactDocument(
      '<p id="c">0</p><script>document.getElementById("c").textContent="1"</script>',
      'm',
    )
    const bodyAt = doc.indexOf('<body>')
    const scriptAt = doc.indexOf('getElementById("c").textContent')
    expect(scriptAt).toBeGreaterThan(bodyAt)
    expect(doc).toContain('<p id="c">0</p>')
  })

  it('head 内联样式移到 CSP 之后', () => {
    const doc = buildArtifactDocument(
      '<html><head><style>p{color:red}</style></head><body><p>x</p></body></html>',
      'm',
    )
    const cspAt = doc.indexOf('Content-Security-Policy')
    const styleAt = doc.indexOf('p{color:red}')
    expect(styleAt).toBeGreaterThan(cspAt)
    expect(doc).toContain('<p>x</p>')
  })

  it('meta refresh 与残缺 HTML 不破坏组装', () => {
    const doc = buildArtifactDocument('<meta http-equiv="refresh" content="0;url=data:text/html,hi"><p>x</p>', 'm')
    expect(doc).not.toContain('http-equiv="refresh"')
    expect(doc).toContain('<p>x</p>')
    expect(doc).toContain('artifact-ready')
  })
})

describe('sanitizeArtifactFileName', () => {
  it('去非法字符并补扩展名', () => {
    expect(sanitizeArtifactFileName('报告：Q1/总结?')).toBe('报告：Q1_总结_.html')
    expect(sanitizeArtifactFileName('   ')).toBe('artifact.html')
  })
})

describe('HtmlArtifactCard', () => {
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
    vi.restoreAllMocks()
  })

  function renderCard(props: Record<string, unknown> = {}) {
    act(() => {
      root.render(createElement(HtmlArtifactCard, { result: result(), ...props } as never))
    })
  }

  it('未打开时不挂 iframe，源码为纯文本', () => {
    renderCard()
    expect(container.querySelector('iframe')).toBeNull()
    expect(container.textContent).toContain('打开预览')
    const buttons = [...container.querySelectorAll('button')]
    const source = buttons.find((b) => b.textContent?.includes('查看源码')) as HTMLElement
    act(() => {
      source.click()
    })
    const pre = container.querySelector('[data-testid="artifact-source"]')
    expect(pre?.textContent).toContain('<button id="b">按</button>')
    expect(pre?.querySelector('button')).toBeNull()
  })

  it('打开预览挂隔离 iframe：仅 allow-scripts，带宿主 CSP', () => {
    renderCard()
    const open = [...container.querySelectorAll('button')].find((b) =>
      b.textContent?.includes('打开预览'),
    ) as HTMLElement
    act(() => {
      open.click()
    })
    const frame = document.body.querySelector('iframe[data-testid="artifact-frame"]') as HTMLIFrameElement | null
    expect(frame).not.toBeNull()
    expect(frame?.getAttribute('sandbox')).toBe('allow-scripts')
    const srcDoc = frame?.getAttribute('srcdoc') ?? ''
    expect(srcDoc).toContain('Content-Security-Policy')
    expect(srcDoc).not.toContain('allow-same-origin')
  })

  it('导出走宿主回调（包内不碰 IPC/文件）', async () => {
    const onExport = vi.fn()
    renderCard({ onExport })
    const exp = [...container.querySelectorAll('button')].find((b) =>
      b.textContent?.includes('导出 HTML'),
    ) as HTMLElement
    await act(async () => {
      exp.click()
    })
    expect(onExport).toHaveBeenCalledOnce()
  })

  it('打开后再打开是新生命周期（挂载 ID 不同，旧错误不残留）', () => {
    renderCard()
    const open = [...container.querySelectorAll('button')].find((b) =>
      b.textContent?.includes('打开预览'),
    ) as HTMLElement
    act(() => {
      open.click()
    })
    const first = document.body.querySelector('iframe')?.getAttribute('srcdoc') ?? ''
    const id1 = /var m="([^"]+)"/.exec(first)?.[1]
    expect(id1).toBeTruthy()
    const close = [...document.body.querySelectorAll('button')].find((b) => b.textContent === '关闭') as HTMLElement
    act(() => {
      close.click()
    })
    act(() => {
      open.click()
    })
    const second = document.body.querySelector('iframe')?.getAttribute('srcdoc') ?? ''
    const id2 = /var m="([^"]+)"/.exec(second)?.[1]
    expect(id2).toBeTruthy()
    expect(id2).not.toBe(id1)
  })

  it('伪造 postMessage（来源/挂载 ID 不符）被忽略', () => {
    renderCard()
    const open = [...container.querySelectorAll('button')].find((b) =>
      b.textContent?.includes('打开预览'),
    ) as HTMLElement
    act(() => {
      open.click()
    })
    const frame = document.body.querySelector('iframe[data-testid="artifact-frame"]') as HTMLIFrameElement | null
    expect(frame).not.toBeNull()
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
    expect(document.body.textContent).not.toContain('artifact-error')
    // 合法来源+挂载 ID 则接受（happy-dom 无 frame contentWindow 时跳过不断言）
    const srcDoc = frame?.getAttribute('srcdoc') ?? ''
    const mountId = /var m="([a-z0-9-]+)"/.exec(srcDoc)?.[1]
    const contentWindow = frame?.contentWindow ?? null
    if (mountId && contentWindow) {
      act(() => {
        window.dispatchEvent(
          new MessageEvent('message', {
            source: contentWindow as Window,
            data: { mountId, type: 'artifact-height', value: 500 },
          }),
        )
      })
      expect(frame?.style.height).toBe('500px')
    }
  })
})
