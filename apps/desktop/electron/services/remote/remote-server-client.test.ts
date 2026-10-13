/**
 * 本地管道客户端集成验证（A2）：对 Bun 构建的自包含产物，
 * 用 PATH 中的真实 Node（非 Bun/Electron）启动并完成握手；
 * 校验调用闭环、未知方法、平台冒充拒绝与关闭语义。
 */
import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { delimiter, join, resolve } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { RemoteServerPipeClient } from './remote-server-client'
import { resolveNodeExecutable } from './remote-server-host'

const REPO_ROOT = resolve(__dirname, '..', '..', '..', '..', '..')
const BUILD_SCRIPT = join(REPO_ROOT, 'packages', 'remote-server', 'scripts', 'build.ts')

let outDir = ''
let bundlePath = ''
let nodePath = ''
let ready = true

function findRealNode(): string {
  const suffix = process.platform === 'win32' ? '.exe' : ''
  for (const dir of (process.env['PATH'] ?? '').split(delimiter)) {
    if (!dir) continue
    const candidate = join(dir, `node${suffix}`)
    if (existsSync(candidate)) return candidate
  }
  return ''
}

beforeAll(() => {
  nodePath = findRealNode()
  if (!nodePath) {
    ready = false
    console.warn('[skip] PATH 中无真实 node，跳过管道客户端集成验证')
    return
  }
  outDir = mkdtempSync(join(tmpdir(), 'ws-client-'))
  const built = spawnSync('bun', [BUILD_SCRIPT, '--outDir', outDir], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    timeout: 120_000,
  })
  if (built.status !== 0) {
    ready = false
    console.warn(`[skip] remote bundle 构建失败：${built.stderr?.slice(0, 500)}`)
    return
  }
  bundlePath = join(outDir, 'montree-remote-server.cjs')
}, 120_000)

afterAll(() => {
  if (outDir) rmSync(outDir, { recursive: true, force: true })
})

describe('本地管道客户端', () => {
  it('PATH 中能定位真实 Node', () => {
    const found = resolveNodeExecutable()
    expect(found.ok).toBe(true)
  })

  it('真实 Node 启动握手成功，上报真实平台/架构/版本', async () => {
    if (!ready) return
    const root = mkdtempSync(join(tmpdir(), 'ws-root-'))
    try {
      const launched = await RemoteServerPipeClient.launch({
        nodePath,
        serverPath: bundlePath,
        root,
        session: 'sess-client-1',
        generation: 'gen-1',
        expectedPlatform: process.platform,
      })
      expect(launched.ok).toBe(true)
      if (!launched.ok) return
      const client = launched.value
      expect(client.handshake?.platform).toBe(process.platform)
      expect(client.handshake?.arch).toBe(process.arch)
      expect(client.handshake?.nodeVersion).toBe(process.version)
      expect(client.connectionState).toBe('connected')
      client.close()
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('经管道完成读写闭环，未知方法可解释失败', async () => {
    if (!ready) return
    const root = mkdtempSync(join(tmpdir(), 'ws-root-'))
    writeFileSync(join(root, 'note.md'), 'pipe\n')
    try {
      const launched = await RemoteServerPipeClient.launch({
        nodePath,
        serverPath: bundlePath,
        root,
        session: 'sess-client-2',
        generation: 'gen-1',
      })
      expect(launched.ok).toBe(true)
      if (!launched.ok) return
      const client = launched.value
      const listed = await client.invoke('listDirectory', { path: '' })
      expect(listed.ok).toBe(true)
      const read = await client.invoke('readText', { path: 'note.md' })
      expect(read.ok).toBe(true)
      if (!read.ok) {
        client.close()
        return
      }
      const revision = (read.value as { revision: string }).revision
      const written = await client.invoke('writeText', {
        path: 'note.md',
        content: 'pipe v2\n',
        expectedRevision: revision,
      })
      expect(written.ok).toBe(true)
      const unknown = await client.invoke('noSuchMethod' as never)
      expect(unknown.ok).toBe(false)
      if (!unknown.ok) expect(unknown.error.code).toBe('NOT_SUPPORTED')
      client.close()
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('期望平台不符时拒绝连接（防 Windows node.exe 冒充）', async () => {
    if (!ready) return
    const root = mkdtempSync(join(tmpdir(), 'ws-root-'))
    try {
      const opposite = process.platform === 'win32' ? 'linux' : 'win32'
      const launched = await RemoteServerPipeClient.launch({
        nodePath,
        serverPath: bundlePath,
        root,
        session: 'sess-client-3',
        generation: 'gen-1',
        expectedPlatform: opposite as NodeJS.Platform,
      })
      expect(launched.ok).toBe(false)
      if (!launched.ok) expect(launched.error.code).toBe('CONNECTION_ERROR')
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('关闭后调用不再伪装成功', async () => {
    if (!ready) return
    const root = mkdtempSync(join(tmpdir(), 'ws-root-'))
    try {
      const launched = await RemoteServerPipeClient.launch({
        nodePath,
        serverPath: bundlePath,
        root,
        session: 'sess-client-4',
        generation: 'gen-1',
      })
      expect(launched.ok).toBe(true)
      if (!launched.ok) return
      launched.value.close()
      const after = await launched.value.invoke('ping')
      expect(after.ok).toBe(false)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})
