import { EventEmitter } from 'node:events'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { IPty } from 'node-pty'
import { TerminalService } from './terminal-service'
vi.mock('node:child_process', () => ({ spawn: vi.fn(() => new EventEmitter()) }))
let root: string, data: (value: string) => void, exit: (event: { exitCode: number }) => void, service: TerminalService
const events = vi.fn(), write = vi.fn(), resize = vi.fn(), kill = vi.fn()
const spawn = vi.fn((_file: string, _args: string[] | string, _options: unknown) => ({ pid: 12345678, write, resize, kill,
  onData: (callback: typeof data) => { data = callback; return { dispose() {} } },
  onExit: (callback: typeof exit) => { exit = callback; return { dispose() {} } },
}) as unknown as IPty)
beforeEach(async () => { vi.clearAllMocks(); vi.spyOn(process, 'kill').mockReturnValue(true); root = await mkdtemp(join(tmpdir(), 'montree-terminal-')); service = new TerminalService(events, async () => ({ spawn })) })
afterEach(async () => { service.dispose(); vi.restoreAllMocks(); await rm(root, { recursive: true, force: true }) })
const workspace = () => ({ id: 'local', kind: 'local' as const, target: '', rootLabel: root })
describe('workspace terminal', () => {
  it('creates an interactive PTY, forwards input and dimensions, records exit', async () => {
    const term = await service.create('a', workspace(), { cols: 90, rows: 30 })
    expect(spawn.mock.calls[0]).toMatchObject([expect.any(String), expect.any(Array), { cwd: root, cols: 90, rows: 30 }])
    service.write('a', term.id, 'git status\r'); expect(write).toHaveBeenCalledWith('git status\r')
    service.resize('a', term.id, 100, 40); expect(resize).toHaveBeenCalledWith(100, 40)
    data('first'); const first = service.read('a', term.id)
    data('second'); expect(service.read('a', term.id, first.cursor).output).toBe('second')
    exit({ exitCode: 0 }); expect(service.read('a', term.id).exitCode).toBe(0)
    expect(() => service.write('a', term.id, 'late')).toThrow('退出')
  })
  it('isolates terminals between windows', async () => {
    const term = await service.create('a', workspace())
    expect(() => service.read('b', term.id)).toThrow('不属于')
    expect(() => service.write('b', term.id, 'danger')).toThrow('不属于')
    expect(() => service.close('b', term.id)).toThrow('不属于')
    service.disposeOwner('b'); expect(service.list('a').map(row => row.id)).toEqual([term.id])
  })
  it('bounds retained output and reports a truncated cursor', async () => {
    const term = await service.create('a', workspace()); data('x'.repeat(300000))
    const output = service.read('a', term.id)
    expect(output.output.length).toBeLessThan(300000); expect(output.truncated).toBe(true); expect(output.cursor).toBe(300000)
    expect(() => service.read('a', term.id, -1)).toThrow()
    expect(() => service.resize('a', term.id, Number.NaN, 30)).toThrow()
  })
  it('does not spawn after owner disposal during asynchronous loading', async () => {
    let release!: () => void
    const pendingLoad = new Promise<void>(resolve => { release = resolve })
    const loading = new TerminalService(events, async () => { await pendingLoad; return { spawn } })
    const pending = loading.create('a', workspace()).catch((error: unknown) => error)
    await new Promise(resolve => setTimeout(resolve, 10)); loading.disposeOwner('a'); release()
    expect(await pending).toBeInstanceOf(Error); expect(spawn).not.toHaveBeenCalled()
  })
  it('rejects stale workspaces, invalid dimensions and unavailable shells', async () => {
    await expect(service.create('a', workspace(), {}, () => false)).rejects.toThrow('工作区已变更')
    await expect(service.create('a', workspace(), { cols: 999999 })).rejects.toThrow('尺寸')
    await expect(service.create('a', workspace(), { profile: 'arbitrary-executable' })).rejects.toThrow('Shell')
    expect(spawn).not.toHaveBeenCalled()
  })
  it.runIf(process.platform === 'win32')('launches WSL in the bound distro and Linux directory without a local fallback', async () => {
    await service.create('a', { id: 'wsl:Ubuntu:/home/test', kind: 'wsl', target: 'Ubuntu', rootLabel: '/home/test' })
    expect(spawn.mock.calls[0][1]).toEqual(['--distribution', 'Ubuntu', '--cd', '/home/test', '--exec', 'bash', '-l'])
  })
})
