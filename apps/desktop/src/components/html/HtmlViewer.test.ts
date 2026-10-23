// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { HtmlViewer } from './HtmlViewer'

;(globalThis as unknown as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

vi.mock('@/api/app-api', () => ({
  appApi: {
    openExternal: vi.fn(),
  },
}))

const htmlPreview = vi.hoisted(() => ({
  register: vi.fn(async () => ({ token: 'token-1', url: 'about:blank?t=token-1' })),
  update: vi.fn(async (_token: string, _html: string) => undefined),
  release: vi.fn(async () => undefined),
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
    expect(iframe?.getAttribute('src')).toMatch(/^about:blank\?t=token-1&v=\d+$/)
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
})
