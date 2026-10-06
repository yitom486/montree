import { acpApi } from '@/api/acp-api'
import { useAcpUiStore } from '@/stores/acp-ui-store'
import { isOk } from '@montree/contracts'
import { buildAcpPromptBlocks, type ComposerAttachment } from '@/lib/agent/acp-composer'
import type { AcpConfigOption } from '@montree/contracts'
import {
  accumulateSubsessionUpdate,
  ensureSubsessionSession,
  isSubsessionPrompting,
  resetSubsession,
  sendSubsessionPrompt,
  subsessionOwnsSessionFor,
} from '@/lib/agent/acp-subsession'
import {
  markSessionBootstrapSent,
  shouldSendSessionBootstrap,
} from './context/session-bootstrap'

/** 目录页原图（渲染端离屏渲染，供模型识图；无图片能力时自动退化纯文本） */
export interface TocPromptImage {
  base64: string
  mimeType: string
  /** 如 `toc-p8.png`，进附件名与日志 */
  name: string
}

const TOC_PURPOSE = 'toc'
/** prepare 会话的稳定键（always-new 下每次 ensure 覆盖，不泄漏）；单次 send 另用 opId 风格唯一键 */
const TOC_PREPARE_KEY = 'current'

/**
 * 目录 AI 整理专用副会话（考官会话同款无头模式）。
 * 与考官单例复用不同：每次整理新建一条——目录内容随书而变，
 * 复用会把上一本书的目录残留进上下文。
 */

let tocSessionId: string | null = null
/** 单调 prompt 序号：与 session 短 id 合成 operationId（审计日志关联一次整理） */
let tocPromptSeq = 0

const TOC_TOOL_OVERVIEW =
  'This is an Montree TOC task. The ACP client has already discovered the available toc_* MCP tools via MCP tools/list. Prefer toc_replace_all for a complete draft, toc_upsert_entry/toc_delete_entry for small fixes, and toc_list_draft to verify. Full parameters and limits are in the tool descriptions.'

const TOC_SESSION_BOOTSTRAP =
  'You are the one-shot Montree table-of-contents assistant. Work only on the supplied book TOC task, use the available toc_* tools, and never write the final cache directly; the user confirms the draft in the UI.'

export function isTocPrompting(): boolean {
  return isSubsessionPrompting(TOC_PURPOSE)
}

/** 当前 Agent 是否接受图片（决定整理时附不附目录页原图） */
export function canTocUseImages(): boolean {
  return useAcpUiStore.getState().promptCapabilities.image === true
}

export function tocOwnsSessionId(sessionId: string): boolean {
  return subsessionOwnsSessionFor(TOC_PURPOSE, sessionId)
}

/** 收集目录副会话的流式增量（不进入右侧时间线） */
export function accumulateTocSessionUpdate(
  sessionId: string,
  update: Record<string, unknown>,
): void {
  if (!tocOwnsSessionId(sessionId) && !isTocPrompting()) return
  accumulateSubsessionUpdate(sessionId, update)
}

export interface TocModelOverride {
  configId: string
  value: string
}

/** 模型 / 思考档下拉的数据源：从 session 下发的 configOptions 里按类别挑 */
export function pickTocModelOptions(
  options: readonly AcpConfigOption[],
): AcpConfigOption[] {
  return options.filter(
    (o) =>
      o.type === 'select' &&
      (o.category === 'model' || /model/i.test(`${o.configId} ${o.name}`)),
  )
}

export function pickTocThoughtOptions(
  options: readonly AcpConfigOption[],
): AcpConfigOption[] {
  return options.filter(
    (o) =>
      o.type === 'select' &&
      (o.category === 'thought_level' ||
        /thought|reason|effort/i.test(`${o.configId} ${o.name}`)),
  )
}

function findRunnableOverride(
  options: readonly AcpConfigOption[],
  override: TocModelOverride | undefined,
): TocModelOverride | null {
  if (!override || !override.configId || override.value === '') return null
  const opt = options.find((o) => o.configId === override.configId)
  if (!opt) return null
  if (opt.options && opt.options.length > 0) {
    const allowed = opt.options.some((o) => o.value === override.value)
    if (!allowed) return null
  }
  const current =
    opt.currentValue === undefined || opt.currentValue === null
      ? ''
      : String(opt.currentValue)
  if (current === override.value) return null
  return override
}

/**
 * 新建目录整理会话：先套用户偏好，再套调用方显式选择（模型/思考档）。
 * 返回应用后的完整 configOptions，供 UI 回显实际生效值。
 */
export async function ensureTocSessionId(overrides?: {
  model?: TocModelOverride
  thought?: TocModelOverride
}): Promise<{ sessionId: string; configOptions: AcpConfigOption[] } | null> {
  const ensured = await ensureSubsessionSession({
    purpose: TOC_PURPOSE,
    key: TOC_PREPARE_KEY,
    rotation: { mode: 'always-new' },
    toolScope: 'toc',
  })
  if ('error' in ensured) return null
  const sid = ensured.sessionId
  let options = ensured.configOptions

  const patches: TocModelOverride[] = []
  for (const extra of [overrides?.model, overrides?.thought]) {
    const runnable = findRunnableOverride(options, extra)
    if (runnable) patches.push(runnable)
  }
  // 显式选择后赢：同 configId 去重，保留最后一个
  const deduped = new Map<string, string>()
  for (const patch of patches) deduped.set(patch.configId, patch.value)
  for (const [configId, value] of deduped) {
    const applied = await acpApi.setConfigOption({ sessionId: sid, configId, value })
    if (isOk(applied)) options = applied.value.configOptions
  }

  tocSessionId = sid
  return { sessionId: sid, configOptions: options }
}

export type TocPromptSendOutcome = 'ok' | 'empty' | 'timeout' | 'error'

export interface TocPromptSendResult {
  /** 累积正文（可能为空字符串）；发送失败时为 null */
  reply: string | null
  /**
   * 发送结局：ok（有正文）/ empty（成功但零正文，工具可能已跑）/
   * timeout（客户端计时器先响且不发 cancel，服务端大概率仍在跑——草稿稍后到）/
   * error（发送前失败，重试等待无意义）。
   * 只有 timeout/empty 才值得等待工具草稿。
   */
  outcome: TocPromptSendOutcome
  elapsedMs: number
  /** 单调操作 id（审计日志关联一次整理） */
  opId: string
}

export interface TocPromptSendOptions {
  /** 当前书指纹：只取尾部进日志（全路径不落日志） */
  fingerprint?: string
}

/**
 * 发送目录整理 Prompt 并等待完成（调用方再做 JSON 解析与校验）。
 * 图片经 buildAcpPromptBlocks 组装：Agent 无 image 能力时自动只剩文本，
 * 调用方据此把提示词切到纯文本口径（见 buildTocAiPrompt withImages）。
 */
export async function sendTocPrompt(
  promptText: string,
  images?: readonly TocPromptImage[],
  options?: TocPromptSendOptions,
): Promise<TocPromptSendResult> {
  const opId = `${tocSessionId?.slice(0, 8) ?? 'nosession'}-${(tocPromptSeq += 1)}`
  const fpTail =
    options?.fingerprint && options.fingerprint.length > 24
      ? `…${options.fingerprint.slice(-24)}`
      : (options?.fingerprint ?? '')
  if (!tocSessionId) {
    return { reply: null, outcome: 'error', elapsedMs: 0, opId }
  }
  const preparedSid = tocSessionId
  const shortSid = preparedSid.slice(0, 8)
  const attachments: ComposerAttachment[] = (images ?? []).map((image, index) => ({
    id: `toc-img-${index}`,
    kind: 'image',
    name: image.name,
    mimeType: image.mimeType,
    base64: image.base64,
  }))
  const caps = useAcpUiStore.getState().promptCapabilities
  const includeBootstrap = shouldSendSessionBootstrap(preparedSid)
  const taskText = [
    includeBootstrap ? TOC_SESSION_BOOTSTRAP : null,
    TOC_TOOL_OVERVIEW,
    promptText,
  ]
    .filter((part): part is string => Boolean(part))
    .join('\n\n')
  const blocks = buildAcpPromptBlocks({ text: taskText, attachments, promptCapabilities: caps })
  const imageCount = blocks.filter((block) => block.type === 'image').length
  console.info(
    `[toc-ai] prompt:start op=${opId} session=${shortSid} fp=${fpTail} chars=${promptText.length} images=${imageCount}/${attachments.length}`,
  )
  const startedAt = Date.now()
  // 单次 send 独占一 entry（并发串扰隔离），完成后即清；always-new 下它只为累积本次 reply 而存在
  const opKey = `op-${opId}`
  try {
    const sent = await sendSubsessionPrompt(
      {
        purpose: TOC_PURPOSE,
        key: opKey,
        rotation: { mode: 'always-new' },
        toolScope: 'toc',
        images: attachments.map((attachment) => ({
          id: attachment.id,
          kind: 'image' as const,
          name: attachment.name,
          mimeType: attachment.mimeType,
          base64: attachment.base64 ?? '',
        })),
      },
      taskText,
    )
    const elapsedMs = Date.now() - startedAt
    if (sent.status === 'ok') {
      if (includeBootstrap) {
        markSessionBootstrapSent(preparedSid)
      }
      const reply = sent.reply
      const outcome: TocPromptSendOutcome = reply ? 'ok' : 'empty'
      console.info(
        `[toc-ai] send:return op=${opId} outcome=${outcome} elapsedMs=${elapsedMs} replyChars=${reply.length} stop=ok`,
      )
      return { reply, outcome, elapsedMs, opId }
    }
    if (sent.status === 'auth-required') {
      console.info(
        `[toc-ai] send:return op=${opId} outcome=error elapsedMs=${elapsedMs} error=auth-required`,
      )
      return { reply: null, outcome: 'error', elapsedMs, opId }
    }
    const outcome: TocPromptSendOutcome =
      sent.errorCode === 'ACP_TIMEOUT' ? 'timeout' : 'error'
    console.info(
      `[toc-ai] send:return op=${opId} outcome=${outcome} elapsedMs=${elapsedMs} error=${sent.errorCode ?? 'failed'}`,
    )
    return { reply: null, outcome, elapsedMs, opId }
  } catch (cause) {
    const elapsedMs = Date.now() - startedAt
    console.info(
      `[toc-ai] send:return op=${opId} outcome=error elapsedMs=${elapsedMs} error=${cause instanceof Error ? cause.message : String(cause)}`,
    )
    return { reply: null, outcome: 'error', elapsedMs, opId }
  } finally {
    resetSubsession(TOC_PURPOSE, opKey)
  }
}

/**
 * 尽力取消某次整理的目录副会话（放弃等待时止血）。
 * 传本次 run 的 sid：新一轮可能已建新会话，误杀不得。
 * 失败静默（会话可能已结束），调用方 fire-and-forget。
 */
export async function cancelTocPrompt(sessionId?: string | null): Promise<void> {
  const sid = sessionId ?? tocSessionId
  if (!sid) return
  try {
    await acpApi.cancel({ sessionId: sid })
  } catch {
    // 止血尽力而为，取消失败不影响调用方流程
  }
}

export function resetTocSession(): void {
  tocSessionId = null
  resetSubsession(TOC_PURPOSE, TOC_PREPARE_KEY)
}
