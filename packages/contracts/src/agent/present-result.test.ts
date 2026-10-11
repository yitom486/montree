import { describe, expect, it } from 'vitest'
import {
  PRESENT_COMPARE_MAX_ITEMS,
  PRESENT_MAX_HTML_BYTES,
  parsePresentResult,
  presentResultHash,
  presentResultId,
  presentResultSizeError,
} from './present-result'

const compare = {
  schemaVersion: 1,
  kind: 'chapter-comparison',
  id: 'present-chapter-comparison-abc123',
  title: '两章观点比较',
  documentFingerprint: '/books/a.epub',
  documentLabel: 'a.epub',
  chapters: [
    { key: 'c1', label: '第一章', flatIndex: 0 },
    { key: 'c2', label: '第二章' },
  ],
  items: [
    { id: 'i1', dimension: '核心观点', chapterKey: 'c1', excerpt: '原文一', verified: true, flatIndex: 0 },
    { id: 'i2', dimension: '核心观点', chapterKey: 'c2', note: '无摘录', verified: false },
  ],
}

describe('parsePresentResult', () => {
  it('接受合法比较卡（含未验证条目）', () => {
    const parsed = parsePresentResult(JSON.stringify(compare))
    expect(parsed?.kind).toBe('chapter-comparison')
    if (parsed?.kind === 'chapter-comparison') {
      expect(parsed.items).toHaveLength(2)
      expect(parsed.items[1]?.verified).toBe(false)
      expect(parsed.items[1]?.flatIndex).toBeUndefined()
    }
  })

  it('缺失来源指纹的比较卡拒绝（定位无法验归属）', () => {
    const { documentFingerprint: _dropped, ...rest } = compare
    void _dropped
    expect(parsePresentResult(rest)).toBeNull()
  })

  it('拒绝未知版本/未知类型/章节数越界/野指针', () => {
    expect(parsePresentResult({ ...compare, schemaVersion: 2 })).toBeNull()
    expect(parsePresentResult({ ...compare, kind: 'json-render' })).toBeNull()
    expect(parsePresentResult({ ...compare, chapters: [{ key: 'c1', label: '一' }] })).toBeNull()
    expect(
      parsePresentResult({
        ...compare,
        items: [{ id: 'x', dimension: 'd', chapterKey: 'ghost', verified: true }],
      }),
    ).toBeNull()
    expect(parsePresentResult('not json')).toBeNull()
  })

  it('条目上限与 HTML 上限', () => {
    const items = Array.from({ length: PRESENT_COMPARE_MAX_ITEMS + 1 }, (_, i) => ({
      id: `i${i}`,
      dimension: 'd',
      chapterKey: 'c1',
      verified: false,
    }))
    expect(parsePresentResult({ ...compare, items })).toBeNull()
    const big = { schemaVersion: 1, kind: 'html-artifact', id: 'x', title: 't', html: 'x'.repeat(PRESENT_MAX_HTML_BYTES + 1) }
    expect(parsePresentResult(big)).toBeNull()
    expect(
      parsePresentResult({ schemaVersion: 1, kind: 'html-artifact', id: 'x', title: 't', html: '<p>hi</p>' })?.kind,
    ).toBe('html-artifact')
  })

  it('稳定 ID 与整体上限', () => {
    expect(presentResultId('chapter-comparison', 'a')).toBe(presentResultId('chapter-comparison', 'a'))
    expect(presentResultId('chapter-comparison', 'a')).not.toBe(presentResultId('chapter-comparison', 'b'))
    expect(presentResultHash('')).toHaveLength(8)
    const parsed = parsePresentResult(compare)!
    expect(presentResultSizeError(parsed)).toBeNull()
  })
})
