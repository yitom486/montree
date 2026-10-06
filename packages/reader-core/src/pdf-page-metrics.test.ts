import { describe, expect, it } from 'vitest'
import {
  estimatePageOffsetTop,
  resolvePdfPageScrollTop,
} from '@montree/reader-core'

describe('pdf page metrics', () => {
  it('按等高估算页偏移', () => {
    expect(estimatePageOffsetTop(1, 800, 16)).toBe(0)
    expect(estimatePageOffsetTop(2, 800, 16)).toBe(816)
    expect(estimatePageOffsetTop(19, 800, 16)).toBe(18 * 816)
  })

  it('有锚点时优先用真实 offsetTop', () => {
    expect(resolvePdfPageScrollTop(19, 800, 12000)).toBe(12000 - 16)
  })

  it('无锚点时回退估算，避免远跳视口落空', () => {
    expect(resolvePdfPageScrollTop(19, 800, null)).toBe(18 * 816)
  })
})
