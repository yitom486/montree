import { describe, expect, it } from 'vitest'
import {
  CROSS_WORKSPACE_MOVE_MESSAGE,
  assertSameWorkspaceId,
  isStaleGenerationEvent,
} from './workspace-files'

describe('workspace-files（B2 宿主相对操作）', () => {
  it('跨宿主 copy/move 明确拒绝', () => {
    expect(assertSameWorkspaceId('local', 'local')).toBe(true)
    expect(assertSameWorkspaceId('wsl:Ubuntu:/a', 'wsl:Ubuntu:/a')).toBe(true)
    expect(assertSameWorkspaceId('local', 'wsl:Ubuntu:/a')).toBe(false)
    expect(CROSS_WORKSPACE_MOVE_MESSAGE).toContain('跨工作区')
  })

  it('代际过滤：旧事件不污染新工作区，缺失代际视为有效', () => {
    expect(isStaleGenerationEvent('gen-1', 'gen-2')).toBe(true)
    expect(isStaleGenerationEvent('gen-2', 'gen-2')).toBe(false)
    expect(isStaleGenerationEvent(undefined, 'gen-2')).toBe(false)
    expect(isStaleGenerationEvent('gen-1', undefined)).toBe(false)
    expect(isStaleGenerationEvent(1, 2)).toBe(true)
  })
})
