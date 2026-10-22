import { describe, expect, it } from 'vitest'
import { systemTarCommand } from './system-tar'

describe('systemTarCommand', () => {
  it('非 Windows 用 PATH 中的 tar', () => {
    expect(systemTarCommand('linux', {})).toBe('tar')
  })
  it('Windows 下 System32 tar 不存在时回退 tar', () => {
    expect(systemTarCommand('win32', { SystemRoot: '/nonexistent-root' })).toBe('tar')
  })
})
