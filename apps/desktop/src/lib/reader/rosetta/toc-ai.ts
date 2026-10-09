import type { OcrTocEntry, OcrTocEntrySource } from '@montree/contracts'
import {
  cleanupOcrTocTitle,
  computeTocPageRanges,
  inferLevel,
  isWatermarkTocEntry,
  normalizeOcrChinese,
  sortTocEntriesForDisplay,
} from '@montree/ocr-core'
import { sectionOfHeading } from '@montree/ocr-core'

/**
 * 目录 AI 整理：把目录页原图与 OCR 原文发给大模型做多模态/视觉结构化抽取，
 * 保持真实章节层级（Unit/Lesson/Section），并根据“下一部分起始页 - 1”推算结束页。
 * 结果进 PdfOcrTocEditor 当草稿由用户确认。页码对齐是确定性加法
 * （印刷页 + 偏移），不让模型猜，只让它做解析。
 * 有目录工具时模型直接写草稿（takeTocDraft 取走），无工具时回退 JSON 解析。
 */

export const TOC_AI_MAX_TEXT_CHARS = 30_000

export interface TocAiDraftEntry {
  title: string
  printedPage: number
  endPage?: number | null
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
  ocrText: string | null | undefined,
  fingerprint: string,
  options?: TocAiPromptOptions,
): string {
  const cleanOcr = (ocrText ?? '').trim()
  const text =
    cleanOcr.length > TOC_AI_MAX_TEXT_CHARS
      ? cleanOcr.slice(0, TOC_AI_MAX_TEXT_CHARS)
      : cleanOcr
  const withImages = options?.withImages === true
  const imageLine =
    withImages && options?.imagePages && options.imagePages.length > 0
      ? `附图为目录页原图（共 ${options.imagePages.length} 页：第 ${options.imagePages.join('、')} 页，按页码顺序）。`
      : withImages
        ? '附图为目录页原图（按页码顺序）。'
        : ''

  const lines = [
    withImages
      ? `你是专业图书目录结构化专家。${imageLine}请直接仔细阅读附图中的目录页原图，精确识别章节条目并结构化输出。`
      : '你是专业图书目录结构化专家。请从下面的目录页文本中提取章节条目并结构化输出。',
    '【工具与执行要求 - 严格单次执行】：',
    '1. 严禁调用 run_command、view_file、write_to_file 等任何终端/文件命令！所有需要的目录原图与文本已在本次消息中直接提供。',
    '2. 必须直接提取目录结构，并【仅调用一次】toc_replace_all 工具一次性写入完整草稿。',
    '3. 严禁反复循环调用工具，无需使用脚本二次验证。toc_replace_all 成功后，必须【立刻结束本轮回复】，输出一行 "DONE: X 条" 即可，不要输出任何多余解释。',
    `4. 本书指纹 fingerprint 为：${fingerprint}。`,
    '5. 工具不可用时才输出纯 JSON 数组：每个元素为 {"title": "章节标题", "printedPage": 印刷页码数字, "endPage": 结束页码数字或null, "level": 层级数字}。',
    '规则要求：',
    '1. 【层级保持真实树形】：根据字号大小、字体粗细与缩进深度准确判定 level：',
    '   - level 1（1级 单元）：单元/篇/部/Unit/Part（如「入门单元」「第1单元」「Unit 1」）；',
    '   - level 2（2级 课/章）：章/课/罗马数字序号/Lesson/Chapter（如「I. 日语的发音」「II. 日语的文字与书写方法」「第1课 李さんは中国...」）；',
    '   - level 3（3级 节）：节/Section（如「第1节」「1.1」）；',
    '   - level 4（4级 小节）：小节/专栏/1.1.1。',
    '   无法判断时，顶级单元填 1，次级课/章填 2。',
    withImages
      ? '2. 【看图读数】：人眼顺着标题右侧的点线/虚线引导符水平向右对齐印刷页码 printedPage，严禁跨行、跨栏借用页码或虚构数字；图上看不清宁可跳过，绝不编造。'
      : '2. 【同行数字】：页码只取同行数字，绝不跨行借用、无中生有。找不到对应页码的标题宁可跳过，绝不编造。',
    '3. 【起止页区间推导】：printedPage 为章节起始印刷页；若存在下一章节，当前章节的 endPage 为 下一章节起始页 - 1；若为末尾章节无后继，endPage 留空为 null。',
    '4. 【背景杂音与去水印】：自动忽略半透明斜向水印、联系方式、QQ群、网址、二维码、页眉页脚、版权印次等非目录噪音。',
    '5. 【标题原文忠实】：保留章节标题原文（含外语假名与标点），仅去除首尾多余空白，不要擅自改写或续写缺失章节。',
    '6. 【格式洁净】：走工具调用时不要输出重复 JSON；走 JSON 回退时只输出单个 JSON 数组，严禁包含任何前缀闲聊或解释。',
  ]

  if (options?.baseline && options.baseline.length > 0) {
    lines.push(
      '机器基线参考如下（`标题 | 印刷页 | 层级 | 证据`；层级 0=章/部，1=节，2=小节）：',
      ...options.baseline
        .slice(0, 300)
        .map(
          (entry) =>
            `- ${entry.title} | ${entry.printedPage} | ${entry.level} | ${baselineTrustLabel(entry.source)}`,
        ),
      '核对要求：逐行看图核对页码与层级，错的在返回表里直接给对的页；基线缺的行（图上有、表上无）要补上；返回的一定是修正后的完整表，不要只给差异。',
    )
  }

  if (text) {
    lines.push(
      withImages
        ? '以下为辅助参考 OCR 文本（若与图片视觉内容有出入，严格以附图为准）：'
        : '目录页文本内容如下：',
      text,
    )
  }

  return lines.join('\n')
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
    const endPage = toPrintedPage(record.endPage)
    prevPage = printedPage
    entries.push({
      title,
      printedPage,
      endPage: endPage ?? undefined,
      level: toLevel(record.level),
      source: 'ai',
    })
  }
  const withRanges = computeTocPageRanges(entries)
  if (dropped > 0) {
    warnings.push(`丢弃 ${dropped} 条空标题/非法页码`)
  }
  return { entries: withRanges, dropped, warnings }
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
    if (!/[\u4e00-\u9fff\u3040-\u30ff\uac00-\ud7afa-zA-Z]/.test(title) && !sectionOfHeading(title)) {
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
      if (pushUnique({ title, printedPage: aiEntry.printedPage, endPage: aiEntry.endPage, level, source: 'ai' })) {
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
    pushUnique({ title, printedPage: aiEntry.printedPage, endPage: aiEntry.endPage, level, source: 'ai' })
  }

  baseline.forEach((base, index) => {
    if (!consumed.has(index)) {
      if (ai.length > 0 && evidenceTier(base.source) < evidenceTier('ai')) {
        const minAiPage = Math.min(...ai.map((e) => e.printedPage))
        const maxAiPage = Math.max(...ai.map((e) => e.endPage ?? e.printedPage))
        if (base.printedPage >= minAiPage && base.printedPage <= maxAiPage) {
          dropped.push(`过滤未被 AI 采纳的基线存疑行「${base.title}」（页 ${base.printedPage}）`)
          return
        }
      }
      pushUnique({ ...base })
    }
  })

  const kept = sortTocEntriesForDisplay(merged, (entry) => {
    dropped.push(`「${entry.title}」页码 ${entry.printedPage} 倒退，疑似错配已丢弃`)
  })
  const withRanges = computeTocPageRanges(kept)
  return { entries: withRanges, conflicts, aiAdded, dropped }
}
