import type { ChildProcessWithoutNullStreams } from 'node:child_process'
import type { ClientApp, ClientContext, AgentRequestMethod, AgentRequestParamsByMethod, AgentRequestResponsesByMethod } from '@agentclientprotocol/sdk'
import { connectSdkClient as connect, sdkRequest as request } from '@yitom/acp-client'
import { logAcpDiagnostic } from './mcp/diagnostics'

export { ACP_SDK_REQUEST_TIMEOUT_MS, createSdkStreamHandle } from '@yitom/acp-client'
export type { SdkStreamHandle } from '@yitom/acp-client'

/** Application identity only; transport ownership and teardown live in the headless SDK. */
export function connectSdkClient(child: ChildProcessWithoutNullStreams, configure: (app: ClientApp) => void, runtimeId?: string) {
  return connect(child, configure, runtimeId, { name: 'montree' })
}

export function sdkRequest<Method extends AgentRequestMethod>(agent: ClientContext, method: Method, params: AgentRequestParamsByMethod[Method], timeoutMs?: number): Promise<AgentRequestResponsesByMethod[Method]>
export function sdkRequest<Response, Params>(agent: ClientContext, method: string, params: Params, timeoutMs?: number): Promise<Response>
/** Preserve product diagnostics; request timeout and cancellation are owned by the SDK. */
export async function sdkRequest<Response, Params>(agent: ClientContext, method: string, params: Params, timeoutMs?: number): Promise<Response> {
  try {
    return await request<Response, Params>(agent, method, params, timeoutMs)
  } catch (error) {
    const message = error instanceof Error ? error.message : ''
    const code = typeof (error as { code?: unknown })?.code === 'number' ? (error as { code: number }).code : undefined
    logAcpDiagnostic('acp.request.failed', { method, code, timedOut: message.startsWith('请求超时:'), authRequired: /authentication required/i.test(message), pathFailure: /cwd|directory|path|ENOENT/i.test(message) })
    throw error
  }
}
