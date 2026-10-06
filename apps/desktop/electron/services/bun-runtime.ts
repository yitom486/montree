import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { err, ok, type Result } from '@montree/contracts'
import type { AppError } from '@montree/contracts'
import type { BunRuntimeStatus } from '@montree/contracts'

/** Agent 通过 bunx 启动时，是否像「未安装 Bun」导致的错误 */
export function isLikelyBunMissingMessage(message: string): boolean {
  const lower = message.toLowerCase()
  if (!lower.includes('bun')) return false
  return (
    lower.includes('enoent') ||
    lower.includes('not found') ||
    lower.includes('not recognized') ||
    lower.includes('不是内部或外部命令') ||
    lower.includes('无法将') ||
    lower.includes('command not found') ||
    (lower.includes('spawn') && lower.includes('bun'))
  )
}

export function bunNotInstalledMessage(): string {
  return '未检测到 Bun。Agent 需通过 bunx 启动 Codex，请先安装 Bun（安装后请完全退出并重新打开 Montree）。'
}

const execFileAsync = promisify(execFile)

export type { BunRuntimeStatus }

export function runtimeCommandNeedsBun(command: string): boolean {
  return command === 'bunx' || command === 'bun'
}

async function runBunVersionCheck(): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync(
      process.platform === 'win32' ? 'cmd.exe' : 'sh',
      process.platform === 'win32' ? ['/d', '/s', '/c', 'bun --version'] : ['-lc', 'bun --version'],
      { timeout: 12_000, windowsHide: true },
    )
    const version = stdout.trim()
    return version || null
  } catch {
    return null
  }
}

export async function probeBunRuntime(): Promise<BunRuntimeStatus> {
  const version = await runBunVersionCheck()
  if (!version) {
    return { installed: false }
  }
  return { installed: true, version }
}

export async function ensureBunForCommand(command: string): Promise<Result<void, AppError>> {
  if (!runtimeCommandNeedsBun(command)) {
    return ok(undefined)
  }
  const status = await probeBunRuntime()
  if (status.installed) {
    return ok(undefined)
  }
  return err({
    code: 'BUN_NOT_INSTALLED',
    message: bunNotInstalledMessage(),
  })
}

export async function installBunRuntime(): Promise<Result<void, AppError>> {
  try {
    if (process.platform === 'win32') {
      await execFileAsync(
        'powershell.exe',
        [
          '-NoProfile',
          '-ExecutionPolicy',
          'Bypass',
          '-Command',
          'irm bun.sh/install.ps1 | iex',
        ],
        { timeout: 300_000, windowsHide: false },
      )
    } else {
      await execFileAsync('bash', ['-lc', 'curl -fsSL https://bun.sh/install | bash'], {
        timeout: 300_000,
      })
    }
  } catch (cause) {
    const message =
      cause instanceof Error
        ? cause.message
        : 'Bun 安装脚本执行失败，请访问 https://bun.sh 手动安装'
    return err({ code: 'BUN_NOT_INSTALLED', message })
  }

  const status = await probeBunRuntime()
  if (!status.installed) {
    return err({
      code: 'BUN_NOT_INSTALLED',
      message:
        '安装脚本已执行。若仍无法连接，请完全退出 Montree 后重试（或注销/重启以使 PATH 生效）。',
    })
  }

  return ok(undefined)
}

export function mapSpawnErrorToAppError(error: unknown, fallback: string): AppError {
  if (error instanceof Error) {
    const message = error.message
    if (isLikelyBunMissingMessage(message)) {
      return { code: 'BUN_NOT_INSTALLED', message: bunNotInstalledMessage() }
    }
    const code =
      message.includes('超时') || message.toLowerCase().includes('timeout')
        ? 'ACP_TIMEOUT'
        : message.includes('spawn') || message.includes('ENOENT')
          ? 'ACP_SPAWN_ERROR'
          : 'ACP_PROTOCOL_ERROR'
    return { code, message: message || fallback }
  }
  return { code: 'ACP_PROTOCOL_ERROR', message: fallback }
}
