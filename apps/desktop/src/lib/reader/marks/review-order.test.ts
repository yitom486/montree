import { describe, expect, it } from 'vitest'
import { sortCardsByDueOrder } from './review-order'
import type { Flashcard } from '@montree/annotations'

function card(id: string): Flashcard {
  return { id, kind: 'basic', front: id, back: '', tags: [], sourceTitle: '书' }
}

describe('sortCardsByDueOrder', () => {
  it('按 due 顺序重排', () => {
    const out = sortCardsByDueOrder([card('a'), card('b'), card('c')], ['c', 'a'])
    expect(out.map((c) => c.id)).toEqual(['c', 'a', 'b'])
  })

  it('null 原样返回（due 拉取失败回落派生顺序）', () => {
    const cards = [card('a'), card('b')]
    expect(sortCardsByDueOrder(cards, null)).toBe(cards)
  })

  it('due 多余 id 忽略，不在 due 中的新卡缀尾不丢失', () => {
    const out = sortCardsByDueOrder([card('new'), card('a')], ['ghost', 'a'])
    expect(out.map((c) => c.id)).toEqual(['a', 'new'])
  })
})
