import { useAcpUiStore } from '@/stores/acp-ui-store'

/**
 * 子会话传输等待器（制卡/测验共用）。
 *
 * 未连/出错时先发 `requestConnect` 信令（`useAcpSession` 驱动完整 connect，
 * 含认证弹窗），再等传输就绪：
 * - connected → 'connected'
 * - awaiting_auth → 'auth-required'（认证必须用户点，不替用户等）
 * - error → 'unavailable'
 * - 发信号后 1s 内仍是 disconnected → 'unavailable'（无驱动，立刻收兵，
 *   不空转到超时；单测无 hook 挂载，走的也是这条）
 * - connecting 中则等到传入的上限（运行时拉起需要秒级）。
 */
export type AcpTransportState = 'connected' | 'auth-required' | 'unavailable'

const SETTLE_DISCONNECTED_POLLS = 10
const POLL_MS = 100

export async function ensureAcpTransport(
  timeoutMs = 8000,
  targetRuntimeId?: string,
): Promise<AcpTransportState> {
  const store = useAcpUiStore.getState()
  if (targetRuntimeId && targetRuntimeId !== store.selectedRuntimeId) {
    store.requestSwitchRuntime(targetRuntimeId)
  } else if (store.status === 'connected') {
    return 'connected'
  } else if (store.status === 'awaiting_auth') {
    return 'auth-required'
  } else if (store.status !== 'connecting') {
    store.requestConnect()
  }
  let quietDisconnected = 0
  const deadline = Date.now() + timeoutMs
  for (;;) {
    await new Promise((r) => setTimeout(r, POLL_MS))
    const status = useAcpUiStore.getState().status
    const currentRuntime = useAcpUiStore.getState().selectedRuntimeId
    if (targetRuntimeId && currentRuntime !== targetRuntimeId) {
      if (Date.now() >= deadline) return 'unavailable'
      continue
    }
    if (status === 'connected') return 'connected'
    if (status === 'awaiting_auth') return 'auth-required'
    if (status === 'error') return 'unavailable'
    if (status === 'disconnected') {
      quietDisconnected += 1
      if (quietDisconnected >= SETTLE_DISCONNECTED_POLLS) return 'unavailable'
    } else {
      quietDisconnected = 0
    }
    if (Date.now() >= deadline) return 'unavailable'
  }
}
