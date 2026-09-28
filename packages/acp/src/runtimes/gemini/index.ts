import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { AcpAuthMethod, CodexAuthPreflight } from '@inkdown/contracts'
import type { GenericRuntimeAdapter } from '../index'

/**
 * Gemini 运行时适配器（本机 `gemini --acp`）。
 *
 * 凭证复用：Gemini CLI 本机登录（`~/.gemini/oauth_creds.json`；
 * 新版可能迁入系统 Keychain，故文件缺失不等于未登录）或
 * `GEMINI_API_KEY` / `GOOGLE_API_KEY` 环境透传。
 * 只做布尔级存在性探测，不读密钥内容。
 */
export function resolveGeminiHome(): string {
  return join(homedir(), '.gemini')
}

export function probeGeminiAuth(): CodexAuthPreflight {
  const geminiHome = resolveGeminiHome()
  const hasCodexHome = existsSync(geminiHome)
  const hasAuthFile =
    existsSync(join(geminiHome, 'oauth_creds.json')) ||
    Boolean(process.env.GOOGLE_APPLICATION_CREDENTIALS?.trim())
  const hasApiKeyEnv = Boolean(
    process.env.GEMINI_API_KEY?.trim() || process.env.GOOGLE_API_KEY?.trim(),
  )

  return {
    codexHome: geminiHome,
    hasCodexHome,
    hasAuthFile,
    hasApiKeyEnv,
    looksLoggedIn: hasAuthFile || hasApiKeyEnv,
  }
}

export const geminiAdapter: GenericRuntimeAdapter = {
  id: 'gemini',
  probeAuth: () => probeGeminiAuth(),
  orderAuthMethods: (methods: AcpAuthMethod[]) => methods,
  canSkipInteractiveAuth: () => false,
}
