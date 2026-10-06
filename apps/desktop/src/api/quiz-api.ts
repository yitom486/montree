import type { QuizSessionRecord } from '@montree/contracts'
import type { AppError } from '@montree/contracts'
import { err, ok, type Result } from '@montree/contracts'

function requireElectronAPI() {
  if (!window.electronAPI) {
    return err({
      code: 'API_UNAVAILABLE' as const,
      message: 'Electron API 不可用',
    })
  }
  return ok(window.electronAPI)
}

export const quizApi = {
  async appendSession(session: QuizSessionRecord): Promise<Result<void, AppError>> {
    const api = requireElectronAPI()
    if (!api.ok) return api
    return api.value.appendQuizSession(session)
  },

  async getAllSessions(): Promise<Result<QuizSessionRecord[], AppError>> {
    const api = requireElectronAPI()
    if (!api.ok) return api
    return api.value.getAllQuizSessions()
  },

  async getSessionsByFile(filePath: string): Promise<Result<QuizSessionRecord[], AppError>> {
    const api = requireElectronAPI()
    if (!api.ok) return api
    return api.value.getQuizSessionsByFile(filePath)
  },
}
