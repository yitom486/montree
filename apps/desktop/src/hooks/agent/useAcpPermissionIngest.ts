import { useEffect } from 'react'
import { acpApi } from '@/api/acp-api'
import {
  parsePermissionOptions,
  permissionSummaryFromToolCall,
  toolCallIdFromPermission,
} from '@/lib/agent/acp-permission'
import { useAcpUiStore } from '@/stores/acp-ui-store'

/**
 * 挂在 App 根：订阅 ACP 权限请求，写入 store，供聊天内联审批卡使用。
 * （不再用全局 Dialog 作为主路径——用户期望按钮出现在气泡/工具卡上。
 *  Agent 断开/出错时清掉未决请求。）
 */
export function useAcpPermissionIngest(): void {
  useEffect(startAcpPermissionIngest, [])
}

/** 应用级订阅入口；权限工具只经宿主适配一次写入权威 feed。 */
export function startAcpPermissionIngest(): () => void {
  const offPermission = acpApi.onPermissionRequest((event) => {
      const toolCall =
        event.toolCall && typeof event.toolCall === 'object'
          ? event.toolCall
          : undefined
      const options = parsePermissionOptions(event.options)
      console.info('[acp-ui] 收到权限请求 IPC', {
        requestId: event.requestId,
        summary: event.summary,
        toolCallId: toolCallIdFromPermission(toolCall),
        optionCount: options.length,
      })
      useAcpUiStore.getState().ingestPermissionRequest({
        requestId: event.requestId,
        sessionId: event.sessionId,
        toolCallId: toolCallIdFromPermission(toolCall),
        summary:
          event.summary ??
          permissionSummaryFromToolCall(toolCall, 'Agent 请求执行工具'),
        options,
        toolCall,
      })
      // ingestPermissionRequest 已将工具事件写入唯一 feed；审批槽与校验由宿主持有。
  })
  const offStatus = acpApi.onStatusChanged((event) => {
      if (event.status === 'disconnected' || event.status === 'error') {
        useAcpUiStore.getState().clearPendingPermission()
      }
  })
  return () => {
    offPermission()
    offStatus()
  }
}
