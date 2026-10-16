import type { ChatTransportPort } from '@montree/chat-session'
import { isOk } from '@montree/contracts'
import { acpApi } from '@/api/acp-api'
import {
  buildAcpPromptBlocks,
  type ComposerAttachment,
} from '@/lib/agent/acp-composer'
import { flushAcpStreamBuffer } from '@/lib/agent/acp-stream-host'
import { buildMontreePromptPrefix } from '@/lib/agent/context/build-prompt-prefix'
import {
  markSessionBootstrapSent,
  shouldSendSessionBootstrap,
} from '@/lib/agent/context/session-bootstrap'
import { respondPermissionRequest } from '@/lib/agent/permission-respond'
import { reportAppError } from '@/lib/workspace/report-error'
import { threadAgentSessionForRuntime, useAcpUiStore } from '@/stores/acp-ui-store'

/**
 * P0 宿主侧 `ChatTransportPort` 实现（`@montree/chat-session` 传输端口）。
 *
 * 只委托现有宿主链路，不自创语义；成功失败都只 resolve/reject Promise，
 * 不写时间线、不弹 toast——时间线写入由调用方经新 store ingest 完成，
 * 失败抛错由调用方转系统消息。现有 `useAcpSession` 调用链一字不动，
 * P1 只读并跑时才由桥接 store 使用本端口。
 */
export interface ChatTransportSendOptions {
  /**
   * 随本轮一并发送的附件（P2 前的透传位）：
   * 经 `buildAcpPromptBlocks` 与宿主 `AgentComposer` 同规则组装
   *（有 image 能力且带 base64 → image 块，否则 absolutePath → resource_link）。
   * 缺省无附件时行为与现有纯文本 `sendPrompt` 调用完全一致。
   */
  attachments?: ComposerAttachment[]
}

/**
 * 宿主传输端口：`ChatTransportPort` 的超集（`sendText` 多一个可选附件位）。
 * 可选第三参在结构类型下仍可赋值给 `ChatTransportPort`，P2 包侧扩接口后直接对齐。
 */
export interface HostChatTransportPort extends ChatTransportPort {
  sendText(
    threadId: string,
    text: string,
    options?: ChatTransportSendOptions,
  ): Promise<void>
}

/**
 * 按线程解析本轮要用的 ACP sessionId：
 * 优先该线程在当前运行时的归属绑定（`thread.agentSessionIds`），
 * 无归属时回退当前 live `sessionId`（与 `selectActiveThreadAgentSessionId` 同源）。
 */
function resolveSessionIdForThread(threadId: string): string | null {
  const state = useAcpUiStore.getState()
  const thread = state.threads.find((t) => t.id === threadId)
  const bound = thread
    ? threadAgentSessionForRuntime(thread, state.selectedRuntimeId)
    : null
  return bound ?? state.sessionId
}

export function createChatTransportPort(): HostChatTransportPort {
  /**
   * 对照 `useAcpSession.sendPrompt`（`hooks/agent/useAcpSession.ts:634-702`）：
   * 前缀（`buildMontreePromptPrefix` + bootstrap 一次语义）与 `acpApi.prompt` 照抄；
   * 去掉的宿主 UI 侧写操作（`appendUserMessage/setPrompting/beginAgentReply`、
   * `rollbackFailedTurn/appendSystemMessage`、busy 时 `toast.info`）一律由调用方
   * 经新 store 完成；失败保留 `reportAppError` 上报后抛错（调用方转系统消息）。
   */
  async function sendText(
    threadId: string,
    text: string,
    options: ChatTransportSendOptions = {},
  ): Promise<void> {
    const sid = resolveSessionIdForThread(threadId)
    // P0 无连接驱动（连接/认证仍走现有 hook，P3 才下沉）：无可用 session 直接拒收。
    if (!sid) {
      throw new Error('未连接：请先连接后再发送')
    }
    const state = useAcpUiStore.getState()
    const includeBootstrap = shouldSendSessionBootstrap(sid)
    const prefix = buildMontreePromptPrefix(threadId, {
      includeBootstrap,
      mode: state.sessionPromptMode,
    })
    const body = buildAcpPromptBlocks({
      text,
      attachments: options.attachments ?? [],
      promptCapabilities: state.promptCapabilities,
    })
    // 空正文 + 无附件时主进程也会拒收（空 prompt），提前以明确错误拒收。
    if (body.length === 0) {
      throw new Error('发送内容为空')
    }
    const result = await acpApi.prompt({
      sessionId: sid,
      prompt: [...prefix, ...body],
    })
    if (isOk(result) && includeBootstrap) {
      markSessionBootstrapSent(sid)
    }
    // 各发送路径先冲刷流缓冲再收尾，否则尾部 chunk 可能丢失或错序（同 sendPrompt）。
    flushAcpStreamBuffer()
    if (!isOk(result)) {
      reportAppError(result.error)
      throw new Error(result.error.message)
    }
  }

  /**
   * 对照 `useAcpSession.cancel`（同文件 `:711-724`）：
   * `acpApi.cancel` + `reportAppError` + 冲刷残留照抄；
   * `clearPendingPermission/cancelActiveTools/finishStreaming` 是 store 侧收尾，
   * 由调用方另行调，此处不碰。
   */
  async function cancel(threadId: string): Promise<void> {
    const sid = resolveSessionIdForThread(threadId)
    if (!sid) return
    const result = await acpApi.cancel({ sessionId: sid })
    if (!isOk(result)) {
      reportAppError(result.error)
      throw new Error(result.error.message)
    }
    flushAcpStreamBuffer()
  }

  /**
   * 等价于 `respondPermissionRequest`（`lib/agent/permission-respond.ts`）：
   * 跨卡幂等领取（store 当前 pending 为准，requestId 不一致直接 no-op）+
   * `clearPendingPermission` + `acpApi.respondPermission` 发送。
   * 此处按 requestId 取 store 当前 pending 后整体委托该函数，行为逐字一致。
   */
  async function respondPermission(
    requestId: number,
    optionId: string | null,
  ): Promise<void> {
    const current = useAcpUiStore.getState().pendingPermission
    if (!current || current.requestId !== requestId) return
    respondPermissionRequest(current, optionId)
  }

  /**
   * 对照 `useAcpSession.setModel`（`hooks/agent/useAcpSession.ts:730-747`）：
   * 按 active 线程归属解析 sessionId（`resolveSessionIdForThread`，无 active 线程回退 live），
   * 调 `acpApi.setConfigOption`；成功经 `rememberConfigPreference` 记忆偏好并同步
   * `configOptions`（行为与 setModel 一致）；失败只返回 false，不写时间线、不弹 toast。
   */
  async function setModelOption(configId: string, value: string | boolean): Promise<boolean> {
    const hostState = useAcpUiStore.getState()
    const activeThreadId = hostState.activeThreadId
    const sid = activeThreadId ? resolveSessionIdForThread(activeThreadId) : hostState.sessionId
    if (!sid) return false
    const runtimeId = hostState.selectedRuntimeId
    const result = await acpApi.setConfigOption({ sessionId: sid, configId, value })
    // 报错收敛：失败只返回 false，由调用方决定提示；此处不写时间线、不弹 toast（同 setModel）。
    if (!isOk(result)) {
      return false
    }
    useAcpUiStore.getState().rememberConfigPreference(runtimeId, configId, value)
    if (result.value.configOptions.length > 0) {
      useAcpUiStore.getState().setConfigOptions(result.value.configOptions)
    }
    return true
  }

  return { sendText, cancel, respondPermission, setModelOption }
}
