/**
 * Track which ACP sessions have received the one-time Montree bootstrap.
 * The set is renderer-process scoped, so a resumed session after an app reload
 * receives the bootstrap again even if the ACP session id is unchanged.
 */
const sentSessionIds = new Set<string>()

export function shouldSendSessionBootstrap(sessionId: string): boolean {
  return !sentSessionIds.has(sessionId)
}

export function markSessionBootstrapSent(sessionId: string): void {
  sentSessionIds.add(sessionId)
}

export function resetSessionBootstrap(sessionId?: string): void {
  if (sessionId) {
    sentSessionIds.delete(sessionId)
  } else {
    sentSessionIds.clear()
  }
}
