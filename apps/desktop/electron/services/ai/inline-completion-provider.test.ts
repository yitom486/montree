import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  clearInlineCompletionProvider,
  getInlineCompletionProviderStatus,
  resolveInlineCompletionProvider,
  saveInlineCompletionProvider,
} from './inline-completion-provider'

let dir: string

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'montree-completion-provider-'))
})

afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

async function writeLegacyProvider(): Promise<void> {
  await mkdir(join(dir, 'agent'), { recursive: true })
  await writeFile(join(dir, 'agent', 'provider.json'), JSON.stringify({
    baseUrl: 'https://api.example.com/v1',
    model: 'legacy-model',
    apiKey: 'sk-legacy',
    wireApi: 'chat',
  }), 'utf8')
}

describe('inline completion provider', () => {
  it('专用配置优先，缺失时回退旧 Agent 配置', async () => {
    await writeLegacyProvider()
    expect(await getInlineCompletionProviderStatus(dir)).toMatchObject({
      configured: true,
      source: 'agent',
      model: 'legacy-model',
      hasApiKey: true,
    })

    const saved = await saveInlineCompletionProvider({
      name: 'Fast local',
      baseUrl: 'http://localhost:11434/v1',
      model: 'qwen2.5-coder:7b',
      apiKey: '',
    }, dir)
    expect(saved.ok).toBe(true)
    if (!saved.ok) return
    expect(saved.value).toMatchObject({
      configured: true,
      source: 'dedicated',
      model: 'qwen2.5-coder:7b',
      hasApiKey: false,
    })
    expect((await resolveInlineCompletionProvider(dir))?.source).toBe('dedicated')

    const cleared = await clearInlineCompletionProvider(dir)
    expect(cleared.ok).toBe(true)
    if (!cleared.ok) return
    expect(cleared.value).toMatchObject({ source: 'agent', model: 'legacy-model' })
  })

  it('ChatGPT 模式使用独立凭据，缺失时提示登录', async () => {
    const saved = await saveInlineCompletionProvider({
      authMode: 'chatgpt',
      model: 'gpt-4o-mini',
    }, dir)
    expect(saved.ok).toBe(true)
    if (!saved.ok) return
    expect(saved.value).toMatchObject({
      configured: false,
      authMode: 'chatgpt',
      model: 'gpt-6-luna',
      loginRequired: true,
    })

    await mkdir(join(dir, 'ai'), { recursive: true })
    await writeFile(join(dir, 'ai', 'chatgpt-auth.json'), JSON.stringify({
      access: 'access',
      refresh: 'refresh',
      expires: Date.now() + 120_000,
      accountId: 'acct_1',
    }))

    expect(await getInlineCompletionProviderStatus(dir)).toMatchObject({
      configured: true,
      authMode: 'chatgpt',
      model: 'gpt-6-luna',
      chatgptAccountId: 'acct_1',
      loginRequired: false,
    })
    expect((await resolveInlineCompletionProvider(dir))?.credential?.accountId).toBe('acct_1')
  })

  it('远程端点要求 API Key，本地 localhost 允许留空', async () => {
    const remote = await saveInlineCompletionProvider({
      baseUrl: 'https://api.example.com/v1',
      model: 'remote-model',
      apiKey: '',
    }, dir)
    expect(remote.ok).toBe(false)

    const first = await saveInlineCompletionProvider({
      baseUrl: 'https://api.example.com/v1',
      model: 'remote-model',
      apiKey: 'sk-first',
    }, dir)
    expect(first.ok).toBe(true)
    const sameBase = await saveInlineCompletionProvider({
      baseUrl: 'https://api.example.com/v1/',
      model: 'remote-model-2',
      apiKey: '',
    }, dir)
    expect(sameBase.ok).toBe(true)
    const storedKey = JSON.parse(await readFile(join(dir, 'ai', 'inline-completion-provider.json'), 'utf8')) as { apiKey: string }
    expect(storedKey.apiKey).toBe('sk-first')

    const otherBase = await saveInlineCompletionProvider({
      baseUrl: 'https://other.example.com/v1',
      model: 'other-model',
      apiKey: '',
    }, dir)
    expect(otherBase.ok).toBe(false)

    const local = await saveInlineCompletionProvider({
      baseUrl: 'http://127.0.0.1:1234/v1',
      model: 'local-model',
      apiKey: '',
    }, dir)
    expect(local.ok).toBe(true)
    const stored = JSON.parse(await readFile(join(dir, 'ai', 'inline-completion-provider.json'), 'utf8')) as { apiKey: string }
    expect(stored.apiKey).toBe('')
  })
})
