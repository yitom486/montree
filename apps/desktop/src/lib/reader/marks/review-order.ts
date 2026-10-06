import type { Flashcard } from '@montree/annotations'

/**
 * 待复习排序（UI批）：派生卡按 due id 顺序重排。
 * 不在 due 中的卡（due 拉取与建卡竞态的新卡）缀尾，不静默丢失；
 * due 拉取失败（null）原样返回派生顺序（今日行为）。
 * due 中多余的 id（卡已删）自然忽略。
 */
export function sortCardsByDueOrder(
  cards: Flashcard[],
  dueOrder: string[] | null,
): Flashcard[] {
  if (!dueOrder) return cards
  const rank = new Map(dueOrder.map((id, index) => [id, index]))
  const inDue: Flashcard[] = []
  const fresh: Flashcard[] = []
  for (const card of cards) {
    if (rank.has(card.id)) inDue.push(card)
    else fresh.push(card)
  }
  inDue.sort((a, b) => (rank.get(a.id) ?? 0) - (rank.get(b.id) ?? 0))
  return [...inDue, ...fresh]
}
