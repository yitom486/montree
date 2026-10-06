import type {
  CreateReadingMarkPayload,
  MarksListByChapterPayload,
  MarksSearchPayload,
  ReadingMark,
  UpdateReadingMarkPayload,
} from '@montree/contracts'
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

export const readingMarksApi = {
  async list(filePath: string): Promise<Result<ReadingMark[], AppError>> {
    const api = requireElectronAPI()
    if (!api.ok) return api
    return api.value.listReadingMarks(filePath)
  },

  async create(payload: CreateReadingMarkPayload): Promise<Result<ReadingMark, AppError>> {
    const api = requireElectronAPI()
    if (!api.ok) return api
    return api.value.createReadingMark(payload)
  },

  async update(payload: UpdateReadingMarkPayload): Promise<Result<ReadingMark, AppError>> {
    const api = requireElectronAPI()
    if (!api.ok) return api
    return api.value.updateReadingMark(payload)
  },

  async remove(id: string): Promise<Result<void, AppError>> {
    const api = requireElectronAPI()
    if (!api.ok) return api
    return api.value.deleteReadingMark(id)
  },

  /** 本书内卡片全文搜（空 query 调主进程直接回空，调用方展示全量） */
  async search(payload: MarksSearchPayload): Promise<Result<ReadingMark[], AppError>> {
    const api = requireElectronAPI()
    if (!api.ok) return api
    return api.value.searchReadingMarks(payload)
  },

  /** 按章查卡（固化命中 + 未固化候选，调用方窄化；见 chapter-scope） */
  async listByChapter(
    payload: MarksListByChapterPayload,
  ): Promise<Result<ReadingMark[], AppError>> {
    const api = requireElectronAPI()
    if (!api.ok) return api
    return api.value.listReadingMarksByChapter(payload)
  },
}
