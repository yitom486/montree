import type { ReadingMarkCategory } from '@montree/contracts'
import type { HighlightColorId } from '@montree/reader-core'

export interface HeuristicCardResult {
  category: ReadingMarkCategory
  title: string
  aiSummary: string
  keyPoints: string[]
  color: HighlightColorId
}

/**
 * 分类→高亮色单源映射（启发式与 AI 制卡共用；模型不定色）。
 * 与下文各分支 return 的 color 逐字一致，改色只改这里。
 */
export function highlightColorForCategory(category: ReadingMarkCategory): HighlightColorId {
  switch (category) {
    case 'method':
      return 'green'
    case 'diagram':
      return 'pink'
    case 'quote':
      return 'yellow'
    case 'question':
      return 'orange'
    case 'note':
      return 'purple'
    case 'concept':
    default:
      return 'blue'
  }
}

/**
 * 卡片落盘形状与分类→高亮色映射。
 * 启发式提炼引擎（`heuristicClassifyMark`）已删除——调不通模型就不建卡，
 * 不拿关键词拼凑充数；颜色映射保留（模型不定色，审美归代码）。
 */
