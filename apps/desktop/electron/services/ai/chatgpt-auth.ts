import { app } from 'electron'
import { createServer } from 'node:http'
import { createHash, randomBytes } from 'node:crypto'
import { existsSync } from 'node:fs'
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { ChatGptAuthStatus } from '../../../contracts/inline-completion-provider'

/**
 * ChatGPT/Codex OAuth（PKCE）。凭据只写主进程 userData，不进入渲染进程；
 * 请求走 ChatGPT Codex 后端，而不是公开 api.openai.com。
 */
const CLIENT_ID = 'app_EMoamEEZ73f0CkXaXp7hrann'
const AUTHORIZE_URL = 'https://auth.openai.com/oauth/authorize'
const TOKEN_URL = 'https://auth.openai.com/oauth/token'
const CALLBACK_PORT = 1455
export const CHATGPT_REDIRECT_URI = `http://localhost:${CALLBACK_PORT}/auth/callback`
const SCOPE = 'openid profile email offline_access'
const JWT_CLAIM_PATH = 'https://api.openai.com/auth'
const ORIGINATOR = 'montree'
const LOGIN_TIMEOUT_MS = 5 * 60_000
const REFRESH_MARGIN_MS = 60_000

export const CHATGPT_DEFAULT_MODEL = 'gpt-6-luna'
export const CHATGPT_SUPPORTED_MODELS = ['gpt-6-astra', 'gpt-6.1-sol', 'gpt-6-luna'] as const

export interface ChatGptCredential {
  access: string
  refresh: string
  expires: number
  accountId: string
}

interface TokenResponse {
  access_token?: string
  refresh_token?: string
  expires_in?: number
}

function authFilePath(dir: string): string {
  return join(dir, 'ai', 'chatgpt-auth.json')
}

export function usableChatGptModel(requested?: string): string {
  return requested && (CHATGPT_SUPPORTED_MODELS as readonly string[]).includes(requested)
    ? requested
    : CHATGPT_DEFAULT_MODEL
}

function base64Url(bytes: Buffer): string {
  return bytes.toString('base64url')
}

export function buildChatGptAuthorizeUrl(state: string, challenge: string): string {
  const url = new URL(AUTHORIZE_URL)
  url.search = new URLSearchParams({
    response_type: 'code',
    client_id: CLIENT_ID,
    redirect_uri: CHATGPT_REDIRECT_URI,
    scope: SCOPE,
    code_challenge: challenge,
    code_challenge_method: 'S256',
    state,
    id_token_add_organizations: 'true',
    codex_cli_simplified_flow: 'true',
    originator: ORIGINATOR,
  }).toString()
  return url.toString()
}

export function decodeChatGptAccountId(accessToken: string): string | null {
  const payload = accessToken.split('.')[1]
  if (!payload) return null
  try {
    const json = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as Record<string, unknown>
    const auth = json[JWT_CLAIM_PATH]
    if (!auth || typeof auth !== 'object') return null
    const accountId = (auth as { chatgpt_account_id?: unknown }).chatgpt_account_id
    return typeof accountId === 'string' && accountId ? accountId : null
  } catch {
    return null
  }
}

function credentialFromToken(token: TokenResponse): ChatGptCredential {
  if (!token.access_token || !token.refresh_token || !token.expires_in) {
    throw new Error('ChatGPT token 响应缺少 access_token / refresh_token / expires_in')
  }
  const accountId = decodeChatGptAccountId(token.access_token)
  if (!accountId) throw new Error('无法从 ChatGPT token 中读取 account id')
  return {
    access: token.access_token,
    refresh: token.refresh_token,
    expires: Date.now() + token.expires_in * 1000,
    accountId,
  }
}

async function fetchAuth(url: string, init: RequestInit): Promise<Response> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 15_000)
  try {
    return await fetch(url, { ...init, signal: controller.signal })
  } catch (error) {
    if (controller.signal.aborted) throw new Error('ChatGPT 认证请求超时，请检查网络后重试')
    throw error
  } finally {
    clearTimeout(timer)
  }
}

async function exchangeCode(code: string, verifier: string): Promise<ChatGptCredential> {
  const response = await fetchAuth(TOKEN_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      client_id: CLIENT_ID,
      code,
      code_verifier: verifier,
      redirect_uri: CHATGPT_REDIRECT_URI,
    }),
  })
  if (!response.ok) {
    const body = await response.text().catch(() => '')
    throw new Error(`ChatGPT token exchange failed (${response.status}): ${body}`)
  }
  return credentialFromToken(await response.json() as TokenResponse)
}

async function refreshCredential(refreshToken: string): Promise<ChatGptCredential> {
  const response = await fetchAuth(TOKEN_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
      client_id: CLIENT_ID,
    }),
  })
  if (!response.ok) {
    const body = await response.text().catch(() => '')
    throw new Error(`ChatGPT token refresh failed (${response.status}): ${body}`)
  }
  return credentialFromToken(await response.json() as TokenResponse)
}

async function readCredential(dir: string): Promise<ChatGptCredential | null> {
  const file = authFilePath(dir)
  if (!existsSync(file)) return null
  try {
    const raw = JSON.parse(await readFile(file, 'utf8')) as Partial<ChatGptCredential>
    if (
      typeof raw.access !== 'string' ||
      typeof raw.refresh !== 'string' ||
      typeof raw.expires !== 'number' ||
      typeof raw.accountId !== 'string'
    ) return null
    return { access: raw.access, refresh: raw.refresh, expires: raw.expires, accountId: raw.accountId }
  } catch {
    return null
  }
}

async function saveCredential(credential: ChatGptCredential, dir: string): Promise<void> {
  await mkdir(join(dir, 'ai'), { recursive: true })
  await writeFile(authFilePath(dir), JSON.stringify(credential, null, 2), {
    encoding: 'utf8',
    mode: 0o600,
  })
}

let loginInFlight: Promise<ChatGptCredential> | null = null
let refreshInFlight: Promise<ChatGptCredential> | null = null
let cancelActiveLogin: (() => void) | null = null
// 退出登录或重新登录后，旧的在途刷新/登录结果不能再写回凭据文件。
let authEpoch = 0

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  })[char] ?? char)
}

function callbackPage(ok: boolean, message: string): string {
  return `<!doctype html><html><head><meta charset="utf-8"><title>Montree</title>
    <style>body{font:16px system-ui,sans-serif;display:grid;place-items:center;height:100vh;margin:0;background:#fafafa;color:#18181b}</style>
    </head><body><main><h1>${ok ? 'ChatGPT 登录成功' : 'ChatGPT 登录失败'}</h1><p>${escapeHtml(message)}</p><p>可以关闭此页面，回到 Montree。</p></main></body></html>`
}

export async function loginChatGpt(openUrl: (url: string) => Promise<void>, dir = app.getPath('userData')): Promise<ChatGptCredential> {
  if (loginInFlight) return loginInFlight
  const epoch = ++authEpoch
  loginInFlight = (async () => {
    const verifier = base64Url(randomBytes(32))
    const challenge = base64Url(createHash('sha256').update(verifier).digest())
    const state = randomBytes(16).toString('hex')
    const authorizeUrl = buildChatGptAuthorizeUrl(state, challenge)

    let resolveCode!: (code: string) => void
    let rejectCode!: (error: Error) => void
    const codePromise = new Promise<string>((resolve, reject) => {
      resolveCode = resolve
      rejectCode = reject
    })
    let settled = false
    const server = createServer((request, response) => {
      // 仅接受本机回调；即使端口被局域网访问也不能伪造授权码。
      const remote = request.socket.remoteAddress
      if (remote && !['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(remote)) {
        response.writeHead(404).end()
        return
      }
      const url = new URL(request.url ?? '/', CHATGPT_REDIRECT_URI)
      if (url.pathname !== '/auth/callback') {
        response.writeHead(404).end()
        return
      }
      const error = url.searchParams.get('error')
      const code = url.searchParams.get('code')
      if (error) {
        response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }).end(callbackPage(false, error))
        if (!settled) { settled = true; rejectCode(new Error(`ChatGPT 登录失败：${error}`)) }
        return
      }
      if (url.searchParams.get('state') !== state || !code) {
        response.writeHead(400, { 'content-type': 'text/html; charset=utf-8' }).end(callbackPage(false, 'state 校验失败或缺少授权码'))
        if (!settled) { settled = true; rejectCode(new Error('ChatGPT 登录 state 校验失败')) }
        return
      }
      response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }).end(callbackPage(true, '已完成授权。'))
      if (!settled) { settled = true; resolveCode(code) }
    })

    await new Promise<void>((resolve, reject) => {
      server.once('error', (error: NodeJS.ErrnoException) => {
        reject(error.code === 'EADDRINUSE'
          ? new Error('ChatGPT 登录端口 1455 被占用，请先退出 Codex CLI 或占用该端口的程序')
          : error)
      })
      server.listen(CALLBACK_PORT, resolve)
    })
    const timer = setTimeout(() => {
      if (settled) return
      settled = true
      rejectCode(new Error('ChatGPT 登录超时，请重试'))
    }, LOGIN_TIMEOUT_MS)
    cancelActiveLogin = () => {
      if (settled) return
      settled = true
      rejectCode(new Error('ChatGPT 登录已取消'))
    }

    try {
      await openUrl(authorizeUrl)
      const code = await codePromise
      const credential = await exchangeCode(code, verifier)
      if (epoch !== authEpoch) throw new Error('ChatGPT 登录已取消')
      await saveCredential(credential, dir)
      return credential
    } finally {
      cancelActiveLogin = null
      clearTimeout(timer)
      server.close()
    }
  })()
  try {
    return await loginInFlight
  } finally {
    loginInFlight = null
  }
}

export async function getValidChatGptCredential(dir = app.getPath('userData')): Promise<ChatGptCredential> {
  const stored = await readCredential(dir)
  if (!stored) throw new Error('ChatGPT 未登录')
  if (stored.expires - Date.now() > REFRESH_MARGIN_MS) return stored

  if (!refreshInFlight) {
    const epoch = authEpoch
    refreshInFlight = (async () => {
      const latest = await readCredential(dir)
      if (!latest) throw new Error('ChatGPT 未登录')
      if (latest.expires - Date.now() > REFRESH_MARGIN_MS) return latest
      const refreshed = await refreshCredential(latest.refresh)
      if (epoch !== authEpoch) throw new Error('ChatGPT 登录状态已变更')
      await saveCredential(refreshed, dir)
      return refreshed
    })().finally(() => { refreshInFlight = null })
  }
  return refreshInFlight
}

export async function getChatGptAuthStatus(dir = app.getPath('userData')): Promise<ChatGptAuthStatus> {
  const stored = await readCredential(dir)
  return stored
    ? { configured: true, accountId: stored.accountId, expiresAt: stored.expires, models: [...CHATGPT_SUPPORTED_MODELS] }
    : { configured: false, models: [...CHATGPT_SUPPORTED_MODELS] }
}

export async function logoutChatGpt(dir = app.getPath('userData')): Promise<ChatGptAuthStatus> {
  authEpoch++
  cancelActiveLogin?.()
  await rm(authFilePath(dir), { force: true })
  return getChatGptAuthStatus(dir)
}
