/**
 * B2/B3 回环验证：RemoteWorkspaceHost 经传输抽象调用**真实服务端实现**
 *（`@montree/remote-server` createWorkspaceServer，进程内直调 handleRequest，
 * 无 WSL/无 stdio），覆盖文本闭环、冲突、搜索分页/取消、Git、watch 代际、
 * 断线、重连、多会话隔离。真实 WSL 端到端（Linux Node 缺失）见交付说明。
 */
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createWorkspaceServer } from '@montree/remote-server'
import type { WorkspaceWatchEvent } from '@montree/contracts'
import {
  bindRemoteHostToWindow,
  getRemoteHost,
  registerRemoteHost,
  remoteHostBoundWindowCount,
  resetRemoteHostSessionsForTest,
  unbindRemoteHostFromWindow,
  RemoteWorkspaceHost,
  type RemoteWorkspaceTransport,
} from './remote-workspace-host'

const dirs: string[] = []
afterEach(() => {
  resetRemoteHostSessionsForTest()
  while (dirs.length > 0) rmSync(dirs.pop() as string, { recursive: true, force: true })
})

function makeRoot(): string {
  const dir = mkdtempSync(join(tmpdir(), 'montree-remote-host-'))
  dirs.push(dir)
  return dir
}

function hostId(tag: string): { id: string; kind: 'wsl'; target: string; rootLabel: string } {
  return { id: `wsl:Ubuntu:${tag}`, kind: 'wsl', target: 'Ubuntu', rootLabel: tag }
}

/** 回环传输：直调真实服务端（无 stdio/WSL），connected 可编程模拟断线。 */
function makeLoopback(root: string, session: string, generation: string) {
  const server = createWorkspaceServer({ root, session, generation, buildId: 'test-loopback' })
  let connected = true
  const listeners = new Set<(event: WorkspaceWatchEvent) => void>()
  const offServer = server.onEvent((event) => {
    if ('fatal' in event) return
    for (const listener of listeners) listener(event)
  })
  let counter = 0
  const transport: RemoteWorkspaceTransport = {
    invoke: async (method, params, _timeoutMs, signal) => {
      if (signal?.aborted) return { ok: false, code: 'CANCELLED', message: '请求已取消' }
      if (!connected) return { ok: false, code: 'REMOTE_NOT_CONNECTED', message: '回环已断开' }
      const response = await server.handleRequest({
        proto: 'montree-workspace',
        id: `ws-${(counter += 1)}`,
        method,
        session,
        generation,
        params,
      })
      if (response.ok) return { ok: true, result: response.value as never }
      return { ok: false, code: response.error.code, message: response.error.message }
    },
    onEvent: (listener) => {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    isConnected: () => connected,
  }
  return {
    server,
    transport,
    setConnected: (value: boolean) => {
      connected = value
    },
    dispose: () => {
      offServer()
      server.dispose()
    },
  }
}

function makeHost(root: string, tag = '/notes', generation = 'gen-1', session = 'sess-1') {
  const loop = makeLoopback(root, session, generation)
  const host = new RemoteWorkspaceHost(hostId(tag), loop.transport, generation)
  return { host, loop }
}

describe('B2 远端文本闭环（回环真实服务端）', () => {
  it('open…read/write：revision 一致，外部修改持旧版保存冲突且磁盘不动（T5）', async () => {
    const root = makeRoot()
    const { host, loop } = makeHost(root)
    try {
      const created = await host.createFile({ workspaceRoot: root, path: 'a.md', content: 'hello' })
      expect(created.ok).toBe(true)

      const read = await host.readText('a.md')
      expect(read.ok).toBe(true)
      if (!read.ok) return
      expect(typeof read.value.revision).toBe('string')

      const written = await host.writeText('a.md', {
        content: 'hello world',
        expectedRevision: read.value.revision,
      })
      expect(written.ok).toBe(true)

      // Ubuntu 外部写入（此处为同机直写，语义等价）后持旧 revision 保存必须冲突
      writeFileSync(join(root, 'a.md'), 'external', 'utf8')
      const conflict = await host.writeText('a.md', {
        content: 'stale-buffer',
        expectedRevision: read.value.revision,
      })
      expect(conflict.ok).toBe(false)
      if (conflict.ok) return
      expect(conflict.error.code).toBe('REVISION_CONFLICT')
      // 回读仍是外部版本（不盲覆盖）
      const reread = await host.readText('a.md')
      expect(reread.ok && reread.value.content).toBe('external')
    } finally {
      loop.dispose()
    }
  })

  it('P1 provider 保存语义：expectedContent 一致写盘，不一致两次都冲突且磁盘不动', async () => {
    const root = makeRoot()
    const { host, loop } = makeHost(root)
    try {
      expect((await host.createFile({ workspaceRoot: root, path: 'm.md', content: 'v1' })).ok).toBe(true)
      // 一致：markdown provider 的 expectedContent（加载时磁盘原文）可正常保存
      const first = await host.saveFile({ filePath: 'm.md', content: 'v2', expectedContent: 'v1' })
      expect(first.ok).toBe(true)
      // 外部改写后持旧 expectedContent 保存必须冲突（非盲覆盖）
      writeFileSync(join(root, 'm.md'), 'external', 'utf8')
      const conflict1 = await host.saveFile({ filePath: 'm.md', content: 'stale-1', expectedContent: 'v2' })
      expect(conflict1.ok).toBe(false)
      if (conflict1.ok) return
      expect(conflict1.error.code).toBe('REVISION_CONFLICT')
      // 重复保存仍用旧基线比较，继续拒绝（宿主层无 baseline 可推进）
      const conflict2 = await host.saveFile({ filePath: 'm.md', content: 'stale-2', expectedContent: 'v2' })
      expect(conflict2.ok).toBe(false)
      if (conflict2.ok) return
      expect(conflict2.error.code).toBe('REVISION_CONFLICT')
      const reread = await host.readText('m.md')
      expect(reread.ok && reread.value.content).toBe('external')
      // 显式覆盖（调用方重读磁盘版本后）可写入
      const overwrite = await host.saveFile({ filePath: 'm.md', content: 'mine', expectedContent: 'external' })
      expect(overwrite.ok).toBe(true)
    } finally {
      loop.dispose()
    }
  })

  it('provider 内容核对后、写入前发生外部修改仍拒绝覆盖', async () => {
    const root = makeRoot()
    const { host, loop } = makeHost(root)
    try {
      writeFileSync(join(root, 'm.md'), 'baseline', 'utf8')
      const invoke = loop.transport.invoke.bind(loop.transport)
      loop.transport.invoke = async <T>(...args: Parameters<RemoteWorkspaceTransport['invoke']>) => {
        const result = await invoke<T>(...args)
        if (args[0] === 'readText' && result.ok) {
          writeFileSync(join(root, 'm.md'), 'external-during-save', 'utf8')
        }
        return result
      }
      const saved = await host.saveFile({
        filePath: 'm.md', content: 'mine', expectedContent: 'baseline',
      })
      expect(saved.ok).toBe(false)
      if (!saved.ok) expect(saved.error.code).toBe('REVISION_CONFLICT')
      loop.transport.invoke = invoke
      const disk = await host.readText('m.md')
      expect(disk.ok && disk.value.content).toBe('external-during-save')
    } finally {
      loop.dispose()
    }
  })

  it('mkdir/rename/delete/同宿主 move；跨宿主断言拒绝', async () => {
    const root = makeRoot()
    const { host, loop } = makeHost(root)
    try {
      expect((await host.createDirectory({ workspaceRoot: root, path: 'docs' })).ok).toBe(true)
      expect((await host.createFile({ workspaceRoot: root, path: 'docs/b.md', content: 'b' })).ok).toBe(true)
      const renamed = await host.renamePath({ workspaceRoot: root, fromPath: 'docs/b.md', toPath: 'docs/c.md' })
      expect(renamed.ok).toBe(true)
      if (renamed.ok) expect(renamed.value.path).toBe('docs/c.md')
      const moved = await host.movePath({ workspaceRoot: root, fromPath: 'docs/c.md', toPath: 'd.md' })
      expect(moved.ok).toBe(true)
      expect((await host.deletePath({ workspaceRoot: root, path: 'd.md' })).ok).toBe(true)
      const missing = await host.readText('d.md')
      expect(missing.ok).toBe(false)

      // 跨宿主 copy/move 拒绝（T7）
      expect(host.assertOwnWorkspace(host.descriptor.id).ok).toBe(true)
      const cross = host.assertOwnWorkspace('wsl:Ubuntu:/other')
      expect(cross.ok).toBe(false)
      if (!cross.ok) expect(cross.error.code).toBe('UNSUPPORTED_OPERATION')
    } finally {
      loop.dispose()
    }
  })

  it('远端另存为：不弹对话框，已存在拒绝，新路径成功', async () => {
    const root = makeRoot()
    const { host, loop } = makeHost(root)
    try {
      expect((await host.createFile({ workspaceRoot: root, path: 'a.md', content: 'x' })).ok).toBe(true)
      const dup = await host.saveTextAs('', 'a.md', 'overwrite?')
      expect(dup.ok).toBe(false)
      const saved = await host.saveTextAs('', 'b.md', 'new file')
      expect(saved.ok).toBe(true)
      if (saved.ok) expect(saved.value.relativePath).toBe('b.md')
      const badName = await host.saveTextAs('', '../evil.md', 'x')
      expect(badName.ok).toBe(false)
      // A1 saveFileAs 无路径时必须显式失败（不弹本机对话框冒充远端保存）
      const noPath = await host.saveFileAs({ content: 'untitled' })
      expect(noPath.ok).toBe(false)
    } finally {
      loop.dispose()
    }
  })

  it('相对预览图片经宿主（dataUrl），粘贴图缺服务端方法时显式不支持', async () => {
    const root = makeRoot()
    const { host, loop } = makeHost(root)
    try {
      const png = Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
        'base64',
      )
      writeFileSync(join(root, 'pic.png'), png)
      const image = await host.readImage('pic.png')
      expect(image.ok).toBe(true)
      if (image.ok) expect(image.value.dataUrl.startsWith('data:image/png;base64,')).toBe(true)

      const paste = await host.savePastedImage({ base64: 'xx', mimeType: 'image/png' })
      expect(paste.ok).toBe(false)
      if (!paste.ok) expect(paste.error.code).toBe('NOT_SUPPORTED')
    } finally {
      loop.dispose()
    }
  })
})

describe('B3 搜索/取消（回环）', () => {
  it('远端 searchMarkdown 分页：offset/limit/nextOffset', async () => {
    const root = makeRoot()
    const { host, loop } = makeHost(root)
    try {
      for (let i = 0; i < 5; i += 1) {
        writeFileSync(join(root, `f${i}.md`), `王道计 ${i}\n`, 'utf8')
      }
      const page1 = await host.searchMarkdown({ workspaceRoot: root, query: '王道计', offset: 0, limit: 2 })
      expect(page1.ok).toBe(true)
      if (!page1.ok) return
      expect(page1.value.hits).toHaveLength(2)
      expect(page1.value.nextOffset).toBe(2)
      const page2 = await host.searchMarkdown({ workspaceRoot: root, query: '王道计', offset: 2, limit: 2 })
      if (!page2.ok) return
      expect(page2.value.hits).toHaveLength(2)
      expect(page2.value.nextOffset).toBe(4)
      const page3 = await host.searchMarkdown({ workspaceRoot: root, query: '王道计', offset: 4, limit: 2 })
      if (!page3.ok) return
      expect(page3.value.hits).toHaveLength(1)
      expect(page3.value.nextOffset).toBeNull()
    } finally {
      loop.dispose()
    }
  })

  it('取消的搜索返回 CANCELLED（不抛、不悬挂）', async () => {
    const root = makeRoot()
    const { host, loop } = makeHost(root)
    try {
      writeFileSync(join(root, 'a.md'), '王道计\n', 'utf8')
      const controller = new AbortController()
      controller.abort()
      const result = await host.searchMarkdown(
        { workspaceRoot: root, query: '王道计' },
        { signal: controller.signal },
      )
      expect(result.ok).toBe(false)
      if (!result.ok) expect(result.error.code).toBe('CANCELLED')
    } finally {
      loop.dispose()
    }
  })
})

describe('B3 远端 Git（回环真实 git，无真实远端 push）', () => {
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
  })

  function makeRepo(): string {
    const dir = makeRoot()
    execFileSync('git', ['init', '-b', 'main', dir])
    return dir
  }

  it('status/diff/branch/commit 经远端执行', async () => {
    const root = makeRepo()
    const { host, loop } = makeHost(root, '/repo')
    try {
      writeFileSync(join(root, 'a.md'), 'hello\n', 'utf8')
      const status1 = await host.gitStatus(root)
      expect(status1.isRepo).toBe(true)
      expect(status1.files.some((f) => f.path === 'a.md')).toBe(true)

      const commit = await host.gitCommit({ cwd: root, message: 'init', stageAll: true })
      expect(commit.ok).toBe(true)

      writeFileSync(join(root, 'a.md'), 'hello world\n', 'utf8')
      const diff = await host.gitDiff('a.md')
      expect(diff.ok).toBe(true)
      if (diff.ok) {
        expect(diff.value.truncated).toBe(false)
        expect(diff.value.diff).toContain('hello world')
      }
      const branch = await host.gitBranch()
      expect(branch.ok).toBe(true)
      if (branch.ok) {
        expect(branch.value.current).toBe('main')
        expect(branch.value.branches).toContain('main')
      }
      // push 到不存在的远端必须明确失败（测试中无真实远端 push）
      const push = await host.gitPush({ cwd: root, remote: 'nonexistent-xyz' })
      expect(push.ok).toBe(false)
    } finally {
      loop.dispose()
    }
  }, 20000)
})

describe('B3 watch/断线/重连/隔离（回环）', () => {
  it('远端原生 watch 事件合并送达；unwatch 后停止', async () => {
    const root = makeRoot()
    const { host, loop } = makeHost(root)
    try {
      const seen: WorkspaceWatchEvent[] = []
      host.onWatchEvent((event) => seen.push(event))
      const sub = await host.watchDirectory('')
      expect(sub.ok).toBe(true)
      writeFileSync(join(root, 'live.md'), 'hi\n', 'utf8')
      await vi.waitFor(() => expect(seen.length).toBeGreaterThan(0), { timeout: 8000 })
      expect(seen[0]?.generation).toBe('gen-1')
      expect(seen[0]?.changes.some((c) => c.path === 'live.md')).toBe(true)
      if (!sub.ok) return
      expect((await host.unwatchDirectory(sub.value.subscriptionId)).ok).toBe(true)
      expect(host.getSubscriptionCount()).toBe(0)
    } finally {
      loop.dispose()
    }
  }, 15000)

  it('T4：断线返回连接错误且 buffer 保留；恢复后可读写（不误报成功）', async () => {
    const root = makeRoot()
    const { host, loop } = makeHost(root)
    try {
      expect((await host.createFile({ workspaceRoot: root, path: 'draft.md', content: 'v1' })).ok).toBe(true)
      // 渲染端未保存 buffer（宿主永不持有/清空它，此处模拟保留）
      let buffer = 'v1 + 未保存修改'
      loop.setConnected(false)
      const failed = await host.writeText('draft.md', { content: buffer })
      expect(failed.ok).toBe(false)
      if (!failed.ok) expect(failed.error.code).toBe('REMOTE_NOT_CONNECTED')
      expect(buffer).toBe('v1 + 未保存修改')
      const failedRead = await host.readText('draft.md')
      expect(failedRead.ok).toBe(false)
      loop.setConnected(true)
      const recovered = await host.writeText('draft.md', { content: buffer })
      expect(recovered.ok).toBe(true)
    } finally {
      loop.dispose()
    }
  })

  it('T6：重连自增代际、旧事件丢弃、revision 重核报告外部修改', async () => {
    const root = makeRoot()
    const first = makeLoopback(root, 'sess-1', 'gen-1')
    const host = new RemoteWorkspaceHost(hostId('/notes'), first.transport, 'gen-1')
    try {
      expect((await host.createFile({ workspaceRoot: root, path: 'a.md', content: 'v1' })).ok).toBe(true)
      // 跟踪 revision（重连核对用）
      expect((await host.readText('a.md')).ok).toBe(true)
      const forwarded: WorkspaceWatchEvent[] = []
      host.onWatchEvent((event) => forwarded.push(event))
      expect((await host.watchDirectory('')).ok).toBe(true)

      // 重连到新代际（同目录新会话，模拟服务重启）
      const second = makeLoopback(root, 'sess-2', 'gen-2')
      try {
        writeFileSync(join(root, 'a.md'), 'external-change', 'utf8')
        const reconnected = await host.reconnect(second.transport, 'gen-2')
        expect(reconnected.ok).toBe(true)
        if (!reconnected.ok) return
        expect(reconnected.value.generation).toBe('gen-2')
        // 跟踪中的 revision 被外部修改 → 报告
        expect(reconnected.value.changedPaths).toContain('a.md')
        // 旧代际传输的事件不再转发
        writeFileSync(join(root, 'old-gen.md'), 'x', 'utf8')
        await new Promise((resolve) => setTimeout(resolve, 900))
        expect(forwarded.every((event) => event.generation === 'gen-2')).toBe(true)
      } finally {
        second.dispose()
      }
    } finally {
      first.dispose()
      host.dispose()
    }
  }, 20000)

  it('T3 方向：UNC/绝对/穿越路径在宿主边界即拒绝（永不进传输）', async () => {
    const root = makeRoot()
    const { host, loop } = makeHost(root)
    try {
      const invokes: string[] = []
      const rawInvoke = loop.transport.invoke.bind(loop.transport)
      loop.transport.invoke = (async (method: string, params: Record<string, unknown>, timeoutMs?: number) => {
        invokes.push(method)
        return rawInvoke(method, params, timeoutMs)
      }) as typeof loop.transport.invoke
      for (const bad of [
        '\\\\wsl.localhost\\Ubuntu\\home\\u\\a.md',
        '\\\\wsl$\\Ubuntu\\home\\u\\a.md',
        'D:\\notes\\a.md',
        '/abs/a.md',
        '../escape.md',
      ]) {
        const read = await host.readText(bad)
        expect(read.ok).toBe(false)
        if (!read.ok) expect(read.error.code).toBe('INVALID_ARGUMENT')
        const write = await host.writeText(bad, { content: 'x' })
        expect(write.ok).toBe(false)
      }
      // 非法路径零传输（未到达远端，更无 UNC I/O）
      expect(invokes).toEqual([])
    } finally {
      loop.dispose()
    }
  })

  it('T7：两工作区同相对路径隔离；关 A 不杀 B', async () => {
    const rootA = makeRoot()
    const rootB = makeRoot()
    const loopA = makeLoopback(rootA, 'sess-a', 'gen-1')
    const loopB = makeLoopback(rootB, 'sess-b', 'gen-1')
    const hostA = new RemoteWorkspaceHost(
      { id: 'wsl:Ubuntu:/a', kind: 'wsl', target: 'Ubuntu', rootLabel: '/a' },
      loopA.transport,
      'gen-1',
    )
    const hostB = new RemoteWorkspaceHost(
      { id: 'wsl:Ubuntu:/b', kind: 'wsl', target: 'Ubuntu', rootLabel: '/b' },
      loopB.transport,
      'gen-1',
    )
    try {
      registerRemoteHost(hostA)
      registerRemoteHost(hostB)
      expect((await hostA.writeText('same.md', { content: 'A 版本' })).ok).toBe(true)
      expect((await hostB.writeText('same.md', { content: 'B 版本' })).ok).toBe(true)
      const readA = await hostA.readText('same.md')
      const readB = await hostB.readText('same.md')
      expect(readA.ok && readA.value.content).toBe('A 版本')
      expect(readB.ok && readB.value.content).toBe('B 版本')

      expect(bindRemoteHostToWindow('wsl:Ubuntu:/a', 101)).toBe(true)
      expect(bindRemoteHostToWindow('wsl:Ubuntu:/a', 102)).toBe(true)
      expect(bindRemoteHostToWindow('wsl:Ubuntu:/b', 201)).toBe(true)
      expect(remoteHostBoundWindowCount('wsl:Ubuntu:/a')).toBe(2)
      // 关 A 的一个窗口：连接保留
      expect(unbindRemoteHostFromWindow('wsl:Ubuntu:/a', 101)).toBe(false)
      expect(getRemoteHost('wsl:Ubuntu:/a')).not.toBeNull()
      // 关 A 的最后一个窗口：连接释放；B 不受影响
      expect(unbindRemoteHostFromWindow('wsl:Ubuntu:/a', 102)).toBe(true)
      expect(getRemoteHost('wsl:Ubuntu:/a')).toBeNull()
      const stillB = await hostB.readText('same.md')
      expect(stillB.ok && stillB.value.content).toBe('B 版本')
    } finally {
      loopA.dispose()
      loopB.dispose()
    }
  })
})
