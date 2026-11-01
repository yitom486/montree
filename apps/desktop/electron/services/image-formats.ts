/**
 * 图片扩展名与 MIME（主进程侧）。
 * 与渲染端 `apps/desktop/src/lib/workspace/image-types.ts` 保持同步。
 */

export const DOCUMENT_IMAGE_EXTENSIONS = [
  'png',
  'jpg',
  'jpeg',
  'jfif',
  'gif',
  'webp',
  'avif',
  'bmp',
  'ico',
  'svg',
  'tif',
  'tiff',
] as const

export const IMAGE_MIME_BY_EXTENSION: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.jfif': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.bmp': 'image/bmp',
  '.ico': 'image/x-icon',
  '.svg': 'image/svg+xml',
  '.tif': 'image/tiff',
  '.tiff': 'image/tiff',
}

export function isImageFileExtension(extension: string): boolean {
  return extension in IMAGE_MIME_BY_EXTENSION
}

export function getImageMimeType(filePath: string): string | undefined {
  const index = filePath.lastIndexOf('.')
  if (index === -1) return undefined
  return IMAGE_MIME_BY_EXTENSION[filePath.slice(index).toLowerCase()]
}
