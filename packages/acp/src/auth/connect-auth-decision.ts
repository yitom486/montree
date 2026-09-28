import type { AcpAuthMethod } from "../contracts"
import type { CodexAuthPreflight } from "../contracts"
import { orderSilentAuthMethodIds, shouldPromptAuthWizard } from './auth-method-order'

export type ConnectAuthDecision =
  | { action: 'skip_auth' }
  | { action: 'needs_auth'; methods: AcpAuthMethod[] }
  | { action: 'silent'; methodIds: string[] }

/**
 * 连接阶段认证决策（纯函数，便于单测 / 后续 E2E mock 对齐）。
 * - 无 authMethods → 跳过
 * - 未登录 → 弹向导（方法按偏好排序）
 * - 已登录 → 静默按序尝试 methodIds
 */
export function decideConnectAuth(
  methods: AcpAuthMethod[],
  preflight: Pick<CodexAuthPreflight, 'looksLoggedIn' | 'hasAuthFile' | 'hasApiKeyEnv'>,
): ConnectAuthDecision {
  if (methods.length === 0) return { action: 'skip_auth' }

  const orderedIds = orderSilentAuthMethodIds(methods, preflight)
  const ordered = orderedIds
    .map((id) => methods.find((m) => m.id === id))
    .filter((m): m is AcpAuthMethod => Boolean(m))

  if (shouldPromptAuthWizard(methods, preflight)) {
    return { action: 'needs_auth', methods: ordered.length > 0 ? ordered : methods }
  }

  return { action: 'silent', methodIds: orderedIds }
}
