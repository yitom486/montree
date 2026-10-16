import { describe, expect, it } from 'vitest'
import {
  isChapterMarkPlanToolTitle,
  parseChapterMarkPlanToolResult,
} from './parse-chapter-mark-plan'

describe('parse-chapter-mark-plan', () => {
  it('识别 suggest_chapters 工具名', () => {
    expect(isChapterMarkPlanToolTitle('montree_suggest_chapters')).toBe(true)
    expect(isChapterMarkPlanToolTitle('montree_propose_mark')).toBe(false)
  })

  it('解析章级建议 JSON', () => {
    const parsed = parseChapterMarkPlanToolResult(
      JSON.stringify({
        suggested: true,
        count: 2,
        chapters: [
          { flatIndex: 1, title: '第二章', reason: '核心概念集中' },
          { flatIndex: 3, title: '第四章', reason: '案例丰富' },
        ],
        message: '请选择一章',
      }),
    )
    expect(parsed?.count).toBe(2)
    expect(parsed?.chapters[0]?.flatIndex).toBe(1)
    expect(parsed?.chapters[1]?.reason).toBe('案例丰富')
  })
})
