import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { CodexAuthPreflight } from '@montree/contracts'
import {
  buildCustomProviderConfigToml,
  buildCustomProviderSpawnEnv,
} from "@yitom/acp-client"
import { probeCodexAuth } from './codex-auth-preflight'
import {
  getAcpProviderCodexHome,
  readStoredAcpProvider,
  type StoredAcpProvider,
} from './codex-provider'

export * from './codex-auth-preflight'
export * from './codex-provider'

export async function provisionCustomProviderCodexHome(
  provider: StoredAcpProvider,
  codexHome: string,
): Promise<boolean> {
  try {
    await mkdir(codexHome, { recursive: true })
    await writeFile(
      join(codexHome, 'config.toml'),
      buildCustomProviderConfigToml(provider),
      'utf8',
    )
    return true
  } catch (error) {
    console.error('[acp] 自定义供应商 config.toml 写入失败，回落本机登录', error)
    return false
  }
}

export interface CodexRuntimeAdapter {
  id: 'codex-acp'
  probeAuth: () => CodexAuthPreflight
  getCustomProvider: () => Promise<{
    provider: StoredAcpProvider | null
    customEnv: NodeJS.ProcessEnv
    isCustom: boolean
  }>
}

export const codexAdapter: CodexRuntimeAdapter = {
  id: 'codex-acp',
  probeAuth: () => {
    return probeCodexAuth()
  },
  getCustomProvider: async () => {
    const provider = await readStoredAcpProvider()
    const codexHome = getAcpProviderCodexHome()
    const isCustom =
      provider !== null && (await provisionCustomProviderCodexHome(provider, codexHome))

    const customEnv =
      isCustom && provider
        ? buildCustomProviderSpawnEnv(provider, provider.apiKey, codexHome)
        : {}

    return {
      provider,
      customEnv,
      isCustom,
    }
  },
}
