import { useEffect } from 'react'
import { acpApi } from '@/api/acp-api'
import { acpDevLog } from '@/lib/agent/acp-dev-log'
import {
  markProposalArgPreview,
  markProposalDevFail,
  markProposalDevLog,
} from '@/lib/agent/context/mark-proposal-dev-log'
import { resolveMontreeSnapshot } from '@/lib/agent/context/virtual-fs-resolver'
import { useAcpUiStore } from '@/stores/acp-ui-store'
import { useAnnotationAgentStore } from '@/stores/annotation-agent-store'

/**
 * 挂在 App 根：应答主进程对 Montree 内存快照的请求。
 * MCP 工具调用与 Agent `fs/read .montree/agent/*` 最终都落在这里。
 */
export function useMontreeSnapshotHost(): void {
  useEffect(() => {
    return acpApi.onSnapshotRequest((event) => {
      void (async () => {
        const started = performance.now()
        const isMarkProposal =
          event.resource === 'propose-mark' ||
          event.resource === 'propose-note' ||
          event.resource === 'create-note'
        if (isMarkProposal) {
          markProposalDevLog('snapshot:start', {
            resource: event.resource,
            requestId: event.requestId,
            ...markProposalArgPreview(event.args),
          })
        }
        try {
          const content = await resolveMontreeSnapshot(event.resource, event.args)
          if (isMarkProposal) {
            markProposalDevLog('snapshot:ok', {
              resource: event.resource,
              requestId: event.requestId,
              ms: Math.round(performance.now() - started),
              chars: content.length,
            })
            // codex-acp 仅显示 MCP 工具名，不会在 session/update 回传 result.content。
            // 在快照响应的源头绑定 JSON，回合结束时即可挂到最终 Agent 回复。
            if (!useAnnotationAgentStore.getState().capturing) {
              useAcpUiStore.getState().attachMarkProposalsFromSnapshot(content)
            }
          } else {
            acpDevLog('snapshot served', { resource: event.resource, chars: content.length })
          }
          acpApi.respondSnapshot({ requestId: event.requestId, ok: true, content })
        } catch (error) {
          if (isMarkProposal) {
            markProposalDevFail('snapshot:fail', error, {
              resource: event.resource,
              requestId: event.requestId,
              ms: Math.round(performance.now() - started),
              ...markProposalArgPreview(event.args),
            })
          }
          acpApi.respondSnapshot({
            requestId: event.requestId,
            ok: false,
            message: error instanceof Error ? error.message : '快照生成失败',
          })
        }
      })()
    })
  }, [])
}
