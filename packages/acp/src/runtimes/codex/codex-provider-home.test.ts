import { describe, expect, it } from 'vitest'
import {
  buildCustomProviderConfigToml,
  buildCustomProviderSpawnEnv,
  INKDOWN_PROVIDER_API_KEY_ENV,
  INKDOWN_PROVIDER_ID,
} from './codex-provider-home'

describe('buildCustomProviderConfigToml', () => {
  it('chat 档：生成 provider 段与顶层 model_provider/model', () => {
    const toml = buildCustomProviderConfigToml({
      name: 'DeepSeek',
      baseUrl: 'https://api.deepseek.com',
      model: 'deepseek-chat',
      wireApi: 'chat',
    })
    expect(toml).toContain('model_provider = "inkdown-custom"')
    expect(toml).toContain('model = "deepseek-chat"')
    expect(toml).toContain(`[model_providers.${INKDOWN_PROVIDER_ID}]`)
    expect(toml).toContain('name = "DeepSeek"')
    expect(toml).toContain('base_url = "https://api.deepseek.com"')
    expect(toml).toContain(`env_key = "${INKDOWN_PROVIDER_API_KEY_ENV}"`)
    expect(toml).toContain('wire_api = "chat"')
  })

  it('responses 档与缺省 name 回退', () => {
    const toml = buildCustomProviderConfigToml({
      baseUrl: 'https://example.com/v1',
      model: 'my-model',
      wireApi: 'responses',
    })
    expect(toml).toContain('wire_api = "responses"')
    expect(toml).toContain('name = "自定义 API"')
  })

  it('转义 model/name/baseUrl 中的双引号与反斜杠', () => {
    const toml = buildCustomProviderConfigToml({
      baseUrl: 'https://example.com/"x"\\y',
      model: 'a"b\\c',
      wireApi: 'chat',
    })
    expect(toml).toContain('model = "a\\"b\\\\c"')
    expect(toml).toContain('base_url = "https://example.com/\\"x\\"\\\\y"')
  })
})

describe('buildCustomProviderSpawnEnv', () => {
  it('注入 CODEX_HOME 与专用 Key 环境变量，不触碰 OPENAI_*', () => {
    const env = buildCustomProviderSpawnEnv(
      { baseUrl: 'https://x', model: 'm', wireApi: 'chat' },
      'sk-test',
      'D:/home/codex-isolated',
    )
    expect(env.CODEX_HOME).toBe('D:/home/codex-isolated')
    expect(env[INKDOWN_PROVIDER_API_KEY_ENV]).toBe('sk-test')
    expect('OPENAI_API_KEY' in env).toBe(false)
  })
})
