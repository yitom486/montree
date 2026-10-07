import { describe, expect, it } from 'vitest'
import { shouldLogRendererConsole, setVerboseRendererLogs } from './runtime-state'

describe('runtime-state', () => {
  it('默认仅记录 error 级别', () => {
    setVerboseRendererLogs(false)
    expect(shouldLogRendererConsole(2, 'info message')).toBe(false)
    expect(shouldLogRendererConsole(3, 'info message')).toBe(true)
    expect(shouldLogRendererConsole(2, 'Uncaught Error')).toBe(true)
  })

  it('verbose 模式记录全部', () => {
    setVerboseRendererLogs(true)
    expect(shouldLogRendererConsole(1, 'debug')).toBe(true)
    setVerboseRendererLogs(false)
  })

  it('过滤良性 ResizeObserver loop 提示', () => {
    expect(
      shouldLogRendererConsole(3, 'ResizeObserver loop completed with undelivered notifications.'),
    ).toBe(false)
    expect(shouldLogRendererConsole(3, 'ResizeObserver loop limit exceeded')).toBe(false)
  })
})
