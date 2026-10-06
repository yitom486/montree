import { describe, expect, it } from 'vitest'
import { parseQuizJsonl, serializeQuizSession } from '@montree/contracts'
import type { QuizSessionRecord } from '@montree/contracts'

describe('quiz-service JSONL serialization', () => {
  const sampleRecord: QuizSessionRecord = {
    id: 'quiz-1',
    bookTitle: '红楼梦',
    filePath: 'D:/books/hongloumeng.epub',
    createdAt: new Date().toISOString(),
    totalScore: 85,
    grade: 'B',
    questions: [
      {
        id: 'q1',
        title: '太虚幻境判词意图',
        prompt: '请阐述作者在此处的暗示手法。',
        keyPoints: ['暗示命运', '预叙结构'],
        sourceExcerpt: '满纸荒唐言，一把辛酸泪。',
      },
    ],
    submissions: {
      q1: {
        questionId: 'q1',
        userAnswer: '作者借判词暗示了书中主要人物的悲剧命运结局。',
        score: 85,
        grade: 'B',
        feedback: '很好地答出了命运预叙，但对结构线索的分析略有欠缺。',
        hitKeyPoints: ['暗示命运'],
        missedKeyPoints: ['预叙结构'],
        gradedAt: new Date().toISOString(),
      },
    },
  }

  it('serializes single record as single-line string with newline', () => {
    const serialized = serializeQuizSession(sampleRecord)
    expect(serialized.endsWith('\n')).toBe(true)
    expect(serialized.trim().split('\n')).toHaveLength(1)
  })

  it('parses valid JSONL and skips corrupted/empty lines', () => {
    const raw = `
${JSON.stringify(sampleRecord)}
corrupted line {invalid json
${JSON.stringify({ ...sampleRecord, id: 'quiz-2' })}

    `
    const parsed = parseQuizJsonl(raw)
    expect(parsed).toHaveLength(2)
    expect(parsed[0]?.id).toBe('quiz-1')
    expect(parsed[1]?.id).toBe('quiz-2')
  })
})
