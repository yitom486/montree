import { create } from 'zustand'
import type { ElicitationRequest, ElicitationResponse } from '../../../contracts/acp-elicitation'

export interface PendingElicitation extends ElicitationRequest { threadId: string; runtimeId: string; submitting: boolean }
export interface ElicitationReceipt { request: PendingElicitation; response?: ElicitationResponse }
interface ElicitationState {
  pending: PendingElicitation[]
  receipts: ElicitationReceipt[]
}
/** Transient requests never survive process restart or enter the persisted conversation feed. */
export const useElicitationStore = create<ElicitationState>(() => ({ pending: [], receipts: [] }))

export function closeElicitation(id: string, response?: ElicitationResponse): void {
  useElicitationStore.setState(state => {
    const request = state.pending.find(item => item.id === id)
    if (!request) return state
    return {
      pending: state.pending.filter(item => item.id !== id),
      receipts: [...state.receipts, { request, response }].slice(-40),
    }
  })
}
