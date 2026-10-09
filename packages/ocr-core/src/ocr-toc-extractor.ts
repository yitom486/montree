/**
 * 从 OCR 纯文本提取教材目录。
 * 有范围参数时先经 directory-reassemble 重组（竖线拆分/数字汤配对/范围门）；
 * 注意与那边互引：双方只在函数体内使用对方绑定，无顶层求值循环。
 */

import {
  compareSectionStrings,
  reassembleDirectoryText,
  type DirectoryReassembleStats,
} from './directory-reassemble'
import type { OcrTocEntrySource } from '@montree/contracts'

export interface OcrTocEntry {
  title: string
  printedPage: number
  /** 结束印刷页码。若有下一部分则为下一部分起始页 - 1，无后继则留空 */
  endPage?: number | null
  level: number
  raw: string
  /** 证据等级（合并裁决用，见 shared/types/ocr） */
  source?: OcrTocEntrySource
}

/** 通用出版元数据与网络引流噪音（不包含任何具体品牌名称） */
const NOISE_PATTERNS = [
  /https?:\/\//i,
  /\b[a-z0-9\-]+\.(?:com|cn|net|org|edu|gov|vip|cc|io)\b/i,
  /qq\s*群?[:：\s]*\d+/i,
  /微信\s*公众号?/i,
  /扫码|二维码/i,
  /水印/i,
  /版权所有|翻印必究|侵权必究/i,
  /ISBN\b/i,
  /CIP\b/i,
  /邮编/i,
  /印张|字数|版次|印次|定价/i,
]

export function normalizeOcrChinese(text: string): string {
  return text
    .replace(/\s+/g, '')
    .replace(/[·…．。，,]/g, '')
}

export function isNoiseLine(line: string): boolean {
  const compact = normalizeOcrChinese(line)
  if (compact.length < 3) return true
  return NOISE_PATTERNS.some((p) => p.test(compact) || p.test(line))
}

/** 通用网络营销/引流/水印标识 */
export const GENERIC_WATERMARK_PATTERNS: readonly RegExp[] = [
  /https?:\/\//i,
  /\b[a-z0-9\-]+\.(?:com|cn|net|org|edu|gov|vip|cc|io)\b/i,
  /qq\s*群?[:：\s]*\d+/i,
  /微信\s*公众号?/i,
  /扫码|二维码/i,
  /水印|盗版|交流群/i,
]

/**
 * 水印碎片与营销干扰过滤（纯通用逻辑，严禁硬编码任何具体商业名称）：
 * 1. 外部注入/动态发现的已知水印集合（优先完全匹配）；
 * 2. 命中网址、域名、QQ群、微信、扫码等通用引流/水印模式；
 * 3. 含有 6 位以上连续数字碎片（如常见交流群号），且缺少合法章节编号前缀。
 */
export function isWatermarkTocEntry(
  title: string,
  knownWatermarks?: readonly string[],
): boolean {
  const compact = normalizeOcrChinese(title)
  if (compact.length < 2 || compact.length > 30) return false

  // 1. 外部注入/整书发现的已知水印集合
  if (knownWatermarks && knownWatermarks.length > 0) {
    const lower = compact.toLowerCase()
    if (knownWatermarks.some((w) => w && lower.includes(w.toLowerCase()))) {
      return true
    }
  }

  // 2. 通用引流/营销特征
  if (GENERIC_WATERMARK_PATTERNS.some((p) => p.test(compact))) {
    return true
  }

  // 3. 6 位以上连续数字碎片（如常见交流群号），且非章节前缀
  if (/\d{6,}/.test(compact) && !/^第?\d+章/.test(compact) && !/^\d+\.\d+/.test(compact)) {
    return true
  }

  return false
}

/**
 * 数字汤行（点线页码被 OCR 拆散后又粘回标题后，如 “…251254”）：
 * 超长且数字标点过半的不可能是章节名（章节编号本身再密也只占几字）。
 * 短标题豁免：3.1.1概述这类合法短节名数字占比天然高。
 */
export function isDigitSoupTitle(title: string): boolean {
  const chars = [...title]
  if (chars.length <= 12) return false
  const noisyCount = chars.filter((ch) => /[\d\s.·…．。，,\-—–_#|｜丨:：;；]/.test(ch)).length
  return noisyCount / chars.length > 0.6
}

export function cleanupOcrTocTitle(title: string): string {
  return title
    .replace(/^#]11/, '第1章')
    .replace(/^#]1/, '第1章')
    .replace(/^第\s*(\d+)\s*章/, '第$1章')
    .replace(/_{1,}/g, '')
    .replace(/["""]/g, '')
    // “*” 是删纲标记前缀（*1.1…），“①” 是页脚注标：只去首尾，不动中间
    .replace(/^[*#\s]+/, '')
    .replace(/[①②③④⑤⑥⑦⑧⑨\s]+$/, '')
    .trim()
}

export function inferLevel(title: string): number {
  const trimmed = title.trim()
  // 顶级：单元 / 篇 / 编 / 部 / Unit / Part / 章（无单元时的顶级）
  if (
    /^(?:第[0-9一二三四五六七八九十百千]+[单元篇编部]|入门单元|单元\s*\d+|Unit\b|UNIT\b|Part\b|PART\b)/i.test(
      trimmed,
    )
  ) {
    return 0
  }
  if (/^第[0-9一二三四五六七八九十百千]+章/.test(trimmed)) return 0

  // 次级：课 / Lesson / 罗马数字序号 (I., II., Ⅰ, Ⅱ)
  if (
    /^(?:第[0-9一二三四五六七八九十百千]+课|Lesson\b|LESSON\b|[IVXLCDM]+[\.、\s]|[Ⅰ-Ⅻ][\.、\s]?)/i.test(
      trimmed,
    )
  ) {
    return 1
  }

  if (/^第[0-9一二三四五六七八九十百千]+节/.test(trimmed)) return 1
  // 三段号（2.1.1）是小节 level2，四段号 level3；须先于两段号判定，
  // 否则 2.1.1 会被误判为 level1 导致侧栏扁平与回填涂抹（同级继承）。
  const deep = trimmed.match(/^(\d+)\.(\d+)\.(\d+)(?:\.(\d+))?/)
  if (deep) {
    if (deep[4] !== undefined) return 3
    return 2
  }
  const section = trimmed.match(/^(\d+)\.(\d+)/)
  if (section) {
    const [, major, minor] = section
    if (minor === '0' || minor === '00') return 0
    if (major && minor) return minor.length <= 2 ? 1 : 2
  }
  return 1
}

export const TOC_LINE = /^(.+?)(?:[.·…．。\-—–_\s]{1,8})?(\d{1,4})\s*$/

/**
 * 无页码父项行（目录里常见：父标题不印页码，页码只印在子条目上）。
 * 保守判定：章/节编号开头、短行、无句读（正文句子必带 。？！），且过噪音与水印。
 * 但第X章除外：真实目录里章一定带页码（见书影），无数字的章行是数字丢失，
 * 继承后代页码必错（章起始远在子节之前），直接丢弃；节父项与长子同起一页，
 * 继承合理。连续上限防整段涂抹。
 */
const PAGELESS_HEADING = /^(?:\d+\.)+\d*\s*.{1,30}$/

export function parsePagelessHeading(
  line: string,
  knownWatermarks?: readonly string[],
): string | null {
  // 与 TOC_LINE 分支同口径：先归一化去空格，侧栏标题与旧条目一致无空格
  const compact = normalizeOcrChinese(line)
  if (compact.length < 2 || compact.length > 40 || /[。？！]/.test(compact)) return null
  if (isNoiseLine(line)) return null
  const title = cleanupOcrTocTitle(compact)
  if (title.length < 2) return null
  if (isWatermarkTocEntry(title, knownWatermarks)) return null
  if (!PAGELESS_HEADING.test(title)) return null
  if (!/[\u4e00-\u9fff]/.test(title) && !/^第\d+章/.test(title) && !/^\d+\.\d+/.test(title)) {
    return null
  }
  return title
}

export interface ExtractOcrTocOptions {
  /** 真实总页数（与 pageOffset 联动做范围门） */
  pageCount?: number
  /** 印刷页 + 偏移 = 真实页 */
  pageOffset?: number
  /** 几何配对表（章节号 → 印刷页，见 toc-geometry），直透重组 */
  geometryPages?: ReadonlyMap<string, number>
  /** 已知水印集合（几何发现或外部配置注入，防硬编码） */
  knownWatermarks?: readonly string[]
  /** 重组统计回传（调用方拼识别摘要用；legacy 无参数路径不调用） */
  onDiagnostics?: (stats: DirectoryReassembleStats) => void
}

export function extractOcrTocFromText(text: string, options?: ExtractOcrTocOptions): OcrTocEntry[] {
  // 有范围参数时先重组（竖线拆分/数字汤配对/范围门/几何直配），无参数走 legacy 原文
  const rangeGated = options?.pageCount != null && options?.pageOffset != null
  const reassembled = rangeGated
    ? reassembleDirectoryText(text, {
        pageCount: options?.pageCount as number,
        pageOffset: options?.pageOffset as number,
        geometryPages: options?.geometryPages,
      })
    : null
  if (reassembled) {
    options?.onDiagnostics?.(reassembled.stats)
  }
  const source = reassembled?.text ?? text
  const pinned = reassembled?.pinned ?? new Map<string, { page: number; kind: 'pipe' | 'geo' }>()
  const entries: OcrTocEntry[] = []
  const seen = new Set<string>()

  interface RawEntry {
    title: string
    printedPage: number | null
    level: number
    raw: string
    source?: OcrTocEntrySource
  }
  const rawEntries: RawEntry[] = []

  // “*” 删纲标记常把两节黏在一行（*7.1.1… *7.1.2…）：先拆再提，
  // 与 directory-reassemble 同策略，否则整行超长被当正文丢弃。
  const splitLines: string[] = []
  for (const rawLine of source.split(/\r?\n/)) {
    const starParts =
      rawLine.includes('*') && !rawLine.includes('|')
        ? rawLine.split('*').filter((part) => part.trim())
        : [rawLine]
    for (const starPart of starParts) {
      for (const part of splitStuckSections(starPart)) {
        splitLines.push(part)
      }
    }
  }

  for (const rawLine of splitLines) {
    const line = rawLine.trim()
    if (!line || isNoiseLine(line)) continue

    const compact = normalizeOcrChinese(line)
    const m = compact.match(TOC_LINE)
    if (m) {
      const title = cleanupOcrTocTitle(m[1].trim())
      const printedPage = Number.parseInt(m[2], 10)
      if (printedPage < 1 || printedPage > 3000) continue
      if (title.length < 2) continue
      if (!/[\u4e00-\u9fff]/.test(title) && !/^第\d+章/.test(title) && !/^\d+\.\d+/.test(title)) {
        continue
      }
      if (/^\d[\d.\-]*$/.test(title)) continue
      if (isWatermarkTocEntry(title, options?.knownWatermarks)) continue
      if (isDigitSoupTitle(title)) continue
      if (/^7-121/.test(title)) continue
      // 钉死表命中（同章节同页）→ pipe/geo 证据，否则为汤配或直读；
      // 回填来源在 backfill 后统一标记
      const section = parentSectionOf(title)
      const pin = section ? pinned.get(section) : undefined
      const source: OcrTocEntrySource =
        pin && pin.page === printedPage ? pin.kind : rangeGated ? 'paired' : 'read'
      rawEntries.push({ title, printedPage, level: inferLevel(title), raw: line, source })
      continue
    }

    // 无页码父项：暂记空页码，第二遍从后继条目继承（父与长子同起一页）
    const pageless = parsePagelessHeading(line, options?.knownWatermarks)
    if (pageless) {
      rawEntries.push({ title: pageless, printedPage: null, level: inferLevel(pageless), raw: line })
    }
  }

  // 回填：无页码项取其后第一个有页码项的页；尾部无后继的丢弃。
  // 上限见 backfillMissingPages（连续过长=整段丢失，放弃）。
  // 回填得页的标 backfilled（推测证据，合并裁决时 AI 可推翻）。
  const filled = backfillMissingPages(rawEntries)
  for (let i = 0; i < filled.length; i += 1) {
    const entry = filled[i] as (typeof filled)[number] & { source?: OcrTocEntrySource }
    if (entry.printedPage === null) continue
    const before = rawEntries[i]
    const source: OcrTocEntrySource =
      entry.source ?? (before && before.printedPage === null ? 'backfilled' : 'read')
    const key = `${entry.title}|${entry.printedPage}`
    if (seen.has(key)) continue
    seen.add(key)
    entries.push({
      title: entry.title,
      printedPage: entry.printedPage,
      level: entry.level,
      raw: entry.raw,
      source,
    })
  }

  return sortTocEntriesForDisplay(entries)
}

/** 展示序：按章节号回正（OCR 阅读序会甩尾，如 3.5.4 掉到 3.5.7 后面） */
export interface TocDisplayEntry {
  title: string
  printedPage: number
  level: number
}

/**
 * 恢复逻辑序 + 单调过滤（合并裁决复用：AI  hallucinations 同样走这道门）。
 * 页码严格递减即错配（如 3.5.4→85 掉在 111 后面），真目录后节不可能早于
 * 前节，宁漏勿编直接丢弃；等页允许（父与长子同起一页）。onDrop 收被丢的条目。
 */
export function sortTocEntriesForDisplay<T extends TocDisplayEntry>(
  entries: readonly T[],
  onDrop?: (entry: T) => void,
): T[] {
  const withIndex = entries.map((entry, index) => ({ entry, index }))
  withIndex.sort((a, b) => {
    const sa = parentSectionOf(a.entry.title)
    const sb = parentSectionOf(b.entry.title)
    if (sa === null || sb === null) return a.index - b.index
    const cmp = compareSectionStrings(sa, sb)
    if (cmp === null || cmp === 0) return a.index - b.index
    return cmp
  })
  const ordered: T[] = []
  let maxPage = -Infinity
  for (const { entry } of withIndex) {
    if (entry.printedPage < maxPage) {
      onDrop?.(entry)
      continue
    }
    ordered.push(entry)
    if (entry.printedPage > maxPage) maxPage = entry.printedPage
  }
  return ordered
}

export function defaultPdfPageOffset(tocPageRange: [number, number]): number {
  return tocPageRange[1]
}

/**
 * 无星号黏连行拆分（`4.3.5本节习题精选4.4CISC和RISC的基本概念`）：
 * 一行内出现 2+ 个章节号（`X.Y` 三段亦可）即从第二个起切开，
 * 合回来的那条不拆（末尾纯页码不是章节号形状）。
 * pipe 行不在此列（表格结构优先，由重组侧处理）。
 */
const STUCK_SECTION = /(^|[^\d.])(?=\d+\.\d+(?:\.\d+)*)/g
const STUCK_CHAPTER_WITH_PAGE = /(?<=\d{1,4})\s*(?=(?:第[0-9一二三四五六七八九十百千]+[课章单元]|Lesson\b|Chapter\b|[IVXLCDM]+[\.、\s]|[Ⅰ-Ⅻ]))/i

export function splitStuckSections(line: string): string[] {
  if (line.includes('|')) return [line]
  const preChunks = line.split(STUCK_CHAPTER_WITH_PAGE).map((c) => c.trim()).filter(Boolean)
  const chunksToProcess = preChunks.length > 1 ? preChunks : [line]
  const results: string[] = []

  for (const chunk of chunksToProcess) {
    const starts: number[] = []
    for (const m of chunk.matchAll(STUCK_SECTION)) {
      starts.push((m.index ?? 0) + (m[1] ?? '').length)
    }
    if (starts.length <= 1) {
      results.push(chunk)
      continue
    }
    const parts: string[] = []
    for (let i = 0; i < starts.length; i += 1) {
      const part = chunk.slice(starts[i] as number, starts[i + 1] as number | undefined).trim()
      if (part) parts.push(part)
    }
    if (parts.length <= 1) {
      results.push(chunk)
      continue
    }
    // 行尾页码归第一段：黏连的是连续两行，第一行（上一节尾）的点线页码
    // 贴在整行末尾（如 `4.3.5…4.4…181` 中 181 是 4.3.5 的——4.4.1 已 191，
    // 4.4 不可能早 10 页）。后段留空走回填/几何，不硬分。
    const first = parts[0] as string
    const last = parts[parts.length - 1] as string
    const tail = /^(.*\S)\s+(\d{1,4})\s*$/.exec(last)
    if (tail && tail[1] && tail[2] && !/\d\s*$/.test(first) && /[\u4e00-\u9fff]/.test(tail[1])) {
      parts[0] = `${first} ${tail[2]}`
      parts[parts.length - 1] = (tail[1] as string).trim()
    }
    results.push(...parts)
  }

  return results
}

/** 回填输入：页码可空（调用方负责先滤掉无号章行，见 isBareChapterTitle） */
export interface TocEntryWithOptionalPage {
  title: string
  printedPage: number | null
  level: number
}

/** 连续回填上限：小步继承合理（父与长子同起一页），长连跑必是整段丢失 */
export const MAX_BACKFILL_RUN = 3

/**
 * 无页码章行判定：真目录章必带页码，无号即数字丢失，不继承只丢弃。
 * 节父项不在此列（节与长子同起一页，继承合理）。
 */
export function isBareChapterTitle(title: string): boolean {
  return /^第[0-9一二三四五六七八九十百千]+[章节]/.test(title.trim())
}

/** 标题行首章节号（"3.1.2主存储器"→"3.1.2"）；无则 null（与 directory-reassemble 同口径，避循环放本地） */
function parentSectionOf(title: string): string | null {
  const match = /^(\d+(?:\.\d+)*)/.exec(title.trim())
  return match ? (match[1] ?? null) : null
}

/**
 * 无页码项从后继继承：仅父项可继承（level 严格小于后继，且章节号前缀匹配），
 * 同级兄弟不同页（2.1.1←2.1.2）、跨章（1.5←2.1.2）继承必涂抹，一律丢弃。
 * 尾部无后继的保留 null，由调用方丢弃计数。
 */
export function backfillMissingPages<T extends TocEntryWithOptionalPage>(
  entries: readonly T[],
): T[] {
  const out = entries.map((entry) => ({ ...entry }))
  let nextPage: number | null = null
  let nextLevel: number | null = null
  let nextSection: string | null = null
  let bareRun = 0
  for (let i = out.length - 1; i >= 0; i -= 1) {
    const entry = out[i]
    if (!entry) continue
    if (entry.printedPage !== null) {
      nextPage = entry.printedPage
      nextLevel = entry.level
      nextSection = parentSectionOf(entry.title)
      bareRun = 0
    } else if (
      nextPage !== null &&
      nextLevel !== null &&
      bareRun < MAX_BACKFILL_RUN &&
      entry.level < nextLevel
    ) {
      // 前缀门：父章节号须是后继章节号的前缀（3.1←3.1.2 可，1.5←2.1.2 不可）
      const parentSec = parentSectionOf(entry.title)
      if (
        parentSec !== null &&
        nextSection !== null &&
        (nextSection === parentSec || nextSection.startsWith(`${parentSec}.`))
      ) {
        entry.printedPage = nextPage
      }
      bareRun += 1
    } else {
      bareRun += 1
    }
  }
  return out
}

export function ocrTocToReaderUnits(
  entries: OcrTocEntry[],
  pageOffset: number,
): Array<{ label: string; href: string; level: number }> {
  return entries.map((e) => ({
    label: e.title,
    href: String(Math.max(1, e.printedPage + pageOffset)),
    level: e.level,
  }))
}

/**
 * 根据起始页计算每个目录条目的结束页区间：
 * 1. 若存在下一条有效起始页，则当前条目结束页 = 下一条目起始页 - 1。
 * 2. 若后面没有下一部分（最后一项），则结束页留空（undefined）。
 */
export function computeTocPageRanges<T extends { printedPage: number; endPage?: number | null }>(
  entries: T[],
): T[] {
  return entries.map((entry, index) => {
    let nextStart: number | null = null
    for (let i = index + 1; i < entries.length; i += 1) {
      const candidate = entries[i]?.printedPage
      if (candidate != null && Number.isFinite(candidate) && candidate > 0) {
        nextStart = candidate
        break
      }
    }
    if (nextStart === null) {
      return { ...entry, endPage: undefined }
    }
    const computedEnd = Math.max(entry.printedPage, nextStart - 1)
    return { ...entry, endPage: computedEnd }
  })
}

