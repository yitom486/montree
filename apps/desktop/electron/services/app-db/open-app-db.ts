import { existsSync, mkdirSync, renameSync } from 'node:fs'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { migrateMontreeDb } from './schema'

/**
 * 全局一库打开器：`userData/montree.db`（历史兼容 `inkdown.db`）。
 * userDataDir 由调用方传入（app.getPath），本模块不直连 electron，保证可单测。
 * 与 `book-db/open-book-db` 同模式：句柄缓存 + 打开即迁移。
 */

export function getMontreeDbPath(userDataDir: string): string {
  const montreePath = join(userDataDir, 'montree.db')
  const legacyPath = join(userDataDir, 'inkdown.db')
  if (!existsSync(montreePath) && existsSync(legacyPath)) {
    try {
      renameSync(legacyPath, montreePath)
    } catch {
      return legacyPath
    }
  }
  return montreePath
}

export const getInkdownDbPath = getMontreeDbPath

const openHandles = new Map<string, DatabaseSync>()

export function openMontreeDb(userDataDir: string): DatabaseSync {
  const dbPath = getMontreeDbPath(userDataDir)
  const existing = openHandles.get(dbPath)
  if (existing) return existing
  mkdirSync(userDataDir, { recursive: true })
  const db = new DatabaseSync(dbPath)
  migrateMontreeDb(db)
  openHandles.set(dbPath, db)
  return db
}

export const openInkdownDb = openMontreeDb

export function closeAllMontreeDbs(): void {
  for (const [dbPath, db] of openHandles) {
    try {
      db.close()
    } catch {
      // 关闭失败不阻断退出
    }
    openHandles.delete(dbPath)
  }
}

export const closeAllInkdownDbs = closeAllMontreeDbs
