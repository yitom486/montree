import type { StateCreator } from 'zustand'
import { DEFAULT_ACP_RUNTIME_ID } from '@montree/contracts'
import type {
  AcpConfigOption,
  AcpConnectionStatus,
  AcpPromptCapabilities,
  AppErrorCode,
} from '@montree/contracts'
import {
  rememberPreferredConfig,
  type AcpPreferredConfigMap,
} from '@/lib/agent/acp-config-preferences'
import type { AcpUiStore } from './acp-types'
import { createEmptyThread, patchActiveThread } from './chat-helpers'

export interface SessionSlice {
  selectedRuntimeId: string
  status: AcpConnectionStatus
  sessionId: string | null
  statusError?: string
  statusErrorCode?: AppErrorCode
  configOptions: AcpConfigOption[]
  prompting: boolean
  promptCapabilities: AcpPromptCapabilities
  preferredConfigByRuntime: AcpPreferredConfigMap
  /**
   * Cursor 横杠 canonical 模型目录（内存态，不持久化）：
   * connect 成功由渲染端写入，disconnect/切换清空。无目录=现状行为一字不改，
   * dash 受控尝试仅在有目录时作为 listed 门槛后的最后候补。
   */
  modelCatalogByRuntime: Record<string, string[]>

  setSelectedRuntimeId: (id: string) => void
  setStatus: (status: AcpConnectionStatus, errorMessage?: string, errorCode?: AppErrorCode) => void
  setSession: (sessionId: string | null, configOptions?: AcpConfigOption[]) => void
  setConfigOptions: (options: AcpConfigOption[]) => void
  setPromptCapabilities: (caps: AcpPromptCapabilities) => void
  setPrompting: (prompting: boolean) => void
  setModelCatalog: (runtimeId: string, catalog: string[] | null) => void
  rememberConfigPreference: (
    runtimeId: string,
    configId: string,
    value: string | boolean,
  ) => void
  /**
   * 子会话（制卡/测验）的连接请求信令：nonce，0=无请求。
   * 故意不进 persist（重启不自连）；`useAcpSession` 监听并驱动完整 connect
   *（含认证弹窗），子会话只管发信号、不碰 auth 状态机。
   */
  connectRequestedAt: number
  requestConnect: () => void
  runtimeSwitchRequestedAt: number
  requestedRuntimeId: string | null
  requestSwitchRuntime: (runtimeId: string) => void
}

export const createSessionSlice: StateCreator<
  AcpUiStore,
  [],
  [],
  SessionSlice
> = (set, get) => ({
  selectedRuntimeId: DEFAULT_ACP_RUNTIME_ID,
  status: 'disconnected',
  sessionId: null,
  statusError: undefined,
  configOptions: [],
  prompting: false,
  promptCapabilities: {},
  preferredConfigByRuntime: {},
  modelCatalogByRuntime: {},
  connectRequestedAt: 0,
  runtimeSwitchRequestedAt: 0,
  requestedRuntimeId: null,

  setSelectedRuntimeId: (id) =>
    set((s) => {
      if (s.selectedRuntimeId === id) return s

      // 寻找目标 Agent 下的已有线程列表
      const targetThreads = s.threads.filter(
        (t) => (t.runtimeId || DEFAULT_ACP_RUNTIME_ID) === id,
      )
      let threads = s.threads
      let activeThreadId = s.activeThreadId

      if (targetThreads.length > 0) {
        const sorted = [...targetThreads].sort((a, b) => b.updatedAt - a.updatedAt)
        activeThreadId = sorted[0]!.id
      } else {
        // 该 Agent 尚无历史线程，自动为其创建专属空白线程
        const fresh = createEmptyThread(undefined, id)
        threads = [fresh, ...threads]
        activeThreadId = fresh.id
      }

      return {
        selectedRuntimeId: id,
        threads,
        activeThreadId,
        prompting: false,
        pendingPermission: null,
        // 切换 Agent 后立即清空旧 Agent 遗留的模型选项与能力缓存（含横杠目录）
        configOptions: [],
        promptCapabilities: {},
        modelCatalogByRuntime: {},
      }
    }),

  setStatus: (status, errorMessage, errorCode) =>
    set({
      status,
      statusError: errorMessage,
      statusErrorCode: errorCode,
      ...(status === 'connected'
        ? { statusError: undefined, statusErrorCode: undefined }
        : {}),
      ...(status === 'disconnected' || status === 'error'
        ? {
            prompting: false,
            pendingPermission: null,
            promptCapabilities: {},
            configOptions: [],
            modelCatalogByRuntime: {},
          }
        : {}),
    }),

  setSession: (sessionId, configOptions) =>
    set((s) => ({
      sessionId,
      ...(configOptions ? { configOptions } : {}),
      // 仅在拿到有效 session 时写入 thread；断开时按运行时保留以便恢复
      ...(sessionId
        ? patchActiveThread(s, (t) => ({
            ...t,
            agentSessionIds: {
              ...(t.agentSessionIds ?? {}),
              [s.selectedRuntimeId]: sessionId,
            },
            updatedAt: Date.now(),
          }))
        : {}),
    })),

  setConfigOptions: (options) => set({ configOptions: options }),
  setPromptCapabilities: (caps) => set({ promptCapabilities: caps }),
  setPrompting: (prompting) => set({ prompting }),
  setModelCatalog: (runtimeId, catalog) =>
    set((s) => {
      const rid = runtimeId.trim()
      if (!rid) return s
      if (!catalog || catalog.length === 0) {
        if (!(rid in s.modelCatalogByRuntime)) return s
        const next = { ...s.modelCatalogByRuntime }
        delete next[rid]
        return { modelCatalogByRuntime: next }
      }
      return { modelCatalogByRuntime: { ...s.modelCatalogByRuntime, [rid]: [...catalog] } }
    }),
  rememberConfigPreference: (runtimeId, configId, value) =>
    set((s) => ({
      preferredConfigByRuntime: rememberPreferredConfig(
        s.preferredConfigByRuntime,
        runtimeId,
        configId,
        value,
      ),
    })),
  requestConnect: () => set({ connectRequestedAt: Date.now() }),
  requestSwitchRuntime: (id: string) =>
    set({ requestedRuntimeId: id, runtimeSwitchRequestedAt: Date.now() }),
})
