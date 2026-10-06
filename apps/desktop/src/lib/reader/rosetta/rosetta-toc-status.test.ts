import { describe, expect, it } from 'vitest'
import { computeTocSignature } from '@montree/reader-core'
import {
  getCurrentRosettaTocSignature,
  resolveRosettaIndexStatus,
  resolveRosettaTocStatus,
} from './rosetta-toc-status'

describe('resolveRosettaTocStatus', () => {
  const current = computeTocSignature([
    { title: '第1章 概述', realPage: 10, level: 1 },
    { title: '1.1 背景', realPage: 12, level: 2 },
  ])

  it('签名缺失时判 stale（不得只显示数据库 ✓）', () => {
    expect(resolveRosettaTocStatus('', current)).toBe('stale')
    expect(resolveRosettaTocStatus(null, current)).toBe('stale')
    expect(resolveRosettaTocStatus(undefined, current)).toBe('stale')
  })

  it('签名不一致时判 stale', () => {
    const other = computeTocSignature([{ title: '第1章 概述', realPage: 11, level: 1 }])
    expect(other).not.toBe(current)
    expect(resolveRosettaTocStatus(other, current)).toBe('stale')
  })

  it('签名一致时才判 ready（AI 直接读库）', () => {
    expect(resolveRosettaTocStatus(current, current)).toBe('ready')
  })

  it('无索引时判 no-index', () => {
    expect(resolveRosettaIndexStatus(null, current)).toBe('no-index')
    expect(resolveRosettaIndexStatus(undefined, current)).toBe('no-index')
    expect(resolveRosettaIndexStatus({ tocSignature: current }, current)).toBe('ready')
    expect(resolveRosettaIndexStatus({ tocSignature: '' }, current)).toBe('stale')
  })
})

describe('getCurrentRosettaTocSignature', () => {
  it('与入库侧同一规范化：空白折叠后签名一致', () => {
    const base = getCurrentRosettaTocSignature({
      outlineUnits: [],
      ocrEntries: [{ title: '第1章  概述', printedPage: 1, level: 1 }],
      pageOffset: 9,
      pageCount: 50,
    })
    const spaced = getCurrentRosettaTocSignature({
      outlineUnits: [],
      ocrEntries: [{ title: '  第1章 概述  ', printedPage: 1, level: 1 }],
      pageOffset: 9,
      pageCount: 50,
    })
    expect(base).toBe(spaced)
    expect(base).toBe(computeTocSignature([{ title: '第1章 概述', realPage: 10, level: 1 }]))
  })

  it('页数非法时返回空串（不误报）', () => {
    expect(
      getCurrentRosettaTocSignature({ outlineUnits: [], ocrEntries: [], pageOffset: 0, pageCount: 0 }),
    ).toBe('')
  })
})
