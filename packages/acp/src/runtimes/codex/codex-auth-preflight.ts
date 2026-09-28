import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { CodexAuthPreflight } from '@inkdown/contracts'

export type { CodexAuthPreflight }

export function emptyAcpAuthPreflight(): CodexAuthPreflight {
  return {
    codexHome: '',
    hasCodexHome: false,
    hasAuthFile: false,
    hasApiKeyEnv: false,
    looksLoggedIn: false,
  }
}

export function isCodexPreflightRuntime(runtimeId?: string): boolean {
  return !runtimeId || runtimeId === 'codex-acp'
}

export function resolveCodexHome(): string {
  const fromEnv = process.env.CODEX_HOME?.trim()
  if (fromEnv) return fromEnv
  return join(homedir(), '.codex')
}

/**
 * 仅做布尔级探测，对齐 VS Code/Zed「复用本机 Codex 登录」：
 * 不把 auth.json / token 读进渲染进程。
 */
export function probeCodexAuth(): CodexAuthPreflight {
  const codexHome = resolveCodexHome()
  const hasCodexHome = existsSync(codexHome)
  const hasAuthFile = existsSync(join(codexHome, 'auth.json'))
  const hasApiKeyEnv = Boolean(
    process.env.CODEX_API_KEY?.trim() || process.env.OPENAI_API_KEY?.trim(),
  )

  return {
    codexHome,
    hasCodexHome,
    hasAuthFile,
    hasApiKeyEnv,
    looksLoggedIn: hasAuthFile || hasApiKeyEnv,
  }
}
