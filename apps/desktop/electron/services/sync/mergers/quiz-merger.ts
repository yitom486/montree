import type { QuizSessionRecord } from '@montree/contracts'
import { parseQuizJsonl, serializeQuizSession } from '@montree/contracts'

export interface QuizMergeResult {
  mergedSessions: QuizSessionRecord[]
  mergedJsonl: string
  addedCount: number
}

/**
 * AI 伴读测验记录双向合并（按 session.id 幂等去重，按 createdAt 升序排序）
 */
export function mergeQuizSessions(
  localJsonl: string,
  remoteJsonl: string,
): QuizMergeResult {
  const localList = parseQuizJsonl(localJsonl)
  const remoteList = parseQuizJsonl(remoteJsonl)

  const sessionMap = new Map<string, QuizSessionRecord>()
  for (const session of localList) {
    sessionMap.set(session.id, session)
  }

  let addedCount = 0
  for (const session of remoteList) {
    if (!sessionMap.has(session.id)) {
      sessionMap.set(session.id, session)
      addedCount += 1
    }
  }

  const mergedSessions = Array.from(sessionMap.values()).sort(
    (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
  )

  const mergedJsonl = mergedSessions
    .map((session) => serializeQuizSession(session))
    .join('')

  return {
    mergedSessions,
    mergedJsonl,
    addedCount,
  }
}
