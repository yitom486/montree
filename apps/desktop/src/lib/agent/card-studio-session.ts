import { aiSessionApi } from '@/api/ai-session-api'
import { isOk } from '@montree/contracts'
import {
  accumulateSubsessionUpdateFor,
  clearSubsessionSessions,
  ensureSubsessionSession,
  isSubsessionPrompting,
  resetSubsession,
  sendSubsessionPrompt,
  subsessionOwnsSessionFor,
  type SubsessionStore,
} from '@/lib/agent/acp-subsession'

/**
 * AI 制卡一书一会话（P1，见 `.plan/ai-cards/01-card-studio-plan.md`）。
 * 统一副会话工厂的薄封装：purpose 固定 `'card'`、key 取书指纹；
 * 指针落 `montree.db ai_sessions`（重启不失）；轮转阈值沿 quiz 副会话
 * （2h 空闲 / 20 轮）；复用走 `loadSession(secondary)`，失败回 `session/new`。
 * 会话内存表、复用/轮转、自转重试语义一律由工厂保证，本文件只定身份与持久化。
 */

const CARD_PURPOSE = 'card'
const ROTATE_IDLE_MS = 2 * 60 * 60 * 1000
const ROTATE_PROMPT_COUNT = 20

/** ai_sessions 行存取：load→get 行、save→put 整行、touch→touch（原调用原样搬运） */
const cardStudioStore: SubsessionStore = {
  async load(_purpose, key) {
    const stored = await aiSessionApi.get({ bookFingerprint: key })
    const row = isOk(stored) ? stored.value : null
    if (!row) return null
    return { sessionId: row.sessionId, promptCount: row.promptCount, lastUsedAt: row.lastUsedAt }
  },
  async save(_purpose, key, state) {
    await aiSessionApi.put({
      bookFingerprint: key,
      sessionId: state.sessionId,
      promptCount: state.promptCount,
      lastUsedAt: state.lastUsedAt,
    })
  },
  async touch(_purpose, key) {
    await aiSessionApi.touch({ bookFingerprint: key })
  },
}

function cardOptions(bookKey: string) {
  return {
    purpose: CARD_PURPOSE,
    key: bookKey,
    rotation: { idleMs: ROTATE_IDLE_MS, maxPrompts: ROTATE_PROMPT_COUNT },
    store: cardStudioStore,
  }
}

export function cardStudioOwnsSessionId(sessionId: string): boolean {
  return subsessionOwnsSessionFor(CARD_PURPOSE, sessionId)
}

export function isCardStudioPrompting(): boolean {
  return isSubsessionPrompting(CARD_PURPOSE)
}

/** 收集制卡副会话的流式增量（不进入右侧时间线，沿 quiz/toc 同模式） */
export function accumulateCardStudioSessionUpdate(
  sessionId: string,
  update: Record<string, unknown>,
): void {
  accumulateSubsessionUpdateFor(CARD_PURPOSE, sessionId, update)
}

export type CardStudioSessionError = 'auth-required' | 'unavailable'

/**
 * 取本书制卡会话：传输未就绪先发直连信令（`useAcpSession` 自驱完整 connect，
 * 认证弹窗自动弹出），再按过期策略复用/恢复/新建。
 * 认证必须用户点——这是唯一需要主 UI 出面的环节，返回错误由调用方提示重试。
 * 内存命中且未过期即用；否则读库复用（load），恢复失败或计数/超时到期则新建。
 */
export async function getOrCreateCardStudioSessionId(
  bookKey: string,
): Promise<{ sessionId: string } | { error: CardStudioSessionError }> {
  const ensured = await ensureSubsessionSession(cardOptions(bookKey))
  if ('error' in ensured) return { error: ensured.error }
  return { sessionId: ensured.sessionId }
}

/**
 * 经本书会话发制卡 prompt。
 * 结局：ok（有正文）/ auth-required（认证弹窗已出，等用户点）/ failed（其他）。
 * 成功（status ok）记一次 touch（工厂内调 store.touch）；旧会话已死自转一次重试
 * （工厂保证：非 TIMEOUT 拒收删 entry 重建再试一次）。
 * 每次关键节点打 console.info（工厂 `[subsession]` 前缀，devtools 可查；不记原文与指纹全文）。
 */
export type CardStudioSendStatus = 'ok' | 'auth-required' | 'failed'

export interface CardStudioSendResult {
  status: CardStudioSendStatus
  reply: string
}

export async function sendCardStudioPrompt(
  bookKey: string,
  promptText: string,
): Promise<CardStudioSendResult> {
  const sent = await sendSubsessionPrompt(cardOptions(bookKey), promptText)
  return { status: sent.status, reply: sent.reply }
}

/** 手动新开会话（对话框"新开会话"按钮）：清内存，下一调用建新行覆盖 */
export function resetCardStudioSession(bookKey: string): void {
  resetSubsession(CARD_PURPOSE, bookKey)
}

/** 仅单测用 */
export function clearCardStudioSessions(): void {
  clearSubsessionSessions()
}
