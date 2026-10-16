import type { StateCreator } from 'zustand'
import { toolCallIdFromPermission } from '@/lib/agent/acp-permission'
import type { AcpPendingPermission, AcpUiStore } from './acp-types'

export interface PermissionSlice {
  pendingPermission: AcpPendingPermission | null
  setPendingPermission: (pending: AcpPendingPermission | null) => void
  clearPendingPermission: (requestId?: number) => void
  ingestPermissionRequest: (pending: AcpPendingPermission) => void
}

export const createPermissionSlice: StateCreator<
  AcpUiStore,
  [],
  [],
  PermissionSlice
> = (set, get) => ({
  pendingPermission: null,

  setPendingPermission: (pending) => set({ pendingPermission: pending }),

  clearPendingPermission: (requestId) =>
    set((s) => {
      if (
        requestId != null &&
        s.pendingPermission &&
        s.pendingPermission.requestId !== requestId
      ) {
        return s
      }
      return { pendingPermission: null }
    }),

  ingestPermissionRequest: (pending) => {
    set({ pendingPermission: pending })
    const toolCall = pending.toolCall
    if (!toolCall) return
    const toolCallId = pending.toolCallId ?? toolCallIdFromPermission(toolCall)
    if (!toolCallId) return
    const update: Record<string, unknown> = {
      sessionUpdate: 'tool_call',
      toolCallId,
      title:
        typeof toolCall.title === 'string' ? toolCall.title : pending.summary,
      kind: typeof toolCall.kind === 'string' ? toolCall.kind : 'other',
      status:
        typeof toolCall.status === 'string' ? toolCall.status : 'pending',
    }
    if ('content' in toolCall) update.content = toolCall.content
    if ('locations' in toolCall) update.locations = toolCall.locations
    if ('name' in toolCall) update.name = toolCall.name
    if ('rawInput' in toolCall) update.rawInput = toolCall.rawInput
    get().applySessionUpdate(update)
  },
})
