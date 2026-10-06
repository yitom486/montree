import type { IQuizRepository } from './quiz-repository'
import type { QuizSessionRecord } from '@montree/contracts'
import { quizApi } from '@/api/quiz-api'
import { isOk, type Result } from '@montree/contracts'
import type { AppError } from '@montree/contracts'

export class JsonlQuizRepository implements IQuizRepository {
  async appendSession(session: QuizSessionRecord): Promise<Result<void, AppError>> {
    return quizApi.appendSession(session)
  }

  async getSessionsByFile(filePath: string): Promise<QuizSessionRecord[]> {
    const res = await quizApi.getSessionsByFile(filePath)
    if (isOk(res)) return res.value
    return []
  }

  async getAllSessions(): Promise<QuizSessionRecord[]> {
    const res = await quizApi.getAllSessions()
    if (isOk(res)) return res.value
    return []
  }

  async getSessionById(sessionId: string): Promise<QuizSessionRecord | null> {
    const all = await this.getAllSessions()
    return all.find((s) => s.id === sessionId) ?? null
  }
}

export const defaultQuizRepository = new JsonlQuizRepository()
