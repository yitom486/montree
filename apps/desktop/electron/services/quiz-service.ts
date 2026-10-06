import { appendFile, mkdir, readFile, writeFile } from 'fs/promises'
import { existsSync } from 'fs'
import { join } from 'path'
import { app } from 'electron'
import { toAppError, type AppError } from '@montree/contracts'
import { err, ok, parseQuizJsonl, serializeQuizSession, type Result } from '@montree/contracts'
import type { QuizSessionRecord } from '@montree/contracts'
import {
  exportQuizJsonl,
  importQuizJsonl,
  insertQuizSession,
  listQuizSessions,
  listQuizSessionsByFile,
} from './quiz-db'

// 兼容再导出：纯函数已下沉 contracts，旧测试仍从本模块引入，保持可用
export { parseQuizJsonl, serializeQuizSession } from '@montree/contracts'

export function getQuizFilePath(): string {
  return join(app.getPath('userData'), 'quiz-records.jsonl')
}

/**
 * 后端开关（[2]-02a 灰度/回滚）：默认走全局 montree.db；
 * `MONTREE_QUIZ_BACKEND=file` 切回旧 JSONL 实现（保留旧代码路径）。
 */
export function useFileQuizBackend(): boolean {
  return process.env.MONTREE_QUIZ_BACKEND === 'file'
}

async function readQuizStoreFile(): Promise<string> {
  const filePath = getQuizFilePath()
  return readFile(filePath, 'utf-8').catch((e: unknown) => {
    if (e && typeof e === 'object' && 'code' in e && (e as { code: string }).code === 'ENOENT') {
      return ''
    }
    throw e
  })
}

/** 已迁移过的 userData 目录（进程内记忆，跨目录测试互不干扰） */
const quizMigratedDirs = new Set<string>()

/**
 * 懒迁移：首个 DB 操作时把 quiz-records.jsonl 灌库（一次性），
 * 先落 .bak 再灌，marker 防止重复。灰度期内旧文件保留，回滚切开关即回。
 */
async function ensureQuizMigrated(): Promise<void> {
  const userDataDir = app.getPath('userData')
  if (quizMigratedDirs.has(userDataDir)) return
  quizMigratedDirs.add(userDataDir)
  const marker = join(userDataDir, 'quiz-records.jsonl.migrated-to-db')
  if (existsSync(marker)) return
  const raw = await readQuizStoreFile()
  if (!raw.trim()) {
    await writeFile(marker, JSON.stringify({ at: Date.now(), sessions: 0 }))
    return
  }
  await writeFile(join(userDataDir, 'quiz-records.jsonl.bak'), raw, 'utf-8')
  const stats = importQuizJsonl(userDataDir, raw)
  await writeFile(marker, JSON.stringify({ at: Date.now(), ...stats }))
}

function normalizeFilePath(filePath: string): string {
  const trimmed = filePath.trim()
  if (process.platform === 'win32') {
    return trimmed.toLowerCase()
  }
  return trimmed
}

/**
 * 追加一条测验记录（幂等：同 id 重复追加不翻倍）
 */
export async function appendQuizSession(
  session: QuizSessionRecord,
): Promise<Result<void, AppError>> {
  try {
    if (useFileQuizBackend()) {
      const filePath = getQuizFilePath()
      await mkdir(app.getPath('userData'), { recursive: true })
      await appendFile(filePath, serializeQuizSession(session), 'utf-8')
      return ok(undefined)
    }
    await ensureQuizMigrated()
    insertQuizSession(app.getPath('userData'), session)
    return ok(undefined)
  } catch (error) {
    return err(toAppError(error, '测验记录保存失败'))
  }
}

/**
 * 读取全部测验历史记录（倒序排列，最新优先）
 */
export async function readAllQuizSessions(): Promise<Result<QuizSessionRecord[], AppError>> {
  try {
    if (useFileQuizBackend()) {
      const records = parseQuizJsonl(await readQuizStoreFile())
      // 按时间倒序
      records.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
      return ok(records)
    }
    await ensureQuizMigrated()
    return ok(listQuizSessions(app.getPath('userData')))
  } catch (error) {
    return err(toAppError(error, '读取测验记录失败'))
  }
}

/**
 * 按书籍/文档路径读取测验历史
 */
export async function readQuizSessionsByFile(
  filePath: string,
): Promise<Result<QuizSessionRecord[], AppError>> {
  try {
    if (useFileQuizBackend()) {
      const allResult = await readAllQuizSessions()
      if (!allResult.ok) return allResult
      const targetPath = normalizeFilePath(filePath)
      const filtered = allResult.value.filter(
        (record) => normalizeFilePath(record.filePath) === targetPath,
      )
      return ok(filtered)
    }
    await ensureQuizMigrated()
    return ok(listQuizSessionsByFile(app.getPath('userData'), filePath))
  } catch (error) {
    return err(toAppError(error, '读取测验记录失败'))
  }
}

/**
 * 同步传输：读本地全量 JSONL（DB 后端即读库导出，远端格式不变）。
 * `sync-manager` 经此函数拿数据，merge 纯函数与远端文件名都不动。
 */
export async function readQuizJsonlForSync(): Promise<string> {
  if (useFileQuizBackend()) return readQuizStoreFile()
  await ensureQuizMigrated()
  return exportQuizJsonl(app.getPath('userData'))
}

/** 同步传输：合并后的 JSONL 写回本地（DB 后端即幂等灌库） */
export async function writeQuizJsonlForSync(mergedJsonl: string): Promise<void> {
  if (useFileQuizBackend()) {
    await mkdir(app.getPath('userData'), { recursive: true })
    await writeFile(getQuizFilePath(), mergedJsonl, 'utf-8')
    return
  }
  await ensureQuizMigrated()
  importQuizJsonl(app.getPath('userData'), mergedJsonl)
}
