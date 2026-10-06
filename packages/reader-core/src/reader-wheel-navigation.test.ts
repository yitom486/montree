import { describe, expect, it } from 'vitest'
import { resolveWheelPageTurn } from '@montree/reader-core'

describe('resolveWheelPageTurn', () => {
  const fitsViewport = { scrollTop: 0, scrollHeight: 800, clientHeight: 800 }
  const scrollableMiddle = { scrollTop: 400, scrollHeight: 1600, clientHeight: 800 }
  const scrollableTop = { scrollTop: 0, scrollHeight: 1600, clientHeight: 800 }
  const scrollableBottom = { scrollTop: 800, scrollHeight: 1600, clientHeight: 800 }

  it('页面适配视口时滚轮直接翻页', () => {
    expect(resolveWheelPageTurn(120, fitsViewport)).toBe('next')
    expect(resolveWheelPageTurn(-120, fitsViewport)).toBe('prev')
  })

  it('可滚动且未到边界时不翻页', () => {
    expect(resolveWheelPageTurn(120, scrollableMiddle)).toBeNull()
    expect(resolveWheelPageTurn(-120, scrollableMiddle)).toBeNull()
  })

  it('滚到底部后继续向下滚时翻下一页', () => {
    expect(resolveWheelPageTurn(120, scrollableBottom)).toBe('next')
  })

  it('滚到顶部后继续向上滚时翻上一页', () => {
    expect(resolveWheelPageTurn(-120, scrollableTop)).toBe('prev')
  })
})
