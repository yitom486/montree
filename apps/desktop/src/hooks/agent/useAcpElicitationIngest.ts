import { useEffect } from 'react'
import { acpElicitationApi } from '@/api/acp-elicitation-api'
import { acpApi } from '@/api/acp-api'
import { useAcpUiStore } from '@/stores/acp-ui-store'
import { closeElicitation, useElicitationStore, type PendingElicitation } from '@/stores/acp/elicitation-store'
import { onThreadLifecycle } from '@/lib/agent/thread-lifecycle'
import type { ElicitationResponse } from '../../../contracts/acp-elicitation'

function routeCurrent(request: PendingElicitation): boolean {
  const host = useAcpUiStore.getState()
  return host.activeThreadId === request.threadId && host.selectedRuntimeId === request.runtimeId &&
    (!request.sessionId || host.sessionId === request.sessionId)
}

/** Synchronous claim prevents duplicate replies across mirrored chat surfaces. */
export async function respondToElicitation(id: string, response: ElicitationResponse): Promise<void> {
  const request = useElicitationStore.getState().pending.find(item => item.id === id)
  if (!request || request.submitting) return
  if (!routeCurrent(request) && response.action !== 'cancel') throw new Error('该提问所属会话已切换')
  useElicitationStore.setState(state => ({ pending: state.pending.map(item => item.id === id ? { ...item, submitting: true } : item) }))
  const result = await acpElicitationApi.respond({ id, response })
  if (!result.ok) {
    if (result.error.code === 'CANCELLED') { closeElicitation(id); return }
    useElicitationStore.setState(state => ({ pending: state.pending.map(item => item.id === id ? { ...item, submitting: false } : item) }))
    throw new Error(result.error.message)
  }
  // The main-process closed event may arrive before invoke resolves.
  closeElicitation(id, response)
  useElicitationStore.setState(state => ({ receipts: state.receipts.map(item => item.request.id === id ? { ...item, response } : item) }))
}

export function startAcpElicitationIngest(): () => void {
  const cancel = (request: PendingElicitation) => {
    closeElicitation(request.id)
    void acpElicitationApi.respond({ id: request.id, response: { action: 'cancel' } })
  }
  const off = acpElicitationApi.subscribe(event => {
    if (event.kind === 'closed') { closeElicitation(event.id); return }
    const host = useAcpUiStore.getState()
    const request: PendingElicitation = { ...event.request, threadId: host.activeThreadId, runtimeId: host.selectedRuntimeId, submitting: false }
    if (event.request.sessionId && event.request.sessionId !== host.sessionId) {
      void acpElicitationApi.respond({ id: request.id, response: { action: 'cancel' } })
      return
    }
    useElicitationStore.setState(state => state.pending.some(item => item.id === request.id) ? state : { pending: [...state.pending, request] })
  })
  const offRoute = useAcpUiStore.subscribe(() => {
    for (const request of useElicitationStore.getState().pending) if (!routeCurrent(request)) cancel(request)
  })
  const offStatus = acpApi.onStatusChanged(event => {
    if (event.status === 'disconnected' || event.status === 'error') for (const request of useElicitationStore.getState().pending) cancel(request)
  })
  const offLifecycle = onThreadLifecycle(event => {
    for (const request of useElicitationStore.getState().pending) if (request.threadId === event.threadId) cancel(request)
    if (event.kind !== 'cancel') useElicitationStore.setState(state => ({ receipts: state.receipts.filter(item => item.request.threadId !== event.threadId) }))
  })
  return () => {
    off(); offRoute(); offStatus(); offLifecycle()
    for (const request of useElicitationStore.getState().pending) cancel(request)
  }
}
export function useAcpElicitationIngest(): void { useEffect(startAcpElicitationIngest, []) }
