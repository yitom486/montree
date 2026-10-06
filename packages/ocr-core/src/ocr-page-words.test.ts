import { describe, expect, it } from 'vitest'
import {
  filterOcrHitLayerWords,
  normalizeInspectorSpans,
  ocrPageCacheToTextContent,
  pageHasNativeText,
  splitCjkUnits,
} from './ocr-page-words'
import type { OcrPageWord, PdfOcrPageCache } from '@montree/contracts'

describe('ocr-page-words', () => {
  it('pageHasNativeText 阈值', () => {
    expect(pageHasNativeText(0)).toBe(false)
    expect(pageHasNativeText(20)).toBe(true)
  })

  it('ocrPageCacheToTextContent 生成 TextItem', () => {    const cache: PdfOcrPageCache = {
      fileFingerprint: 'a|1',
      page: 1,
      pageWidth: 100,
      pageHeight: 200,
      ocrScale: 2,
      createdAt: '2026-01-01',
      words: [{ text: '测试', bbox: { x0: 0.1, y0: 0.2, x1: 0.3, y1: 0.25 } }],
    }
    const content = ocrPageCacheToTextContent(cache)
    expect(content.items).toHaveLength(1)
    expect(content.items[0]).toMatchObject({ str: '测试', width: 20 })
  })
})

describe('splitCjkUnits', () => {
  it('中文逐字、拉丁按词', () => {
    expect(splitCjkUnits('Hello世界和平')).toEqual(['Hello', '世', '界', '和', '平'])
    expect(splitCjkUnits('  ')).toEqual([])
  })
})

describe('normalizeInspectorSpans', () => {
  it('中文行按字等分（y-up 转左上原点）', () => {
    const words = normalizeInspectorSpans(
      [{ text: '甲乙', confidence: 0.9, x: 10, y: 700, width: 20, height: 10 }],
      100,
      800,
    )
    expect(words).toHaveLength(2)
    expect(words[0]?.text).toBe('甲')
    expect(words[0]?.bbox.x0).toBeCloseTo(0.1, 6)
    expect(words[0]?.bbox.x1).toBeCloseTo(0.2, 6)
    expect(words[0]?.bbox.y0).toBeCloseTo(0.1125, 6)
    expect(words[0]?.bbox.y1).toBeCloseTo(0.125, 6)
    expect(words[1]?.text).toBe('乙')
    expect(words[1]?.bbox.x0).toBeCloseTo(0.2, 6)
    expect(words[1]?.bbox.x1).toBeCloseTo(0.3, 6)
  })

  it('拉丁行整词保留、低置信丢弃', () => {
    const words = normalizeInspectorSpans(
      [
        { text: 'Hello World', confidence: 0.99, x: 0, y: 0, width: 100, height: 10 },
        { text: 'junk', confidence: 0.1, x: 0, y: 0, width: 100, height: 10 },
      ],
      100,
      100,
    )
    expect(words.map((w) => w.text)).toEqual(['Hello', 'World'])
  })

  it('非法输入返回空', () => {
    expect(normalizeInspectorSpans([], 100, 100)).toEqual([])
    expect(
      normalizeInspectorSpans(
        [{ text: '甲', confidence: 0.9, x: 0, y: 0, width: 10, height: 10 }],
        0,
        100,
      ),
    ).toEqual([])
  })

  it('U1：有宽高词全落在 0–1；无/非法宽高一律为空', () => {
    const words = normalizeInspectorSpans(
      [{ text: '甲乙丙', confidence: 0.9, x: 560, y: 750, width: 30, height: 30 }],
      612,
      792,
    )
    expect(words).toHaveLength(3)
    for (const word of words) {
      expect(word.bbox.x0).toBeGreaterThanOrEqual(0)
      expect(word.bbox.x1).toBeLessThanOrEqual(1)
      expect(word.bbox.y0).toBeGreaterThanOrEqual(0)
      expect(word.bbox.y1).toBeLessThanOrEqual(1)
    }
    const span = [{ text: '甲', confidence: 0.9, x: 0, y: 0, width: 10, height: 10 }]
    expect(normalizeInspectorSpans(span, 0, 792)).toEqual([])
    expect(normalizeInspectorSpans(span, 612, 0)).toEqual([])
    expect(normalizeInspectorSpans(span, Number.NaN, 792)).toEqual([])
    expect(normalizeInspectorSpans(span, 612, Number.NaN)).toEqual([])
    expect(normalizeInspectorSpans(span, -612, 792)).toEqual([])
  })
})

describe('filterOcrHitLayerWords', () => {
  const w = (text: string, x0: number, y0: number, x1: number, y1: number): OcrPageWord => ({
    text,
    bbox: { x0, y0, x1, y1 },
  })
  const bodyLine = (y0: number, chars = '甲乙丙丁戊己庚辛壬癸'): OcrPageWord[] =>
    [...chars].map((char, i) => w(char, 0.1 + i * 0.03, y0, 0.125 + i * 0.03, y0 + 0.02))

  it('水平正文行全部保留', () => {
    const words = bodyLine(0.4)
    expect(filterOcrHitLayerWords(words).map((word) => word.text).join('')).toBe(
      '甲乙丙丁戊己庚辛壬癸',
    )
  })

  it('中带斜戳印短行丢弃（高瘦字、行高巨大）', () => {
    const stamp = ['戳', '印', '甲', '乙', '丙'].map((char, i) =>
      w(char, 0.5 + i * 0.03, 0.4, 0.525 + i * 0.03, 0.55),
    )
    expect(filterOcrHitLayerWords(stamp)).toEqual([])
  })

  it('一行正文 + 对角短词：正文保留、戳印丢弃', () => {
    const body = bodyLine(0.5, '正文段落内容测试')
    const stamp = ['斜', '戳', '印'].map((char, i) =>
      w(char, 0.5 + i * 0.03, 0.6, 0.525 + i * 0.03, 0.72),
    )
    const kept = filterOcrHitLayerWords([...body, ...stamp]).map((word) => word.text)
    expect(kept.join('')).toBe('正文段落内容测试')
  })

  it('底部页码与顶部标题保留（边距豁免）', () => {
    const pageNum = [w('3', 0.5, 0.97, 0.515, 0.985), w('6', 0.515, 0.97, 0.53, 0.985)]
    expect(filterOcrHitLayerWords(pageNum)).toHaveLength(2)
    const title = [...'本书标题'].map((char, i) => w(char, 0.3 + i * 0.03, 0.01, 0.325 + i * 0.03, 0.05))
    expect(filterOcrHitLayerWords(title)).toHaveLength(4)
  })

  it('短标题与独立公式不误杀（行高正常）', () => {
    const heading = ['第', '一', '章'].map((char, i) =>
      w(char, 0.4 + i * 0.03, 0.3, 0.425 + i * 0.03, 0.325),
    )
    expect(filterOcrHitLayerWords(heading)).toHaveLength(3)
    const bigHeading = ['绪', '论'].map((char, i) =>
      w(char, 0.4 + i * 0.05, 0.3, 0.445 + i * 0.05, 0.353),
    )
    expect(filterOcrHitLayerWords(bigHeading)).toHaveLength(2)
    const formula = ['∑', 'x', '=', '1'].map((char, i) =>
      w(char, 0.4 + i * 0.03, 0.5, 0.425 + i * 0.03, 0.52),
    )
    expect(filterOcrHitLayerWords(formula)).toHaveLength(4)
  })

  it('行高离谱的中带行直接丢（字符再多也不收）', () => {
    const words = [...'甲乙丙丁戊己庚辛'].map((char, i) =>
      w(char, 0.1 + i * 0.03, 0.4, 0.125 + i * 0.03, 0.53),
    )
    expect(filterOcrHitLayerWords(words)).toEqual([])
  })

  it('密排段落链式合并成高行不误杀（中位字高门）', () => {
    // 7 行密排正文：链式聚成一行（行高 0.128 ≥ 离谱线），中位字高正常 ⇒ 全保留
    const para: OcrPageWord[] = []
    for (let line = 0; line < 7; line += 1) {
      for (let i = 0; i < 6; i += 1) {
        para.push(w('正', 0.1 + i * 0.03, 0.4 + line * 0.018, 0.125 + i * 0.03, 0.42 + line * 0.018))
      }
    }
    expect(filterOcrHitLayerWords(para)).toHaveLength(42)
  })

  it('密行压字只摘巨框单字（戳印压正文行）', () => {
    const body = bodyLine(0.5, '正文段落内容测试啊')
    const pressed = [w('戳', 0.2, 0.46, 0.23, 0.56), w('印', 0.3, 0.46, 0.33, 0.56)]
    const kept = filterOcrHitLayerWords([...body, ...pressed]).map((word) => word.text)
    expect(kept.join('')).toBe('正文段落内容测试啊')
  })

  it('稀疏巨字行丢弃（60pt 级独占标题，接受不可选）', () => {
    const giant = ['绪', '论'].map((char, i) =>
      w(char, 0.4 + i * 0.06, 0.4, 0.45 + i * 0.06, 0.48),
    )
    expect(filterOcrHitLayerWords(giant)).toEqual([])
  })

  it('空输入与原序保持', () => {
    expect(filterOcrHitLayerWords([])).toEqual([])
    const a = bodyLine(0.5, '甲乙')
    const b = bodyLine(0.6, '丙丁')
    const kept = filterOcrHitLayerWords([...b, ...a])
    expect(kept.map((word) => word.text)).toEqual(['丙', '丁', '甲', '乙'])
  })
})
