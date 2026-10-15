import { montreeAgentResourceDir } from './agent-resources'
import { getAcpRuntimeAdapter, resolveRuntimeEligibility as sdkResourceEligibility, isSupportedBridgeVersion as sdkBridgeVersion } from '@yitom/acp-client'
import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { isAbsolute, join } from 'node:path'
import type { AcpPromptMode } from '@montree/contracts'

/**
 * Host resource location, process reuse and delivery decisions.
 * Runtime configuration, Skills bindings and version contracts belong to acp-client.
 * Unsupported versions and unverified execution environments keep compatibility delivery.
 */

export const NATIVE_RULES_FILE = 'AGENTS.md'

export type NativeCompatReason =
  | 'runtime-not-verified'
  | 'agent-resource-missing'
  | 'invalid-codex-config'
  | 'conflicting-codex-config'
  | 'unknown-bridge-version'
  | 'unsupported-bridge-version'
  | 'binding-not-ready'
  | 'session-restored'
  | 'rules-updated-deferred-busy'
  | 'execution-not-verified'
  | 'effective-config-not-verified'

export interface NativeEligibility {
  eligible: boolean
  reason?: NativeCompatReason
}

/** Runtime configuration contracts and version gates belong to the SDK. */
export const resolveRuntimeEligibility = sdkResourceEligibility
export const isSupportedBridgeVersion = sdkBridgeVersion

export interface AgentResourcePaths {
  /** Runtime resource directory, normally ~/.montree. */
  resourceDir: string
}

/** 读取原生规则正文；缺失返回 null（调用方降级 compatibility）。 */
export async function readNativeRulesText(paths: AgentResourcePaths): Promise<string | null> {
  if (!paths.resourceDir) return null
  try {
    const text = await readFile(join(paths.resourceDir, NATIVE_RULES_FILE), 'utf8')
    return text.trim() ? text : null
  } catch {
    return null
  }
}

/** 规则内容摘要：温进程复用只比摘要，不比目录名。 */
export function digestNativeRules(rulesText: string, skillsMarker = ''): string {
  return createHash('sha256').update(`montree-native-rules-v1\n${rulesText}\n${skillsMarker}`, 'utf8').digest('hex')
}

export function shortProfileHash(digestHex: string): string {
  return digestHex.slice(0, 16)
}

/** 温进程绑定标签：规则摘要 + 运行时；版本是进程属性，握手后另行记录比对。 */
export function buildProfileTag(runtimeId: string, profileHash: string): string {
  return `${runtimeId}:rules@${profileHash}`
}

/**
 * config.toml 手术式合并（无 TOML 解析依赖）：保留用户全部未知内容，
 * 只替换本应用管理的键——顶层 `model` / `model_provider` 与
 * `[model_providers.inkdown-custom]` 整节。注释、空行与其他表原样保留。
 */
export function mergeCodexConfigToml(existingText: string | null, providerBlock: string): string {
  const block = providerBlock.trim() ? `${providerBlock.trim()}\n` : ''
  if (!existingText || !existingText.trim()) return block
  // 不把多行字符串中的伪表头或带引号的表名当成 TOML 结构；复杂配置保留原文件。
  if (/"""|'''/.test(existingText) || /^\s*\[.*["'].*\]|^\s*\[\[|^\s*["'](?:model|model_provider)["']\s*=/m.test(existingText)) {
    throw new Error('复杂 Codex 配置需要结构化合并，已保留原文件')
  }
  const managedTable = 'model_providers.inkdown-custom'
  const out: string[] = []
  let inManagedTable = false
  let inAnyTable = false
  for (const line of existingText.split('\n')) {
    const header = /^\s*\[([^\]]+)\]\s*(?:#.*)?$/.exec(line)?.[1]?.trim() ?? null
    if (header !== null) {
      inAnyTable = true
      inManagedTable = header === managedTable
      if (!inManagedTable) out.push(line)
      continue
    }
    if (inManagedTable) continue
    // 仅顶层（尚未进入任何表）的 model / model_provider 由本应用管理
    if (!inAnyTable && /^\s*(model|model_provider)\s*=/.test(line)) continue
    out.push(line)
  }
  const kept = out.join('\n').trim()
  if (!kept) return block
  // 管理块的顶层键必须在第一张表之前；追加到末尾会落入用户最后一张表。
  const tableAt = block.indexOf('[model_providers.')
  if (tableAt < 0) return `${block}\n${kept}\n`
  return `${block.slice(0, tableAt).trim()}\n\n${kept}\n\n${block.slice(tableAt)}`
}

export interface PromptModeDecision {
  mode: AcpPromptMode
  reason?: NativeCompatReason
}

/**
 * prompt 模式裁决：只有「资格 + 版本 + 新会话 + 绑定就绪」四者齐备才 native；
 * 恢复/重载仅在本次会话扩展重新被接受时使用 native，否则保持 compatibility。
 */
export function resolvePromptMode(input: {
  eligible: boolean
  versionSupported: boolean
  bindingReady: boolean
  restoreMethod?: string | null
  nativeSessionAccepted?: boolean
}): PromptModeDecision {
  if (!input.eligible) return { mode: 'compatibility', reason: 'runtime-not-verified' }
  if (!input.versionSupported) return { mode: 'compatibility', reason: 'unsupported-bridge-version' }
  if (!input.bindingReady) return { mode: 'compatibility', reason: 'binding-not-ready' }
  if (input.restoreMethod !== 'new' && !input.nativeSessionAccepted) {
    return { mode: 'compatibility', reason: 'session-restored' }
  }
  return { mode: 'native' }
}

export interface NativeBindingManifest {
  profileHash: string
  runtimeId: string
  bridgeVersion?: string
  eligible: boolean
  versionSupported: boolean
  rulesChars: number
  createdAt: string
}

/**
 * 物化版本目录审计记录（best-effort，不抛错阻断连接）。
 * 只写 manifest，不复制规则全文、不写认证、不建技能实体目录。
 */
export async function materializeBindingManifest(
  userDataDir: string,
  manifest: NativeBindingManifest,
): Promise<string | null> {
  try {
    const dir = join(userDataDir, 'agent-profiles', manifest.profileHash)
    await mkdir(dir, { recursive: true })
    const file = join(dir, 'manifest.json')
    await writeFile(file, JSON.stringify(manifest, null, 2), 'utf8')
    return file
  } catch {
    return null
  }
}

/** 脱敏的绑定摘要（日志/诊断用；不含指令正文与完整配置）。 */
export function describeBindingForLog(input: {
  runtimeId: string
  mode: AcpPromptMode
  reason?: NativeCompatReason
  profileHash?: string
  bridgeVersion?: string
  rulesChars?: number
}): Record<string, string> {
  const out: Record<string, string> = {
    runtime: input.runtimeId,
    mode: input.mode,
  }
  if (input.reason) out['reason'] = input.reason
  if (input.profileHash) out['profileHash'] = input.profileHash
  if (input.bridgeVersion) out['bridgeVersion'] = input.bridgeVersion
  if (typeof input.rulesChars === 'number') out['rulesChars'] = String(input.rulesChars)
  return out
}

/** 资源目录存在性（开发期与打包期统一入口；调用方传入候选）。 */
export function agentResourceDirExists(paths: AgentResourcePaths): boolean {
  return existsSync(join(paths.resourceDir, NATIVE_RULES_FILE))
}

/**
 * 默认资源目录候选（无 electron 依赖，可单测）：
 * 打包后 resourcesPath/agent；开发期项目相对路径。返回首个存在的目录，
 * 都不存在时返回打包候选（调用方读取失败即降级，不抛错）。
 */
export function agentResourceTemplateDir(appPath = process.cwd(), packaged = false): string {
  const candidates: string[] = []
  const resourcesPath =
    typeof process.resourcesPath === 'string' && process.resourcesPath
      ? process.resourcesPath
      : null
  if (packaged) return resourcesPath ? join(resourcesPath, 'agent') : ''
  candidates.push(join(appPath, 'apps/desktop/resources/agent'))
  candidates.push(join(appPath, 'resources/agent'))
  for (const dir of candidates) {
    try {
      if (existsSync(join(dir, NATIVE_RULES_FILE))) return dir
    } catch {
      // 忽略不可访问候选，继续下一个
    }
  }
  return candidates[0] ?? join(appPath, 'apps/desktop/resources/agent')
}

export interface PreparedNativeBinding {
  eligible: boolean
  reason?: NativeCompatReason
  profileTag: string | null
  profileHash: string | null
  rulesChars: number
  /** Runtime-specific resource preparation belongs to acp-client. */
  resourceEnv?: NodeJS.ProcessEnv
  sessionMeta?: Record<string, unknown>
}

/** Prepare through the SDK; keep secrets out of logs and use only a digest for reuse. */
export async function prepareNativeBinding(input: {
  runtimeId: string
  command?: string
  resourceDir?: string
  env?: NodeJS.ProcessEnv
  executionVerified?: boolean
  cwd?: string
}): Promise<PreparedNativeBinding> {
  const runtimeId = (input.runtimeId ?? '').trim()
  const idle: PreparedNativeBinding = {
    eligible: false,
    reason: 'runtime-not-verified',
    profileTag: null,
    profileHash: null,
    rulesChars: 0,
  }
  if (input.executionVerified === false || (input.cwd && !isAbsolute(input.cwd))) {
    return {...idle, reason:'execution-not-verified'}
  }
  const resourceDir=input.resourceDir ?? montreeAgentResourceDir()
  try {
    const adapter=getAcpRuntimeAdapter(runtimeId)
    const prepared=await adapter.prepareAppResources?.({directory:resourceDir,workspaceRoot:input.cwd ?? process.cwd(),env:input.env,command:input.command})
    const digest=prepared?.report.profileDigest
    const sessionMeta=adapter.appResourceSessionMeta?.(resourceDir)
    if (!prepared?.report.rulesPrepared || !digest || (!prepared.env && !sessionMeta)) {
      const reason=prepared?.report.reason
      return {...idle,reason:reason === 'effective-config-not-verified' || reason === 'execution-not-verified' ? reason : 'binding-not-ready'}
    }
    const profileHash=shortProfileHash(digestNativeRules(digest,JSON.stringify({env:prepared.env,sessionMeta})))
    return {...idle,eligible:true,reason:undefined,profileHash,profileTag:buildProfileTag(runtimeId,profileHash),rulesChars:prepared.report.rulesChars,
      resourceEnv:sessionMeta ? undefined : prepared.env,sessionMeta}
  } catch {
    return {...idle,reason:'binding-not-ready'}
  }
}
