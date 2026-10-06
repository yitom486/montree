import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { delimiter, dirname, join, posix, win32 } from 'node:path'
import { promisify } from 'node:util'
import {
  err,
  ok,
  AGY_ACP_NPM_PACKAGE,
  type AcpAuthMethod,
  type AgyCliStatus,
  type AppError,
  type CodexAuthPreflight,
  type Result,
} from '@montree/contracts'
import type { GenericRuntimeAdapter } from '../index'

const execFileAsync = promisify(execFile)

export interface AgyPathOverrides {
  platform?: NodeJS.Platform
  env?: NodeJS.ProcessEnv
  home?: string
  existsSync?: (path: string) => boolean
}

function agyLocalAppData(env: NodeJS.ProcessEnv, platform: NodeJS.Platform = process.platform): string {
  const pathLib = platform === 'win32' ? win32 : posix
  const local = env.LOCALAPPDATA?.trim()
  if (local) return local
  const profile = env.USERPROFILE?.trim()
  return profile ? pathLib.join(profile, 'AppData', 'Local') : ''
}

function isAgyOnPath(
  command: string,
  env: NodeJS.ProcessEnv,
  platform: NodeJS.Platform,
  existsFn: (p: string) => boolean = existsSync,
): boolean {
  const pathLib = platform === 'win32' ? win32 : posix
  const pathValue = env.PATH ?? env.Path ?? ''
  if (!pathValue.trim()) return false
  const sep = platform === 'win32' ? ';' : delimiter
  for (const dir of pathValue.split(sep)) {
    const trimmed = dir.trim().replace(/^"|"$/g, '')
    if (!trimmed) continue
    try {
      if (existsFn(pathLib.join(trimmed, command))) return true
    } catch {
      // 容错继续下一条
    }
  }
  return false
}

/**
 * 全路径探测 Antigravity CLI (agy) 可执行文件：
 * 1. 显式 AGY_BIN 环境变量优先；
 * 2. 系统 PATH 中的 agy[.exe]；
 * 3. 常见默认安装路径（Windows: %LOCALAPPDATA%\agy\bin\agy.exe, ~/.gemini/bin/agy.exe；POSIX: ~/.local/bin/agy 等）。
 */
export function resolveAgyCliBin(overrides?: AgyPathOverrides): string | null {
  const platform = overrides?.platform ?? process.platform
  const env = overrides?.env ?? process.env
  const existsFn = overrides?.existsSync ?? existsSync
  const home = overrides?.home ?? env.USERPROFILE ?? env.HOME ?? homedir()

  // 1. 显式环境变量
  const rawBin = env.AGY_BIN?.trim()
  if (rawBin) {
    try {
      if (existsFn(rawBin)) return rawBin
    } catch {}
  }

  const binaryName = platform === 'win32' ? 'agy.exe' : 'agy'

  // 2. 系统 PATH
  if (isAgyOnPath(binaryName, env, platform, existsFn)) {
    return binaryName
  }

  // 3. 平台常见路径
  const pathLib = platform === 'win32' ? win32 : posix
  const candidates: string[] = []
  if (platform === 'win32') {
    const localAppData = agyLocalAppData(env, platform)
    if (localAppData) {
      candidates.push(pathLib.join(localAppData, 'agy', 'bin', 'agy.exe'))
    }
    candidates.push(pathLib.join(home, '.gemini', 'bin', 'agy.exe'))
    candidates.push(pathLib.join(home, '.local', 'bin', 'agy.exe'))
    const programFiles = env.ProgramFiles?.trim()
    if (programFiles) {
      candidates.push(pathLib.join(programFiles, 'Google', 'Antigravity', 'bin', 'agy.exe'))
    }
  } else {
    candidates.push(pathLib.join(home, '.local', 'bin', 'agy'))
    candidates.push(pathLib.join(home, '.gemini', 'bin', 'agy'))
    candidates.push('/usr/local/bin/agy')
    candidates.push('/opt/homebrew/bin/agy')
  }

  for (const candidate of candidates) {
    try {
      if (existsFn(candidate)) return candidate
    } catch {}
  }

  return null
}

/** 注入运行时环境变量（自动附加 AGY_BIN 与补全 PATH） */
export function resolveAgyRuntimeEnv(overrides?: AgyPathOverrides): Record<string, string> {
  const bin = resolveAgyCliBin(overrides)
  if (!bin) return {}
  const platform = overrides?.platform ?? process.platform
  const pathLib = platform === 'win32' ? win32 : posix
  const env = overrides?.env ?? process.env
  const sep = platform === 'win32' ? ';' : delimiter
  const existingPath = env.PATH ?? env.Path ?? ''

  // 如果解析到的是完整路径且不是 PATH 中的纯命令名，补全 AGY_BIN 并注入 PATH
  if (bin.includes('/') || bin.includes('\\')) {
    const binDir = pathLib.dirname(bin)
    const newPath = existingPath.includes(binDir) ? existingPath : `${binDir}${sep}${existingPath}`
    // 同步更新主进程自身环境变量
    if (!overrides) {
      process.env.AGY_BIN = bin
      process.env.PATH = newPath
    }
    return {
      AGY_BIN: bin,
      PATH: newPath,
    }
  }
  return { AGY_BIN: bin }
}

/**
 * 预 spawn 接线：未安装返回 null 由连接层转友善中文提示，
 * 已安装返回 undefined 沿用模板（bunx -y @yitom/agy-acp-map@latest 直调桥入口）。
 */
export function resolveAgySpawnCommand(
  overrides?: AgyPathOverrides,
): { command: string; args: string[] } | null {
  const bin = resolveAgyCliBin(overrides)
  if (!bin) return null
  resolveAgyRuntimeEnv(overrides)
  return {
    command: 'bunx',
    args: ['-y', `${AGY_ACP_NPM_PACKAGE}@latest`],
  }
}

/** 未安装时的用户可读指引（分 win/posix 话术） */
export function buildAgyMissingCliMessage(overrides?: AgyPathOverrides): string {
  const platform = overrides?.platform ?? process.platform
  if (platform === 'win32') {
    return 'Antigravity CLI (agy) 未安装：请点击下方一键安装，或在终端执行 irm https://antigravity.google/cli/install.ps1 | iex 后重试（已安装请确认 agy 在 PATH，或 %LOCALAPPDATA%\\agy\\bin\\agy.exe 存在）'
  }
  return 'Antigravity CLI (agy) 未安装：请点击下方一键安装，或在终端执行 curl -fsSL https://antigravity.google/cli/install.sh | bash 后重试（已安装请确认 agy 在 PATH，或 ~/.local/bin/agy 存在）'
}

/** 将 bin 目录持久化追加到 Windows 用户级 PATH（免重启终端） */
export async function ensureAgyInSystemPath(binDir: string): Promise<void> {
  if (process.platform !== 'win32') return
  try {
    const script = `
$dir = '${binDir.replace(/'/g, "''")}';
$current = [System.Environment]::GetEnvironmentVariable('Path', 'User');
if ($current -notlike "*$dir*") {
  $newPath = if ([string]::IsNullOrWhiteSpace($current)) { $dir } else { "$current;$dir" };
  [System.Environment]::SetEnvironmentVariable('Path', $newPath, 'User');
}
`
    await execFileAsync(
      'powershell.exe',
      ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', script],
      { timeout: 15_000, windowsHide: true },
    )
  } catch (error) {
    console.warn('[acp:agy] 持久化用户 PATH 失败，已在内存中生效', error)
  }
}

/** 探测本机 Antigravity CLI 状态与版本 */
export async function probeAgyCli(overrides?: AgyPathOverrides): Promise<AgyCliStatus> {
  const bin = resolveAgyCliBin(overrides)
  if (!bin) {
    return { installed: false }
  }
  let version: string | undefined
  try {
    const { stdout } = await execFileAsync(bin, ['--version'], {
      timeout: 5_000,
      windowsHide: true,
    })
    version = stdout.trim() || undefined
  } catch {
    version = undefined
  }
  return {
    installed: true,
    version,
    path: bin,
  }
}

/** 一键安装 Antigravity CLI (agy) */
export async function installAgyCli(): Promise<Result<AgyCliStatus, AppError>> {
  const current = await probeAgyCli()
  if (current.installed) {
    return ok(current)
  }

  try {
    if (process.platform === 'win32') {
      await execFileAsync(
        'powershell.exe',
        [
          '-NoProfile',
          '-ExecutionPolicy',
          'Bypass',
          '-Command',
          'irm https://antigravity.google/cli/install.ps1 | iex',
        ],
        { timeout: 300_000, windowsHide: true },
      )
    } else {
      await execFileAsync(
        'bash',
        ['-lc', 'curl -fsSL https://antigravity.google/cli/install.sh | bash'],
        { timeout: 300_000 },
      )
    }
  } catch (cause) {
    const message =
      cause instanceof Error
        ? cause.message
        : 'Antigravity CLI 安装脚本执行失败，请访问 https://antigravity.google 手动安装'
    return err({ code: 'ACP_SPAWN_ERROR', message })
  }

  const after = await probeAgyCli()
  if (!after.installed || !after.path) {
    return err({
      code: 'ACP_SPAWN_ERROR',
      message: '安装脚本已执行，但未能在默认路径中定位到 agy 可执行文件。请尝试重启应用或手动安装。',
    })
  }

  // 持久化写入系统用户环境变量 PATH，并更新当前进程
  if (after.path.includes('/') || after.path.includes('\\')) {
    const binDir = dirname(after.path)
    await ensureAgyInSystemPath(binDir)
    process.env.AGY_BIN = after.path
    const sep = process.platform === 'win32' ? ';' : delimiter
    const existing = process.env.PATH ?? ''
    if (!existing.includes(binDir)) {
      process.env.PATH = `${binDir}${sep}${existing}`
    }
  }

  return ok(after)
}

export function probeAgyAuth(): CodexAuthPreflight {
  return {
    codexHome: '',
    hasCodexHome: false,
    hasAuthFile: false,
    hasApiKeyEnv: false,
    looksLoggedIn: false,
  }
}

export const agyAdapter: GenericRuntimeAdapter = {
  id: 'agy',
  probeAuth: () => probeAgyAuth(),
  resolveSpawnCommand: () => resolveAgySpawnCommand(),
  orderAuthMethods: (methods: AcpAuthMethod[]) => methods,
  canSkipInteractiveAuth: () => false,
  tryDirectSessionFirst: true,
}
