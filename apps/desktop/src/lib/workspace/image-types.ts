/**
 * 桌面端图片文件识别。
 *
 * 与 `apps/desktop/electron/services/image-formats.ts` 保持同一份扩展名/MIME 口径；
 * `@yitom/contracts` 的 DocumentKind 暂不包含图片，这里用路径扩展名单独分流。
 */

export const IMAGE_FILE_EXTENSIONS = [
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

export type ImageFileExtension = (typeof IMAGE_FILE_EXTENSIONS)[number]

export const IMAGE_MIME_BY_EXTENSION: Record<ImageFileExtension, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  jfif: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  avif: 'image/avif',
  bmp: 'image/bmp',
  ico: 'image/x-icon',
  svg: 'image/svg+xml',
  tif: 'image/tiff',
  tiff: 'image/tiff',
}

const IMAGE_EXTENSION_SET = new Set<string>(IMAGE_FILE_EXTENSIONS.map((extension) => `.${extension}`))

export function getImageExtension(filePath: string): string {
  const trimmed = filePath.trim()
  const withoutQuery = trimmed.split(/[?#]/, 1)[0] ?? trimmed
  const index = withoutQuery.lastIndexOf('.')
  return index === -1 ? '' : withoutQuery.slice(index).toLowerCase()
}

export function isImagePath(filePath: string | undefined): boolean {
  return Boolean(filePath && IMAGE_EXTENSION_SET.has(getImageExtension(filePath)))
}

export function getImageMimeType(filePath: string): string | undefined {
  return IMAGE_MIME_BY_EXTENSION[getImageExtension(filePath).slice(1) as ImageFileExtension]
}

export function getImageFormatLabel(filePath: string): string {
  const extension = getImageExtension(filePath).slice(1)
  return extension ? extension.toUpperCase() : '图片'
}
