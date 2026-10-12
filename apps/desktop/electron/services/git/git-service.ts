import { spawn } from 'node:child_process'
import { isWslPath, parseWslPath, ok, err, type Result, type AppError, type GitCommitOptions, type GitCommitResult, type GitFileStatus, type GitFileStatusCode, type GitPushOptions, type GitPushResult, type GitStatusResult } from '@montree/contracts'

export interface SpawnGitExecution {
  command: string
  args: string[]
  cwd?: string
}

/**
 * 根据传入的 cwd 路径决定是以原生 Windows 命令执行，还是穿透进入 WSL 内部执行 git。
 * 纯函数，可方便单测。
 */
export function resolveGitExecution(cwd: string, gitArgs: string[]): SpawnGitExecution {
  if (isWslPath(cwd)) {
    const parsed = parseWslPath(cwd)
    if (parsed.isWsl && parsed.distro) {
      const linuxCwd = parsed.linuxPath || '/'
      return {
        command: 'wsl.exe',
        args: ['-d', parsed.distro, '--cd', linuxCwd, '--exec', 'git', ...gitArgs],
      }
    }
  }

  return {
    command: 'git',
    args: gitArgs,
    cwd,
  }
}

/** 执行底层 Git 命令 */
export function execGitCommand(
  cwd: string,
  gitArgs: string[],
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  return new Promise((resolve) => {
    const execution = resolveGitExecution(cwd, gitArgs)
    let stdout = ''
    let stderr = ''

    try {
      const child = spawn(execution.command, execution.args, {
        cwd: execution.cwd,
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
      })

      child.stdout.setEncoding('utf8')
      child.stderr.setEncoding('utf8')

      child.stdout.on('data', (chunk) => {
        stdout += chunk
      })
      child.stderr.on('data', (chunk) => {
        stderr += chunk
      })

      child.on('error', (err) => {
        resolve({
          stdout,
          stderr: `${stderr} ${err.message}`.trim(),
          exitCode: -1,
        })
      })

      child.on('close', (code) => {
        resolve({
          stdout: stdout.trim(),
          stderr: stderr.trim(),
          exitCode: code ?? 0,
        })
      })
    } catch (e) {
      resolve({
        stdout: '',
        stderr: e instanceof Error ? e.message : String(e),
        exitCode: -1,
      })
    }
  })
}

/**
 * 解析 `git status --porcelain=v1 -uall` 的输出。
 * 纯函数，单测可测。
 */
export function parseGitPorcelain(raw: string): GitFileStatus[] {
  if (!raw || !raw.trim()) return []
  const lines = raw.split(/\r?\n/)
  const result: GitFileStatus[] = []

  for (const line of lines) {
    if (line.length < 3) continue
    const x = line[0] // 暂存区状态
    const y = line[1] // 工作区状态
    const filePath = line.slice(3).trim()

    let status: GitFileStatusCode = 'modified'
    let staged = false

    if (x === '?' && y === '?') {
      status = 'untracked'
      staged = false
    } else if (x === 'U' || y === 'U' || (x === 'A' && y === 'A') || (x === 'D' && y === 'D')) {
      status = 'conflict'
      staged = false
    } else if (x === 'D' || y === 'D') {
      status = 'deleted'
      staged = x === 'D' && y === ' '
    } else if (x === 'A' || y === 'A') {
      status = 'added'
      staged = x === 'A'
    } else if (x === 'R' || y === 'R') {
      status = 'renamed'
      staged = x === 'R'
    } else {
      status = 'modified'
      staged = x !== ' ' && x !== '?'
    }

    result.push({
      path: filePath,
      status,
      staged,
    })
  }

  return result
}

/**
 * 解析 `git rev-list --left-right --count HEAD...@{u}` 获取 ahead / behind 计数值。
 * 纯函数。
 */
export function parseGitAheadBehind(raw: string): { ahead: number; behind: number } {
  if (!raw || !raw.trim()) return { ahead: 0, behind: 0 }
  // 输出格式通常形如: "1\t2" 或 "1 2"（左 ahead，右 behind）
  const parts = raw.trim().split(/\s+/)
  if (parts.length >= 2) {
    const ahead = parseInt(parts[0], 10) || 0
    const behind = parseInt(parts[1], 10) || 0
    return { ahead, behind }
  }
  return { ahead: 0, behind: 0 }
}

/** 查询工作区 Git 状态 */
export async function getGitStatus(cwd: string): Promise<GitStatusResult> {
  // 1. 检查是否在 git 仓库中
  const checkRepo = await execGitCommand(cwd, ['rev-parse', '--is-inside-work-tree'])
  if (checkRepo.exitCode !== 0 || checkRepo.stdout !== 'true') {
    return {
      isRepo: false,
      branch: null,
      ahead: 0,
      behind: 0,
      files: [],
      totalChanges: 0,
    }
  }

  // 2. 取当前分支名
  const branchRes = await execGitCommand(cwd, ['branch', '--show-current'])
  let branch: string | null = branchRes.stdout.trim() || null
  if (!branch) {
    // 游离 HEAD，尝试取当前 commit hash
    const headRes = await execGitCommand(cwd, ['rev-parse', '--short', 'HEAD'])
    branch = headRes.stdout ? `(${headRes.stdout.trim()})` : null
  }

  // 3. 取改动文件列表
  const statusRes = await execGitCommand(cwd, ['status', '--porcelain=v1', '-uall'])
  const files = parseGitPorcelain(statusRes.stdout)

  // 4. 取 ahead / behind
  let ahead = 0
  let behind = 0
  const abRes = await execGitCommand(cwd, ['rev-list', '--left-right', '--count', 'HEAD...@{u}'])
  if (abRes.exitCode === 0) {
    const parsedAB = parseGitAheadBehind(abRes.stdout)
    ahead = parsedAB.ahead
    behind = parsedAB.behind
  }

  return {
    isRepo: true,
    branch,
    ahead,
    behind,
    files,
    totalChanges: files.length,
  }
}

/** 推送到远程仓库 */
export async function gitPush(
  cwd: string,
  options: GitPushOptions = {},
): Promise<Result<GitPushResult, AppError>> {
  const args = ['push']
  if (options.setUpstream && options.branch) {
    args.push('-u', options.remote ?? 'origin', options.branch)
  } else {
    if (options.remote) args.push(options.remote)
    if (options.branch) args.push(options.branch)
  }

  const res = await execGitCommand(cwd, args)
  if (res.exitCode !== 0) {
    const errorMsg = res.stderr || res.stdout || 'Git push 失败'
    return err({
      code: 'GIT_PUSH_FAILED',
      message: errorMsg,
    })
  }

  return ok({
    success: true,
    stdout: res.stdout || res.stderr,
  })
}

/** 提交修改 */
export async function gitCommit(
  cwd: string,
  options: GitCommitOptions,
): Promise<Result<GitCommitResult, AppError>> {
  if (!options.message || !options.message.trim()) {
    return err({
      code: 'INVALID_ARGUMENT',
      message: 'Commit message 不能为空',
    })
  }

  if (options.stageAll) {
    const addRes = await execGitCommand(cwd, ['add', '-A'])
    if (addRes.exitCode !== 0) {
      return err({
        code: 'GIT_ADD_FAILED',
        message: addRes.stderr || 'Git add 失败',
      })
    }
  }

  const commitRes = await execGitCommand(cwd, ['commit', '-m', options.message])
  if (commitRes.exitCode !== 0) {
    return err({
      code: 'GIT_COMMIT_FAILED',
      message: commitRes.stderr || commitRes.stdout || 'Git commit 失败',
    })
  }

  const hashRes = await execGitCommand(cwd, ['rev-parse', '--short', 'HEAD'])
  return ok({
    success: true,
    commitHash: hashRes.stdout.trim() || undefined,
    message: options.message,
  })
}
