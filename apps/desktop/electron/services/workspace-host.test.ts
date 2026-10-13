import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { WorkspaceDescriptor } from '@montree/contracts'
import {
  LocalWorkspaceHost,
  UnavailableWorkspaceHost,
  computeLocalRevision,
  getWorkspaceHostForWindow,
  localWorkspaceHost,
  resetRemoteHostResolverForTest,
  resolveWorkspaceHost,
  setRemoteHostResolver,
  type WorkspaceHost,
} from './workspace-host'
import { resetWorkspaceBindingsForTest } from './workspace-bindings'

afterEach(() => {
  // P1 解析器是进程级注入：每个用例后复位，不污染其他分发断言
  resetRemoteHostResolverForTest()
  resetWorkspaceBindingsForTest()
})

describe('workspace-host（宿主分发）', () => {
  it('无绑定时走本机宿主（本机模式回归）', () => {
    resetWorkspaceBindingsForTest()
    expect(getWorkspaceHostForWindow(4242)).toBe(localWorkspaceHost)
    expect(resolveWorkspaceHost(null)).toBe(localWorkspaceHost)
    expect(resolveWorkspaceHost(undefined)).toBe(localWorkspaceHost)
  })

  it('只看描述符 kind 分发，不嗅探路径', () => {
    // UNC 形 rootLabel 的 local 描述符仍走本机；kind 为准
    expect(
      resolveWorkspaceHost({
        id: 'local',
        kind: 'local',
        target: '',
        rootLabel: '\\\\wsl.localhost\\Ubuntu\\home\\u',
        displayName: 'Ubuntu',
      }).kind,
    ).toBe('local')
    expect(
      resolveWorkspaceHost({
        id: 'wsl:Ubuntu:/home/u/blog',
        kind: 'wsl',
        target: 'Ubuntu',
        rootLabel: '/home/u/blog',
        displayName: 'blog',
      }),
    ).toBeInstanceOf(UnavailableWorkspaceHost)
    expect(
      resolveWorkspaceHost({
        id: 'ssh:lab:~/blog',
        kind: 'ssh',
        target: 'lab',
        rootLabel: '~/blog',
        displayName: 'blog',
      }),
    ).toBeInstanceOf(UnavailableWorkspaceHost)
  })

  it('远端占位宿主显式失败，不伪装成功', async () => {
    const host = new UnavailableWorkspaceHost('wsl')
    const scanned = await host.scanWorkspace('/home/u')
    expect(scanned.ok).toBe(false)
    const read = await host.readText('/home/u/a.md')
    expect(!read.ok && read.error.code).toBe('REMOTE_NOT_CONNECTED')
    const written = await host.writeText('/home/u/a.md', { content: 'x' })
    expect(written.ok).toBe(false)
    expect((await host.gitStatus('/home/u')).isRepo).toBe(false)
  })

  it('本机读写带 revision；携带旧版本写入返回 REVISION_CONFLICT', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'montree-host-'))
    try {
      const host = new LocalWorkspaceHost()
      const file = join(dir, 'a.md')
      await writeFile(file, 'hello', 'utf-8')
      const read = await host.readText(file)
      expect(read.ok).toBe(true)
      if (!read.ok) return
      expect(read.value.revision).toBe(computeLocalRevision('hello'))

      const okWrite = await host.writeText(file, {
        content: 'hello world',
        expectedRevision: read.value.revision,
      })
      expect(okWrite.ok).toBe(true)

      // 外部修改后，持旧 revision 保存必须冲突（T5 不盲覆盖）
      await writeFile(file, 'external', 'utf-8')
      const conflict = await host.writeText(file, {
        content: 'stale',
        expectedRevision: read.value.revision,
      })
      expect(conflict.ok).toBe(false)
      if (conflict.ok) return
      expect(conflict.error.code).toBe('REVISION_CONFLICT')
      // 不带版本按遗留语义直接写（回归）
      const legacy = await host.writeText(file, { content: 'plain' })
      expect(legacy.ok).toBe(true)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('P1 远端解析器：已注册会话走远端宿主，未注册显式 unavailable（不回落）', () => {
    const descriptor: WorkspaceDescriptor = {
      id: 'wsl:Ubuntu:/home/u/blog',
      kind: 'wsl',
      target: 'Ubuntu',
      rootLabel: '/home/u/blog',
      displayName: 'blog',
    }
    // 缺省无解析器：显式不可用宿主
    expect(resolveWorkspaceHost(descriptor)).toBeInstanceOf(UnavailableWorkspaceHost)
    const fake = { kind: 'wsl', descriptor } as unknown as WorkspaceHost
    setRemoteHostResolver((workspaceId: string) => (workspaceId === descriptor.id ? fake : null))
    expect(resolveWorkspaceHost(descriptor)).toBe(fake)
    // 未注册 id 仍显式不可用；本机不受影响
    expect(
      resolveWorkspaceHost({ ...descriptor, id: 'wsl:Ubuntu:/other' }),
    ).toBeInstanceOf(UnavailableWorkspaceHost)
    expect(resolveWorkspaceHost(null)).toBe(localWorkspaceHost)
  })
})
