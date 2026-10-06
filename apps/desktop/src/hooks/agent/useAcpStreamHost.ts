import { useEffect } from 'react'
import { startAcpStreamHost } from '@/lib/agent/acp-stream-host'

/**
 * 挂在 App 根（与 `useAcpPermissionIngest` / `useMontreeSnapshotHost` 并列）：
 * ACP 流式推送订阅的生命周期跟应用走，不跟任何面板的挂载走。
 */
export function useAcpStreamHost(): void {
  useEffect(() => startAcpStreamHost(), [])
}
