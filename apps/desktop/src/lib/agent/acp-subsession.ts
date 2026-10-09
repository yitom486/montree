import { acpApi } from '@/api/acp-api'
import { useAcpUiStore } from '@/stores/acp-ui-store'
import { isOk } from '@montree/contracts'
import type { AcpConfigOption } from '@montree/contracts'
import { listPreferredConfigPatches } from '@/lib/agent/acp-config-preferences'
import { buildAcpPromptBlocks, type ComposerAttachment } from '@/lib/agent/acp-composer'
import { extractTextFromContent } from '@/stores/acp-chat-types'
import { ensureAcpTransport } from '@/lib/agent/acp-transport'

import {
  useSubsessionProgressStore,
  type SubsessionProgress,
} from '@/stores/subsession-progress-store'

export type { SubsessionProgress }

/**
 * 统一副会话工厂（quiz 单例 / toc 每次新建 / 制卡一书一键 共用骨架）。
 * 语义沿现有三实现，不自创：内存复用 → store/load 复用 → sessionNew 新建；
 * prompt 拒收删 entry 自转一次重试；流式增量按 sessionId 或 prompting 态路由。
 */

// 身份：purpose 区分用途（'quiz' | 'toc' | 'card' 等），key 区分归属（quiz 用 'default'，制卡用书指纹，toc 用单次 opId）
export interface SubsessionIdentity {
  purpose: string
  key: string
}

// 轮转策略：固定阈值，或每次新建（toc 模式）
export type SubsessionRotation = { idleMs: number; maxPrompts: number } | { mode: 'always-new' }

export interface SubsessionPersistedState {
  sessionId: string
  promptCount: number
  lastUsedAt: number
}

// 可选持久化（仅制卡用；quiz/toc 传空即纯内存）
export interface SubsessionStore {
  load(purpose: string, key: string): Promise<SubsessionPersistedState | null>
  save(purpose: string, key: string, state: SubsessionPersistedState): Promise<void>
  touch(purpose: string, key: string): Promise<void>
}

export interface SubsessionEnsureOptions extends SubsessionIdentity {
  toolScope?: 'toc' | 'full' // 传给 acpApi.sessionNew（toc 传 'toc'，其余缺省）
  rotation: SubsessionRotation
  store?: SubsessionStore
  runtimeId?: string // 显式指定运行时的 Agent（如 TOC AI 自由选择运行时）
}

export interface SubsessionSendOptions extends SubsessionEnsureOptions {
  /** 显式指定已有会话（如 TOC prepare 后的特定会话），避免重复新建导致孤儿会话与配置丢失 */
  sessionId?: string
  images?: Array<{ id: string; kind: 'image'; name: string; mimeType: string; base64: string }> // toc 专用，缺省无
}

export type SubsessionEnsureResult =
  | { sessionId: string; configOptions: AcpConfigOption[]; fresh: boolean }
  | { error: 'auth-required' | 'unavailable' }

export type SubsessionSendResult = {
  status: 'ok' | 'auth-required' | 'failed'
  reply: string
  errorCode?: string
}

interface SubsessionEntry extends SubsessionPersistedState {
  purpose: string
  key: string
  replyBuffer: string
  prompting: boolean
  /** 本进程内新建（无需 load）；store 里捞回来的是 false，复用前先 load */
  fresh: boolean
  configOptions: AcpConfigOption[]
  progress?: SubsessionProgress
}

const entries = new Map<string, SubsessionEntry>()


function entryKey(purpose: string, key: string): string {
  return `${purpose}${key}`
}

function isAlwaysNew(rotation: SubsessionRotation): rotation is { mode: 'always-new' } {
  return 'mode' in rotation && rotation.mode === 'always-new'
}

function isEntryExpired(
  entry: SubsessionEntry,
  rotation: Exclude<SubsessionRotation, { mode: 'always-new' }>,
  now: number,
): boolean {
  return now - entry.lastUsedAt > rotation.idleMs || entry.promptCount >= rotation.maxPrompts
}

function keyTail(key: string): string {
  return key.length > 8 ? `…${key.slice(-8)}` : key
}

function resolvePreferredAgentCwd(): string | undefined {
  const s = useAcpUiStore.getState()
  const active = s.threads.find((t) => t.id === s.activeThreadId)
  const fromActive = active?.workspaceRoot?.trim()
  if (fromActive) return fromActive
  for (const thread of s.threads) {
    const root = thread.workspaceRoot?.trim()
    if (root) return root
  }
  return undefined
}

/** 任一在册 entry 命中 */
export function subsessionOwnsSessionId(sessionId: string): boolean {
  const sid = sessionId.trim()
  if (!sid) return false
  for (const entry of entries.values()) {
    if (entry.sessionId === sid) return true
  }
  return false
}

/** 限定 purpose 判归属（quiz/toc 薄封装限定注册表用；只读，无副作用） */
export function subsessionOwnsSessionFor(purpose: string, sessionId: string): boolean {
  const sid = sessionId.trim()
  if (!sid) return false
  for (const entry of entries.values()) {
    if (entry.purpose === purpose && entry.sessionId === sid) return true
  }
  return false
}

function extractThoughtFromContent(content: unknown): string {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  let result = ''
  for (const item of content) {
    if (item && typeof item === 'object') {
      const block = item as Record<string, unknown>
      if (block.type === 'thought' && typeof block.text === 'string') {
        result += block.text
      } else if (typeof block.thought === 'string') {
        result += block.thought
      }
    }
  }
  return result
}

function updateEntryProgress(
  entry: SubsessionEntry,
  update: Record<string, unknown>,
): void {
  const current: SubsessionProgress = entry.progress ?? {
    sessionId: entry.sessionId,
    purpose: entry.purpose,
    stepCount: 1,
    statusText: '处理中…',
    updatedAt: Date.now(),
  }

  let modified = false
  const updateKind = typeof update.sessionUpdate === 'string' ? update.sessionUpdate : ''

  if (updateKind === 'tool_call' || updateKind === 'tool_call_update') {
    const title =
      typeof update.title === 'string'
        ? update.title
        : typeof update.toolTitle === 'string'
          ? update.toolTitle
          : undefined
    const name = typeof update.name === 'string' ? update.name : undefined
    const toolName = title || name || '工具调用'
    const status =
      typeof update.status === 'string'
        ? (update.status as 'in_progress' | 'completed' | 'failed')
        : 'in_progress'

    current.stepCount += 1
    current.currentTool = toolName
    current.toolStatus = status
    if (status === 'completed') {
      current.statusText = `工具 ${toolName} 执行完成`
    } else if (status === 'failed') {
      current.statusText = `工具 ${toolName} 执行失败`
    } else {
      current.statusText = `正在调用工具: ${toolName}`
    }
    modified = true
  } else if (updateKind === 'agent_thought_chunk') {
    const thought = extractTextFromContent(update.content) || extractThoughtFromContent(update.content)
    if (thought) {
      const merged = (current.latestThought ?? '') + thought
      current.latestThought = merged.length > 300 ? '…' + merged.slice(-280) : merged
      current.statusText = '大模型深度思考中…'
      modified = true
    }
  } else if (update.step_update && typeof update.step_update === 'object') {
    const su = update.step_update as Record<string, unknown>
    if (typeof su.step_index === 'number') {
      current.stepCount = Math.max(current.stepCount, su.step_index)
      modified = true
    }
    if (typeof su.tool_name === 'string' && su.tool_name) {
      current.currentTool = su.tool_name
      current.statusText = `执行工具: ${su.tool_name}`
      modified = true
    }
    if (typeof su.state === 'string') {
      current.toolStatus = su.state === 'DONE' ? 'completed' : su.state === 'ACTIVE' ? 'in_progress' : 'failed'
      modified = true
    }
  } else {
    const text = extractTextFromContent(update.content)
    if (text) {
      current.statusText = '正在生成结果…'
      modified = true
    }
  }

  if (modified) {
    current.updatedAt = Date.now()
    entry.progress = current
    useSubsessionProgressStore.getState().setProgress(entry.purpose, { ...current })
  }
}

/**
 * 命中 entry 则累加其 replyBuffer；prompting 中的 entry 也收
 *（沿 quiz/toc 的 `|| isXxxPrompting()` 语义，见 card 的全表扫描写法）。
 */
export function accumulateSubsessionUpdate(
  sessionId: string,
  update: Record<string, unknown>,
): void {
  const sid = sessionId.trim()
  if (!sid) return
  for (const entry of entries.values()) {
    if (entry.sessionId !== sid && !entry.prompting) continue
    const text = extractTextFromContent(update.content)
    if (text) entry.replyBuffer += text
    updateEntryProgress(entry, update)
  }
}

/** 限定 purpose 的增量累加（语义同上，仅收本 purpose 的 entry；制卡薄封装用） */
export function accumulateSubsessionUpdateFor(
  purpose: string,
  sessionId: string,
  update: Record<string, unknown>,
): void {
  const sid = sessionId.trim()
  if (!sid) return
  for (const entry of entries.values()) {
    if (entry.purpose !== purpose) continue
    if (entry.sessionId !== sid && !entry.prompting) continue
    const text = extractTextFromContent(update.content)
    if (text) entry.replyBuffer += text
    updateEntryProgress(entry, update)
  }
}

/** 任一（或指定 purpose）entry.prompting */
export function isSubsessionPrompting(purpose?: string): boolean {
  for (const entry of entries.values()) {
    if (purpose !== undefined && entry.purpose !== purpose) continue
    if (entry.prompting) return true
  }
  return false
}

async function createSubsessionSession(
  opts: SubsessionEnsureOptions,
  mapKey: string,
  now: number,
): Promise<SubsessionEnsureResult> {
  const { purpose, key } = opts
  const created = await acpApi.sessionNew({
    cwd: resolvePreferredAgentCwd(),
    ...(opts.toolScope ? { toolScope: opts.toolScope } : {}),
  })
  if (!isOk(created)) {
    console.info(`[subsession] ensure:create-failed purpose=${purpose} key=${keyTail(key)}`)
    return { error: 'unavailable' }
  }
  const sid = created.value.sessionId
  const configOptions = created.value.configOptions ?? []

  // 继承该运行时下的模型与配置偏好
  const acpState = useAcpUiStore.getState()
  const runtimeId = opts.runtimeId || acpState.selectedRuntimeId
  const preferred = acpState.preferredConfigByRuntime[runtimeId] ?? undefined
  const patches = listPreferredConfigPatches(configOptions, preferred)
  for (const patch of patches) {
    await acpApi.setConfigOption({
      sessionId: sid,
      configId: patch.configId,
      value: patch.value,
    })
  }

  entries.set(mapKey, {
    purpose,
    key,
    sessionId: sid,
    promptCount: 0,
    lastUsedAt: now,
    replyBuffer: '',
    prompting: false,
    fresh: true,
    configOptions,
  })
  if (opts.store) {
    await opts.store.save(purpose, key, { sessionId: sid, promptCount: 0, lastUsedAt: now })
  }
  console.info(
    `[subsession] ensure:create purpose=${purpose} key=${keyTail(key)} session=${sid.slice(0, 8)}`,
  )
  return { sessionId: sid, configOptions, fresh: true }
}

export async function ensureSubsessionSession(
  opts: SubsessionEnsureOptions,
): Promise<SubsessionEnsureResult> {
  const { purpose, key, rotation } = opts
  const mapKey = entryKey(purpose, key)

  const transport = await ensureAcpTransport(12000, opts.runtimeId)
  if (transport !== 'connected') {
    console.info(`[subsession] ensure:abort purpose=${purpose} key=${keyTail(key)} reason=${transport}`)
    return { error: transport }
  }
  const now = Date.now()

  // 内存 entry 未过期即复用（always-new 跳过内存与 store 的读路径）
  if (!isAlwaysNew(rotation)) {
    const existing = entries.get(mapKey)
    if (existing && !isEntryExpired(existing, rotation, now)) {
      existing.lastUsedAt = now
      console.info(
        `[subsession] ensure:reuse purpose=${purpose} key=${keyTail(key)} session=${existing.sessionId.slice(0, 8)}`,
      )
      return { sessionId: existing.sessionId, configOptions: existing.configOptions, fresh: false }
    }
    // store 有且未过期则 loadSession 复用（沿制卡逻辑），失败回落新建
    if (opts.store) {
      const stored = await opts.store.load(purpose, key)
      if (
        stored &&
        now - stored.lastUsedAt <= rotation.idleMs &&
        stored.promptCount < rotation.maxPrompts
      ) {
        const loaded = await acpApi.loadSession({
          sessionId: stored.sessionId,
          cwd: resolvePreferredAgentCwd(),
          secondary: true,
        })
        if (isOk(loaded)) {
          const configOptions = loaded.value.configOptions ?? []
          entries.set(mapKey, {
            purpose,
            key,
            sessionId: stored.sessionId,
            promptCount: stored.promptCount,
            lastUsedAt: now,
            replyBuffer: '',
            prompting: false,
            fresh: false,
            configOptions,
          })
          console.info(
            `[subsession] ensure:load purpose=${purpose} key=${keyTail(key)} session=${stored.sessionId.slice(0, 8)}`,
          )
          return { sessionId: stored.sessionId, configOptions, fresh: false }
        }
      }
    }
  }

  return createSubsessionSession(opts, mapKey, now)
}

type PromptOnceResult = { reply: string } | { error: true; errorCode?: string; retryable: boolean }

async function promptOnce(
  mapKey: string,
  sessionId: string,
  opts: SubsessionSendOptions,
  promptText: string,
): Promise<PromptOnceResult> {
  const entry = entries.get(mapKey)
  if (!entry || entry.sessionId !== sessionId) return { error: true, retryable: true }
  entry.replyBuffer = ''
  entry.prompting = true
  try {
    const attachments: ComposerAttachment[] = (opts.images ?? []).map((image) => ({
      id: image.id,
      kind: image.kind,
      name: image.name,
      mimeType: image.mimeType,
      base64: image.base64,
    }))
    const rawCaps = useAcpUiStore.getState().promptCapabilities
    const caps = {
      ...rawCaps,
      ...(opts.images && opts.images.length > 0 && rawCaps.image !== false ? { image: true } : {}),
    }
    const blocks = buildAcpPromptBlocks({ text: promptText, attachments, promptCapabilities: caps })
    const initialProgress: SubsessionProgress = {
      sessionId,
      purpose: entry.purpose,
      stepCount: 1,
      statusText:
        opts.images && opts.images.length > 0
          ? `已附带 ${opts.images.length} 张目录原图，等待 AI 识别…`
          : '已发送请求，等待 AI 响应…',
      updatedAt: Date.now(),
    }
    entry.progress = initialProgress
    useSubsessionProgressStore.getState().setProgress(entry.purpose, initialProgress)
    const result = await acpApi.prompt({ sessionId, prompt: blocks })
    if (!isOk(result)) {
      // ACP_TIMEOUT 表示服务端可能仍在跑（toc 调用方要等工具草稿），不算会话已死，不自转
      return { error: true, errorCode: result.error.code, retryable: result.error.code !== 'ACP_TIMEOUT' }
    }
    entry.promptCount += 1
    entry.lastUsedAt = Date.now()
    return { reply: entry.replyBuffer.trim() }
  } catch {
    return { error: true, retryable: false }
  } finally {
    entry.prompting = false
  }
}

export async function sendSubsessionPrompt(
  opts: SubsessionSendOptions,
  promptText: string,
): Promise<SubsessionSendResult> {
  const { purpose, key } = opts
  const mapKey = entryKey(purpose, key)

  let targetSessionId = opts.sessionId
  if (targetSessionId) {
    const existing = entries.get(mapKey)
    if (!existing || existing.sessionId !== targetSessionId) {
      entries.set(mapKey, {
        purpose,
        key,
        sessionId: targetSessionId,
        promptCount: 0,
        lastUsedAt: Date.now(),
        replyBuffer: '',
        prompting: false,
        fresh: false,
        configOptions: [],
      })
    }
  } else {
    const ensured = await ensureSubsessionSession(opts)
    if ('error' in ensured) {
      console.info(
        `[subsession] send:abort purpose=${purpose} key=${keyTail(key)} reason=${ensured.error}`,
      )
      return { status: ensured.error === 'auth-required' ? 'auth-required' : 'failed', reply: '' }
    }
    targetSessionId = ensured.sessionId
  }

  const first = await promptOnce(mapKey, targetSessionId, opts, promptText)
  if (!('error' in first)) {
    if (opts.store) await opts.store.touch(purpose, key)
    console.info(
      `[subsession] send:return purpose=${purpose} key=${keyTail(key)} outcome=ok replyChars=${first.reply.length}`,
    )
    return { status: 'ok', reply: first.reply }
  }
  if (!first.retryable) {
    console.info(
      `[subsession] send:return purpose=${purpose} key=${keyTail(key)} outcome=failed error=${first.errorCode ?? 'thrown'}`,
    )
    return { status: 'failed', reply: '', errorCode: first.errorCode }
  }

  // 旧会话已死（prompt 拒收）时删 entry 自转一次重试（沿制卡逻辑）
  console.info(`[subsession] send:retry purpose=${purpose} key=${keyTail(key)} reason=prompt-rejected`)
  entries.delete(mapKey)
  const recreated = await createSubsessionSession(opts, mapKey, Date.now())
  if ('error' in recreated) {
    console.info(
      `[subsession] send:abort purpose=${purpose} key=${keyTail(key)} reason=rotate-failed`,
    )
    return { status: 'failed', reply: '' }
  }
  const retried = await promptOnce(mapKey, recreated.sessionId, opts, promptText)
  if (!('error' in retried)) {
    if (opts.store) await opts.store.touch(purpose, key)
    console.info(
      `[subsession] send:return purpose=${purpose} key=${keyTail(key)} outcome=ok-after-rotate replyChars=${retried.reply.length}`,
    )
    return { status: 'ok', reply: retried.reply }
  }
  console.info(
    `[subsession] send:return purpose=${purpose} key=${keyTail(key)} outcome=failed error=${retried.errorCode ?? 'thrown'}`,
  )
  return { status: 'failed', reply: '', errorCode: retried.errorCode }
}

/** 删内存 entry（store 行保留，下次 ensure 覆盖） */
export function resetSubsession(purpose: string, key: string): void {
  entries.delete(entryKey(purpose, key))
  useSubsessionProgressStore.getState().clearProgress(purpose)
}

/** 仅单测用，清空内存表 */
export function clearSubsessionSessions(): void {
  entries.clear()
  useSubsessionProgressStore.setState({ progressByPurpose: {} })
}

