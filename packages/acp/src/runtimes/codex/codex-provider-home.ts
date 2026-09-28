import type { AcpProviderConfig } from '@inkdown/contracts'

/**
 * 自定义供应商专用 CODEX_HOME 内生成的 provider id。
 * 固定值，便于测试与日志识别；与用户真实 ~/.codex 的 provider 命名空间隔离。
 */
export const INKDOWN_PROVIDER_ID = 'inkdown-custom'

/** 自定义供应商专用环境变量名：config.toml 的 env_key 指向它 */
export const INKDOWN_PROVIDER_API_KEY_ENV = 'INKDOWN_PROVIDER_API_KEY'

function tomlEscape(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
}

/**
 * 生成隔离 CODEX_HOME 的完整 config.toml。
 * 该目录由本应用独占创建，整文件重写安全（无用户手工内容需合并）。
 */
export function buildCustomProviderConfigToml(config: AcpProviderConfig): string {
  const name = config.name?.trim() || '自定义 API'
  const wireApi = config.wireApi === 'responses' ? 'responses' : 'chat'
  return [
    `model_provider = "${INKDOWN_PROVIDER_ID}"`,
    `model = "${tomlEscape(config.model.trim())}"`,
    '',
    `[model_providers.${INKDOWN_PROVIDER_ID}]`,
    `name = "${tomlEscape(name)}"`,
    `base_url = "${tomlEscape(config.baseUrl.trim())}"`,
    `env_key = "${INKDOWN_PROVIDER_API_KEY_ENV}"`,
    `wire_api = "${wireApi}"`,
    '',
  ].join('\n')
}

/**
 * 自定义供应商模式的 spawn 环境覆盖项：
 * - CODEX_HOME 指向隔离目录（适配器读 config.toml，找不到 auth.json）
 * - INKDOWN_PROVIDER_API_KEY 承载明文 Key（config.toml env_key 引用）
 * 仅影响子进程；主进程与用户 ~/.codex 不受影响。
 */
export function buildCustomProviderSpawnEnv(
  config: AcpProviderConfig,
  apiKey: string,
  codexHome: string,
): NodeJS.ProcessEnv {
  return {
    CODEX_HOME: codexHome,
    [INKDOWN_PROVIDER_API_KEY_ENV]: apiKey,
  }
}
