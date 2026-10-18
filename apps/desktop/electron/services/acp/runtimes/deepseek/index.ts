import { existsSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { AcpAuthMethod, CodexAuthPreflight } from '@yitom/contracts'
import { DEEPSEEK_DSH_NPM_PACKAGE } from '@yitom/contracts'
import type { GenericRuntimeAdapter } from '../index'

/**
 * DeepSeek 运行时适配器（`bunx @deepseek-ai/dsh --profile acp`）。
 *
 * 凭证复用：harness 自身凭证（`DEEPSEEK_API_KEY` 或 `$DSH_HOME/.credentials.yaml`，
 * 全部留在官方位置，我方不存、不读内容）。harness 的 ACP `authMethods` 为空，
 * 连接门闩天然走 `skip_auth`；此处探测仅供诊断展示。
 * 模型经 session 到达（顶层 `models` 方言由 session-open 合成 model 选项），无需额外动作。
 *
 * 缺 key 预检（仿 cursor `resolveSpawnCommand` 为 null 即拦的 precedent）：
 * 本机既无 env key 也无 DSH 本地登录时 harness 极可能直接退出（stdio 关闭→传输层报
 * connection closed），故经 `resolveSpawnBlocker` 在 spawn 前判停，回带中文动作指引。
 * 同族 `DSH_*` 仅认文档明确的变量——`DSH_HOME`（本地登录位置）、`DEEPSEEK_API_KEY`
 * （预检）与 `DSH_PACKAGE`（包定位符覆盖，见 `resolveDeepseekSpawnCommand`）。
 *
 * 上游坏包逃生（实锤：dsh 0.1.5-rc.2 内依赖 `…-documentpreview@^0.1.5-rc.3`，
 * 而该包最高仅 0.1.6-alpha.1，上游缺 rc.3，自解析依赖失败退出）：
 * 设 `DSH_PACKAGE` pin 旧版（如 `@deepseek-ai/dsh@0.1.4`）即可绕过。
 */
export function buildDeepseekMissingKeyMessage(): string {
  return '未检测到 DEEPSEEK_API_KEY，也未找到 DSH 本地登录（~/.dsh/.credentials.yaml）：请先在终端导出该变量，或先完成 DeepSeek Harness 自身登录后再连接'
}

/** DSH 的 home；沿用 harness 自己的 DSH_HOME 约定，缺省 ~/.dsh。 */
export function resolveDeepseekHarnessHome(env?: NodeJS.ProcessEnv): string {
  const source = env ?? process.env
  const configured = source.DSH_HOME?.trim()
  return configured || join(homedir(), '.dsh')
}

/** 只检查 DSH 本地凭据文件是否存在且非空，绝不读取/记录其中内容。 */
export function hasDeepseekHarnessCredentials(env?: NodeJS.ProcessEnv): boolean {
  const file = join(resolveDeepseekHarnessHome(env), '.credentials.yaml')
  try {
    return existsSync(file) && statSync(file).size > 0
  } catch {
    return false
  }
}

export function resolveDeepseekSpawnBlocker(env?: NodeJS.ProcessEnv): string | null {
  const source = env ?? process.env
  if (source.DEEPSEEK_API_KEY?.trim()) return null
  if (hasDeepseekHarnessCredentials(source)) return null
  return buildDeepseekMissingKeyMessage()
}

/**
 * 包定位符覆盖（`DSH_PACKAGE`，缺省 `@deepseek-ai/dsh`，沿 contracts 常量口径）：
 * 最小校验——非空、无空白、无 shell 元字符（`;&|$()` 等），非法回落缺省并 dev warn。
 * 经 `resolveSpawnCommand` 风格返回 spawn 目标覆盖（precedent 照抄 cursor）。
 */
export function resolveDeepseekPackage(env?: NodeJS.ProcessEnv): string {
  const source = env ?? process.env
  const raw = source.DSH_PACKAGE?.trim()
  if (!raw) return DEEPSEEK_DSH_NPM_PACKAGE
  if (/[\s;&|$()`"'\\<>*?~#!]/.test(raw)) {
    if (process.env.NODE_ENV !== 'production') {
      console.warn(`[acp:deepseek] 非法 DSH_PACKAGE 回落缺省: ${raw}`)
    }
    return DEEPSEEK_DSH_NPM_PACKAGE
  }
  return raw
}

export function resolveDeepseekSpawnCommand(env?: NodeJS.ProcessEnv): {
  command: string
  args: string[]
} {
  const pkg = resolveDeepseekPackage(env)
  // 缺省包跟模板一样带 @latest（每次冷启动直取 registry 最新）；用户覆盖值原样使用
  const spec = pkg === DEEPSEEK_DSH_NPM_PACKAGE ? `${pkg}@latest` : pkg
  return { command: 'bunx', args: ['-y', spec, '--profile', 'acp'] }
}
export function probeDeepseekAuth(): CodexAuthPreflight {
  const hasApiKeyEnv = Boolean(process.env.DEEPSEEK_API_KEY?.trim())
  const harnessHome = resolveDeepseekHarnessHome()
  const hasAuthFile = hasDeepseekHarnessCredentials()

  return {
    codexHome: harnessHome,
    hasCodexHome: existsSync(harnessHome),
    hasAuthFile,
    hasApiKeyEnv,
    looksLoggedIn: hasApiKeyEnv || hasAuthFile,
  }
}

export const deepseekAdapter: GenericRuntimeAdapter = {
  id: 'deepseek',
  probeAuth: () => probeDeepseekAuth(),
  resolveSpawnCommand: () => resolveDeepseekSpawnCommand(),
  resolveSpawnBlocker: () => resolveDeepseekSpawnBlocker(),
  orderAuthMethods: (methods: AcpAuthMethod[]) => methods,
  canSkipInteractiveAuth: () => false,
}
