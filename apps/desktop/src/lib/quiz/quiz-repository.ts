import type { QuizSessionRecord } from '@yitom/contracts'
import type { Result } from '@yitom/contracts'
import type { AppError } from '@yitom/contracts'

export interface IQuizRepository {
  appendSession(session: QuizSessionRecord): Promise<Result<void, AppError>>
  getSessionsByFile(filePath: string): Promise<QuizSessionRecord[]>
  getAllSessions(): Promise<QuizSessionRecord[]>
  getSessionById(sessionId: string): Promise<QuizSessionRecord | null>
}
