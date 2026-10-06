import type { QuizSessionRecord } from '@montree/contracts'
import type { Result } from '@montree/contracts'
import type { AppError } from '@montree/contracts'

export interface IQuizRepository {
  appendSession(session: QuizSessionRecord): Promise<Result<void, AppError>>
  getSessionsByFile(filePath: string): Promise<QuizSessionRecord[]>
  getAllSessions(): Promise<QuizSessionRecord[]>
  getSessionById(sessionId: string): Promise<QuizSessionRecord | null>
}
