import { describe, it, expect } from 'vitest'
import { mergeQuizSessions } from './quiz-merger'
import type { QuizSessionRecord } from '@montree/contracts'
import { serializeQuizSession } from '@montree/contracts'

describe('quiz-merger', () => {
  const session1: QuizSessionRecord = {
    id: 'quiz-1',
    bookTitle: '红楼梦',
    filePath: 'd:/books/hongloumeng.epub',
    chapterTitle: '第一回',
    totalScore: 85,
    grade: 'B',
    questions: [
      {
        id: 'q1',
        title: '通灵宝玉',
        prompt: '甄士隐梦幻识通灵？',
        sourceExcerpt: '甄士隐梦幻识通灵',
        keyPoints: ['通灵宝玉'],
      },
    ],
    submissions: {},
    createdAt: '2026-09-01T10:00:00.000Z',
  }

  const session2: QuizSessionRecord = {
    id: 'quiz-2',
    bookTitle: '红楼梦',
    filePath: 'd:/books/hongloumeng.epub',
    chapterTitle: '第二回',
    totalScore: 95,
    grade: 'A',
    questions: [
      {
        id: 'q2',
        title: '贾雨村',
        prompt: '贾夫人仙逝扬州城？',
        sourceExcerpt: '贾夫人仙逝扬州城',
        keyPoints: ['贾雨村'],
      },
    ],
    submissions: {},
    createdAt: '2026-09-02T10:00:00.000Z',
  }

  it('按 session.id 幂等去重并按时间升序排序', () => {
    const localJsonl = serializeQuizSession(session2)
    const remoteJsonl = serializeQuizSession(session1) + serializeQuizSession(session2)

    const result = mergeQuizSessions(localJsonl, remoteJsonl)
    expect(result.mergedSessions).toHaveLength(2)
    expect(result.addedCount).toBe(1)
    expect(result.mergedSessions[0]?.id).toBe('quiz-1')
    expect(result.mergedSessions[1]?.id).toBe('quiz-2')
  })
})
