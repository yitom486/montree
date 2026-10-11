import { describe, expect, it } from 'vitest'
import { createArtifactFrameGuard, type GuardFrameSnapshot } from './artifact-navigation-guard'

function frame(overrides: Partial<GuardFrameSnapshot> = {}): GuardFrameSnapshot {
  return {
    name: '',
    url: 'about:blank',
    frameTreeNodeId: 1,
    detached: false,
    ...overrides,
  }
}

describe('createArtifactFrameGuard', () => {
  it('登记后改名仍按身份阻止（P1 改名绕过）', () => {
    const guard = createArtifactFrameGuard()
    guard.handleFrameCreated(frame({ name: 'montree-artifact-abc', url: 'about:blank', frameTreeNodeId: 7 }))
    // guest 脚本：window.name='ordinary-reader' 后跳 data:
    const renamed = frame({ name: 'ordinary-reader', url: 'about:srcdoc', frameTreeNodeId: 7 })
    expect(guard.isArtifactFrame(renamed)).toBe(true)
    expect(guard.shouldBlockSubframeNavigation(renamed, 'data:text/html,<p>hacked</p>')).toBe(true)
    expect(guard.shouldBlockSubframeNavigation(renamed, 'https://example.test/')).toBe(true)
  })

  it('初始 srcdoc/blank 提交一律放行', () => {
    const guard = createArtifactFrameGuard()
    guard.handleFrameCreated(frame({ name: 'montree-artifact-abc', frameTreeNodeId: 7 }))
    const registered = frame({ name: 'montree-artifact-abc', url: 'about:blank', frameTreeNodeId: 7 })
    expect(guard.shouldBlockSubframeNavigation(registered, 'about:srcdoc')).toBe(false)
    expect(guard.shouldBlockSubframeNavigation(registered, 'about:blank')).toBe(false)
  })

  it('普通阅读器帧不受影响（未登记、无前缀名）', () => {
    const guard = createArtifactFrameGuard()
    guard.handleFrameCreated(frame({ name: 'montree-artifact-abc', frameTreeNodeId: 7 }))
    const reader = frame({ name: '', url: 'blob:file:///x', frameTreeNodeId: 9 })
    expect(guard.isArtifactFrame(reader)).toBe(false)
    expect(guard.shouldBlockSubframeNavigation(reader, 'blob:file:///y')).toBe(false)
    expect(guard.shouldBlockSubframeNavigation(reader, 'https://example.test/')).toBe(false)
  })

  it('未知/detached 帧 fail-open，不误伤阅读器', () => {
    const guard = createArtifactFrameGuard()
    expect(guard.shouldBlockSubframeNavigation(null, 'data:text/html,x')).toBe(false)
    expect(guard.shouldBlockSubframeNavigation(undefined, 'data:text/html,x')).toBe(false)
    expect(
      guard.shouldBlockSubframeNavigation(
        frame({ name: 'montree-artifact-abc', url: 'about:srcdoc', frameTreeNodeId: 7, detached: true }),
        'data:text/html,x',
      ),
    ).toBe(false)
  })

  it('非 Artifact 帧创建不登记', () => {
    const guard = createArtifactFrameGuard()
    guard.handleFrameCreated(frame({ name: '', url: 'about:blank', frameTreeNodeId: 3 }))
    expect(
      guard.isArtifactFrame(frame({ name: '', url: 'about:srcdoc', frameTreeNodeId: 3 })),
    ).toBe(false)
  })

  it('存活帧永不因数量淘汰（U0：501 个全存活仍保护最旧）', () => {
    const live = new Set<number>()
    for (let i = 1; i <= 501; i += 1) live.add(i)
    const guard = createArtifactFrameGuard({ listLiveFrameTreeNodeIds: () => live })
    guard.handleFrameCreated({ name: 'montree-artifact-original', url: 'about:srcdoc', frameTreeNodeId: 1, detached: false })
    for (let i = 2; i <= 501; i += 1) {
      guard.handleFrameCreated({ name: `montree-artifact-${i}`, url: 'about:srcdoc', frameTreeNodeId: i, detached: false })
    }
    const renamed = frame({ name: 'ordinary-reader', url: 'about:srcdoc', frameTreeNodeId: 1 })
    expect(guard.isArtifactFrame(renamed)).toBe(true)
    expect(guard.shouldBlockSubframeNavigation(renamed, 'data:text/html,replacement')).toBe(true)
  })

  it('已销毁帧按实际生命周期清理（U0）', () => {
    const live = new Set([1, 2])
    const guard = createArtifactFrameGuard({ listLiveFrameTreeNodeIds: () => live })
    guard.handleFrameCreated(frame({ name: 'montree-artifact-a', url: 'about:srcdoc', frameTreeNodeId: 1 }))
    guard.handleFrameCreated(frame({ name: 'montree-artifact-b', url: 'about:srcdoc', frameTreeNodeId: 2 }))
    live.delete(1)
    guard.handleFrameCreated(frame({ name: 'montree-artifact-c', url: 'about:srcdoc', frameTreeNodeId: 3 }))
    live.add(3)
    expect(guard.isArtifactFrame(frame({ name: 'x', url: 'about:srcdoc', frameTreeNodeId: 1 }))).toBe(false)
    expect(guard.isArtifactFrame(frame({ name: 'x', url: 'about:srcdoc', frameTreeNodeId: 2 }))).toBe(true)
  })
})
