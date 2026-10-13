import { describe, expect, it } from 'vitest'
import {
  DEFAULT_WORKSPACE_LIMITS,
  WORKSPACE_PROTOCOL_MAJOR,
  WORKSPACE_PROTOCOL_MINOR,
  type DocumentRef,
  type RemoteServerConnectionInfo,
  type WorkspaceDescriptor,
  type WorkspaceServerHandshake,
  type WorkspaceWatchEvent,
} from './workspace'

/**
 * workspace 协议共享类型回归（A2 原文件被 B2 分支误覆盖后重建）。
 * 只断言仓内引用点依赖的形状，不锁定 A2 未定语义。
 */
describe('workspace 协议共享类型（A2 重建回归）', () => {
  it('协议版本为 v1.0（与 remote.ts REMOTE_* 一致）', () => {
    expect(WORKSPACE_PROTOCOL_MAJOR).toBe(1)
    expect(WORKSPACE_PROTOCOL_MINOR).toBe(0)
  })

  it('本机描述符形状满足 workspace-identity 期望', () => {
    const descriptor: WorkspaceDescriptor = {
      id: 'local',
      kind: 'local',
      target: '',
      rootLabel: 'C:\\notes\\blog',
      displayName: 'blog',
    }
    expect(descriptor.kind).toBe('local')
    const ref: DocumentRef = { workspaceId: descriptor.id, relativePath: 'posts/a.md' }
    expect(ref.relativePath).toBe('posts/a.md')
  })

  it('远端描述符 id 形如 wsl:发行版:根', () => {
    const descriptor: WorkspaceDescriptor = {
      id: 'wsl:Ubuntu:/home/u/blog',
      kind: 'wsl',
      target: 'Ubuntu',
      rootLabel: '/home/u/blog',
      displayName: 'blog',
    }
    expect(descriptor.id).toContain('wsl:Ubuntu:')
  })

  it('默认限额覆盖服务端使用的全部字段', () => {
    expect(DEFAULT_WORKSPACE_LIMITS.maxFrameBytes).toBeGreaterThan(0)
    expect(DEFAULT_WORKSPACE_LIMITS.maxTextBytes).toBeGreaterThan(0)
    expect(DEFAULT_WORKSPACE_LIMITS.maxResourceBytes).toBeGreaterThan(0)
    expect(DEFAULT_WORKSPACE_LIMITS.searchMaxFiles).toBe(200)
    expect(DEFAULT_WORKSPACE_LIMITS.searchMaxFileBytes).toBe(256 * 1024)
    expect(DEFAULT_WORKSPACE_LIMITS.searchMaxHits).toBe(100)
    expect(DEFAULT_WORKSPACE_LIMITS.maxConcurrent).toBeGreaterThan(0)
    expect(DEFAULT_WORKSPACE_LIMITS.requestTimeoutMs).toBeGreaterThan(0)
  })

  it('握手携带服务端 server.ts 构造的全部字段', () => {
    const handshake: WorkspaceServerHandshake = {
      protocolMajor: 1,
      protocolMinor: 0,
      buildId: 'dev',
      nodeVersion: 'v22.0.0',
      platform: 'linux',
      arch: 'x64',
      capabilities: ['fs', 'watch', 'search', 'git', 'resource'],
      limits: DEFAULT_WORKSPACE_LIMITS,
    }
    expect(handshake.limits).toBe(DEFAULT_WORKSPACE_LIMITS)
  })

  it('监听事件携带代际（旧事件过期判定用）', () => {
    const event: WorkspaceWatchEvent = {
      subscriptionId: 'wsub-1',
      generation: 'gen-2',
      changes: [{ path: 'a.md', kind: 'modified' }],
    }
    expect(event.changes).toHaveLength(1)
  })

  it('服务连接信息形状满足接入层用法', () => {
    const info: RemoteServerConnectionInfo = {
      connectionId: 'conn-1',
      state: 'connected',
      generation: 'gen-1',
    }
    expect(info.state).toBe('connected')
  })
})
