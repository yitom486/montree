import { create } from 'zustand'
import { useShallow } from 'zustand/react/shallow'
import { LOCAL_WORKSPACE_ID } from '@yitom/contracts'
import type {
  WorkspaceConnectionState,
  WorkspaceConnectResult,
  WorkspaceDescriptor,
  WindowWorkspaceStatus,
} from '@yitom/contracts'

interface WorkspaceStoreState {
  /** 当前窗口绑定的工作区描述符（未绑定为 null，身份回落 local）。 */
  descriptor: WorkspaceDescriptor | null
  /** 连接状态快照（以 main 推送为准；旧代际推送不得覆盖新状态）。 */
  status: WindowWorkspaceStatus | null
  /** 显式连接成功后全量同步（描述符 + 状态同代际）。 */
  setConnected: (result: WorkspaceConnectResult) => void
  /** 应用连接状态推送（generation 守卫，T6：迟到回复不污染新工作区）。 */
  applyStatus: (status: WindowWorkspaceStatus) => void
  resetWorkspace: () => void
}

export const useWorkspaceStore = create<WorkspaceStoreState>()((set) => ({
  descriptor: null,
  status: null,

  setConnected: (result) =>
    set({
      descriptor: result.descriptor,
      status: result.status,
    }),

  applyStatus: (status) =>
    set((state) => {
      const currentGeneration = state.status?.generation ?? 0
      if (status.generation < currentGeneration) return state
      return { status }
    }),

  resetWorkspace: () => set({ descriptor: null, status: null }),
}))

export interface WorkspaceIdentity {
  workspaceId: string
  generation: number
  state: WorkspaceConnectionState
}

/**
 * 当前窗口工作区身份。返回对象时必须 `useShallow`（见
 * `.cursor/rules/zustand-selectors.mdc`），避免无限重渲染。
 */
export function useWorkspaceIdentity(): WorkspaceIdentity {
  return useWorkspaceStore(
    useShallow((s) => ({
      workspaceId: s.descriptor?.id ?? LOCAL_WORKSPACE_ID,
      generation: s.status?.generation ?? 0,
      state: s.status?.state ?? ('disconnected' as WorkspaceConnectionState),
    })),
  )
}

/** 当前连接快照（描述符 + 状态；同样经 useShallow 稳住引用）。 */
export function useWorkspaceConnection(): {
  descriptor: WorkspaceDescriptor | null
  status: WindowWorkspaceStatus | null
} {
  return useWorkspaceStore(
    useShallow((s) => ({ descriptor: s.descriptor, status: s.status })),
  )
}
