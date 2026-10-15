import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  getGitDiff,
  getGitStatus,
  gitCommit,
  gitPush,
  isSafeGitDiffPath,
  listGitBranches,
  parseGitAheadBehind,
  parseGitBranchList,
  parseGitPorcelain,
  resolveGitExecution,
} from './git-service'
import { execGitCommand } from './git-service'

describe('git-service 纯逻辑测试', () => {
  it('resolveGitExecution 正确分流 Windows 与 WSL 命令执行', () => {
    // 1. 普通 Windows 路径
    const winRes = resolveGitExecution('D:\\project\\blog', ['status', '--short'])
    expect(winRes).toEqual({
      command: 'git',
      args: ['status', '--short'],
      cwd: 'D:\\project\\blog',
    })

    // 2. WSL UNC 路径
    const wslRes = resolveGitExecution('\\\\wsl.localhost\\Ubuntu\\home\\zheye\\my-blog', [
      'push',
      'origin',
      'main',
    ])
    expect(wslRes).toEqual({
      command: 'wsl.exe',
      args: ['-d', 'Ubuntu', '--cd', '/home/zheye/my-blog', '--exec', 'git', 'push', 'origin', 'main'],
    })

    // 3. wsl$ 路径
    const wslDollarRes = resolveGitExecution('\\\\wsl$\\Debian\\var\\www', ['status'])
    expect(wslDollarRes).toEqual({
      command: 'wsl.exe',
      args: ['-d', 'Debian', '--cd', '/var/www', '--exec', 'git', 'status'],
    })
  })

  it('parseGitPorcelain 正确解析 git status 输出状态与暂存区', () => {
    const raw = `
?? posts/new-post.md
 M posts/existing.md
M  posts/staged.md
A  images/banner.png
 D old-notes.md
UU merge-conflict.md
`
    const files = parseGitPorcelain(raw)
    expect(files).toHaveLength(6)

    expect(files[0]).toEqual({
      path: 'posts/new-post.md',
      status: 'untracked',
      staged: false,
    })

    expect(files[1]).toEqual({
      path: 'posts/existing.md',
      status: 'modified',
      staged: false,
    })

    expect(files[2]).toEqual({
      path: 'posts/staged.md',
      status: 'modified',
      staged: true,
    })

    expect(files[3]).toEqual({
      path: 'images/banner.png',
      status: 'added',
      staged: true,
    })

    expect(files[4]).toEqual({
      path: 'old-notes.md',
      status: 'deleted',
      staged: false,
    })

    expect(files[5]).toEqual({
      path: 'merge-conflict.md',
      status: 'conflict',
      staged: false,
    })
  })

  it('parseGitAheadBehind 正确提取领先/落后 commit 数量', () => {
    expect(parseGitAheadBehind('2\t0')).toEqual({ ahead: 2, behind: 0 })
    expect(parseGitAheadBehind('0 5\n')).toEqual({ ahead: 0, behind: 5 })
    expect(parseGitAheadBehind('3 4')).toEqual({ ahead: 3, behind: 4 })
    expect(parseGitAheadBehind('')).toEqual({ ahead: 0, behind: 0 })
  })

  it('isSafeGitDiffPath 拒绝绝对路径与穿越', () => {
    expect(isSafeGitDiffPath('posts/a.md')).toBe(true)
    expect(isSafeGitDiffPath('a.md')).toBe(true)
    expect(isSafeGitDiffPath('')).toBe(false)
    expect(isSafeGitDiffPath('/etc/passwd')).toBe(false)
    expect(isSafeGitDiffPath('D:/x/a.md')).toBe(false)
    expect(isSafeGitDiffPath('../outside.md')).toBe(false)
    expect(isSafeGitDiffPath('a/../../b.md')).toBe(false)
    expect(isSafeGitDiffPath('a.md\0')).toBe(false)
  })

  it('parseGitBranchList 去星号与空行', () => {
    expect(parseGitBranchList('main\n* dev\n\n  feature/x\n')).toEqual(['main', 'dev', 'feature/x'])
    expect(parseGitBranchList('')).toEqual([])
  })
})

/**
 * B3 临时仓库验证：status/diff/branch/commit 全走本机 git，
 * 身份经 GIT_* 环境变量注入（不碰全局配置），无真实远端 push。
 */
describe('git-service 临时仓库（无远端 push）', () => {
  const dirs: string[] = []
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
    while (dirs.length > 0) {
      rmSync(dirs.pop() as string, { recursive: true, force: true })
    }
  })

  async function makeRepo(): Promise<string> {
    const dir = mkdtempSync(join(tmpdir(), 'montree-git-'))
    dirs.push(dir)
    expect((await execGitCommand(dir, ['init', '-b', 'main'])).exitCode).toBe(0)
    return dir
  }

  it('status/diff/branch/commit 闭环', async () => {
    const dir = await makeRepo()
    writeFileSync(join(dir, 'a.md'), 'hello\n', 'utf8')

    const status1 = await getGitStatus(dir)
    expect(status1.isRepo).toBe(true)
    expect(status1.branch).toBe('main')
    expect(status1.files.some((f) => f.path === 'a.md' && f.status === 'untracked')).toBe(true)

    const commit = await gitCommit(dir, { message: 'init', stageAll: true })
    expect(commit.ok).toBe(true)

    writeFileSync(join(dir, 'a.md'), 'hello world\n', 'utf8')
    const diff = await getGitDiff(dir, 'a.md')
    expect(diff.ok).toBe(true)
    if (diff.ok) {
      expect(diff.value.truncated).toBe(false)
      expect(diff.value.diff).toContain('hello world')
    }
    const badDiff = await getGitDiff(dir, '../evil.md')
    expect(badDiff.ok).toBe(false)

    const branches = await listGitBranches(dir)
    expect(branches.ok).toBe(true)
    if (branches.ok) {
      expect(branches.value.current).toBe('main')
      expect(branches.value.branches).toContain('main')
      expect(branches.value.detached).toBe(false)
    }

    const status2 = await getGitStatus(dir)
    expect(status2.files.some((f) => f.path === 'a.md' && f.status === 'modified')).toBe(true)
  })

  it('非仓库返回 isRepo=false（不抛）', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'montree-git-plain-'))
    dirs.push(dir)
    expect((await getGitStatus(dir)).isRepo).toBe(false)
  })

  it('执行失败不抛（坏 cwd 返回非零退出码）', async () => {
    const res = await execGitCommand(join(tmpdir(), 'montree-git-nope-不存在'), ['status'])
    expect(res.exitCode).not.toBe(0)
  })

  it('ahead 经本地裸仓库真实计数（覆盖状态栏 ↑N 链路）', async () => {
    const remote = mkdtempSync(join(tmpdir(), 'montree-git-remote-'))
    dirs.push(remote)
    expect((await execGitCommand(remote, ['init', '--bare'])).exitCode).toBe(0)

    const dir = await makeRepo()
    writeFileSync(join(dir, 'a.md'), 'hi\n', 'utf8')
    expect((await gitCommit(dir, { message: 'init', stageAll: true })).ok).toBe(true)
    expect((await execGitCommand(dir, ['remote', 'add', 'origin', remote])).exitCode).toBe(0)
    const pushed = await gitPush(dir, { remote: 'origin', branch: 'main', setUpstream: true })
    expect(pushed.ok).toBe(true)

    expect((await getGitStatus(dir)).ahead).toBe(0)
    writeFileSync(join(dir, 'b.md'), 'more\n', 'utf8')
    expect((await gitCommit(dir, { message: 'second', stageAll: true })).ok).toBe(true)
    const status = await getGitStatus(dir)
    expect(status.ahead).toBe(1)
    expect(status.behind).toBe(0)
  })

  it('hasUpstream 无上游为 false，发布分支后为 true（状态栏发布分支链路）', async () => {
    const dir = await makeRepo()
    writeFileSync(join(dir, 'a.md'), 'hi\n', 'utf8')
    expect((await gitCommit(dir, { message: 'init', stageAll: true })).ok).toBe(true)

    const before = await getGitStatus(dir)
    expect(before.isRepo).toBe(true)
    expect(before.hasUpstream).toBe(false)
    expect(before.ahead).toBe(0)

    const remote = mkdtempSync(join(tmpdir(), 'montree-git-remote-up-'))
    dirs.push(remote)
    expect((await execGitCommand(remote, ['init', '--bare'])).exitCode).toBe(0)
    expect((await execGitCommand(dir, ['remote', 'add', 'origin', remote])).exitCode).toBe(0)
    expect((await gitPush(dir, { remote: 'origin', branch: 'main', setUpstream: true })).ok).toBe(true)

    const after = await getGitStatus(dir)
    expect(after.hasUpstream).toBe(true)
    expect(after.ahead).toBe(0)
  })
})
