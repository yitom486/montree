import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({
  app: {
    getPath: (name: string) => (name === 'userData' ? 'C:\\tmp\\montree-userData' : name),
  },
}))

vi.mock('node:fs', () => ({
  mkdirSync: vi.fn(),
}))

import { mkdirSync } from 'node:fs'
import { resolveAgentCwd, ensureAgentSandboxCwd } from './agent-sandbox-cwd'

describe('resolveAgentCwd', () => {
  it('优先使用用户工作区', () => {
    const resolved = resolveAgentCwd('D:\\books')
    expect(resolved).toEqual({ cwd: 'D:\\books', source: 'workspace' })
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
