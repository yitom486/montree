// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest'
import type { OcrTocEntry } from '@montree/contracts'
import { buildTocAiPrompt, mergeTocAiDraft, parseTocAiEntries } from './toc-ai'

describe('toc-ai', () => {
  it('prompt 约束 JSON 数组输出并截断超长文本', () => {
    const prompt = buildTocAiPrompt(`${'目录文本。'.repeat(8000)}第一章 绪论 1`, 'fp-1')
    expect(prompt).toContain('JSON 数组')
    expect(prompt).toContain('printedPage')
    expect(prompt).toContain('toc_replace_all')
    expect(prompt).toContain('fp-1')
    expect(prompt).toContain('同行数字')
    expect(prompt.length).toBeLessThanOrEqual(31100)
  })

  it('附图口径以图为准、OCR 只辅助', () => {
    const prompt = buildTocAiPrompt('1.1 背景 5', 'fp-1', { withImages: true, imagePages: [8, 9] })
    expect(prompt).toContain('以附图为准')
    expect(prompt).toContain('8、9')
    expect(prompt).toContain('看图读数')
    const plain = buildTocAiPrompt('1.1 背景 5', 'fp-1')
    expect(plain).not.toContain('以附图为准')
    expect(plain).toContain('绝不跨行借用')
  })

  it('解析围栏 JSON 并清洗条目', () => {
    const reply = `整理如下：\n\`\`\`json\n${JSON.stringify([
      { title: '第一章 绪论', printedPage: 1, level: 1 },
      { title: '  1.1 背景  ', printedPage: '5', level: '2' },
      { title: '', printedPage: 9, level: 1 },
      { title: '无页码', printedPage: 0, level: 9 },
    ])}\n\`\`\``
    const result = parseTocAiEntries(reply)
    expect(result.entries).toEqual([
      { title: '第一章 绪论', printedPage: 1, level: 0, source: 'ai' },
      { title: '1.1 背景', printedPage: 5, level: 1, source: 'ai' },
    ])
    expect(result.dropped).toBe(2)
    expect(result.warnings.some((w) => w.includes('丢弃 2 条'))).toBe(true)
  })

  it('页码倒退给出警告但保留条目', () => {
    const result = parseTocAiEntries(
      JSON.stringify([
        { title: '第三章', printedPage: 20, level: 1 },
        { title: '第二章补遗', printedPage: 15, level: 1 },
      ]),
    )
    expect(result.entries).toHaveLength(2)
    expect(result.warnings.some((w) => w.includes('第二章补遗'))).toBe(true)
  })

  it('非 JSON 回复返回空加警告', () => {
    const result = parseTocAiEntries('抱歉，我看不懂这页。')
    expect(result.entries).toEqual([])
    expect(result.warnings).toHaveLength(1)
  })

  it('模型 1-based 层级转存 0-based（章=0）并钳制', () => {
    const result = parseTocAiEntries(
      JSON.stringify([
        { title: '第一章', printedPage: 1, level: 1 },
        { title: '1.1 节', printedPage: 2, level: 2 },
        { title: '深层', printedPage: 3, level: 99 },
      ]),
    )
    expect(result.entries.map((e) => e.level)).toEqual([0, 1, 6])
  })

  it('同一页码长连号警告编造嫌疑', () => {
    const items = Array.from({ length: 14 }, (_, i) => ({
      title: `第1.${i + 1}节`,
      printedPage: 78,
      level: 2,
    }))
    const result = parseTocAiEntries(JSON.stringify(items))
    expect(result.entries).toHaveLength(14)
    expect(result.warnings.some((w) => w.includes('疑似编造'))).toBe(true)
  })

  it('短连号不警告', () => {
    const items = Array.from({ length: 5 }, (_, i) => ({
      title: `第1.${i + 1}节`,
      printedPage: 8,
      level: 2,
    }))
    const result = parseTocAiEntries(JSON.stringify(items))
    expect(result.warnings.some((w) => w.includes('疑似编造'))).toBe(false)
  })

  it('水印碎片按水印口径丢弃并计数', () => {
    const result = parseTocAiEntries(
      JSON.stringify([
        { title: '87929797王道计', printedPage: 149, level: 1 },
        { title: '3.1.2主存储器的组成', printedPage: 31, level: 2 },
      ]),
    )
    expect(result.entries.map((e) => e.title)).toEqual(['3.1.2主存储器的组成'])
    expect(result.dropped).toBe(1)
    expect(result.warnings.some((w) => w.includes('水印'))).toBe(true)
  })

  it('基线附进提示词并标注证据', () => {
    const baseline: OcrTocEntry[] = [
      { title: '3.5.4替换算法', printedPage: 114, level: 2, source: 'geo' },
      { title: '3.5.5一致性', printedPage: 115, level: 2, source: 'paired' },
    ]
    const prompt = buildTocAiPrompt('文本', 'fp-1', { baseline })
    expect(prompt).toContain('3.5.4替换算法 | 114 | 2 | 已钉死')
    expect(prompt).toContain('3.5.5一致性 | 115 | 2 | 存疑')
    expect(prompt).toContain('修正后的完整表')
  })
})

describe('mergeTocAiDraft', () => {
  const OPTS = { pageCount: 340, pageOffset: 12 }

  it('钉死项 AI 改不动（留痕），汤配/回填听 AI 的', () => {
    const baseline: OcrTocEntry[] = [
      { title: '3.5.4替换算法', printedPage: 114, level: 2, source: 'geo' },
      { title: '3.5.5一致性', printedPage: 115, level: 2, source: 'paired' },
    ]
    const ai: OcrTocEntry[] = [
      { title: '3.5.4替换算法', printedPage: 99, level: 2, source: 'ai' },
      { title: '3.5.5一致性', printedPage: 116, level: 2, source: 'ai' },
    ]
    const result = mergeTocAiDraft(baseline, ai, OPTS)
    const byTitle = new Map(result.entries.map((e) => [e.title, e.printedPage]))
    expect(byTitle.get('3.5.4替换算法')).toBe(114)
    expect(byTitle.get('3.5.5一致性')).toBe(116)
    expect(result.conflicts).toHaveLength(1)
    expect(result.conflicts[0]).toContain('114')
    expect(result.conflicts[0]).toContain('99')
  })

  it('AI 新增有据才收，无据丢弃留痕', () => {
    const baseline: OcrTocEntry[] = [
      { title: '1.2.2硬件', printedPage: 3, level: 1, source: 'geo' },
    ]
    const ai: OcrTocEntry[] = [
      { title: '1.2.3软件', printedPage: 4, level: 1, source: 'ai' },
      { title: '正文句子混入', printedPage: 0, level: 1, source: 'ai' },
    ]
    const result = mergeTocAiDraft(baseline, ai, OPTS)
    expect(result.entries.map((e) => e.title)).toEqual(['1.2.2硬件', '1.2.3软件'])
    expect(result.aiAdded).toBe(1)
    expect(result.dropped).toHaveLength(1)
  })

  it('层级按章节号重算，不采模型填的', () => {
    const result = mergeTocAiDraft(
      [],
      [{ title: '3.5.4替换算法', printedPage: 114, level: 0, source: 'ai' }],
      OPTS,
    )
    expect(result.entries[0]?.level).toBe(2)
  })

  it('AI 幻觉倒退页进单调门丢弃', () => {
    const result = mergeTocAiDraft(
      [{ title: '3.5.3映射', printedPage: 111, level: 2, source: 'geo' }],
      [{ title: '3.5.4替换算法', printedPage: 85, level: 2, source: 'ai' }],
      OPTS,
    )
    expect(result.entries.map((e) => e.title)).toEqual(['3.5.3映射'])
    expect(result.dropped.some((d) => d.includes('3.5.4替换算法'))).toBe(true)
  })

  it('同标题同页重复只留一条（模型重发），同号不同名不受影响', () => {
    const baseline: OcrTocEntry[] = [
      { title: '1.4本章小结', printedPage: 18, level: 1, source: 'paired' },
      { title: '5.3.4单总线结构的数据通路', printedPage: 208, level: 2, source: 'geo' },
      { title: '5.3.4专用结构的数据通路', printedPage: 208, level: 2, source: 'geo' },
    ]
    const ai: OcrTocEntry[] = [
      { title: '1.4本章小结', printedPage: 18, level: 1, source: 'ai' },
      { title: '1.4本章小结', printedPage: 18, level: 1, source: 'ai' },
    ]
    const result = mergeTocAiDraft(baseline, ai, OPTS)
    expect(result.entries.filter((e) => e.title === '1.4本章小结')).toHaveLength(1)
    expect(result.dropped.some((d) => d.includes('去重'))).toBe(true)
    expect(
      result.entries.filter((e) => e.title.startsWith('5.3.4')),
    ).toHaveLength(2)
  })

  it('手填是最高证据，AI 改不动', () => {
    const result = mergeTocAiDraft(
      [{ title: '1.1.1硬件', printedPage: 2, level: 2, source: 'manual' }],
      [{ title: '1.1.1硬件', printedPage: 5, level: 2, source: 'ai' }],
      OPTS,
    )
    expect(result.entries[0]?.printedPage).toBe(2)
    expect(result.conflicts).toHaveLength(1)
  })
})
