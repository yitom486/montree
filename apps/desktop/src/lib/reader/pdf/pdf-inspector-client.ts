/**
 * pdf-inspector 主进程解析客户端：整档 Markdown 缓存（按文档指纹）。
 * 与 pdf-structure-client 同构：永不抛错——主进程失败 / 超时一律返回 null/false，
 * 调用方静默回退 WASM / pdf.js 路径。区别：文件由主进程直读，无需 transfer。
 */
import { extractPdfBookMarkdown } from '@/api/pdf-inspect-api'
import { isOk } from '@montree/contracts'
import { splitMarkdownByPageMarkers } from './pdf-structure'

/** 整档解析超时（主进程原生抽取通常秒级，大部头留足余量） */
const PDF_INSPECT_TIMEOUT_MS = 90_000
/** 最多驻留文档数（与 WASM 客户端同量级，防批量预读无界增长） */
const PDF_INSPECT_MAX_DOCS = 3

export type PdfInspectorStatus = 'idle' | 'ready' | 'unavailable'

export interface PdfInspectorState {
  status: PdfInspectorStatus
  reason: string
}

class PdfInspectorClient {
  private markdownByDoc = new Map<string, string>()
  private pagesByDoc = new Map<string, Map<number, string>>()
  private inFlight = new Map<string, Promise<boolean>>()
  private status: PdfInspectorStatus = 'idle'
  private reason = ''

  getState(): PdfInspectorState {
    return { status: this.status, reason: this.reason }
  }

  isUnavailable(): boolean {
    return this.status === 'unavailable'
  }

  hasDocument(docKey: string): boolean {
    return this.markdownByDoc.has(docKey)
  }

  /** 已缓存文档的单页正文；未缓存返回 null（不触发解析，调用方决定是否 parse） */
  getCachedPageText(docKey: string, page: number): string | null {
    const cached = this.pagesByDoc.get(docKey)
    if (cached) return cached.get(page) ?? null
    // 兼容：仅 markdown 命中而分页面缺失时懒构建一次（正常路径已预建）
    const markdown = this.markdownByDoc.get(docKey)
    if (markdown === undefined) return null
    const pages = splitMarkdownByPageMarkers(markdown, 1)
    this.pagesByDoc.set(docKey, pages)
    return pages.get(page) ?? null
  }

  /**
   * 解析整档并缓存。同 docKey 并发调用复用同一在途请求。
   * 超时 / 失败返回 false；整档无可用文字层时记 unavailable（后续直走回退）。
   */
  parseDocument(docKey: string, filePath: string): Promise<boolean> {
    if (this.markdownByDoc.has(docKey)) return Promise.resolve(true)
    if (this.status === 'unavailable') return Promise.resolve(false)
    const flying = this.inFlight.get(docKey)
    if (flying) return flying
    const task = this.doParse(docKey, filePath).finally(() => {
      this.inFlight.delete(docKey)
    })
    this.inFlight.set(docKey, task)
    return task
  }

  /** 文档切换 / 卸载时释放缓存 */
  dispose(): void {
    this.inFlight.clear()
    this.markdownByDoc.clear()
    this.pagesByDoc.clear()
    this.status = 'idle'
    this.reason = ''
  }

  private async doParse(docKey: string, filePath: string): Promise<boolean> {
    try {
      const response = await withTimeout(
        extractPdfBookMarkdown({ filePath }),
        PDF_INSPECT_TIMEOUT_MS,
        `解析超时（>${PDF_INSPECT_TIMEOUT_MS}ms）`,
      )
      if (!isOk(response) || typeof response.value.markdown !== 'string') {
        this.markUnavailable(
          !isOk(response) ? response.error.message : '解析返回异常',
        )
        return false
      }
      const markdown = response.value.markdown
      if (!markdown.trim()) {
        this.markUnavailable('整档无可用文字层')
        return false
      }
      this.markdownByDoc.set(docKey, markdown)
      this.pagesByDoc.set(docKey, splitMarkdownByPageMarkers(markdown, 1))
      // 有界驱逐：按插入序淘汰最旧文档
      while (this.markdownByDoc.size > PDF_INSPECT_MAX_DOCS) {
        const oldest = this.markdownByDoc.keys().next().value
        if (oldest === undefined || oldest === docKey) break
        this.markdownByDoc.delete(oldest)
        this.pagesByDoc.delete(oldest)
      }
      this.status = 'ready'
      this.reason = ''
      return true
    } catch {
      return false
    }
  }

  private markUnavailable(reason: string): void {
    this.status = 'unavailable'
    this.reason = reason
  }
}

function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | null = null
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(message)), ms)
  })
  return Promise.race([promise, timeout]).finally(() => {
    if (timer) clearTimeout(timer)
  })
}

export const pdfInspectorClient = new PdfInspectorClient()
