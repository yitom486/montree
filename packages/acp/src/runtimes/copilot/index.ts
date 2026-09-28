import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { AcpAuthMethod, CodexAuthPreflight } from '@inkdown/contracts'
import type { GenericRuntimeAdapter } from '../index'

/**
 * Copilot 运行时适配器（本机 `copilot --acp --stdio`）。
 *
 * 凭证复用：Copilot CLI 自身 GitHub 登录（OAuth token 默认进系统 keychain，
 * 无 keychain 时落 `~/.copilot/config.json` 明文；`COPILOT_HOME` 可改目录）
 * 或 `COPILOT_GITHUB_TOKEN` / `GH_TOKEN` / `GITHUB_TOKEN` 环境透传。
 * `config.json` 读到 `loggedInUsers` 非空才算已登录（文件本身首启即建，
 * 存在性无意义）；异常一律按未登录处理。
 */
export function resolveCopilotHome(): string {
  const fromEnv = process.env.COPILOT_HOME?.trim()
  if (fromEnv) return fromEnv
  return join(homedir(), '.copilot')
}

function hasCopilotLogin(home: string): boolean {
  try {
    const raw = readFileSync(join(home, 'config.json'), 'utf8')
    const parsed = JSON.parse(raw) as { loggedInUsers?: unknown }
    return Array.isArray(parsed.loggedInUsers) && parsed.loggedInUsers.length > 0
  } catch {
    return false
  }
}

export function probeCopilotAuth(): CodexAuthPreflight {
  const copilotHome = resolveCopilotHome()
  const hasCodexHome = existsSync(copilotHome)
  const hasAuthFile = hasCopilotLogin(copilotHome)
  const hasApiKeyEnv = Boolean(
    process.env.COPILOT_GITHUB_TOKEN?.trim() ||
      process.env.GH_TOKEN?.trim() ||
      process.env.GITHUB_TOKEN?.trim(),
  )

  return {
    codexHome: copilotHome,
    hasCodexHome,
    hasAuthFile,
    hasApiKeyEnv,
    looksLoggedIn: hasAuthFile || hasApiKeyEnv,
  }
}

export const copilotAdapter: GenericRuntimeAdapter = {
  id: 'copilot',
  probeAuth: () => probeCopilotAuth(),
  orderAuthMethods: (methods: AcpAuthMethod[]) => methods,
  canSkipInteractiveAuth: () => false,
}
