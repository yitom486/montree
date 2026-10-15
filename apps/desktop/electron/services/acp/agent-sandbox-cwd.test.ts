import { beforeEach, describe, expect, it, vi } from 'vitest'
import { resolve } from 'node:path'

vi.mock('electron', () => ({
  app: {
    getPath: (name: string) => (name === 'userData' ? 'C:\\tmp\\montree-userData' : name),
  },
}))

vi.mock('node:fs', () => ({
  mkdirSync: vi.fn(),
  statSync: vi.fn(() => ({ isDirectory: () => true })),
}))

import { mkdirSync, statSync } from 'node:fs'
import { resolveAgentCwd, ensureAgentSandboxCwd } from './agent-sandbox-cwd'

describe('resolveAgentCwd', () => {
  beforeEach(() => { vi.mocked(statSync).mockReset(); vi.mocked(statSync).mockReturnValue({ isDirectory: () => true } as ReturnType<typeof statSync>) })
  it('优先使用用户工作区', () => {
    const cwd = resolve('books')
    expect(resolveAgentCwd(cwd)).toEqual({ cwd, source: 'workspace' })
  })

  it('旧缓存的相对构建目录回落沙箱，不按子进程目录重复拼接', () => {
    expect(resolveAgentCwd('out/main').source).toBe('sandbox')
    expect(statSync).not.toHaveBeenCalled()
  })

  it('不存在或普通文件的绝对路径回落沙箱', () => {
    vi.mocked(statSync).mockImplementationOnce(() => { throw new Error('ENOENT') })
    expect(resolveAgentCwd(resolve('missing')).source).toBe('sandbox')
    vi.mocked(statSync).mockReturnValueOnce({ isDirectory: () => false } as ReturnType<typeof statSync>)
    expect(resolveAgentCwd(resolve('file.md')).source).toBe('sandbox')
  })

  it('空白时回落到沙箱并确保目录存在', () => {
    const resolved = resolveAgentCwd('  ')
    expect(resolved.source).toBe('sandbox')
    expect(resolved.cwd.replace(/\\/g, '/')).toContain('userData/agent-sandbox')
    expect(mkdirSync).toHaveBeenCalled()
  })

  it('ensureAgentSandboxCwd 返回 userData 下路径', () => {
    const cwd = ensureAgentSandboxCwd()
    expect(cwd.replace(/\\/g, '/')).toMatch(/agent-sandbox$/)
  })
})
