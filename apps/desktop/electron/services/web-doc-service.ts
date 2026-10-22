import { err, ok, type Result } from '@yitom/contracts'
import type { AppError } from '@yitom/contracts'
import { toAppError } from '@yitom/contracts'
import type {
  WebDocDiscoverTocPayload,
  WebDocDiscoverTocResult,
  WebDocTocEntry,
} from '@yitom/contracts'
import type {
  WebDocFetchPayloadWithMarkdown,
  WebDocFetchResultWithMarkdown,
  WebDocMarkdownSource,
} from '../../contracts/web-doc'
import {
  extractGenericWebDocToc,
  extractMdBookToc,
  resolveMdBookTocUrl,
  extractSameOriginDocLinks,
  resolveWebDocTocDiscoveryUrl,
} from '@montree/web-doc'
import {
  extractLlmsTocSection,
  extractLlmsTxtToc,
  normalizeLlmsDocHref,
  resolveLlmsTxtCandidates,
  looksLikeDocsIndexCandidate,
} from '@montree/web-doc'
import { tryFetchE2eWebDocFixture } from './web-doc/e2e-fixture'
import { extractPeopleDailyToc } from '@montree/web-doc'
import { resolveWebDocSiteId } from './web-doc/site-registry'
import { assertWebDocUrlAllowed, getWebDocLoopbackOrigin, normalizeWebDocUrl } from './web-doc/url-policy'

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

function htmlAttribute(tag: string, name: string): string | null {
  const match = new RegExp(`(?:^|\\s)${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i').exec(tag)
  return match?.[1] ?? match?.[2] ?? match?.[3] ?? null
}

/**
 * 文档站常用 `<link rel="alternate" type="text/markdown">` 暴露正文 Markdown 源。
 * 只读取声明，不猜测 URL；抓取失败时调用方仍回退 HTML。
 */
function resolveMarkdownAlternateUrl(
  html: string,
  pageUrl: string,
  localOrigin?: string,
): string | null {
  for (const tag of html.match(/<link\b[^>]*>/gi) ?? []) {
    const rel = htmlAttribute(tag, 'rel')?.toLowerCase().split(/\s+/) ?? []
    if (!rel.includes('alternate')) continue
    if (!htmlAttribute(tag, 'type')?.toLowerCase().startsWith('text/markdown')) continue
    const href = htmlAttribute(tag, 'href')?.replace(/&amp;/gi, '&')
    if (!href) continue
    try {
      return normalizeWebDocUrl(new URL(href, pageUrl).toString(), localOrigin)
    } catch {
      continue
    }
  }
  return null
}

/**
 * 重定向逐跳重验协议与主机；显式本机文档只继承初始同源权限，公网不能转入本机。
 */
async function fetchWebDocResponse(
  initialUrl: string,
  headers: Record<string, string>,
  localOrigin?: string,
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
    // 本机权限仅跟随原始同源链；跳到公网后不能再返回本机。
    if (new URL(current).origin !== localOrigin) localOrigin = undefined
    const next = normalizeWebDocUrl(new URL(location, current).toString(), localOrigin)
    if (new URL(next).origin !== localOrigin) localOrigin = undefined
    current = next
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
  payload: WebDocFetchPayloadWithMarkdown,
  localOrigin = getWebDocLoopbackOrigin(payload.url),
): Promise<Result<WebDocFetchResultWithMarkdown, AppError>> {
  try {
    const fixtureResult = await tryFetchE2eWebDocFixture(payload.url)
    if (fixtureResult) return fixtureResult

    const normalized = normalizeWebDocUrl(payload.url, localOrigin)
    const response = await fetchWebDocResponse(normalized, webDocHtmlHeaders(), localOrigin)

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

    const result: WebDocFetchResultWithMarkdown = {
      url: response.url || normalized,
      html,
    }
    if (payload.preferMarkdown) {
      const markdownUrl = resolveMarkdownAlternateUrl(html, result.url, localOrigin)
      if (markdownUrl) {
        const markdown = await fetchWebDocMarkdown(markdownUrl, localOrigin)
        if (markdown) result.markdown = markdown
      }
    }

    return ok(result)
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

/** 抓取纯文本资源（目录索引 / Markdown 源），允许 text/plain 与 text/markdown */
async function fetchWebDocPlainText(
  url: string,
  localOrigin?: string,
  label = '目录索引',
): Promise<Result<{ url: string; text: string }, AppError>> {
  try {
    const normalized = normalizeWebDocUrl(url, localOrigin)
    const response = await fetchWebDocResponse(normalized, webDocPlainTextHeaders(), localOrigin)

    if (!response.ok) {
      return toFetchError(httpStatusErrorMessage(response.status))
    }

    const text = await readResponseTextLimited(response)
    if (!text.trim()) {
      return toFetchError(`${label}为空`)
    }

    return ok({
      url: response.url || normalized,
      text,
    })
  } catch (cause) {
    if (cause instanceof Error && cause.name === 'AbortError') {
      return err({ code: 'ACP_TIMEOUT', message: `抓取${label}超时` })
    }
    if (cause instanceof Error && cause.message) {
      return toFetchError(cause.message)
    }
    return err(toAppError(cause, `抓取${label}失败`))
  }
}

async function fetchWebDocMarkdown(
  url: string,
  localOrigin?: string,
): Promise<WebDocMarkdownSource | null> {
  const result = await fetchWebDocPlainText(url, localOrigin, 'Markdown 源')
  if (!result.ok || /^\s*<(?:!doctype|html)\b/i.test(result.value.text)) return null
  return { url: result.value.url, text: result.value.text }
}

/**
 * 依次尝试 llms.txt 候选（页面声明 → 路径前缀 → 根）。优先采用包含当前页的索引，
 * 否则取第一个可用的；HTML 回退页（SPA 对未知路径返回 200 + 首页）一律跳过。
 */
async function discoverLlmsTxtToc(
  pageHref: string,
  html: string,
  origin: string,
  localOrigin: string | null | undefined,
): Promise<WebDocTocEntry[] | undefined> {
  const current = normalizeLlmsDocHref(pageHref, origin)
  let fallback: WebDocTocEntry[] | undefined
  for (const url of resolveLlmsTxtCandidates(pageHref, html)) {
    const result = await fetchWebDocPlainText(url, localOrigin ?? undefined)
    if (!result.ok || /^\s*<(?:!doctype|html)\b/i.test(result.value.text)) continue
    const entries = extractLlmsTxtToc(result.value.text, origin)
    if (entries.length < 3) continue
    if (current && entries.some((e) => e.href === current)) return entries
    fallback ??= entries
  }
  return fallback
}

export async function discoverWebDocToc(
  payload: WebDocDiscoverTocPayload,
): Promise<Result<WebDocDiscoverTocResult, AppError>> {
  const fetchResult = await fetchWebDocPage({ url: payload.url })
  if (!fetchResult.ok) return fetchResult
  const localOrigin = getWebDocLoopbackOrigin(fetchResult.value.url)

  try {
    const pageUrl = new URL(fetchResult.value.url)
    const siteId = resolveWebDocSiteId(pageUrl)
    const mdbookInline = extractMdBookToc(fetchResult.value.html, fetchResult.value.url)
    if (mdbookInline.length) return ok({ siteId, entries: mdbookInline })
    const mdbookTocUrl = resolveMdBookTocUrl(fetchResult.value.html, fetchResult.value.url)
    if (mdbookTocUrl) {
      const toc = await fetchWebDocPage({ url: mdbookTocUrl }, localOrigin ?? '')
      if (!toc.ok) return toc
      if (new URL(toc.value.url).origin !== pageUrl.origin) return toFetchError('mdBook 目录跳转到了其他站点')
      const entries = extractMdBookToc(toc.value.html, toc.value.url)
      if (!entries.length) return toFetchError('mdBook 目录未包含可读取的章节')
      return ok({ siteId, entries })
    }
    let sectionEntries = extractGenericWebDocToc(fetchResult.value.html, fetchResult.value.url)

    // 人民日报：通用密集列表若未命中，再回退纸媒版面列表（版面 DOM 特殊）
    if (sectionEntries.length === 0 && siteId === 'people-daily-paper') {
      sectionEntries = extractPeopleDailyToc(fetchResult.value.html, fetchResult.value.url)
    }

    if (sectionEntries.length === 0 && siteId !== 'people-daily-paper') {
      sectionEntries = extractSameOriginDocLinks(fetchResult.value.html, fetchResult.value.url)
    }

    // 站点级全站索引（如 llms.txt 等）：支持双轨并行
    let siteEntries: WebDocTocEntry[] | undefined

    // 若当前页面是无侧栏的独立内页（sectionEntries 仍为空），尝试回退到站点根入口拉取通用目录
    if (sectionEntries.length === 0 && siteId !== 'people-daily-paper') {
      const fallbackUrl = resolveWebDocTocDiscoveryUrl(fetchResult.value.url, siteId)
      if (fallbackUrl !== fetchResult.value.url) {
        const rootFetch = await fetchWebDocPage({ url: fallbackUrl }, localOrigin ?? '')
        if (rootFetch.ok) {
          const fromRoot = extractGenericWebDocToc(rootFetch.value.html, rootFetch.value.url)
          if (fromRoot.length > 0) {
            sectionEntries = fromRoot
          } else {
            sectionEntries = extractSameOriginDocLinks(rootFetch.value.html, rootFetch.value.url)
          }
          if (looksLikeDocsIndexCandidate(rootFetch.value.html)) {
            siteEntries = await discoverLlmsTxtToc(fetchResult.value.url, rootFetch.value.html, pageUrl.origin, localOrigin)
          }
        }
      }
    }

    // 站点级全站索引（如 llms.txt 等）：支持双轨并行
    if (!siteEntries && looksLikeDocsIndexCandidate(fetchResult.value.html)) {
      siteEntries = await discoverLlmsTxtToc(fetchResult.value.url, fetchResult.value.html, pageUrl.origin, localOrigin)
    }

    // 站点原生 llms.txt 已按模块/分组建树：当前页所在子树优先于 HTML 导航猜测。
    if (siteEntries) {
      const nativeSection = extractLlmsTocSection(siteEntries, fetchResult.value.url)
      if (nativeSection) sectionEntries = nativeSection
    }

    const hasSection = sectionEntries.length > 0
    const hasSite = Boolean(siteEntries && siteEntries.length > 0)

    // 双轨均存在且不相等时：默认优先展示当前局部板块，同时挂载双轨数据供用户切换
    if (
      hasSection &&
      hasSite &&
      (sectionEntries.length !== siteEntries!.length ||
        sectionEntries[0]?.href !== siteEntries![0]?.href)
    ) {
      return ok({
        siteId,
        entries: sectionEntries,
        sectionEntries,
        siteEntries,
      })
    }

    // 仅存在单轨（或两者完全一致）时返回单轨
    const resolvedEntries = hasSection ? sectionEntries : (siteEntries ?? [])
    return ok({
      siteId,
      entries: resolvedEntries,
    })
  } catch (cause) {
    return err(toAppError(cause, '解析文档目录失败'))
  }
}

export function validateWebDocUrl(raw: string, allowLocal = true): Result<string, AppError> {
  try {
    return ok(normalizeWebDocUrl(raw, allowLocal ? getWebDocLoopbackOrigin(raw) : undefined))
  } catch (cause) {
    return err(toAppError(cause, 'URL 无效'))
  }
}

/** 供单测与 handler 校验入参 */
export function parseWebDocUrlInput(raw: unknown, allowLocal = false): Result<string, AppError> {
  if (typeof raw !== 'string' || !raw.trim()) {
    return err({ code: 'FILE_READ_ERROR', message: 'URL 不能为空' })
  }
  return validateWebDocUrl(raw, allowLocal)
}

export { assertWebDocUrlAllowed }
