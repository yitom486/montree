import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

vi.mock('electron', () => ({ app: { getPath: () => process.cwd() } }))

import {
  buildChatGptAuthorizeUrl,
  CHATGPT_REDIRECT_URI,
  decodeChatGptAccountId,
  getChatGptAuthStatus,
  getValidChatGptCredential,
  logoutChatGpt,
  usableChatGptModel,
} from './chatgpt-auth'

const dirs: string[] = []
async function tempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'montree-chatgpt-'))
  dirs.push(dir)
  return dir
}

function tokenWithClaim(claim: unknown): string {
  return `header.${Buffer.from(JSON.stringify(claim)).toString('base64url')}.signature`
}

afterEach(async () => {
  vi.unstubAllGlobals()
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

describe('ChatGPT OAuth helpers', () => {
  it('builds an authorize URL with PKCE and the local callback', () => {
    const url = new URL(buildChatGptAuthorizeUrl('state-1', 'challenge-1'))
    expect(url.origin).toBe('https://auth.openai.com')
    expect(url.searchParams.get('redirect_uri')).toBe(CHATGPT_REDIRECT_URI)
    expect(url.searchParams.get('state')).toBe('state-1')
    expect(url.searchParams.get('code_challenge')).toBe('challenge-1')
    expect(url.searchParams.get('code_challenge_method')).toBe('S256')
    expect(url.searchParams.get('scope')).toContain('offline_access')
  })

  it('decodes the account id from the access token claim', () => {
    const token = tokenWithClaim({
      'https://api.openai.com/auth': { chatgpt_account_id: 'acct_123' },
    })
    expect(decodeChatGptAccountId(token)).toBe('acct_123')
    expect(decodeChatGptAccountId('not-a-jwt')).toBeNull()
  })

  it('clamps unknown models to the supported completion default', () => {
    expect(usableChatGptModel('gpt-6.1-sol')).toBe('gpt-6.1-sol')
    expect(usableChatGptModel('gpt-4o-mini')).toBe('gpt-6-luna')
    expect(usableChatGptModel(undefined)).toBe('gpt-6-luna')
  })
})

describe('ChatGPT credential status', () => {
  it('reports unconfigured, configured, then logged out without exposing tokens', async () => {
    const dir = await tempDir()
    expect(await getChatGptAuthStatus(dir)).toMatchObject({
      configured: false,
      models: expect.arrayContaining(['gpt-6-luna']),
    })

    await mkdir(join(dir, 'ai'), { recursive: true })
    await writeFile(join(dir, 'ai', 'chatgpt-auth.json'), JSON.stringify({
      access: 'secret-access',
      refresh: 'secret-refresh',
      expires: Date.now() + 60_000,
      accountId: 'acct_123',
    }))

    const configured = await getChatGptAuthStatus(dir)
    expect(configured).toMatchObject({ configured: true, accountId: 'acct_123' })
    expect(JSON.stringify(configured)).not.toContain('secret-access')
    expect(JSON.stringify(configured)).not.toContain('secret-refresh')

    expect(await logoutChatGpt(dir)).toMatchObject({ configured: false })
    expect(await getChatGptAuthStatus(dir)).toMatchObject({ configured: false })
  })

  it('refreshes an expired credential and persists the rotated token', async () => {
    const dir = await tempDir()
    await mkdir(join(dir, 'ai'), { recursive: true })
    await writeFile(join(dir, 'ai', 'chatgpt-auth.json'), JSON.stringify({
      access: tokenWithClaim({
        'https://api.openai.com/auth': { chatgpt_account_id: 'acct_123' },
      }),
      refresh: 'old-refresh',
      expires: Date.now() - 1_000,
      accountId: 'acct_123',
    }))

    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      access_token: tokenWithClaim({
        'https://api.openai.com/auth': { chatgpt_account_id: 'acct_123' },
      }),
      refresh_token: 'new-refresh',
      expires_in: 3600,
    }), { status: 200, headers: { 'content-type': 'application/json' } }))
    vi.stubGlobal('fetch', fetchMock)

    const credential = await getValidChatGptCredential(dir)
    expect(credential).toMatchObject({ accountId: 'acct_123', refresh: 'new-refresh' })
    expect(credential.expires).toBeGreaterThan(Date.now() + 3_000_000)
    const saved = JSON.parse(await readFile(join(dir, 'ai', 'chatgpt-auth.json'), 'utf8')) as { refresh: string }
    expect(saved.refresh).toBe('new-refresh')
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const body = String((fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1]?.body)
    expect(body).toContain('grant_type=refresh_token')
  })
})
