import { describe, expect, it } from 'vitest'
import type { ReadingMark } from '@montree/contracts'
import { filterRedundantKeyPoints, parseNoteToCardMeta, resolveCardMeta } from './resolve-card-meta'

describe('resolveCardMeta', () => {
  const baseMark: ReadingMark = {
    id: 'mark-1',
    filePath: '/books/test.epub',
    fileFingerprint: 'fp-1',
    kind: 'note',
    anchor: { format: 'epub', cfi: 'epubcfi(/6/2)', selectedText: '托克维尔' },
    excerpt: '托克维尔和博蒙离开纽约前往奥尔巴尼',
    createdAt: 1000,
    updatedAt: 1000,
  }

  it('deserializes JSON string embedded in mark.note into structured card fields and clears raw JSON note', () => {
    const rawJson = JSON.stringify({
      title: '托克维尔行程要略',
      category: 'concept',
      aiSummary: '托克维尔和博蒙深入北美边疆考察荒野与政治制度。',
      keyPoints: ['离开纽约前往奥尔巴尼', '看到底特律另一边的大荒野'],
    })

    const mark: ReadingMark = {
      ...baseMark,
      note: rawJson,
    }

    const resolved = resolveCardMeta(mark)

    expect(resolved.category).toBe('concept')
    expect(resolved.title).toBe('托克维尔行程要略')
    expect(resolved.aiSummary).toContain('深入北美边疆考察荒野')
    expect(resolved.keyPoints).toEqual(['离开纽约前往奥尔巴尼', '看到底特律另一边的大荒野'])
    expect(resolved.displayNote).toBeUndefined() // Raw JSON 必须被消除，绝不直接显示！
  })

  it('keeps normal human note intact if note is plain text and classifies it as note category', () => {
    const mark: ReadingMark = {
      ...baseMark,
      note: '这是一条读者手写的纯文本思考。',
    }

    const resolved = resolveCardMeta(mark)

    expect(resolved.displayNote).toBe('这是一条读者手写的纯文本思考。')
    expect(resolved.category).toBe('note')
  })

  it('respects mark.category and mark.title when explicitly provided', () => {
    const mark: ReadingMark = {
      ...baseMark,
      category: 'quote',
      title: '警句卡片',
      note: '思考内容',
    }

    const resolved = resolveCardMeta(mark)

    expect(resolved.category).toBe('quote')
    expect(resolved.title).toBe('警句卡片')
    expect(resolved.displayNote).toBe('思考内容')
  })
})

describe('parseNoteToCardMeta', () => {
  it('parses JSON payload and removes JSON payload from note', () => {
    const jsonStr = JSON.stringify({
      title: '概念解析',
      category: 'concept',
      aiSummary: '核心摘要',
      keyPoints: ['要点1', '要点2'],
    })

    const parsed = parseNoteToCardMeta(jsonStr)
    expect(parsed.title).toBe('概念解析')
    expect(parsed.category).toBe('concept')
    expect(parsed.aiSummary).toBe('核心摘要')
    expect(parsed.keyPoints).toEqual(['要点1', '要点2'])
    expect(parsed.note).toBeUndefined()
  })

  it('preserves userNote when embedded in json payload', () => {
    const jsonStr = JSON.stringify({
      title: '概念解析',
      category: 'concept',
      userNote: '用户的手写思考',
    })

    const parsed = parseNoteToCardMeta(jsonStr)
    expect(parsed.note).toBe('用户的手写思考')
  })

  it('returns plain text note as note property if not json', () => {
    const parsed = parseNoteToCardMeta('一段普通笔记')
    expect(parsed.note).toBe('一段普通笔记')
    expect(parsed.title).toBeUndefined()
  })
})

describe('filterRedundantKeyPoints', () => {
  const excerpt = '关于《论美国的民主》，它的时事性经常被讨论的问题。如果我们用时事性一词暗指这一杰出作品仍应当被理解和研究，是完全恰当的。'

  it('摘录原句切出来的要点 pill 全部隐藏', () => {
    expect(
      filterRedundantKeyPoints(['作品仍应当被理解和研究'], excerpt),
    ).toEqual([])
  })

  it('近义改写不过滤（模型输出质量问题，归 quote 预设 directive 管）', () => {
    // '其时事性是经常被讨论的问题' vs 摘录'它的时事性经常被讨论的问题'：
    // 字面不同，过滤器放行；以后靠预设"aiSummary 只写点评不复述"收敛
    expect(
      filterRedundantKeyPoints(['其时事性是经常被讨论的问题'], excerpt),
    ).toEqual(['其时事性是经常被讨论的问题'])
  })

  it('标点空白差异不影响判定，空串与重复顺手清理', () => {
    expect(
      filterRedundantKeyPoints(
        [' 作品仍应当被理解和研究，', '作品仍应当被理解和研究', '', '真正的新要点'],
        excerpt,
      ),
    ).toEqual(['真正的新要点'])
  })

  it('无摘录时无法判定，保留（容错）', () => {
    expect(filterRedundantKeyPoints(['某要点'], undefined)).toEqual(['某要点'])
    expect(filterRedundantKeyPoints(undefined, excerpt)).toEqual([])
  })
})
