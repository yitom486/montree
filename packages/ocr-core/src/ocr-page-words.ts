import type { TextContent, TextItem } from 'pdfjs-dist/types/src/display/api'
import type { OcrPageWord, PdfOcrPageCache } from '@montree/contracts'

/** inspector 行框置信度门限（0–1；与 napi minimum_confidence 对齐） */
const INSPECTOR_MIN_CONFIDENCE = 0.3

export interface InspectorSpanLike {
  text: string
  /** 0–1 置信度 */
  confidence: number
  /** PDF 点坐标，与 TextItem 同帧（左、下、宽、高，y-up） */
  x: number
  y: number
  width: number
  height: number
}

const CJK_CHAR = /[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\uff00-\uffef\u3000-\u303f]/u

function isCjkChar(char: string): boolean {
  return CJK_CHAR.test(char)
}

/**
 * 行文本切词：逐字扫描，CJK（含标点）逐字成词，拉丁/数字按空白分词。
 * 中文全角字接近等宽，框按权重比例切分近似精确；纯拉丁行是近似值。
 */
export function splitCjkUnits(text: string): string[] {
  const units: string[] = []
  let latin = ''
  const flushLatin = (): void => {
    if (latin) {
      units.push(latin)
      latin = ''
    }
  }
  for (const char of text) {
    if (/\s/.test(char)) {
      flushLatin()
      continue
    }
    if (isCjkChar(char)) {
      flushLatin()
      units.push(char)
      continue
    }
    latin += char
  }
  flushLatin()
  return units
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0
  return Math.min(1, Math.max(0, value))
}

/**
 * inspector 行框 → 归一化词（0–1，左上原点；与 normalizeOcrWords 输出同契约）。
 * 置信度不足、空文本、非法尺寸一律丢弃。
 */
export function normalizeInspectorSpans(
  spans: InspectorSpanLike[],
  pageWidthPt: number,
  pageHeightPt: number,
): OcrPageWord[] {
  if (!(pageWidthPt > 0) || !(pageHeightPt > 0)) return []
  const words: OcrPageWord[] = []
  for (const span of spans) {
    if (!span || typeof span.text !== 'string') continue
    if (!(span.confidence >= INSPECTOR_MIN_CONFIDENCE)) continue
    if (!(span.width > 0) || !(span.height > 0)) continue
    const units = splitCjkUnits(span.text)
    if (units.length === 0) continue
    const weights = units.map((unit) =>
      [...unit].reduce((sum, char) => sum + (isCjkChar(char) ? 2 : 1), 0),
    )
    const totalWeight = weights.reduce((sum, weight) => sum + weight, 0)
    if (totalWeight <= 0) continue
    let acc = 0
    units.forEach((unit, index) => {
      const weight = weights[index] ?? 0
      const x0 = clamp01((span.x + (span.width * acc) / totalWeight) / pageWidthPt)
      acc += weight
      const x1 = clamp01((span.x + (span.width * acc) / totalWeight) / pageWidthPt)
      // y-up（底边）→ 归一化左上原点：y0 为顶边
      const y0 = clamp01(1 - (span.y + span.height) / pageHeightPt)
      const y1 = clamp01(1 - span.y / pageHeightPt)
      if (unit.trim().length > 0 && x1 > x0 && y1 > y0) {
        words.push({ text: unit, bbox: { x0, y0, x1, y1 } })
      }
    })
  }
  return words
}

/**
 * V2 命中层过滤（Chrome Searchify 选区策略）：只收接近水平的正文，不收斜向戳印。
 * 只用于人划词的透明层（mount / 新缓存写入）；Agent 正文链路不动。
 *
 * 做法：按中心 y 把词聚成水平行，整行判定去留（同行词共存亡，避免把公式/标题
 * 里的单个高瘦字误杀）。丢弃当且仅当行落在页面中带、行内字中位高度巨大
 * （密排正文被链式合并成高行时豁免），且满足任一：
 * - 短碎片 + 行高巨大（斜戳印检测框接近方形，均摊行高达数十 pt）；
 * - 行高离谱（≥ 约 90pt，不可能是正文，哪怕字符多）。
 * 页眉/页码/页脚（上下边距）一律保留。阈值冻结，单测锁定。
 */

/** 同行中心 y 容差（归一化；754pt 页约 15pt：同行抖动合并，相邻正文行分离） */
const HIT_ROW_Y_TOL = 0.02
/** 短碎片上限（字符数；戳印多为几个字的斜切分，正文行远超此数） */
const HIT_ROW_SHORT_CHARS = 8
/** 戳印行高下限（归一化；约 53pt：45pt 级大标题安然保留，斜框碎片远超） */
const HIT_STAMP_ROW_HEIGHT = 0.07
/** 任何正文都不该达到的行高（归一化；约 90pt）：中带内直接丢 */
const HIT_ABSURD_ROW_HEIGHT = 0.12
/** 行内字中位高度下限（归一化；约 30pt）：密排正文被链式合并成高行时豁免 */
const HIT_STAMP_MEDIAN_WORD_HEIGHT = 0.04
/** 密行内单字高度上限（归一化；约 53pt）：正文再大也到不了，斜戳印跨行压字除外 */
const HIT_DENSE_ROW_WORD_HEIGHT = 0.07
/** 中带；之外（页眉/页码/页脚）一律保留 */
const HIT_MIDDLE_BAND_TOP = 0.06
const HIT_MIDDLE_BAND_BOTTOM = 0.94

export function filterOcrHitLayerWords(words: readonly OcrPageWord[]): OcrPageWord[] {
  if (words.length === 0) return []
  // 中心 y 排序后链式聚行：与上一词中心差 ≤ 容差即同行
  const order = words.map((word, index) => index).sort((a, b) => {
    const wa = words[a]
    const wb = words[b]
    if (!wa || !wb) return 0
    return (wa.bbox.y0 + wa.bbox.y1) / 2 - (wb.bbox.y0 + wb.bbox.y1) / 2
  })
  const rows: number[][] = []
  for (const index of order) {
    const word = words[index]
    if (!word) continue
    const centerY = (word.bbox.y0 + word.bbox.y1) / 2
    const last = rows[rows.length - 1]
    const lastWord = last ? words[last[last.length - 1] ?? -1] : undefined
    if (
      last &&
      lastWord &&
      Math.abs(centerY - (lastWord.bbox.y0 + lastWord.bbox.y1) / 2) <= HIT_ROW_Y_TOL
    ) {
      last.push(index)
    } else {
      rows.push([index])
    }
  }
  const drop = new Set<number>()
  for (const row of rows) {
    let chars = 0
    let y0 = Number.POSITIVE_INFINITY
    let y1 = Number.NEGATIVE_INFINITY
    const heights: number[] = []
    for (const index of row) {
      const word = words[index]
      if (!word) continue
      chars += word.text.length
      y0 = Math.min(y0, word.bbox.y0)
      y1 = Math.max(y1, word.bbox.y1)
      heights.push(word.bbox.y1 - word.bbox.y0)
    }
    if (row.length === 0 || chars === 0) {
      for (const index of row) drop.add(index)
      continue
    }
    heights.sort((a, b) => a - b)
    const medianHeight = heights[Math.floor(heights.length / 2)] ?? 0
    const centerY = (y0 + y1) / 2
    const rowHeight = y1 - y0
    const inMiddle = centerY >= HIT_MIDDLE_BAND_TOP && centerY <= HIT_MIDDLE_BAND_BOTTOM
    // 中位字高门：密排正文被链式合并成高行时不误杀（戳印行全由巨框字组成）
    if (
      inMiddle &&
      medianHeight >= HIT_STAMP_MEDIAN_WORD_HEIGHT &&
      ((chars <= HIT_ROW_SHORT_CHARS && rowHeight >= HIT_STAMP_ROW_HEIGHT) ||
        rowHeight >= HIT_ABSURD_ROW_HEIGHT)
    ) {
      for (const index of row) drop.add(index)
      continue
    }
    // 密行压字：斜戳印压在正文行上时只摘巨框单字（正文字远小于此；四行以上首字下沉为例外，罕见）
    if (inMiddle && chars > HIT_ROW_SHORT_CHARS) {
      for (const index of row) {
        const word = words[index]
        if (word && word.bbox.y1 - word.bbox.y0 >= HIT_DENSE_ROW_WORD_HEIGHT) {
          drop.add(index)
        }
      }
    }
  }
  return words.filter((_, index) => !drop.has(index))
}

export function ocrPageCacheToTextContent(cache: PdfOcrPageCache): TextContent {
  const { pageWidth, pageHeight, words } = cache
  const items: TextItem[] = words.map((word) => {
    const width = Math.max((word.bbox.x1 - word.bbox.x0) * pageWidth, 1)
    const height = Math.max((word.bbox.y1 - word.bbox.y0) * pageHeight, 1)
    const x = word.bbox.x0 * pageWidth
    const y = pageHeight - word.bbox.y1 * pageHeight
    return {
      str: word.text,
      dir: 'ltr',
      width,
      height,
      transform: [height, 0, 0, height, x, y],
      fontName: 'OCR',
      hasEOL: false,
    }
  })
  return { items, styles: {}, lang: null }
}

export function pageHasNativeText(charCount: number): boolean {
  return charCount >= 8
}
