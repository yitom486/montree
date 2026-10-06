import type { DatabaseSync } from 'node:sqlite'

/**
 * 全局库 schema（跨书数据）：`userData/montree.db`。
 * v1 只放测验（[2]-02a）：`quiz_sessions` 每次作答 1 行 +
 * `quiz_questions` 每题 1 行（questions 数组拆行，"错题本/按题统计"变普通查询；
 * `submissions` 明细读多写少，以 JSON 存题行，不拆）。
 * 与 03 DDL 草案两处差异（round-trip 保真所需，见列注释）：
 * 1. `quiz_questions` 用 INTEGER 自增主键 + `question_id` 存原值：
 *    AI/单测里 `q1` 这类通用题 id 跨场次会撞 TEXT 主键。
 * 2. 补 `title` 列：草案漏了 `QuizQuestion.title`，否则丢题干标题。
 */

export const MONTREE_DB_SCHEMA_VERSION = 2

const MIGRATION_V1 = `
CREATE TABLE IF NOT EXISTS quiz_sessions (
  id TEXT PRIMARY KEY,
  book_fingerprint TEXT,
  file_path TEXT NOT NULL,
  book_title TEXT NOT NULL,
  chapter_key TEXT,
  chapter_title TEXT,
  total_score REAL NOT NULL,
  grade TEXT NOT NULL,
  question_count INTEGER NOT NULL,
  correct_count INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_quiz_sessions_file_time ON quiz_sessions (file_path, created_at);
CREATE TABLE IF NOT EXISTS quiz_questions (
  id INTEGER PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES quiz_sessions(id) ON DELETE CASCADE,
  question_id TEXT NOT NULL,
  mark_id TEXT,
  title TEXT,
  prompt TEXT NOT NULL,
  source_excerpt TEXT,
  chapter_title TEXT,
  tag TEXT,
  key_points TEXT,
  score REAL NOT NULL DEFAULT 0,
  max_score REAL NOT NULL DEFAULT 0,
  submissions TEXT,
  created_at INTEGER NOT NULL,
  UNIQUE (session_id, question_id)
);
CREATE INDEX IF NOT EXISTS idx_quiz_questions_session ON quiz_questions (session_id);
`

const MIGRATIONS: Record<number, string> = {
  1: MIGRATION_V1,
  // v2：ai_sessions（一书一会话指针，见 .plan/ai-cards/01）。
  // 只记指针与计数，不存消息明文；purpose 预留 quiz 副会话迁入。
  2: `CREATE TABLE IF NOT EXISTS ai_sessions (
  book_fingerprint TEXT NOT NULL,
  purpose TEXT NOT NULL DEFAULT 'card-studio',
  session_id TEXT NOT NULL,
  prompt_count INTEGER NOT NULL DEFAULT 0,
  last_used_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (book_fingerprint, purpose)
);`,
}

export function getMontreeDbVersion(db: DatabaseSync): number {
  const row = db.prepare('PRAGMA user_version').get() as { user_version?: unknown } | undefined
  const version = row?.user_version
  return typeof version === 'number' && Number.isInteger(version) ? version : 0
}

/** 按 user_version 顺序执行缺失迁移；幂等，可重复调用 */
export function migrateMontreeDb(db: DatabaseSync): { migrated: boolean; version: number } {
  try {
    db.exec('PRAGMA journal_mode = WAL')
  } catch {
    // 极早版本驱动不支持时忽略，迁移本身不受影响
  }
  const current = getMontreeDbVersion(db)
  const pending = Object.keys(MIGRATIONS)
    .map(Number)
    .filter((version) => version > current)
    .sort((a, b) => a - b)
  for (const version of pending) {
    const sql = MIGRATIONS[version]
    if (!sql) continue
    db.exec(sql)
    db.exec(`PRAGMA user_version = ${version}`)
  }
  const next = pending.length > 0 ? (pending[pending.length - 1] as number) : current
  return { migrated: pending.length > 0, version: next }
}
