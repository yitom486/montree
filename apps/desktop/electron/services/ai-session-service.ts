import { app } from 'electron'
import { toAppError, type AppError } from '@montree/contracts'
import { err, ok, type Result } from '@montree/contracts'
import type {
  AiSessionGetPayload,
  AiSessionPutPayload,
  AiSessionRecord,
  AiSessionTouchPayload,
} from '@montree/contracts'
import { openMontreeDb } from './app-db/open-app-db'

/**
 * AI 会话指针 service（一书一会话，P1 制卡工作室用）。
 * 调用方（渲染端）负责建新会话与轮转决策，本模块只做行存取。
 */

const CARD_STUDIO_PURPOSE = 'card-studio'

function purposeOf(payload: { purpose?: string }): string {
  return payload.purpose?.trim() || CARD_STUDIO_PURPOSE
}

function toRecord(row: {
  book_fingerprint: string
  purpose: string
  session_id: string
  prompt_count: number
  last_used_at: number
  created_at: number
  updated_at: number
}): AiSessionRecord {
  return {
    bookFingerprint: row.book_fingerprint,
    purpose: row.purpose,
    sessionId: row.session_id,
    promptCount: row.prompt_count,
    lastUsedAt: row.last_used_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

export async function getAiSession(
  payload: AiSessionGetPayload,
): Promise<Result<AiSessionRecord | null, AppError>> {
  try {
    const fingerprint = payload.bookFingerprint.trim()
    if (!fingerprint) return ok(null)
    const db = openMontreeDb(app.getPath('userData'))
    const row = db
      .prepare('SELECT * FROM ai_sessions WHERE book_fingerprint = ? AND purpose = ?')
      .get(fingerprint, purposeOf(payload)) as Parameters<typeof toRecord>[0] | undefined
    return ok(row ? toRecord(row) : null)
  } catch (error) {
    return err(toAppError(error, '读取 AI 会话失败'))
  }
}

export async function putAiSession(
  payload: AiSessionPutPayload,
): Promise<Result<void, AppError>> {
  try {
    const fingerprint = payload.bookFingerprint.trim()
    if (!fingerprint || !payload.sessionId.trim()) {
      return err({ code: 'INVALID_ARGUMENT', message: '会话指纹与 id 不能为空' })
    }
    const now = Date.now()
    const db = openMontreeDb(app.getPath('userData'))
    db.prepare(
      `INSERT INTO ai_sessions (
        book_fingerprint, purpose, session_id, prompt_count, last_used_at,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(book_fingerprint, purpose) DO UPDATE SET
        session_id = excluded.session_id,
        prompt_count = excluded.prompt_count,
        last_used_at = excluded.last_used_at,
        updated_at = excluded.updated_at`,
    ).get(
      fingerprint,
      purposeOf(payload),
      payload.sessionId,
      payload.promptCount,
      payload.lastUsedAt,
      now,
      now,
    )
    return ok(undefined)
  } catch (error) {
    return err(toAppError(error, '保存 AI 会话失败'))
  }
}

export async function touchAiSession(
  payload: AiSessionTouchPayload,
): Promise<Result<void, AppError>> {
  try {
    const fingerprint = payload.bookFingerprint.trim()
    if (!fingerprint) return ok(undefined)
    const db = openMontreeDb(app.getPath('userData'))
    db.prepare(
      `UPDATE ai_sessions
       SET prompt_count = prompt_count + 1, last_used_at = ?, updated_at = ?
       WHERE book_fingerprint = ? AND purpose = ?`,
    ).get(Date.now(), Date.now(), fingerprint, purposeOf(payload))
    return ok(undefined)
  } catch (error) {
    return err(toAppError(error, '更新 AI 会话失败'))
  }
}
