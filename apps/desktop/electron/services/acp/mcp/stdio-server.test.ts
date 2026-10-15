import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { createInterface } from 'node:readline'
import { createConnection } from 'node:net'
import { mkdtempSync, readFileSync, rmSync, rmdirSync, mkdirSync, copyFileSync, writeFileSync } from 'node:fs'
import { once } from 'node:events'
import { createPackage } from '@electron/asar'
import { tmpdir } from 'node:os'
import { resolve, join } from 'node:path'
import { afterAll, beforeAll, afterEach, describe, expect, it, vi } from 'vitest'
import { stripTypeScriptTypes } from 'node:module'
import { getAcpContext, runInAcpContext, forgetAcpContext } from '../acp-context'
import { startWindowMcpServer, stopWindowMcpServers } from './stdio-server'
import { configureAcpDiagnostics } from './diagnostics'
import type { MontreeMcpServerHandle } from './montree-mcp-server'
import { windowMcpEntry } from './session-config'
import { resolveAgentCwd } from '../agent-sandbox-cwd'

vi.mock('electron', async () => {
  const { tmpdir } = await import('node:os')
  return { app: { getPath: () => tmpdir() } }
})

const children: ChildProcessWithoutNullStreams[] = []
const scopes: ReturnType<typeof getAcpContext>[] = []
const runtimeDirectory = mkdtempSync(join(tmpdir(), 'montree-stdio-test-'))
const runtimeEntry = join(runtimeDirectory, 'mcp-stdio.js')
beforeAll(() => {
  const source = readFileSync(resolve('apps/desktop/electron/mcp-stdio.ts'), 'utf8')
  writeFileSync(runtimeEntry, stripTypeScriptTypes(source))
  writeFileSync(join(runtimeDirectory, 'package.json'), '{"type":"module"}')
})
afterAll(() => {
  rmSync(runtimeEntry, { force: true })
  rmSync(join(runtimeDirectory, 'package.json'), { force: true })
  rmdirSync(runtimeDirectory)
})
function client(handle: MontreeMcpServerHandle, entry = runtimeEntry, cwd?: string) {
  const electron = resolve('node_modules/electron', readFileSync('node_modules/electron/path.txt', 'utf8').trim().replace(/^/, 'dist/'))
  const child = spawn(electron, [entry], { cwd, env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', MONTREE_MCP_PIPE: handle.url, MONTREE_MCP_TOKEN: handle.authToken }, stdio: 'pipe', windowsHide: true })
  children.push(child)
  const lines = createInterface({ input: child.stdout })
  const iterator = lines[Symbol.asyncIterator]()
  let sequence = 0
  return {
    child,
    async request(method: string, params?: unknown) {
      child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: ++sequence, method, params }) + '\n')
      const next = await iterator.next()
      if (next.done) throw new Error('stdio child closed before response')
      return JSON.parse(next.value)
    },
  }
}
afterEach(async () => {
  await Promise.all(children.splice(0).map(async (child) => {
    if (child.exitCode !== null || child.signalCode !== null) return
    const exited = once(child, 'exit')
    child.kill()
    await exited
  }))
  for (const scope of scopes.splice(0)) { await runInAcpContext(scope, stopWindowMcpServers); forgetAcpContext(scope) }
})

describe('window MCP stdio', () => {
  it.runIf(process.env.MONTREE_TEST_BUILT_MCP === '1')('真实构建入口在旧相对目录恢复后完成握手与工具调用', async () => {
    const scope = getAcpContext(`stdio-built-${process.pid}`)
    scopes.push(scope)
    const cwd = runInAcpContext(scope, () => resolveAgentCwd('out/main'))
    expect(cwd.source).toBe('sandbox')
    try {
      const handle = await runInAcpContext(scope, () => startWindowMcpServer({ readSnapshot: async () => 'built entry context' }))
      const c = client(handle, resolve('out/main/mcp-stdio.js'), cwd.cwd)
      expect((await c.request('initialize', { protocolVersion: '2025-03-26' })).result.capabilities.tools).toBeDefined()
      expect((await c.request('tools/list')).result.tools.map((tool: { name: string }) => tool.name)).toContain('montree_present')
      expect((await c.request('tools/call', { name: 'montree_read', arguments: { scope: 'viewport' } })).result.content[0].text).toBe('built entry context')
      const exited = once(c.child, 'exit')
      c.child.kill()
      await exited
    } finally { rmdirSync(cwd.cwd) }
  }, 15000)

  it('WSL uses the mounted executable, forward-slash Windows script path and explicit environment propagation', () => {
    if (process.platform !== 'win32') return
    const entry = windowMcpEntry({ url: 'test-pipe', authToken: 'test-token', close: async () => undefined }, 'montree', '\\\\wsl.localhost\\Ubuntu\\home\\tomy')[0]!
    expect(entry.command).toMatch(/^\/mnt\//)
    expect(entry.args[0]).not.toContain('\\')
    expect(entry.env.find((item) => item.name === 'WSLENV')?.value).toContain('MONTREE_MCP_PIPE')
    expect(entry.env.find((item) => item.name === 'WSLENV')?.value).toContain('ELECTRON_RUN_AS_NODE')
  })
  it('starts the stdio entry from an ASAR archive as in the release build', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'montree-asar-test-'))
    const source = join(directory, 'source')
    mkdirSync(source)
    copyFileSync(runtimeEntry, join(source, 'mcp-stdio.js'))
    writeFileSync(join(source, 'package.json'), '{"type":"module"}')
    const archive = join(directory, 'app.asar')
    const scope = getAcpContext('stdio-asar')
    scopes.push(scope)
    let child: ChildProcessWithoutNullStreams | undefined
    try {
      await createPackage(source, archive)
      const handle = await runInAcpContext(scope, () => startWindowMcpServer({ readSnapshot: async () => 'packaged' }))
      const c = client(handle, join(archive, 'mcp-stdio.js'))
      child = c.child
      expect((await c.request('tools/list')).result.tools.length).toBeGreaterThan(0)
    } finally {
      if (child && child.exitCode === null) { const exited = once(child, 'exit'); child.kill(); await exited }
      rmSync(archive, { force: true })
      rmSync(join(source, 'mcp-stdio.js'), { force: true })
      rmSync(join(source, 'package.json'), { force: true })
      rmdirSync(source)
      rmdirSync(directory)
    }
  }, 15000)

  it('Electron Node source entry discovers tools, reads the correct window, and reconnects to the same broker', async () => {
    const a = getAcpContext('stdio-a'), b = getAcpContext('stdio-b')
    scopes.push(a, b)
    const ha = await runInAcpContext(a, () => startWindowMcpServer({ readSnapshot: async () => 'window A' }))
    const hb = await runInAcpContext(b, () => startWindowMcpServer({ readSnapshot: async () => 'window B' }))
    expect(hb.url).not.toBe(ha.url)
    const ca = client(ha), cb = client(hb)
    expect((await ca.request('initialize', { protocolVersion: '2025-03-26' })).result.capabilities.tools.listChanged).toBe(false)
    const list = await ca.request('tools/list')
    expect(list.result.tools.map((tool: { name: string }) => tool.name)).toContain('montree_get_selection')
    const read = { name: 'montree_read', arguments: { scope: 'viewport' } }
    expect((await ca.request('tools/call', read)).result.content[0].text).toBe('window A')
    expect((await cb.request('tools/call', read)).result.content[0].text).toBe('window B')
    ca.child.stdin.end()
    expect(await runInAcpContext(a, () => startWindowMcpServer({ readSnapshot: async () => 'incorrect replacement' }))).toBe(ha)
    expect((await client(ha).request('tools/call', read)).result.content[0].text).toBe('window A')
    await runInAcpContext(a, stopWindowMcpServers)
    expect((await cb.request('tools/list')).result.tools.length).toBeGreaterThan(0)
  }, 15000)

  it('rejects a different window token and limits toc tools to their own scope', async () => {
    const a = getAcpContext('stdio-auth')
    scopes.push(a)
    const handle = await runInAcpContext(a, () => startWindowMcpServer({ readSnapshot: async () => 'toc' }, 'toc'))
    const socket = createConnection(handle.url)
    await new Promise<void>((resolve) => {
      socket.on('error', () => undefined)
      socket.on('connect', () => socket.write('{"token":"wrong"}\n'))
      socket.on('close', () => resolve())
    })
    const list = await client(handle).request('tools/list')
    expect(list.result.tools.every((tool: { name: string }) => tool.name.startsWith('toc_'))).toBe(true)
  }, 15000)

  it('persists metadata without selected text or credentials', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'montree-diagnostics-'))
    configureAcpDiagnostics(directory)
    const scope = getAcpContext('stdio-log')
    scopes.push(scope)
    try {
      const handle = await runInAcpContext(scope, () => startWindowMcpServer({ readSnapshot: async () => 'private selection' }))
      await client(handle).request('tools/call', { name: 'montree_read', arguments: { scope: 'viewport' } })
      const log = readFileSync(join(directory, 'acp-mcp.log'), 'utf8')
      expect(log).toContain('mcp.request')
      expect(log).toContain('montree_read')
      expect(log).not.toContain('private selection')
      expect(log).not.toContain(handle.authToken)
      expect(log).not.toContain(handle.url)
    } finally {
      configureAcpDiagnostics('')
      rmSync(join(directory, 'acp-mcp.log'), { force: true })
      rmdirSync(directory)
    }
  }, 15000)
})
