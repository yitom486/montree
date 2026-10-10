import { webDocApi } from '@/api/web-doc-api'
import { htmlToText } from '@/lib/agent/context/extract-dom-text'
import { buildWebDocPageContent } from '@/lib/reader/web-doc/web-doc-html'
import type { ReaderUnit } from '@montree/reader-core'
import { normalizeWebDocNavUrl } from '@montree/reader-core'
import { resolveWebDocSiteId } from '@montree/web-doc'
import { isOk } from '@montree/contracts'
import type { ReaderUnitText } from '@/lib/agent/context/reader-content-registry'

const WEB_DOC_TEXT_CACHE_LIMIT = 48

const textCache = new Map<string, string>()

function rememberCachedText(pageUrl: string, text: string): void {
  const key = normalizeWebDocNavUrl(pageUrl)
  if (textCache.size >= WEB_DOC_TEXT_CACHE_LIMIT) {
    const oldest = textCache.keys().next().value
    if (oldest) textCache.delete(oldest)
  }
  textCache.set(key, text)
}

export function primeWebDocAgentTextCache(pageUrl: string, text: string): void {
  rememberCachedText(pageUrl, text)
}

export function clearWebDocAgentTextCache(): void {
  textCache.clear()
}

export async function fetchWebDocPlainText(pageUrl: string): Promise<string> {
  const key = normalizeWebDocNavUrl(pageUrl)
  const cached = textCache.get(key)
  if (cached !== undefined) return cached

  const result = await webDocApi.fetchPage({ url: pageUrl })
  if (!isOk(result)) {
    throw new Error(result.error.message)
  }

  const content = buildWebDocPageContent(
    result.value.html,
    result.value.url,
    resolveWebDocSiteId(result.value.url),
  )
  const text = htmlToText(content.bodyHtml)
  rememberCachedText(result.value.url, text)
  return text
}

export function buildWebDocExternalChapterNotice(label: string, href: string): string {
  return [
    `【在线文档外部章节提示】`,
    `章节「${label}」为未在阅读器中加载的外部在线网页。`,
    `目标链接：${href}`,
    ``,
    `当前桌面阅读器常驻用户正在阅读的单页 DOM。跨页轻量抓取受到该站点的网络/反爬机制或单页应用（SPA）动态渲染限制未能直接提取纯文本。`,
    `💡 建议方案：请直接使用你的 Web Fetch 或 Web Search 工具访问上述目标链接（${href}）读取内容并解答用户问题。`,
  ].join('\n')
}

export async function readWebDocUnitByIndex(
  units: readonly ReaderUnit[],
  flatIndex: number,
): Promise<ReaderUnitText> {
  const unit = units[flatIndex]
  if (!unit) {
    throw new Error(`flatIndex 越界：有效范围 0..${Math.max(0, units.length - 1)}，收到 ${flatIndex}`)
  }

  try {
    const text = await fetchWebDocPlainText(unit.href)
    if (text.trim()) {
      return {
        label: unit.label,
        text,
      }
    }
  } catch {
    // 跨页抓取失败或正文提取为空时，平滑降级为明确的引导提示，不中断 Agent 思考链
  }

  return {
    label: unit.label,
    text: buildWebDocExternalChapterNotice(unit.label, unit.href),
  }
}

export async function* iterateWebDocUnits(
  units: readonly ReaderUnit[],
): AsyncIterable<ReaderUnitText> {
  for (const unit of units) {
    try {
      const text = await fetchWebDocPlainText(unit.href)
      if (text.trim()) {
        yield {
          label: unit.label,
          text,
        }
      }
    } catch {
      // 迭代搜索跳过失败的外部单页，保障整体检索流程不中断
    }
  }
}

