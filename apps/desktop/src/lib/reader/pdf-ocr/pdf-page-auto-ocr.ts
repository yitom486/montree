import type { PdfOcrPageCache } from '@montree/contracts'

/**
 * W3 当前页自动识别门（纯函数）：该页已上报无原生层（nativeCharCount<8，有原生层的
 * 页根本不会上报）→ 只认当前页（窗口邻页只记不认，翻到再认）→ 有缓存/导入中不动。
 * 不依赖文档级 isScannedOrMixed：profile 到达之前页级上报已能证明需要词层，
 * 等 profile 会整次认不了（竞态）。文档级标志仍只用于横幅与后台预识别。
 * 静默：调用方 catch 后不弹框，工具栏「识别本页」仍可手动重试。
 */
export function shouldAutoOcrViewportPage(input: {
  reportedMissing: boolean
  isCurrentPage: boolean
  hasCache: boolean
  importRunning: boolean
}): boolean {
  if (!input.reportedMissing) return false
  if (!input.isCurrentPage) return false
  if (input.hasCache) return false
  if (input.importRunning) return false
  return true
}

/**
 * W3 全书导入互斥：running 期间禁止第二趟 OCR（含手动「识别本页」与后台预识别，
 * 统一在 runPageOcr 入口挡住；已在途的单页任务不受影响）。
 */
export function assertPageOcrAllowed(input: { importRunning: boolean; page: number }): void {
  if (input.importRunning) {
    throw new Error(`第 ${input.page} 页暂无法识别：全书识别进行中，请等待完成或取消后再试`)
  }
}

/**
 * W3 hydrate 按页合并：导入每完成一块就把新落盘页并进来，
 * 不得整表覆盖丢掉用户已认的其它页。落盘新数据优先（后写赢）。
 */
export function mergeOcrPageCaches(
  prev: Record<number, PdfOcrPageCache>,
  fresh: Record<number, PdfOcrPageCache>,
): Record<number, PdfOcrPageCache> {
  return { ...prev, ...fresh }
}
