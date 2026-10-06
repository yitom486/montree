import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  clearAcpProvider,
  getAcpProviderCodexHome,
  getAcpProviderStatus,
  readStoredAcpProvider,
  saveAcpProvider,
} from './provider-config-service'

let dir: string

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'montree-provider-'))
})

afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

describe('provider-config-service', () => {
  it('保存后 get 状态脱敏（无 Key），readStored 才有 Key', async () => {
    const saved = await saveAcpProvider(
      { name: 'DeepSeek', baseUrl: 'https://api.deepseek.com', model: 'deepseek-chat', wireApi: 'chat', apiKey: 'sk-1' },
      dir,
    )
    expect(saved.ok).toBe(true)
    if (!saved.ok) return
    expect(saved.value).toEqual({
      configured: true,
      name: 'DeepSeek',
      baseUrl: 'https://api.deepseek.com',
      model: 'deepseek-chat',
      wireApi: 'chat',
      hasApiKey: true,
    })
    expect('apiKey' in saved.value).toBe(false)

    const stored = await readStoredAcpProvider(dir)
    expect(stored?.apiKey).toBe('sk-1')
  })

  it('缺省 name 归一化为 undefined；responses 档保留', async () => {
    const saved = await saveAcpProvider(
      { baseUrl: 'https://api.openai.com/v1', model: 'gpt-5', wireApi: 'responses', apiKey: 'k' },
      dir,
    )
    expect(saved.ok).toBe(true)
    const stored = await readStoredAcpProvider(dir)
    expect(stored?.name).toBeUndefined()
    expect(stored?.wireApi).toBe('responses')
  })

  it('校验拒绝非法输入', async () => {
    const bad = await saveAcpProvider(
      { baseUrl: 'ftp://x', model: 'm', wireApi: 'chat', apiKey: 'k' },
      dir,
    )
    expect(bad.ok).toBe(false)
    const noKey = await saveAcpProvider(
      { baseUrl: 'https://x', model: 'm', wireApi: 'chat', apiKey: ' ' },
      dir,
    )
    expect(noKey.ok).toBe(false)
  })

  it('Key 留空沿用已存 Key', async () => {
    await saveAcpProvider({ baseUrl: 'https://x', model: 'm', wireApi: 'chat', apiKey: 'sk-1' }, dir)
    const updated = await saveAcpProvider({ baseUrl: 'https://y', model: 'm2', wireApi: 'chat', apiKey: '' }, dir)
    expect(updated.ok).toBe(true)
    const stored = await readStoredAcpProvider(dir)
    expect(stored?.apiKey).toBe('sk-1')
    expect(stored?.baseUrl).toBe('https://y')
  })

  it('clear 后回到未配置', async () => {
    await saveAcpProvider(
      { baseUrl: 'https://x', model: 'm', wireApi: 'chat', apiKey: 'k' },
      dir,
    )
    await clearAcpProvider(dir)
    expect(await getAcpProviderStatus(dir)).toEqual({ configured: false, hasApiKey: false })
  })

  it('codex-home 目录路径在 agent 目录下', () => {
    expect(getAcpProviderCodexHome(dir).replace(/\\/g, '/')).toContain('/agent/codex-home')
  })

  it('损坏的 provider.json 按未配置处理', async () => {
    await saveAcpProvider({ baseUrl: 'https://x', model: 'm', wireApi: 'chat', apiKey: 'k' }, dir)
    const file = join(dir, 'agent', 'provider.json')
    await readFile(file, 'utf8')
    await writeFile(file, '{broken', 'utf8')
    expect(await readStoredAcpProvider(dir)).toBeNull()
  })
})
