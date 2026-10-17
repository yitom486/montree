import { createChatTurnController } from '@yitom/chat-session'
import { appApi } from '@/api/app-api'
import { useAcpUiStore } from '@/stores/acp-ui-store'

interface TurnIdentity {
  scopeId: string
  threadId: string
  runtimeId: string
  sessionId: string | null
  routeGeneration: number
  sessionGeneration: number
}

let routeGeneration = 0
let sessionGeneration = 0
const controllers = new Map<string, ReturnType<typeof createChatTurnController>>()
useAcpUiStore.subscribe((next, previous) => {
  const routeChanged = next.activeThreadId !== previous.activeThreadId || next.selectedRuntimeId !== previous.selectedRuntimeId
  const sessionChanged = next.sessionId !== previous.sessionId
  if (routeChanged) {
    routeGeneration += 1
  }
  if (sessionChanged) sessionGeneration += 1
  for (const controller of controllers.values()) {
    if (routeChanged) controller.invalidateSend()
    else if (sessionChanged) controller.invalidateSendIfStale()
  }
})

/** Docked and floating hook instances in this window must acquire the same send lock. */
export function getAcpTurnController() {
  const scope = appApi.getWindowScopeId()
  let controller = controllers.get(scope)
  if (!controller) {
    controller = createChatTurnController()
    controllers.set(scope, controller)
  }
  return controller
}

export function captureAcpTurnIdentity(): TurnIdentity {
  const state = useAcpUiStore.getState()
  return {
    scopeId: appApi.getWindowScopeId(), threadId: state.activeThreadId,
    runtimeId: state.selectedRuntimeId, sessionId: state.sessionId,
    routeGeneration, sessionGeneration,
  }
}

/** Connection preparation may replace sessionId; it must never replace the intended route. */
export function isAcpTurnRouteCurrent(identity: TurnIdentity): boolean {
  const current = captureAcpTurnIdentity()
  return current.scopeId === identity.scopeId && current.threadId === identity.threadId &&
    current.runtimeId === identity.runtimeId && current.routeGeneration === identity.routeGeneration
}

export function isAcpTurnIdentityCurrent(identity: TurnIdentity): boolean {
  const current = captureAcpTurnIdentity()
  return isAcpTurnRouteCurrent(identity) && current.sessionId === identity.sessionId &&
    current.sessionGeneration === identity.sessionGeneration
}
