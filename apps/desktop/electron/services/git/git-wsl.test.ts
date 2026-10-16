/**
 * B3 WSL 真机 Git 验证（Ubuntu 内真实执行，无真实远端 push）。
 *
 * - 有 WSL/Ubuntu 时跑：经 `\\wsl.localhost\Ubuntu` 映射由 git-service 的
 *   wsl.exe 穿透执行 git（status/diff/branch/commit），断言行为与本机一致。
 * - 无 WSL 时整组 skip（B 分支若无 WSL 只做单测/协议级验证，此处即该门控）。
 * - 身份经仓库本地 `git config` 注入（不碰全局/系统配置）；只清理本测试目录。
 */
import { spawnSync } from 'node:child_process'
import { afterEach, describe, expect, it } from 'vitest'
import {
  getGitDiff,
  getGitStatus,
  gitCommit,
  listGitBranches,
} from './git-service'
import { decodeWslBuffer } from '../remote/remote-service'

function wslAvailable(): boolean {
  if (process.platform !== 'win32') return false
  try {
    const res = spawnSync('wsl.exe', ['-l', '-v'], { windowsHide: true, timeout: 10000 })
    if (res.error || res.status !== 0 || !res.stdout) return false
    // wsl.exe 常见 UTF-16LE 输出，直接 utf8 判会漏检（见 decodeWslBuffer）
    if (!decodeWslBuffer(res.stdout).includes('Ubuntu')) return false
    // 注册发行版不代表当前能启动并执行 Git（例如 WSL 服务不可用）。
    const probe = spawnSync('wsl.exe', ['-d', 'Ubuntu', '--exec', 'sh', '-c', 'command -v git'], {
      windowsHide: true,
      timeout: 10000,
    })
    return !probe.error && probe.status === 0
  } catch {
    return false
  }
}

const CAN_RUN = wslAvailable()

function wslSh(script: string): { exit: number; stdout: string; stderr: string } {
  const res = spawnSync('wsl.exe', ['-d', 'Ubuntu', '--exec', 'sh', '-c', script], {
    windowsHide: true,
    timeout: 30000,
    encoding: 'utf8',
  })
  return { exit: res.status ?? -1, stdout: String(res.stdout ?? ''), stderr: String(res.stderr ?? '') }
}

function toUnc(linuxPath: string): string {
  return `\\\\wsl.localhost\\Ubuntu${linuxPath.replace(/\//g, '\\')}`
}

describe.skipIf(!CAN_RUN)('B3 WSL 真机 Git（Ubuntu 执行）', () => {
  const linuxDirs: string[] = []
  const savedEnv: Record<string, string | undefined> = {}
  for (const key of ['GIT_AUTHOR_NAME', 'GIT_AUTHOR_EMAIL', 'GIT_COMMITTER_NAME', 'GIT_COMMITTER_EMAIL']) {
    savedEnv[key] = process.env[key]
    process.env[key] = key.includes('EMAIL') ? 'montree-test@example.com' : 'montree-test'
  }
  afterEach(() => {
    for (const [key, value] of Object.entries(savedEnv)) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
    for (const dir of linuxDirs.splice(0)) {
      wslSh(`rm -rf '${dir}'`)
    }
  })

  it('status/diff/branch/commit 在 Ubuntu 内执行（临时仓库，无 push）', async () => {
    const mk = wslSh(`mktemp -d /tmp/montree-gitwsl-XXXXXX`)
    expect(mk.exit).toBe(0)
    const linuxRoot = mk.stdout.trim()
    expect(linuxRoot.startsWith('/tmp/montree-gitwsl-')).toBe(true)
    linuxDirs.push(linuxRoot)
    const unc = toUnc(linuxRoot)

    expect(wslSh(`git init -b main '${linuxRoot}'`).exit).toBe(0)
    // 仓库本地身份（不碰全局配置）
    expect(wslSh(`git -C '${linuxRoot}' config user.name montree-test`).exit).toBe(0)
    expect(wslSh(`git -C '${linuxRoot}' config user.email montree-test@example.com`).exit).toBe(0)
    expect(wslSh(`printf 'hello\\n' > '${linuxRoot}/a.md'`).exit).toBe(0)

    const status1 = await getGitStatus(unc)
    expect(status1.isRepo).toBe(true)
    expect(status1.branch).toBe('main')
    expect(status1.files.some((f) => f.path === 'a.md' && f.status === 'untracked')).toBe(true)

    const commit = await gitCommit(unc, { message: 'init', stageAll: true })
    expect(commit.ok).toBe(true)

    expect(wslSh(`printf 'hello world\\n' > '${linuxRoot}/a.md'`).exit).toBe(0)
    const diff = await getGitDiff(unc, 'a.md')
    expect(diff.ok).toBe(true)
    if (diff.ok) {
      expect(diff.value.truncated).toBe(false)
      expect(diff.value.diff).toContain('hello world')
    }

    const branches = await listGitBranches(unc)
    expect(branches.ok).toBe(true)
    if (branches.ok) {
      expect(branches.value.current).toBe('main')
      expect(branches.value.branches).toContain('main')
      expect(branches.value.detached).toBe(false)
    }
    // 无真实远端 push：不断言 push，只验证无远端时 ahead/behind 为 0
    const status2 = await getGitStatus(unc)
    expect(status2.ahead).toBe(0)
    expect(status2.behind).toBe(0)
  }, 90000)
})
