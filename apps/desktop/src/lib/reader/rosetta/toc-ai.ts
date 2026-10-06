import type { OcrTocEntry, OcrTocEntrySource } from '@montree/contracts'
import {
  cleanupOcrTocTitle,
  inferLevel,
  isWatermarkTocEntry,
  normalizeOcrChinese,
  sortTocEntriesForDisplay,
} from '@montree/ocr-core'
import { sectionOfHeading } from '@montree/ocr-core'

/**
 * 目录 AI 整理：把目录页 OCR 原文发给大模型做结构化抽取，
 * 结果进 PdfOcrTocEditor 当草稿由用户确认。页码对齐是确定性加法
 * （印刷页 + 偏移），不让模型猜，只让它做解析。
 * 有目录工具时模型直接写草稿（takeTocDraft 取走），无工具时回退 JSON 解析。
 */

export const TOC_AI_MAX_TEXT_CHARS = 30_000

export interface TocAiDraftEntry {
  title: string
  printedPage: number
  level: number
}

export interface TocAiParseResult {
  entries: OcrTocEntry[]
  /** 被丢弃的条目数（空标题/非法页码） */
  dropped: number
  /** 需用户留意的警告（页码倒退等），展示用 */
  warnings: string[]
}

export interface TocAiPromptOptions {
  /** 附上目录页原图时为 true：以图为准，OCR 文本只当辅助定位 */
  withImages?: boolean
  /** 附图页数（withImages 时写入提示，便于模型核对缺页） */
  imagePages?: readonly number[]
  /**
   * 机器基线表（启发式已出结果，附证据等级）：模型当核对者不当重做者——
   * 逐行核对页码，错的修正，缺的补上，返回修正后的完整表。
   */
  baseline?: readonly OcrTocEntry[]
}

/** 基线行证据标注（钉死的错了也只能指出，不能直接改） */
function baselineTrustLabel(source: OcrTocEntrySource | undefined): string {
  if (source === 'manual') return '用户已确认，以它为准'
  if (source === 'pipe' || source === 'geo') return '已钉死（表格/坐标证据），除非图上明确矛盾否则保留，矛盾请单列指出'
  return '存疑（机器推测），重点核对'
}

export function buildTocAiPrompt(
  ocrText: string,
  fingerprint: string,
  options?: TocAiPromptOptions,
): string {
  const text =
    ocrText.length > TOC_AI_MAX_TEXT_CHARS
      ? ocrText.slice(0, TOC_AI_MAX_TEXT_CHARS)
      : ocrText
  const withImages = options?.withImages === true
  const imageLine =
    withImages && options?.imagePages && options.imagePages.length > 0
      ? `附图为目录页原图（共 ${options.imagePages.length} 页：第 ${options.imagePages.join('、')} 页，按页码顺序），`
      : '附图为目录页原图（按页码顺序），'
  return [
    withImages
      ? `你是图书目录结构化助手。${imageLine}以附图为准提取章节条目，OCR 文本只供辅助定位。`
      : '你是图书目录结构化助手。从下面的目录页 OCR 文本中提取章节条目。',
    '优先使用已提供的 toc_* MCP 工具；完整参数与限制以 tools/list 返回的工具描述为准。' +
      '完整目录优先 toc_replace_all，小修补使用 toc_upsert_entry / toc_delete_entry，写完可用 toc_list_draft 自查。',
    `本书指纹 fingerprint 为：${fingerprint}。`,
    '工具全部成功后只回复一行 DONE 加条数，不要输出其它文字。',
    '工具不可用时才输出 JSON 数组：每个元素为 {"title": "章节标题", "printedPage": 印刷页码数字, "level": 层级数字}。',
    '规则：',
    '1. 走工具时以工具返回为准、不输出 JSON；走 JSON 回退时只输出一个 JSON 数组，不要其它文字，不要用代码块包裹之外的解释。',
    '2. 每个元素为 {"title": "章节标题", "printedPage": 印刷页码数字, "level": 层级数字}。',
    '3. level：章/部为 1，节为 2，小节为 3，以此类推；无法判断时填 1。',
    '4. printedPage 取标题同一行或紧邻的页码；标题跨行时把多行拼成一个标题。',
    withImages
      ? '5. 看图读数：页码取标题同一行右侧的数字（点线只是引导线）；跨行、跨栏借用一律不许；图上看不清的宁可跳过，也绝不编造。OCR 文本里缺页码的行，图上能看清就补，看不清就跳过。'
      : '5. 文本已预处理：每行要么是“标题 页码”成对出现，要么是无页码标题——页码只取同行数字，绝不跨行借用、无中生有。',
    '5. 找不到对应页码的标题宁可跳过，也绝不编造页码；同一页码连续出现超过 10 次必有错误，须停下来重新核对。',
    '6. 忽略页眉页脚、广告、"目录"字样本身、省略号点线、登录提示等非目录噪音。',
    '6. 标题保留原文（含标点），只做去首尾空白；不要改写、不要续写缺失章节。',
    ...(options?.baseline && options.baseline.length > 0
      ? [
          '机器基线表如下（`标题 | 印刷页 | 层级 | 证据`；层级 0=章/部，1=节，2=小节）：',
          ...options.baseline
            .slice(0, 300)
            .map(
              (entry) =>
                `- ${entry.title} | ${entry.printedPage} | ${entry.level} | ${baselineTrustLabel(entry.source)}`,
            ),
          '核对要求：逐行看图核对页码，错的在返回表里直接给对的页；基线缺的行（图上有、表上无）要补上；返回的一定是修正后的完整表，不要只给差异。',
        ]
      : []),
    withImages ? '目录页 OCR 文本如下（仅供辅助定位）：' : '目录页 OCR 文本如下：',
    text,
  ].join('\n')
}

/** 从模型回复中抠 JSON 数组（容忍 ```json 围栏与前后杂话） */
function extractJsonArraySlice(replyText: string): string | null {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(replyText)
  const candidate = (fenced?.[1] ?? replyText).trim()
  const start = candidate.indexOf('[')
  const end = candidate.lastIndexOf(']')
  if (start < 0 || end <= start) return null
  return candidate.slice(start, end + 1)
}


/**
 * 模型口径 1-based（章=1，见提示词）→ 存储 0-based（章=0，与启发式同口径）。
 * 缺省按章算（0）。深度最终以章节号重算为准（见 mergeTocAiDraft），这里只保底。
 */
function toLevel(value: unknown): number {
  const n = typeof value === 'number' ? value : Number.parseInt(String(value ?? ''), 10)
  if (!Number.isFinite(n)) return 0
  return Math.min(6, Math.max(0, Math.floor(n) - 1))
}

function toPrintedPage(value: unknown): number | null {
  const n = typeof value === 'number' ? value : Number.parseFloat(String(value ?? ''))
  if (!Number.isFinite(n) || n < 1) return null
  return Math.floor(n)
}

export function parseTocAiEntries(replyText: string): TocAiParseResult {
  const warnings: string[] = []
  let dropped = 0
  const slice = extractJsonArraySlice(replyText)
  if (!slice) {
    return { entries: [], dropped: 0, warnings: ['模型回复中没有找到 JSON 数组'] }
  }
  let raw: unknown
  try {
    raw = JSON.parse(slice) as unknown
  } catch {
    return { entries: [], dropped: 0, warnings: ['模型回复的 JSON 解析失败'] }
  }
  if (!Array.isArray(raw)) {
    return { entries: [], dropped: 0, warnings: ['模型回复不是 JSON 数组'] }
  }

  const entries: OcrTocEntry[] = []
  let prevPage = 0
  let samePageRun = 0
  let runStartTitle = ''
  for (const item of raw) {
    if (typeof item !== 'object' || item === null) {
      dropped += 1
      continue
    }
    const record = item as Record<string, unknown>
    const title = typeof record.title === 'string' ? record.title.trim() : ''
    const printedPage = toPrintedPage(record.printedPage)
    if (!title || printedPage === null) {
      dropped += 1
      continue
    }
    // 模型也会照抄水印碎片（如 87929797王道计），与启发式同口径丢弃
    if (isWatermarkTocEntry(title)) {
      dropped += 1
      warnings.push(`丢弃水印条目「${title}」`)
      continue
    }
    if (printedPage < prevPage) {
      warnings.push(`「${title}」页码 ${printedPage} 小于上一条 ${prevPage}，请核对`)
    }
    if (printedPage === prevPage) {
      samePageRun += 1
    } else {
      samePageRun = 1
      runStartTitle = title
    }
    // 同一页码连号过长=模型在编：真实目录极少有 13 个条目同起一页
    if (samePageRun === 13) {
      warnings.push(`从「${runStartTitle}」起连续 ${samePageRun} 条同为 ${printedPage} 页，疑似编造页码，请核对目录页范围`)
    }
    prevPage = printedPage
    entries.push({ title, printedPage, level: toLevel(record.level), source: 'ai' })
  }
  if (dropped > 0) {
    warnings.push(`丢弃 ${dropped} 条空标题/非法页码`)
  }
  return { entries, dropped, warnings }
}

/**
 * 证据等级（merge 裁决用）：manual（手填）> pipe/geo（表格/坐标钉死）
 * > ai（模型看图）> read/paired/backfilled/未知（文本推测）。
 */
function evidenceTier(source: OcrTocEntrySource | undefined): number {
  if (source === 'manual') return 4
  if (source === 'pipe' || source === 'geo') return 3
  if (source === 'ai') return 2
  return 1
}

export interface TocMergeOptions {
  /** 真实总页数（与 pageOffset 联动做范围门，AI 新增条目用） */
  pageCount?: number
  /** 印刷页 + 偏移 = 真实页 */
  pageOffset?: number
}

export interface TocMergeResult {
  entries: OcrTocEntry[]
  /** 钉死项被 AI 改动：沿用钉死值，逐条留痕（展示用） */
  conflicts: string[]
  /** AI 新增且收下的条数 */
  aiAdded: number
  /** 丢弃的 AI 条目及原因（展示用） */
  dropped: string[]
}

/**
 * AI 核对表与机器基线的合并裁决（AI 为主干，钉死为红线）。
 *
 * - 同键两边都有：等级高者赢；manual/pipe/geo 赢时留冲突痕（AI 值公示）；
 *   ai 赢（对 read/paired/backfilled）静默采用——这正是要 AI 干的活。
 * - 仅 AI 有：有据（中文/章节号、合法页、范围内）才收，否则丢弃留痕。
 * - 仅基线有：保留（AI 漏看不等于不存在）。
 * - 层级一律按章节号重算（`inferLevel`），不采模型填的——深度是编号事实，
 *   不是视觉判断；无号标题才用 AI 给的层级。
 * - 同标题同页重复只留一条（模型重发/基线自带重复，`5.3.4` 这种同号不同名不受影响）。
 * - 最后过展示序 + 单调门（AI 幻觉页码同样被拦，丢弃留痕）。
 */
export function mergeTocAiDraft(
  baseline: readonly OcrTocEntry[],
  ai: readonly OcrTocEntry[],
  options?: TocMergeOptions,
): TocMergeResult {
  const conflicts: string[] = []
  const dropped: string[] = []
  let aiAdded = 0

  const inRange = (page: number): boolean => {
    if (options?.pageCount == null || options?.pageOffset == null) return true
    const real = page + Math.round(options.pageOffset)
    return real >= 1 && real <= (options.pageCount as number)
  }

  // 基线双索引：标题精确匹配优先（同号双胞胎如两个 5.3.4 各对各的），
  // 标题对不上才按章节号找同节首个未消费行；消费按行下标记，不按合并键。
  const normTitleOf = (title: string): string =>
    cleanupOcrTocTitle(normalizeOcrChinese(title))
  const baseByTitle = new Map<string, number[]>()
  const baseBySection = new Map<string, number[]>()
  baseline.forEach((entry, index) => {
    const titleKey = normTitleOf(entry.title)
    if (titleKey) {
      const list = baseByTitle.get(titleKey) ?? []
      list.push(index)
      baseByTitle.set(titleKey, list)
    }
    const section = sectionOfHeading(entry.title)
    if (section) {
      const list = baseBySection.get(section) ?? []
      list.push(index)
      baseBySection.set(section, list)
    }
  })

  const merged: OcrTocEntry[] = []
  const consumed = new Set<number>()
  const seen = new Set<string>()
  const pushUnique = (entry: OcrTocEntry): boolean => {
    const key = `${entry.title}|${entry.printedPage}`
    if (seen.has(key)) {
      dropped.push(`重复条目「${entry.title}」已去重（页 ${entry.printedPage}）`)
      return false
    }
    seen.add(key)
    merged.push(entry)
    return true
  }
  const takeBaseMatch = (title: string): OcrTocEntry | null => {
    const titleHits = baseByTitle.get(normTitleOf(title)) ?? []
    for (const index of titleHits) {
      if (!consumed.has(index)) {
        consumed.add(index)
        return baseline[index] as OcrTocEntry
      }
    }
    const section = sectionOfHeading(title)
    const sectionHits = section ? (baseBySection.get(section) ?? []) : []
    for (const index of sectionHits) {
      if (!consumed.has(index)) {
        consumed.add(index)
        return baseline[index] as OcrTocEntry
      }
    }
    return null
  };
  for (const aiEntry of ai) {
    const title = aiEntry.title.trim()
    if (title.length < 2) {
      dropped.push(`丢弃 AI 空标题（页 ${aiEntry.printedPage}）`)
      continue
    }
    if (!/[\u4e00-\u9fff]/.test(title) && !sectionOfHeading(title)) {
      dropped.push(`丢弃 AI 非目录条目「${title}」`)
      continue
    }
    if (
      !Number.isInteger(aiEntry.printedPage) ||
      aiEntry.printedPage < 1 ||
      aiEntry.printedPage > 3000 ||
      !inRange(aiEntry.printedPage)
    ) {
      dropped.push(`丢弃 AI 非法页码「${title}」：${aiEntry.printedPage}`)
      continue
    }
    const base = takeBaseMatch(title)
    const level = sectionOfHeading(title) ? inferLevel(title) : aiEntry.level
    if (!base) {
      if (pushUnique({ title, printedPage: aiEntry.printedPage, level, source: 'ai' })) {
        aiAdded += 1
      }
      continue
    }
    if (evidenceTier(base.source) > evidenceTier('ai')) {
      pushUnique({ ...base })
      if (base.printedPage !== aiEntry.printedPage) {
        conflicts.push(`「${title}」沿用钉死页 ${base.printedPage}（AI 给 ${aiEntry.printedPage}），请核对`)
      }
      continue
    }
    pushUnique({ title, printedPage: aiEntry.printedPage, level, source: 'ai' })
  }

  baseline.forEach((base, index) => {
    if (!consumed.has(index)) pushUnique({ ...base })
  })

  const kept = sortTocEntriesForDisplay(merged, (entry) => {
    dropped.push(`「${entry.title}」页码 ${entry.printedPage} 倒退，疑似错配已丢弃`)
  })
  return { entries: kept, conflicts, aiAdded, dropped }
}
