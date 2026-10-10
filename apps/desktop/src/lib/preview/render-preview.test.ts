// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderPreview } from './render-preview'
import { fileApi } from '@/api/file-api'
vi.mock('@/api/file-api', () => ({ fileApi: { readImage: vi.fn() } }))
const dataUrl = 'data:image/png;base64,iVBORw0KGgo='
beforeEach(() => { vi.mocked(fileApi.readImage).mockReset().mockResolvedValue({ ok: true, value: { dataUrl } } as Awaited<ReturnType<typeof fileApi.readImage>>) })
describe('shared Markdown preview renderer', () => {
  it('预览片段也能读取完整文档中的引用式图片定义', async () => {
    const html = await renderPreview('![引用][PIC]', 'D:\\book\\sample.md', { references: { PIC: { href: './a.png', title: '图片' } } })
    expect(html).toContain(dataUrl)
    expect(fileApi.readImage).toHaveBeenCalledWith('D:\\book\\a.png')
  })
  it('复用 GFM 对齐、KaTeX、代码工具栏和 Mermaid 占位', async () => {
    const html = await renderPreview('| A | B |\n|:---|---:|\n|**bold**|`code`|\n\n$$\nx^2\n$$\n\n```js\nconst a = 1\n```\n\n```mermaid\ngraph TD\nA --> B\n```')
    const dom = document.createElement('div')
    dom.innerHTML = html
    expect(dom.querySelector('table')).not.toBeNull()
    expect(dom.querySelector('td strong')?.textContent).toBe('bold')
    expect(dom.querySelectorAll('th')[1].getAttribute('style')).toContain('right')
    expect(dom.querySelector('.katex-display')).not.toBeNull()
    expect(dom.querySelector('.code-block-copy')).not.toBeNull()
    expect(dom.querySelector('pre.mermaid')?.textContent).toContain('A --> B')
  })
  it('Markdown/单引号 HTML/实体路径共用本地图片解析，重复资源只读一次', async () => {
    const html = await renderPreview('![MD](./assets/a.png)\n\n<img src=\'./assets/a.png\' width="300" height="100">\n\n<img src="./assets/a&amp;b.png">', 'D:\\book\\sample.md')
    expect(fileApi.readImage).toHaveBeenCalledTimes(2)
    expect(fileApi.readImage).toHaveBeenCalledWith('D:\\book\\assets\\a&b.png')
    const dom = document.createElement('div')
    dom.innerHTML = html
    expect(Array.from(dom.querySelectorAll('img')).every((img) => img.getAttribute('src') === dataUrl)).toBe(true)
    expect(dom.querySelectorAll('img')[1].getAttribute('width')).toBe('300')
  })
  // DOMPurify does not support happy-dom for security verification; payloads are checked in Electron E2E.
  it('保留 HTML 表格和 details', async () => {
    const html = await renderPreview('<div><details><summary>详情</summary>正文</details><table><tr><td>格子</td></tr></table></div>')
    expect(html).toContain('<details>')
    expect(html).toContain('<td>格子</td>')
    expect(fileApi.readImage).not.toHaveBeenCalled()
  })
  it('资源读取失败仍保留正文、远程图片和替代文字', async () => {
    vi.mocked(fileApi.readImage).mockResolvedValue({ ok: false, error: { code: 'FILE_NOT_FOUND', message: 'missing' } } as Awaited<ReturnType<typeof fileApi.readImage>>)
    const html = await renderPreview('正文\n\n![找不到](./missing.png)\n\n![远程](https://example.com/a.png)', 'D:\\book\\sample.md')
    expect(html).toContain('正文')
    expect(html).toContain('alt="找不到"')
    expect(html).toContain('https://example.com/a.png')
  })
})
