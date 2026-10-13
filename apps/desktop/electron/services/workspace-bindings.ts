/**
 * 可信窗口 ↔ 工作区宿主绑定（A1）。
 *
 * - 归属一律以 main 持有的 IPC `event.sender`（WebContents id）为准，
 *   不信任 renderer 传来的 windowId / workspaceId（计划 §3.5）。
 * - 每次绑定/重连分配独立 generation；旧响应与旧 watch 事件凭
 *   (workspaceId, generation) 判定过期，不得覆盖新工作区状态（§4.1）。
 * - 连接状态机：connecting / connected / reconnecting / disconnected / error，
 *   本机模式只经历 connecting → connected → disconnected，远端状态由 B 阶段驱动。
 * - 窗口销毁时自清理（bind 时登记 once('destroyed')），关闭 A 不影响 B（T7）。
 */
import type {
  AppError,
  WindowWorkspaceStatus,
  WorkspaceConnectionState,
  WorkspaceDescriptor,
} from '@montree/contracts'
import { LOCAL_WORKSPACE_ID } from '@montree/contracts'

/** 绑定所需的最小 WebContents 形状（测试可伪造，不依赖 electron 运行时）。 */
export interface BindableSender {
  id: number
  once: (event: 'destroyed', listener: () => void) => void
}

interface WindowWorkspaceBinding {
  webContentsId: number
  descriptor: WorkspaceDescriptor
  generation: number
  state: WorkspaceConnectionState
  error?: AppError
  updatedAt: number
}

const bindings = new Map<number, WindowWorkspaceBinding>()
let generationSeq = 0

/** 仅测试使用：清空全部绑定并重置代际计数。 */
export function resetWorkspaceBindingsForTest(): void {
  bindings.clear()
  generationSeq = 0
}

function toStatus(binding: WindowWorkspaceBinding): WindowWorkspaceStatus {
  return {
    workspaceId: binding.descriptor.id,
    kind: binding.descriptor.kind,
    state: binding.state,
    generation: binding.generation,
    rootLabel: binding.descriptor.rootLabel,
    ...(binding.error ? { error: binding.error } : {}),
  }
}

/**
 * 绑定窗口到工作区宿主（每次调用分配新 generation）。
 * 同一 webContents 重复绑定会替换旧绑定（旧代际事件自动过期）。
 */
export function bindWindowWorkspace(
  sender: BindableSender,
  descriptor: WorkspaceDescriptor,
  initialState: WorkspaceConnectionState = 'connected',
): WindowWorkspaceStatus {
  generationSeq += 1
  const binding: WindowWorkspaceBinding = {
    webContentsId: sender.id,
    descriptor,
    generation: generationSeq,
    state: initialState,
    updatedAt: Date.now(),
  }
  bindings.set(sender.id, binding)
  sender.once('destroyed', () => {
    const current = bindings.get(sender.id)
    if (current && current.generation === binding.generation) {
      bindings.delete(sender.id)
    }
  })
  return toStatus(binding)
}

/**
 * root 不变时复用既有绑定（watch 触发的重扫不得抖 generation，
 * 否则进行中的订阅会被误判过期）。
 */
export function ensureWindowWorkspace(
  sender: BindableSender,
  descriptor: WorkspaceDescriptor,
): WindowWorkspaceStatus {
  const current = bindings.get(sender.id)
  if (
    current &&
    current.descriptor.kind === descriptor.kind &&
    current.descriptor.id === descriptor.id &&
    current.descriptor.rootLabel === descriptor.rootLabel
  ) {
    return toStatus(current)
  }
  return bindWindowWorkspace(sender, descriptor)
}

export function getWindowWorkspaceDescriptor(webContentsId: number): WorkspaceDescriptor | null {
  return bindings.get(webContentsId)?.descriptor ?? null
}

/** 未绑定时返回 disconnected 默认状态（调用方无需判空）。 */
export function getWindowWorkspaceStatus(webContentsId: number): WindowWorkspaceStatus {
  const binding = bindings.get(webContentsId)
  if (!binding) {
    return {
      workspaceId: LOCAL_WORKSPACE_ID,
      kind: 'local',
      state: 'disconnected',
      generation: 0,
      rootLabel: '',
    }
  }
  return toStatus(binding)
}

export function setWindowWorkspaceState(
  webContentsId: number,
  state: WorkspaceConnectionState,
  error?: AppError,
): WindowWorkspaceStatus {
  const binding = bindings.get(webContentsId)
  if (!binding) return getWindowWorkspaceStatus(webContentsId)
  binding.state = state
  binding.updatedAt = Date.now()
  if (error) binding.error = error
  else if (state === 'connected' || state === 'connecting') delete binding.error
  return toStatus(binding)
}

/** 解绑（默认回到 disconnected；保留返回快照供推送）。 */
export function unbindWindowWorkspace(webContentsId: number): WindowWorkspaceStatus {
  const binding = bindings.get(webContentsId)
  bindings.delete(webContentsId)
  if (!binding) return getWindowWorkspaceStatus(webContentsId)
  return {
    workspaceId: binding.descriptor.id,
    kind: binding.descriptor.kind,
    state: 'disconnected',
    generation: binding.generation,
    rootLabel: binding.descriptor.rootLabel,
  }
}

/**
 * 事件过期判定：workspaceId 不同或 generation 落后即过期。
 * briefing 缺字段（旧版本载荷）时不过滤，由调用方另行兼容。
 */
export function isStaleWorkspaceEvent(
  current: { workspaceId: string; generation: number },
  event: { workspaceId?: string; generation?: number },
): boolean {
  if (!event.workspaceId || typeof event.generation !== 'number') return false
  return event.workspaceId !== current.workspaceId || event.generation !== current.generation
}
