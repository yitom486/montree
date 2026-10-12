import { describe, expect, it } from 'vitest'
import {
  parseGitAheadBehind,
  parseGitPorcelain,
  resolveGitExecution,
} from './git-service'

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
})
