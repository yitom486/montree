import type { AcpAuthMethod } from "../contracts"
import type { CodexAuthPreflight } from "../contracts"
import { decideConnectAuth } from './connect-auth-decision'

export type ConnectAuthGateResult =
  | { outcome: 'skip_auth' }
  | { outcome: 'needs_auth'; methods: AcpAuthMethod[] }
  | { outcome: 'authenticated'; methodId: string }
  /** 静默认证全失败，但 session/new 仍可用（部分 Agent 允许无显式 authenticate） */
  | { outcome: 'session_without_auth' }

export interface ConnectAuthGateDeps {
  authenticate: (methodId: string) => Promise<void>
  /** 静默认证全失败后的兜底；返回 true 表示已建会话 */
  tryOpenSessionWithoutAuth?: () => Promise<boolean>
  /**
   * 是否优先尝试直接建立会话复用本机认证（例如 codex-acp 本地已有 auth.json 时 session/new 即可复用，避免 authenticate 唤起浏览器）
   */
  preferDirectSession?: boolean
  /**
   * keychain 化兜底（cursor / opencode）：文件探针未命中不断言未登录，
   * 在 needs_auth 分支前先试一次直接建会话，成功则免弹向导。
   * 缺省视为 false，其余 runtime 不动。
   */
  tryDirectSessionFirst?: boolean
}

/**
 * 连接阶段认证门闩（mock Agent + preflight 可测）。
 * 对齐：有 auth.json → 静默复用；无登录痕迹 → 弹向导。
 */
export async function runConnectAuthGate(
  authMethods: AcpAuthMethod[],
  preflight: Pick<CodexAuthPreflight, 'looksLoggedIn' | 'hasAuthFile' | 'hasApiKeyEnv'>,
  deps: ConnectAuthGateDeps,
): Promise<ConnectAuthGateResult> {
  const decision = decideConnectAuth(authMethods, preflight)

  if (decision.action === 'skip_auth') {
    return { outcome: 'skip_auth' }
  }

  if (decision.action === 'needs_auth') {
    // keychain 化兜底：探针未命中也先试一次直接建会话（cursor / opencode 置 true），
    // 成功→免弹向导，失败/抛错→照旧回落 needs_auth。
    if (deps.tryDirectSessionFirst && deps.tryOpenSessionWithoutAuth) {
      try {
        if (await deps.tryOpenSessionWithoutAuth()) {
          return { outcome: 'session_without_auth' }
        }
      } catch {
        // 直连失败说明本地凭据不可用，回落向导
      }
      return { outcome: 'needs_auth', methods: decision.methods }
    }
    return { outcome: 'needs_auth', methods: decision.methods }
  }

  // 若指定优先直接建会话（如 codex-acp 且检测到已登录），优先直接开会话复用凭据，避免 authenticate 唤起浏览器
  if (deps.preferDirectSession && preflight.looksLoggedIn && deps.tryOpenSessionWithoutAuth) {
    try {
      if (await deps.tryOpenSessionWithoutAuth()) {
        return { outcome: 'session_without_auth' }
      }
    } catch {
      // 失败则说明本地凭据失效，直接转入待认证向导，避免无提示弹浏览器
      return { outcome: 'needs_auth', methods: authMethods }
    }
    return { outcome: 'needs_auth', methods: authMethods }
  }

  for (const methodId of decision.methodIds) {
    try {
      await deps.authenticate(methodId)
      return { outcome: 'authenticated', methodId }
    } catch {
      // 尝试下一方式
    }
  }

  if (deps.tryOpenSessionWithoutAuth) {
    try {
      if (await deps.tryOpenSessionWithoutAuth()) {
        return { outcome: 'session_without_auth' }
      }
    } catch {
      // fall through
    }
  }

  return { outcome: 'needs_auth', methods: authMethods }
}
