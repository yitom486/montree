import { createHash, randomBytes } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { dirname, extname, isAbsolute, join, relative } from 'node:path'
import { HTML_PREVIEW_SCHEME, type HtmlPreviewRegistration } from '../../../contracts/html-preview'
import { injectHtmlPreviewBridge } from './bridge-script'

/**
 * 本地 HTML 预览的 `montree-html://` 协议。
 *
 * 源 = `montree-html://<工作区哈希>`：页面拥有自己的 localStorage/Cookie，相对 CSS/JS/图片按真实目录加载，
 * 但与应用窗口跨源，访问不到 preload 暴露的文件/终端接口。
 * 主文档来自渲染端推送的内存文本（含未保存修改），由 `?t=<token>` 定位；其余路径只读基准目录内的磁盘文件。
 */

interface PreviewEntry {
  token: string
  ownerId: number
  filePath: string
  baseDir: string
  host: string
  html: string | null
}

const entries = new Map<string, PreviewEntry>()

const MIME_BY_EXTENSION: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.htm': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/plain; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.bmp': 'image/bmp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.ogg': 'audio/ogg',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.wasm': 'application/wasm',
  '.pdf': 'application/pdf',
}

function isInside(baseDir: string, target: string): boolean {
  const rel = relative(baseDir, target)
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel))
}

/** 工作区内的文件以工作区根为基准（`../assets` 之类可解析）；否则只开放文件所在目录。 */
export function resolvePreviewBaseDir(filePath: string, workspaceRoot: string | null): string {
  if (workspaceRoot && isInside(workspaceRoot, filePath)) return workspaceRoot
  return dirname(filePath)
}

export function previewHostFor(baseDir: string): string {
  const key = process.platform === 'win32' ? baseDir.toLowerCase() : baseDir
  return `w${createHash('sha256').update(key).digest('hex').slice(0, 24)}`
}

function encodeRelativePath(baseDir: string, filePath: string): string {
  return relative(baseDir, filePath).split(/[\\/]/).filter(Boolean).map(encodeURIComponent).join('/')
}

export function registerHtmlPreview(input: {
  ownerId: number
  filePath: string
  workspaceRoot: string | null
}): HtmlPreviewRegistration {
  const baseDir = resolvePreviewBaseDir(input.filePath, input.workspaceRoot)
  const host = previewHostFor(baseDir)
  const token = randomBytes(16).toString('hex')
  entries.set(token, { token, ownerId: input.ownerId, filePath: input.filePath, baseDir, host, html: null })
  return { token, url: `${HTML_PREVIEW_SCHEME}://${host}/${encodeRelativePath(baseDir, input.filePath)}?t=${token}` }
}

export function updateHtmlPreview(ownerId: number, token: string, html: string): boolean {
  const entry = entries.get(token)
  if (!entry || entry.ownerId !== ownerId) return false
  entry.html = html
  return true
}

export function releaseHtmlPreview(ownerId: number, token: string): void {
  if (entries.get(token)?.ownerId === ownerId) entries.delete(token)
}

export function releaseHtmlPreviewsFor(ownerId: number): void {
  for (const [token, entry] of entries) {
    if (entry.ownerId === ownerId) entries.delete(token)
  }
}

/** URL 路径 → 基准目录内的磁盘路径；任何越界、盘符、备用数据流或编码异常一律拒绝。 */
export function resolvePreviewResource(baseDir: string, pathname: string): string | null {
  const parts: string[] = []
  for (const raw of pathname.split('/')) {
    if (!raw) continue
    let part: string
    try {
      part = decodeURIComponent(raw)
    } catch {
      return null
    }
    if (part === '.' || part === '..' || /[\\/:\0]/.test(part)) return null
    parts.push(part)
  }
  const target = join(baseDir, ...parts)
  return isInside(baseDir, target) ? target : null
}

function textResponse(status: number, body: string): Response {
  return new Response(body, { status, headers: { 'content-type': 'text/plain; charset=utf-8' } })
}

function previewHeaders(contentType: string): Record<string, string> {
  return { 'content-type': contentType, 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' }
}

export async function handleHtmlPreviewRequest(
  request: Request,
  read: (path: string) => Promise<Buffer> = readFile,
): Promise<Response> {
  if (request.method !== 'GET' && request.method !== 'HEAD') return textResponse(405, 'Method Not Allowed')
  let url: URL
  try {
    url = new URL(request.url)
  } catch {
    return textResponse(400, 'Bad Request')
  }
  const host = url.hostname.toLowerCase()

  const token = url.searchParams.get('t')
  const document = token ? entries.get(token) : undefined
  if (document && document.host === host && document.html !== null) {
    return new Response(injectHtmlPreviewBridge(document.html), { headers: previewHeaders(MIME_BY_EXTENSION['.html']) })
  }

  // 子资源：只要该源仍有存活的预览，就按其基准目录读盘
  const owner = [...entries.values()].find((entry) => entry.host === host)
  if (!owner) return textResponse(404, 'Not Found')
  const target = resolvePreviewResource(owner.baseDir, url.pathname)
  if (!target) return textResponse(403, 'Forbidden')
  let data: Buffer
  try {
    data = await read(target)
  } catch {
    return textResponse(404, 'Not Found')
  }
  const extension = extname(target).toLowerCase()
  const contentType = MIME_BY_EXTENSION[extension] ?? 'application/octet-stream'
  if (extension === '.html' || extension === '.htm') {
    // 页面内自导航（脚本改 location、表单等）到同源其他 HTML 时同样带桥，保持链接拦截与阅读快照
    return new Response(injectHtmlPreviewBridge(data.toString('utf8')), { headers: previewHeaders(contentType) })
  }
  return new Response(new Uint8Array(data), { headers: previewHeaders(contentType) })
}

/** 仅供单测重置注册表 */
export function resetHtmlPreviewsForTest(): void {
  entries.clear()
}
