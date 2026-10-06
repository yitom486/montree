import { err, ok, type Result } from '@montree/contracts'
import type { AppError } from '@montree/contracts'
import { toAppError } from '@montree/contracts'
import type {
  WebDocDiscoverTocPayload,
  WebDocDiscoverTocResult,
  WebDocFetchPayload,
  WebDocFetchResult,
} from '@montree/contracts'
import {
  extractGenericWebDocToc,
  extractSameOriginDocLinks,
} from '@montree/web-doc'
import {
  extractLlmsTxtToc,
  looksLikeDocsIndexCandidate,
  resolveLlmsTxtUrl,
} from '@montree/web-doc'
import { tryFetchE2eWebDocFixture } from './web-doc/e2e-fixture'
import { extractPeopleDailyToc } from '@montree/web-doc'
import { resolveWebDocSiteId } from './web-doc/site-registry'
import { assertWebDocUrlAllowed, normalizeWebDocUrl } from './web-doc/url-policy'

const WEB_DOC_MAX_BYTES = 5 * 1024 * 1024
const WEB_DOC_FETCH_TIMEOUT_MS = 30_000
/** 手动跟随重定向上限（逐跳重验 URL 策略，防 302 跳内网） */
const WEB_DOC_MAX_REDIRECTS = 5

/**
 * 使用接近 Chromium 的 UA。部分 CDN（如 Vercel）会对自定义 bot UA 直接 429。
 * 末尾保留 Montree 标识，便于站点识别桌面阅读器。
 */
const WEB_DOC_USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36 Montree/0.2.7'

function webDocHtmlHeaders(): Record<string, string> {
  return {
    Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
    'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
    'User-Agent': WEB_DOC_USER_AGENT,
  }
}

function webDocPlainTextHeaders(): Record<string, string> {
  return {
    Accept: 'text/plain,text/markdown,text/*;q=0.9,*/*;q=0.8',
    'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
    'User-Agent': WEB_DOC_USER_AGENT,
  }
}

function httpStatusErrorMessage(status: number): string {
  if (status === 429) {
    return '请求过于频繁或站点限制了非浏览器访问（HTTP 429），请稍后再试'
  }
  if (status === 403) {
    return '站点拒绝访问（HTTP 403），可能限制了阅读器抓取'
  }
  return `请求失败（HTTP ${status}）`
}

function toFetchError(message: string): Result<never, AppError> {
  return err({ code: 'FILE_READ_ERROR', message })
}

/**
 * 带 SSRF 防护的抓取：redirect 手动跟随，每跳 Location 都经 normalizeWebDocUrl
 * 重验协议与主机（初始 URL 由调用方先验）。最终 response.url 同样可信。
 */
async function fetchWebDocResponse(
  initialUrl: string,
  headers: Record<string, string>,
): Promise<Response> {
  let current = initialUrl
  for (let hop = 0; hop <= WEB_DOC_MAX_REDIRECTS; hop++) {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), WEB_DOC_FETCH_TIMEOUT_MS)

    let response: Response
    try {
      response = await fetch(current, {
        signal: controller.signal,
        redirect: 'manual',
        headers,
      })
    } finally {
      clearTimeout(timer)
    }

    const isRedirect = response.status >= 300 && response.status < 400
    if (!isRedirect) return response
    if (hop === WEB_DOC_MAX_REDIRECTS) {
      await response.arrayBuffer().catch(() => undefined)
      throw new Error('重定向次数过多，请检查目标链接')
    }

    const location = response.headers.get('location')
    await response.arrayBuffer().catch(() => undefined)
    if (!location) return response
    // 相对 Location 按当前跳解析；非法/内网目标直接抛给调用方转业务错误
    current = normalizeWebDocUrl(new URL(location, current).toString())
  }
  throw new Error('重定向处理异常')
}

async function readResponseTextLimited(response: Response): Promise<string> {
  const lengthHeader = response.headers.get('content-length')
  if (lengthHeader) {
    const length = Number.parseInt(lengthHeader, 10)
    if (Number.isFinite(length) && length > WEB_DOC_MAX_BYTES) {
      throw new Error(`页面过大（>${Math.floor(WEB_DOC_MAX_BYTES / 1024 / 1024)}MB）`)
    }
  }

  const buffer = await response.arrayBuffer()
  if (buffer.byteLength > WEB_DOC_MAX_BYTES) {
    throw new Error(`页面过大（>${Math.floor(WEB_DOC_MAX_BYTES / 1024 / 1024)}MB）`)
  }

  return new TextDecoder('utf-8', { fatal: false }).decode(buffer)
}

export async function fetchWebDocPage(
  payload: WebDocFetchPayload,
): Promise<Result<WebDocFetchResult, AppError>> {
  try {
    const fixtureResult = await tryFetchE2eWebDocFixture(payload.url)
    if (fixtureResult) return fixtureResult

    const normalized = normalizeWebDocUrl(payload.url)
    const response = await fetchWebDocResponse(normalized, webDocHtmlHeaders())

    if (!response.ok) {
      return toFetchError(httpStatusErrorMessage(response.status))
    }

    const contentType = response.headers.get('content-type') ?? ''
    if (contentType && !/text\/html|application\/xhtml\+xml/i.test(contentType)) {
      return toFetchError('该链接不是 HTML 文档页')
    }

    const html = await readResponseTextLimited(response)
    if (!html.trim()) {
      return toFetchError('页面内容为空')
    }

    return ok({
      url: response.url || normalized,
      html,
    })
  } catch (cause) {
    if (cause instanceof Error && cause.name === 'AbortError') {
      return err({ code: 'ACP_TIMEOUT', message: '抓取页面超时' })
    }
    if (cause instanceof Error && cause.message) {
      return toFetchError(cause.message)
    }
    return err(toAppError(cause, '抓取页面失败'))
  }
}

/** 抓取站点目录索引（如 Mintlify `/llms.txt`），允许 text/plain */
async function fetchWebDocPlainText(
  url: string,
): Promise<Result<{ url: string; text: string }, AppError>> {
  try {
    const normalized = normalizeWebDocUrl(url)
    const response = await fetchWebDocResponse(normalized, webDocPlainTextHeaders())

    if (!response.ok) {
      return toFetchError(httpStatusErrorMessage(response.status))
    }

    const text = await readResponseTextLimited(response)
    if (!text.trim()) {
      return toFetchError('目录索引为空')
    }

    return ok({
      url: response.url || normalized,
      text,
    })
  } catch (cause) {
    if (cause instanceof Error && cause.name === 'AbortError') {
      return err({ code: 'ACP_TIMEOUT', message: '抓取目录索引超时' })
    }
    if (cause instanceof Error && cause.message) {
      return toFetchError(cause.message)
    }
    return err(toAppError(cause, '抓取目录索引失败'))
  }
}

export async function discoverWebDocToc(
  payload: WebDocDiscoverTocPayload,
): Promise<Result<WebDocDiscoverTocResult, AppError>> {
  const fetchResult = await fetchWebDocPage({ url: payload.url })
  if (!fetchResult.ok) return fetchResult

  try {
    const pageUrl = new URL(fetchResult.value.url)
    const siteId = resolveWebDocSiteId(pageUrl)
    let entries = extractGenericWebDocToc(fetchResult.value.html, fetchResult.value.url)

    // 站点级索引（llms.txt 等）：不绑域名，补全各页侧栏 SSR 缺失
    if (looksLikeDocsIndexCandidate(fetchResult.value.html)) {
      const llmsUrl = resolveLlmsTxtUrl(fetchResult.value.url, fetchResult.value.html)
      if (llmsUrl) {
        const llmsResult = await fetchWebDocPlainText(llmsUrl)
        if (llmsResult.ok) {
          const fromLlms = extractLlmsTxtToc(llmsResult.value.text, pageUrl.origin)
          if (fromLlms.length >= 3) {
            entries = fromLlms
          }
        }
      }
    }

    // 人民日报：通用密集列表若未命中，再回退纸媒版面列表（版面 DOM 特殊）
    if (entries.length === 0 && siteId === 'people-daily-paper') {
      entries = extractPeopleDailyToc(fetchResult.value.html, fetchResult.value.url)
    }

    const resolvedEntries =
      entries.length > 0
        ? entries
        : siteId === 'people-daily-paper'
          ? []
          : extractSameOriginDocLinks(fetchResult.value.html, fetchResult.value.url)

    return ok({
      siteId,
      entries: resolvedEntries,
    })
  } catch (cause) {
    return err(toAppError(cause, '解析文档目录失败'))
  }
}

export function validateWebDocUrl(raw: string): Result<string, AppError> {
  try {
    return ok(normalizeWebDocUrl(raw))
  } catch (cause) {
    return err(toAppError(cause, 'URL 无效'))
  }
}

/** 供单测与 handler 校验入参 */
export function parseWebDocUrlInput(raw: unknown): Result<string, AppError> {
  if (typeof raw !== 'string' || !raw.trim()) {
    return err({ code: 'FILE_READ_ERROR', message: 'URL 不能为空' })
  }
  return validateWebDocUrl(raw)
}

export { assertWebDocUrlAllowed }
