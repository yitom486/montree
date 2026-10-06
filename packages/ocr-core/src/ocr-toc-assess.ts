import { PDF_OCR_TOC_CACHE_VERSION, type ReaderTocUnit } from '@montree/contracts'
import { ocrTocToReaderUnits } from './ocr-toc-extractor'

/**
 * OCR 目录缓存评估（纯函数）：usable / suspect / invalid / legacy。
 *
 * - 本函数永不抛异常：输入视为 unknown 逐项校验，损坏数据一律收敛为
 *   invalid（配短原因），绝不让 PDF 加载流程报 FILE_READ_ERROR。
 * - invalid 只判客观结构错误：空、非法条目、页码偏移非法、页码或目录页
 *   范围越过真实页数。绝不以条数、缺章、编号跳跃判 invalid。
 * - suspect 只表达“不足以确认完整”（自动识别未经人工确认），不伪装成“确定残缺”。
 * - legacy：结构可读但缺少来源记录的旧版缓存（不自动删除，允许查看/重识/保存确认）。
 * - user-reviewed（origin=reviewed）短目录不受启发式完整性规则影响。
 * - entries 有效但 units 缺失/损坏时优先安全重建（repairedUnits），不判 invalid。
 */
export type OcrTocCacheStatus = 'usable' | 'suspect' | 'invalid' | 'legacy'

export interface OcrTocCacheAssessment {
  status: OcrTocCacheStatus
  /** 机器可读原因（稳定措辞，UI 取首条展示短原因） */
  reasons: string[]
  /** entries 有效但 units 缺失/失配时按条目重建的侧栏（调用方用它恢复） */
  repairedUnits?: ReaderTocUnit[]
}

function isValidPageCount(pageCount: unknown): pageCount is number {
  return Number.isInteger(pageCount) && (pageCount as number) >= 1
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function unitsMatch(
  actual: unknown,
  expected: readonly ReaderTocUnit[],
): boolean {
  if (!Array.isArray(actual) || actual.length !== expected.length) return false
  return actual.every((unit, index) => {
    if (!isRecord(unit)) return false
    const want = expected[index] as ReaderTocUnit | undefined
    return (
      unit.label === want?.label && unit.href === want?.href && unit.level === want?.level
    )
  })
}

function assessInner(
  cache: Record<string, unknown>,
  options: { pageCount: number },
): OcrTocCacheAssessment {
  const { pageCount } = options
  const entriesRaw: unknown = cache.entries
  if (!Array.isArray(entriesRaw) || entriesRaw.length === 0) {
    return { status: 'invalid', reasons: ['空目录：无有效条目'] }
  }
  // 页码偏移必须为非负整数（负数/小数会让全部换算错位）
  if (!Number.isInteger(cache.pageOffset) || (cache.pageOffset as number) < 0) {
    return { status: 'invalid', reasons: ['页码偏移非法'] }
  }
  const pageOffset = cache.pageOffset as number
  // 目录页范围必须恰为两个合法整数 [from, to]（非数组/长度不对一律非法，不解构抛错）
  const rangeRaw: unknown = cache.tocPageRange
  if (
    !Array.isArray(rangeRaw) ||
    rangeRaw.length !== 2 ||
    !Number.isInteger(rangeRaw[0]) ||
    !Number.isInteger(rangeRaw[1])
  ) {
    return { status: 'invalid', reasons: ['目录页范围非法'] }
  }
  const rangeFrom = rangeRaw[0] as number
  const rangeTo = rangeRaw[1] as number
  if (
    rangeFrom < 1 ||
    rangeTo < rangeFrom ||
    (isValidPageCount(pageCount) && rangeTo > pageCount)
  ) {
    return { status: 'invalid', reasons: ['目录页范围非法或越过全书页数'] }
  }
  interface CleanEntry {
    title: string
    printedPage: number
    level: number
  }
  const cleanEntries: CleanEntry[] = []
  for (const item of entriesRaw) {
    if (!isRecord(item)) {
      return { status: 'invalid', reasons: ['非法条目：条目不是对象'] }
    }
    const titleOk = typeof item.title === 'string' && item.title.trim().length > 0
    const pageOk = Number.isInteger(item.printedPage) && (item.printedPage as number) >= 1
    const levelOk = Number.isInteger(item.level) && (item.level as number) >= 0
    if (!titleOk || !pageOk || !levelOk) {
      const label = typeof item.title === 'string' && item.title ? `「${item.title}」` : '（空标题）'
      return { status: 'invalid', reasons: [`非法条目：${label}`] }
    }
    const printedPage = item.printedPage as number
    if (isValidPageCount(pageCount) && printedPage + pageOffset > pageCount) {
      return {
        status: 'invalid',
        reasons: [
          `页码越界：「${item.title}」印刷页 ${printedPage}+偏移 ${pageOffset} 超出全书 ${pageCount} 页`,
        ],
      }
    }
    cleanEntries.push({
      title: item.title as string,
      printedPage,
      level: item.level as number,
    })
  }

  // entries 有效 → units 缺失/损坏一律按条目重建，不判 invalid
  const expectedUnits = ocrTocToReaderUnits(
    cleanEntries.map((entry) => ({ ...entry, raw: entry.title })),
    pageOffset,
  )
  let repairedUnits: ReaderTocUnit[] | undefined
  if (!unitsMatch(cache.units, expectedUnits)) {
    repairedUnits = expectedUnits
  }

  // 来源判定（精确三态）：
  // - origin 缺失或不是 auto/reviewed → legacy（旧版，不自动删除）；
  // - origin=reviewed → usable（即使用户短目录、stats 缺失/损坏）；
  // - origin=auto → suspect。
  // 条数、缺章、编号跳跃永不参与判定（短目录/跳号/人工修订皆可合法）。
  const origin: unknown = cache.origin
  const stats: unknown = cache.stats
  const versionMismatch =
    cache.extractorVersion !== undefined && cache.extractorVersion !== PDF_OCR_TOC_CACHE_VERSION
  if (origin !== 'reviewed' && origin !== 'auto') {
    const assessment: OcrTocCacheAssessment = {
      status: 'legacy',
      reasons: ['旧版缓存缺少来源记录，建议打开校正目录核对后保存确认'],
    }
    if (repairedUnits) assessment.repairedUnits = repairedUnits
    return assessment
  }
  if (versionMismatch) {
    const assessment: OcrTocCacheAssessment = {
      status: 'legacy',
      reasons: ['旧版提取器缓存，建议打开校正目录核对后保存确认'],
    }
    if (repairedUnits) assessment.repairedUnits = repairedUnits
    return assessment
  }
  if (origin === 'reviewed') {
    const assessment: OcrTocCacheAssessment = { status: 'usable', reasons: [] }
    if (repairedUnits) assessment.repairedUnits = repairedUnits
    return assessment
  }
  // stats 缺失/损坏不伪造数字：接受数回退为实际条目数（事实），
  // 过滤数只采有效整数（否则按 0，不编造）
  const statsRecord = isRecord(stats) ? stats : null
  const accepted =
    statsRecord && Number.isInteger(statsRecord.acceptedEntries)
      ? (statsRecord.acceptedEntries as number)
      : cleanEntries.length
  const filtered =
    (statsRecord && Number.isInteger(statsRecord.droppedPool)
      ? (statsRecord.droppedPool as number)
      : 0) +
    (statsRecord && Number.isInteger(statsRecord.droppedLines)
      ? (statsRecord.droppedLines as number)
      : 0)
  const assessment: OcrTocCacheAssessment = {
    status: 'suspect',
    reasons: [
      `自动识别结果未经人工确认（共 ${accepted} 条${filtered > 0 ? `，过滤 ${filtered} 处` : ''}）`,
    ],
  }
  if (repairedUnits) assessment.repairedUnits = repairedUnits
  return assessment
}

export function assessPdfOcrTocCache(
  cache: unknown,
  options: { pageCount: number },
): OcrTocCacheAssessment {
  try {
    if (!isRecord(cache)) {
      return { status: 'invalid', reasons: ['缓存为空或无法解析'] }
    }
    return assessInner(cache, options)
  } catch {
    return { status: 'invalid', reasons: ['缓存结构异常，无法恢复'] }
  }
}
