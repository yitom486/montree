import { describe, expect, it, vi } from 'vitest'
import type { WebContents } from 'electron'
import { captureReaderViewport } from './reader-screenshot-service'

describe('reader screenshot capture', () => {
  it('严格使用阅读区裁剪范围，返回PNG像素和文档定位', async () => {
    const png = Buffer.from('89504e470d0a1a0a', 'hex')
    const capturePage = vi.fn(async () => ({ isEmpty: () => false, getSize: () => ({ width: 600, height: 400 }), toPNG: () => png }))
    const result = await captureReaderViewport({ capturePage } as unknown as Pick<WebContents, 'capturePage'>,
      JSON.stringify({ documentPath: '/books/a.pdf', viewport: { x: 200, y: 100, width: 600, height: 400 } }))
    expect(capturePage).toHaveBeenCalledWith({ x: 200, y: 100, width: 600, height: 400 })
    expect(result.documentPath).toBe('/books/a.pdf')
    expect(result.mimeType).toBe('image/png')
    expect(Buffer.from(result.data, 'base64')).toEqual(png)
  })

  it('没有文档或裁剪区域无效时不截图', async () => {
    const capturePage = vi.fn()
    for (const viewport of [null, { x: -10, y: 0, width: 600, height: 400 }, { x: 0, y: 0, width: 0, height: 400 }]) {
      await expect(captureReaderViewport({ capturePage }, JSON.stringify({ documentPath: '/a', viewport }))).rejects.toThrow('没有可截图')
    }
    expect(capturePage).not.toHaveBeenCalled()
  })
})
