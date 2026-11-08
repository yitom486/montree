import { randomUUID } from 'node:crypto'
import { RequestError, type CreateElicitationRequest } from '@agentclientprotocol/sdk'
import { err, ok, type AppError, type Result } from '@yitom/contracts'
import {
  validateElicitationContent, validateElicitationSchema,
  type ElicitationEvent, type ElicitationReply, type ElicitationRequest, type ElicitationResponse, type ElicitationSchema,
} from '../../../contracts/acp-elicitation'
import { currentAcpContext, type AcpContext } from './acp-context'

interface Pending { request: ElicitationRequest; finish: (response: ElicitationResponse) => void }
interface State { emit?: (event: ElicitationEvent) => void; pending: Map<string, Pending> }
const states = new WeakMap<AcpContext, State>()
function state(): State {
  const context = currentAcpContext()
  let value = states.get(context)
  if (!value) { value = { pending: new Map() }; states.set(context, value) }
  return value
}
export function setElicitationBridge(emit: (event: ElicitationEvent) => void): void { state().emit = emit }
export function cancelElicitations(sessionId?: string): void {
  for (const pending of state().pending.values()) {
    if (!sessionId || pending.request.sessionId === sessionId) pending.finish({ action: 'cancel' })
  }
}
export async function requestElicitation(params: CreateElicitationRequest, signal: AbortSignal): Promise<ElicitationResponse> {
  if (params.mode !== 'form') throw RequestError.invalidParams(undefined, 'Montree 仅声明支持 form elicitation')
  const schema = params.requestedSchema as ElicitationSchema
  let invalid: string | undefined
  try { invalid = validateElicitationSchema(schema) } catch { invalid = '表单结构无效' }
  if (invalid) throw RequestError.invalidParams(undefined, invalid)
  const owner = state()
  if (!owner.emit || signal.aborted || currentAcpContext().closed) return { action: 'cancel' }
  if (owner.pending.size >= 20) throw new RequestError(-32000, '待回答的提问过多')
  const request: ElicitationRequest = {
    id: randomUUID(), message: params.message, schema,
    ...('sessionId' in params && typeof params.sessionId === 'string' ? { sessionId: params.sessionId } : {}),
    ...('toolCallId' in params && typeof params.toolCallId === 'string' ? { toolCallId: params.toolCallId } : {}),
    ...('requestId' in params ? { parentRequestId: params.requestId as string | number } : {}),
  }
  return new Promise(resolve => {
    const abort = () => finish({ action: 'cancel' })
    const finish = (response: ElicitationResponse) => {
      if (!owner.pending.delete(request.id)) return
      signal.removeEventListener('abort', abort)
      try { owner.emit?.({ kind: 'closed', id: request.id }) } catch { /* Renderer already closed. */ }
      resolve(response)
    }
    owner.pending.set(request.id, { request, finish })
    signal.addEventListener('abort', abort, { once: true })
    try { owner.emit!({ kind: 'request', request }) } catch { finish({ action: 'cancel' }) }
  })
}
export function respondElicitation(reply: ElicitationReply): Result<void, AppError> {
  const pending = typeof reply?.id === 'string' ? state().pending.get(reply.id) : undefined
  if (!pending) return err({ code: 'CANCELLED', message: '该提问已结束' })
  const response = reply.response
  if (!response || !['accept', 'decline', 'cancel'].includes(response.action)) return err({ code: 'ACP_PROTOCOL_ERROR', message: '提问响应无效' })
  if (response.action === 'accept') {
    let invalid: string | undefined
    try { invalid = validateElicitationContent(pending.request.schema, response.content) } catch { invalid = '答案格式无效' }
    if (invalid) return err({ code: 'ACP_PROTOCOL_ERROR', message: invalid })
  }
  pending.finish(response)
  return ok(undefined)
}
