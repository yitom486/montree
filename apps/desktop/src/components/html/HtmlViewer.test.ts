// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { HtmlViewer } from './HtmlViewer'
import { appApi } from '@/api/app-api'
import { fileApi } from '@/api/file-api'
import type { HtmlPreviewLink } from '../../../contracts/html-preview'

;(globalThis as unknown as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

vi.mock('@/api/app-api', () => ({
  appApi: {
    openExternal: vi.fn(),
  },
}))

const htmlPreview = vi.hoisted(() => ({
  register: vi.fn(async () => ({ token: 'token-1', url: 'montree-html://preview/page.html?t=token-1' })),
  update: vi.fn(async (_token: string, _html: string) => undefined),
  release: vi.fn(async () => undefined),
  resolveLink: vi.fn(async (_token: string, _href: string): Promise<HtmlPreviewLink> => ({ type: 'local', filePath: 'D:/workspace/next.html' })),
}))

vi.mock('@/api/html-preview-api', () => ({ htmlPreviewApi: htmlPreview }))

vi.mock('@/api/file-api', () => ({
  fileApi: {
    readImage: vi.fn().mockResolvedValue({ ok: false, error: { code: 'FILE_NOT_FOUND', message: 'Not found' } }),
  },
}))

describe('HtmlViewer', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    vi.clearAllMocks()
    // happy-dom 不实现自定义协议，保留 src 属性供断言，实际 frame 使用空白页。
    vi.spyOn(HTMLIFrameElement.prototype, 'src', 'get').mockReturnValue('about:blank')
    vi.spyOn(HTMLIFrameElement.prototype, 'contentWindow', 'get').mockReturnValue(window)
    vi.spyOn(window, 'postMessage').mockImplementation(() => {})
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

  it('渲染 HTML 预览面板与顶部工具栏', async () => {
    const htmlContent = '<h1>Hello Montree HTML</h1><p>Test paragraph</p>'
    const filePath = 'D:/workspace/index.html'

    await act(async () => {
      root.render(createElement(HtmlViewer, { filePath, content: htmlContent }))
    })

    expect(container.textContent).toContain('index.html')
    expect(container.textContent).toContain('预览')
    expect(container.textContent).toContain('分屏')
    expect(container.textContent).toContain('源码')

    const iframe = container.querySelector('iframe')
    expect(iframe).not.toBeNull()
    // 预览改由独立源协议加载：文本推送到主进程，iframe 只拿版本化地址，不再内联 srcdoc
    expect(iframe?.hasAttribute('srcdoc')).toBe(false)
    expect(iframe?.getAttribute('src')).toMatch(/^montree-html:\/\/preview\/page.html\?t=token-1&v=\d+$/)
    expect(htmlPreview.register).toHaveBeenCalledWith(filePath)
    expect(htmlPreview.update).toHaveBeenLastCalledWith('token-1', expect.stringContaining('Hello Montree HTML'))
  })

  it('支持切换至源码编辑模式', async () => {
    const htmlContent = '<div>Sample code content</div>'
    const filePath = 'D:/workspace/demo.htm'

    await act(async () => {
      root.render(createElement(HtmlViewer, { filePath, content: htmlContent }))
    })

    const buttons = Array.from(container.querySelectorAll('button'))
    const sourceBtn = buttons.find((btn) => btn.textContent?.includes('源码'))
    expect(sourceBtn).toBeDefined()

    await act(async () => {
      sourceBtn?.click()
    })

    // 切换至源码模式后，挂载了 CodeMirror 编辑器
    const cmEditor = container.querySelector('.cm-editor')
    expect(cmEditor).not.toBeNull()
  })

  it('成功加载真实 3D 交互看板样本文件并挂载画布与表格', async () => {
    const fs = await import('fs')
    const samplePath = 'D:/book/format-samples/08-数据可视化与3D交互看板.html'
    if (fs.existsSync(samplePath)) {
      const content = fs.readFileSync(samplePath, 'utf-8')
      await act(async () => {
        root.render(createElement(HtmlViewer, { filePath: samplePath, content }))
      })
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 250))
      })

      expect(container.textContent).toContain('08-数据可视化与3D交互看板.html')
      const iframe = container.querySelector('iframe')
      expect(iframe).not.toBeNull()
      const srcDoc = String(htmlPreview.update.mock.calls.at(-1)?.[1] ?? '')
      expect(srcDoc).toContain('Montree 3D 全息交互数据看板')
      expect(srcDoc).toContain('cubeCanvas')
      expect(srcDoc).toContain('分布式工作负载监控')
    }
  })
  function sendLink(href: string, origin = 'montree-html://preview') {
    const frame = container.querySelector('iframe')!
    window.dispatchEvent(new MessageEvent('message', {
      source: frame.contentWindow!, origin, data: { channel: 'montree-html-bridge', type: 'link', href },
    }))
  }

  it('不再代读越界图片，预览保留资源地址并禁止弹窗', async () => {
    const content = '<img src="../outside/private.svg">'
    await act(async () => { root.render(createElement(HtmlViewer, { filePath: 'D:/workspace/page.html', content })) })
    expect(fileApi.readImage).not.toHaveBeenCalled()
    expect(htmlPreview.update).toHaveBeenLastCalledWith('token-1', content)
    expect(container.querySelector('iframe')?.getAttribute('sandbox')).not.toContain('allow-popups')
  })

  it('忽略其他来源的消息，合法本地链接先经主进程授权', async () => {
    const onOpenLocalFile = vi.fn()
    await act(async () => { root.render(createElement(HtmlViewer, { filePath: 'D:/workspace/page.html', content: '<p>Page</p>', onOpenLocalFile })) })
    await act(async () => { sendLink('next.html', 'https://untrusted.example') })
    expect(htmlPreview.resolveLink).not.toHaveBeenCalled()
    await act(async () => { sendLink('next.html') })
    expect(htmlPreview.resolveLink).toHaveBeenCalledWith('token-1', 'next.html')
    expect(onOpenLocalFile).toHaveBeenCalledWith('D:/workspace/next.html', undefined)
  })

  it('伪造外链消息不能直接打开系统浏览器，宿主确认后才打开', async () => {
    htmlPreview.resolveLink.mockResolvedValueOnce({ type: 'external', url: 'https://example.com/' })
      .mockResolvedValueOnce({ type: 'external', url: 'https://example.com/replaced' })
    await act(async () => { root.render(createElement(HtmlViewer, { filePath: 'D:/workspace/page.html', content: '<p>Page</p>' })) })
    await act(async () => { sendLink('https://example.com/') })
    expect(appApi.openExternal).not.toHaveBeenCalled()
    expect(document.body.textContent).toContain('https://example.com/')
    await act(async () => { sendLink('https://example.com/replaced') })
    expect(document.body.textContent).not.toContain('https://example.com/replaced')
    const confirm = Array.from(document.body.querySelectorAll('button')).find(button => button.textContent === '打开链接')
    expect(confirm).toBeDefined()
    await act(async () => { confirm!.click() })
    expect(appApi.openExternal).toHaveBeenCalledExactlyOnceWith('https://example.com/')
  })

})
