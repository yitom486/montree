import type { AcpAuthMethod } from "../contracts"
import type { CodexAuthPreflight } from "../contracts"

function methodKey(method: AcpAuthMethod): string {
  return `${method.id} ${method.type ?? ''} ${method.name ?? ''}`.toLowerCase()
}

function isChatGptMethod(method: AcpAuthMethod): boolean {
  return /chatgpt|openai|google|oauth|subscription|login/.test(methodKey(method))
}

function isApiKeyMethod(method: AcpAuthMethod): boolean {
  return /api[_-]?key|token|env/.test(methodKey(method))
}

/**
 * 已有本机登录时，静默 authenticate 的尝试顺序。
 * auth.json → 优先 ChatGPT；环境变量 API Key → 优先 API Key。
 * 避免「列表第一项是 API Key」却已有 ChatGPT 登录时误弹窗。
 */
export function orderSilentAuthMethodIds(
  methods: AcpAuthMethod[],
  preflight: Pick<CodexAuthPreflight, 'hasAuthFile' | 'hasApiKeyEnv' | 'looksLoggedIn'>,
): string[] {
  if (methods.length === 0) return []

  const score = (method: AcpAuthMethod): number => {
    const id = method.id.toLowerCase()
    // OAuth 个人账号优先，企业账号排后
    if (id === 'oauth-personal') return 0
    if (id === 'oauth-business') return 2
    if (id === 'gemini-api-key') return preflight.hasApiKeyEnv ? 1 : 4

    const chatgpt = isChatGptMethod(method)
    const apiKey = isApiKeyMethod(method)
    if (preflight.hasAuthFile && chatgpt) return 0
    if (preflight.hasApiKeyEnv && apiKey) return 1
    if (preflight.hasAuthFile && apiKey) return 8
    if (preflight.hasApiKeyEnv && chatgpt) return 8
    if (chatgpt) return 3
    if (apiKey) return 4
    return 5
  }

  return [...methods]
    .sort((a, b) => score(a) - score(b) || a.id.localeCompare(b.id))
    .map((m) => m.id)
}

export function shouldPromptAuthWizard(
  methods: AcpAuthMethod[],
  preflight: Pick<CodexAuthPreflight, 'looksLoggedIn'>,
): boolean {
  return methods.length > 0 && !preflight.looksLoggedIn
}
