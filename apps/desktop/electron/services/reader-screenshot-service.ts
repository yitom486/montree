import type { WebContents } from 'electron'
import type { ReaderVisualContext, ReaderViewportImage } from '@montree/contracts'

/** 只截图 owner 窗口的阅读区；像素留在内存，不落盘。 */
export async function captureReaderViewport(target: Pick<WebContents, 'capturePage'>, raw: string): Promise<ReaderViewportImage> {
  const context = JSON.parse(raw) as ReaderVisualContext
  const rect = context.viewport
  if (!context.documentPath || !rect || !Object.values(rect).every(Number.isFinite) ||
    rect.x < 0 || rect.y < 0 || rect.width <= 0 || rect.height <= 0 || rect.width > 10000 || rect.height > 10000) {
    throw new Error('当前没有可截图的阅读区，请先打开文档')
  }
  let image = await target.capturePage({
    x: Math.round(rect.x), y: Math.round(rect.y), width: Math.round(rect.width), height: Math.round(rect.height),
  })
  if (image.isEmpty()) throw new Error('阅读区截图为空，请恢复应用窗口后重试')
  if (image.getSize().width > 1600) image = image.resize({ width: 1600 })
  const data = image.toPNG()
  if (data.byteLength > 8 * 1024 * 1024) throw new Error('阅读区截图过大，请缩小窗口后重试')
  return { documentPath: context.documentPath, mimeType: 'image/png', data: data.toString('base64'), ...image.getSize() }
}
