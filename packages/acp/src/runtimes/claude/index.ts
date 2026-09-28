import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { AcpAuthMethod, CodexAuthPreflight } from '@inkdown/contracts'
import type { GenericRuntimeAdapter } from '../index'

/**
 * Claude 运行时适配器（`claude-agent-acp`）。
 *
 * 凭证复用：Claude Code 本机登录（`~/.claude.json` 的 oauthAccount /
 * Linux/Win `~/.claude/.credentials.json`，macOS 走 Keychain 故仅文件侧探测）
 * 或 `ANTHROPIC_API_KEY` / `CLAUDE_CODE_OAUTH_TOKEN` 环境透传。
 * 只做布尔级存在性探测，不读密钥内容。
 */
export function resolveClaudeHome(): string {
  const fromEnv = process.env.CLAUDE_CONFIG_DIR?.trim()
  if (fromEnv) return fromEnv
  return join(homedir(), '.claude')
}

export function probeClaudeAuth(): CodexAuthPreflight {
  const claudeHome = resolveClaudeHome()
  const hasCodexHome = existsSync(claudeHome)
  const hasAuthFile =
    existsSync(join(homedir(), '.claude.json')) ||
    existsSync(join(claudeHome, '.credentials.json'))
  const hasApiKeyEnv = Boolean(
    process.env.ANTHROPIC_API_KEY?.trim() || process.env.CLAUDE_CODE_OAUTH_TOKEN?.trim(),
  )

  return {
    codexHome: claudeHome,
    hasCodexHome,
    hasAuthFile,
    hasApiKeyEnv,
    looksLoggedIn: hasAuthFile || hasApiKeyEnv,
  }
}

export const claudeAdapter: GenericRuntimeAdapter = {
  id: 'claude',
  probeAuth: () => probeClaudeAuth(),
  orderAuthMethods: (methods: AcpAuthMethod[]) => methods,
  canSkipInteractiveAuth: () => false,
}
