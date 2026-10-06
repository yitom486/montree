import type { PdfOcrPageCache } from '@montree/contracts'

export interface OcrPageCacheHydrateDeps {
  listPages: () => Promise<number[]>
  getPage: (page: number) => Promise<PdfOcrPageCache | null>
}

/**
 * U1 打开时载入已持久化的页词缓存：扫描/混合不区分，有缓存就载。
 * 页码不一致或取失败的条目丢弃（「识别本页」可补）；无缓存返回空对象。
 * 只喂 PdfPageView 透明词层，不得接到 Agent 正文链路。
 */
export async function loadPersistedOcrPageCaches(
  fileFingerprint: string,
  deps: OcrPageCacheHydrateDeps,
): Promise<Record<number, PdfOcrPageCache>> {
  if (!fileFingerprint) return {}
  let pages: number[]
  try {
    pages = await deps.listPages()
  } catch {
    return {}
  }
  const entries = await Promise.all(
    pages
      .filter((page) => Number.isInteger(page) && page > 0)
      .map(async (page) => {
        try {
          const cache = await deps.getPage(page)
          if (!cache || cache.page !== page || !Array.isArray(cache.words)) return null
          return [page, cache] as const
        } catch {
          return null
        }
      }),
  )
  return Object.fromEntries(entries.filter((item) => item !== null))
}
