import { restoreOrCreateAcpSession as restore, type RestoreOrCreateSessionInput } from '@yitom/acp-client'
import { logAcpDiagnostic } from './mcp/diagnostics'

export { isAuthenticationRequired, isTransientAcpTransportError, requestSessionWithResources } from '@yitom/acp-client'
export type { AcpRpcRequest, RestoreOrCreateSessionInput, RestoreOrCreateSessionResult } from '@yitom/acp-client'

/** Reader sessions require tools; only the policy and local diagnostics belong to Montree. */
export function restoreOrCreateAcpSession(input: RestoreOrCreateSessionInput) {
  return restore({
    ...input,
    preserveMcpOnRetry: true,
    log(level, message, data) {
      logAcpDiagnostic('acp.session', {
        action: message, level,
        sessionId: typeof data?.sessionId === 'string' ? data.sessionId : undefined,
        method: typeof data?.method === 'string' ? data.method : undefined,
        attempt: typeof data?.try === 'number' ? data.try : undefined,
        mcpCount: input.mcpServers?.length ?? 0,
      })
      if (input.log) input.log(level, message, data)
      else if (level === 'warn') console.warn('[acp]', message, data ?? '')
      else if (process.env.NODE_ENV !== 'production') console.info('[acp]', message, data ?? '')
    },
  })
}
