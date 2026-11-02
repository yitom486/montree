/** 未换文件时，每隔多少轮重新提醒一次工作区状态 */
export const TURN_CONTEXT_INTERVAL = 5

export interface TurnContextTrackerState {
  /** 距离上次附加 turn-context 已经过去的轮数 */
  turnsSinceAttach: number
  /** 上次附加时的 documentKey */
  lastDocumentKey: string | null
  /** 是否已经附加过至少一次 */
  attachedOnce: boolean
  /** T2：上次附加时的位置键（翻页/换章即变，触发重贴） */
  lastLocationKey: string | null
}

export interface TurnContextDecision {
  attach: boolean
  documentChanged: boolean
  next: TurnContextTrackerState
}

export function createTurnContextTrackerState(): TurnContextTrackerState {
  return { turnsSinceAttach: 0, lastDocumentKey: null, attachedOnce: false, lastLocationKey: null }
}

/**
 * 决定本轮是否附加 turn-context。
 *
 * 附加条件（满足其一）：
 * 1. 打开的文档发生变化（含首次打开、关闭文档）；
 * 2. 距离上次附加已达 `interval` 轮；
 * 3. 发送时用户选区仍有效（带 hasSelection；正文走工具，本轮快照冻结）。
 * 4. T2：已附加过，且阅读位置键变化（含 null→有值、有值→null、页/章切换）；
 *    快照仍是位置不是正文，documentChanged 不因此置 true。
 *
 * 附加后计数清零，避免每轮都拼装、把上下文撑满。
 */
export function decideTurnContext(
  state: TurnContextTrackerState,
  currentDocumentKey: string | null,
  interval = TURN_CONTEXT_INTERVAL,
  hasSelection = false,
  locationKey: string | null = null,
): TurnContextDecision {
  const documentChanged = state.attachedOnce
    ? currentDocumentKey !== state.lastDocumentKey
    : currentDocumentKey !== null

  const intervalReached = state.attachedOnce && state.turnsSinceAttach + 1 >= interval
  const locationChanged = state.attachedOnce && locationKey !== state.lastLocationKey
  const attach = documentChanged || intervalReached || hasSelection || locationChanged

  if (!attach) {
    return {
      attach: false,
      documentChanged: false,
      next: { ...state, turnsSinceAttach: state.turnsSinceAttach + 1 },
    }
  }

  return {
    attach: true,
    documentChanged,
    next: {
      turnsSinceAttach: 0,
      lastDocumentKey: currentDocumentKey,
      attachedOnce: true,
      lastLocationKey: locationKey,
    },
  }
}

/** 按对话线程保存计数：仅内存，切换/删除线程后自然失效 */
const trackerByThread = new Map<string, TurnContextTrackerState>()

export function takeTurnContextDecision(
  threadId: string,
  currentDocumentKey: string | null,
  interval = TURN_CONTEXT_INTERVAL,
  hasSelection = false,
  locationKey: string | null = null,
): TurnContextDecision {
  const state = trackerByThread.get(threadId) ?? createTurnContextTrackerState()
  const decision = decideTurnContext(state, currentDocumentKey, interval, hasSelection, locationKey)
  trackerByThread.set(threadId, decision.next)
  return decision
}

export function resetTurnContextTracker(threadId?: string): void {
  if (threadId) {
    trackerByThread.delete(threadId)
    return
  }
  trackerByThread.clear()
}
