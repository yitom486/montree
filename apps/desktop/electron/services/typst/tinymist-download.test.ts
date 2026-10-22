import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { createServer, type Server } from 'node:http'
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { installTinymist, installedTinymist, ensureTinymist, tinymistInstallDir } from './tinymist-download'

let server: Server | null = null
afterEach(() => { server?.close(); server = null })

function fakeArchive() {
  const dir = mkdtempSync(join(tmpdir(), 'tinymist-src-'))
  mkdirSync(join(dir, 'tinymist-x86_64-unknown-linux-gnu'))
  writeFileSync(join(dir, 'tinymist-x86_64-unknown-linux-gnu', 'tinymist'), '#!/bin/sh\necho tinymist 0.15.8\n')
  const archive = join(dir, 'tinymist.tar.gz')
  execFileSync('tar', ['-czf', archive, '-C', dir, 'tinymist-x86_64-unknown-linux-gnu'])
  const bytes = readFileSync(archive)
  return { bytes, sha256: createHash('sha256').update(bytes).digest('hex') }
}
async function serve(body: Buffer): Promise<{ url: string; hits: () => number }> {
  let hits = 0
  server = createServer((_, res) => { hits++; res.writeHead(200, { 'Content-Length': body.length }); res.end(body) })
  await new Promise<void>((resolve) => server!.listen(0, '127.0.0.1', resolve))
  const address = server.address() as { port: number }
  return { url: `http://127.0.0.1:${address.port}`, hits: () => hits }
}

describe.skipIf(process.platform === 'win32')('Tinymist 按需下载', () => {
  it('下载→校验→解压→原子就位，带进度；再次调用不重复下载', async () => {
    const { bytes, sha256 } = fakeArchive()
    const { url, hits } = await serve(bytes)
    const root = mkdtempSync(join(tmpdir(), 'tinymist-root-'))
    const license = join(root, 'LICENSE.src'); writeFileSync(license, 'license')
    const asset = { name: 'tinymist.tar.gz', sha256, executable: 'tinymist' } as never
    const phases: string[] = []
    let lastReceived = 0
    const exe = await installTinymist({ root, licensePath: license, platform: 'linux', arch: 'x64', baseUrl: url, asset, onProgress: (p) => { phases.push(p.phase); lastReceived = p.received } })
    expect(exe).toBe(join(tinymistInstallDir(root, 'linux', 'x64'), 'tinymist'))
    expect(execFileSync(exe, { encoding: 'utf8' })).toContain('tinymist 0.15.8')
    expect(lastReceived).toBe(bytes.length)
    expect(phases[0]).toBe('download'); expect(phases.slice(-3)).toEqual(['verify', 'extract', 'done'])
    expect(readFileSync(join(tinymistInstallDir(root, 'linux', 'x64'), 'LICENSE'), 'utf8')).toBe('license')
    expect(await installedTinymist(root, 'linux', 'x64', asset)).toBe(exe)
    await installTinymist({ root, licensePath: license, platform: 'linux', arch: 'x64', baseUrl: url, asset })
    expect(hits()).toBe(1)
    expect(readdirSync(root).filter((name) => name.startsWith('.staging'))).toEqual([])
  })

  it('SHA-256 不匹配时拒绝安装且不留半成品', async () => {
    const { bytes } = fakeArchive()
    const { url } = await serve(bytes)
    const root = mkdtempSync(join(tmpdir(), 'tinymist-root-'))
    const asset = { name: 'tinymist.tar.gz', sha256: '0'.repeat(64), executable: 'tinymist' } as never
    await expect(installTinymist({ root, licensePath: join(root, 'none'), platform: 'linux', arch: 'x64', baseUrl: url, asset })).rejects.toThrow(/SHA-256/)
    expect(readdirSync(root)).toEqual([])
    expect(await installedTinymist(root, 'linux', 'x64', asset)).toBeNull()
  })

  it('并发调用共享一次下载', async () => {
    const { bytes, sha256 } = fakeArchive()
    const { url, hits } = await serve(bytes)
    const root = mkdtempSync(join(tmpdir(), 'tinymist-root-'))
    const asset = { name: 'tinymist.tar.gz', sha256, executable: 'tinymist' } as never
    const options = { root, licensePath: join(root, 'none'), platform: 'linux', arch: 'x64', baseUrl: url, asset }
    const [a, b] = await Promise.all([ensureTinymist(options), ensureTinymist(options)])
    expect(a).toBe(b); expect(hits()).toBe(1)
  })

  it('HTTP 错误给出可读信息', async () => {
    server = createServer((_, res) => { res.writeHead(404); res.end() })
    await new Promise<void>((resolve) => server!.listen(0, '127.0.0.1', resolve))
    const root = mkdtempSync(join(tmpdir(), 'tinymist-root-'))
    await expect(installTinymist({ root, licensePath: '', platform: 'linux', arch: 'x64', baseUrl: `http://127.0.0.1:${(server.address() as { port: number }).port}` })).rejects.toThrow(/HTTP 404/)
  })
})
