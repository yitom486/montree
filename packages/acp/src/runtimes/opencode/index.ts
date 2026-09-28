import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import type { AcpAuthMethod, CodexAuthPreflight } from '@inkdown/contracts'
import type { GenericRuntimeAdapter } from '../index'

/**
 * OpenCode 运行时适配器（本机 `opencode acp`）。
 *
 * 凭证复用：`opencode auth login` 写入的 `auth.json`（legacy 位置；
 * v2 起凭据已迁 SQLite，auth.json 仅作兼容残留）。
 * 探测顺序：`$XDG_DATA_HOME/opencode/auth.json`（XDG 优先，含 Windows）
 * ＞ Windows `%LOCALAPPDATA%\\opencode\\auth.json`
 * ＞ Windows `%USERPROFILE%\.local\share\opencode\auth.json`（回落；
 * posix 下为 `~/.local/share/opencode/auth.json`）。
 * 注意：旧实现曾误用 `%APPDATA%\\opencode\\auth.json`（Roaming），
 * 与 opencode 文档/社区 issue 确认的实际落盘位置不符，已修正。
 * 另有空白文件损坏先例：文件存在但去空白后为空、JSON 不可解析、
 * 或解析后无任何 key 时，一律按未登录处理，只做布尔级探测，不读密钥内容。
 * 环境变量无需探测：spawn 继承父进程 env，透传天然生效。
 */
export interface OpencodePathOverrides {
  platform?: NodeJS.Platform
  env?: NodeJS.ProcessEnv
  home?: string
}

function pickEnv(env: NodeJS.ProcessEnv | undefined, key: string): string {
  return env?.[key]?.trim() ?? ''
}

export function resolveOpencodeAuthCandidates(overrides?: OpencodePathOverrides): string[] {
  const platform = overrides?.platform ?? process.platform
  const env = overrides?.env ?? process.env
  const home = overrides?.home ?? homedir()
  const seen = new Set<string>()
  const out: string[] = []
  const push = (p: string) => {
    if (!p || seen.has(p)) return
    seen.add(p)
    out.push(p)
  }

  const xdg = pickEnv(env, 'XDG_DATA_HOME')
  if (xdg) push(join(xdg, 'opencode', 'auth.json'))

  if (platform === 'win32') {
    const localAppData =
      pickEnv(env, 'LOCALAPPDATA') ||
      (pickEnv(env, 'USERPROFILE') ? join(pickEnv(env, 'USERPROFILE'), 'AppData', 'Local') : '')
    if (localAppData) push(join(localAppData, 'opencode', 'auth.json'))
    const userProfile = pickEnv(env, 'USERPROFILE') || home
    if (userProfile) push(join(userProfile, '.local', 'share', 'opencode', 'auth.json'))
  } else if (home) {
    push(join(home, '.local', 'share', 'opencode', 'auth.json'))
  }
  return out
}

export function resolveOpencodeAuthFile(): string {
  return resolveOpencodeAuthCandidates()[0] ?? join(homedir(), '.local', 'share', 'opencode', 'auth.json')
}

/** 空白/损坏/空对象一律判无效：存在 ≠ 已登录。 */
export function isValidOpencodeAuthFile(authFile: string): boolean {
  try {
    if (!authFile || !existsSync(authFile)) return false
    const raw = readFileSync(authFile, 'utf8').trim()
    if (!raw) return false
    const parsed: unknown = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object') return false
    return Object.keys(parsed).length > 0
  } catch {
    return false
  }
}

export function probeOpencodeAuth(overrides?: OpencodePathOverrides): CodexAuthPreflight {
  const candidates = resolveOpencodeAuthCandidates(overrides)
  let firstExisting: string | null = null
  let validFile: string | null = null
  for (const candidate of candidates) {
    let exists = false
    try {
      exists = existsSync(candidate)
    } catch {
      exists = false
    }
    if (!exists) continue
    firstExisting ??= candidate
    if (validFile) continue
    if (isValidOpencodeAuthFile(candidate)) validFile = candidate
  }

  const authFile = validFile ?? firstExisting ?? candidates[0] ?? resolveOpencodeAuthFile()
  const authDir = dirname(authFile)
  let hasCodexHome = false
  try {
    hasCodexHome = existsSync(authDir)
  } catch {
    hasCodexHome = false
  }
  const hasAuthFile = firstExisting !== null

  return {
    codexHome: authDir,
    hasCodexHome,
    hasAuthFile,
    hasApiKeyEnv: false,
    looksLoggedIn: validFile !== null,
  }
}

export const opencodeAdapter: GenericRuntimeAdapter = {
  id: 'opencode',
  probeAuth: () => probeOpencodeAuth(),
  orderAuthMethods: (methods: AcpAuthMethod[]) => methods,
  canSkipInteractiveAuth: () => false,
  // v2 已迁 SQLite，文件探针同样会漏检，未命中时由 gate 直连试一次兜底
  tryDirectSessionFirst: true,
}
