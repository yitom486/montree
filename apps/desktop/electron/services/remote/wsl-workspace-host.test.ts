import { spawn, type ChildProcess } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * T3 动态 UNC 拦截：在 Electron main 的 fs 调用边界生效。
 * Remote 工作区的新链路（bootstrap/浏览/stat/安装）若触碰 UNC 路径
 *（`\\wsl…` / `//wsl.localhost` / `wsl$`），直接抛错使测试失败；
 * 仅源码 rg 不算验收。允许 Windows 本地资源/日志/产物的本机路径。
 */
function isBannedUncPath(value: unknown): boolean {
  if (typeof value !== 'string') return false
  return /\\\\wsl|wsl\.localhost|wsl\$/i.test(value)
}

function guardModule<T extends Record<string, unknown>>(orig: T, keys: string[]): T {
  const patched: Record<string, unknown> = { ...orig }
  for (const key of keys) {
    const fn = orig[key]
    if (typeof fn !== 'function') continue
    patched[key] = (...args: unknown[]) => {
      if (args.length > 0 && isBannedUncPath(args[0])) {
        throw new Error(`B1 禁止 Remote 走 UNC 文件 I/O: ${String(args[0])}`)
      }
      return (fn as (...a: unknown[]) => unknown)(...args)
    }
  }
  return patched as T
}

vi.mock('node:fs', async (importOriginal) => {
  const orig = await importOriginal<typeof import('node:fs')>()
  return guardModule(orig as unknown as Record<string, unknown>, [
    'readFileSync',
    'writeFileSync',
    'appendFileSync',
    'statSync',
    'lstatSync',
    'readdirSync',
    'realpathSync',
    'existsSync',
    'mkdirSync',
    'rmSync',
    'renameSync',
    'copyFileSync',
    'watch',
  ]) as unknown as typeof import('node:fs')
})

vi.mock('node:fs/promises', async (importOriginal) => {
  const orig = await importOriginal<typeof import('node:fs/promises')>()
  return guardModule(orig as unknown as Record<string, unknown>, [
    'readFile',
    'writeFile',
    'appendFile',
    'stat',
    'lstat',
    'readdir',
    'realpath',
    'access',
    'mkdir',
    'rm',
    'rename',
    'copyFile',
    'cp',
    'open',
    'opendir',
    'watch',
  ]) as unknown as typeof import('node:fs/promises')
})

import { toWorkspaceRelative, WslWorkspaceHost } from './wsl-workspace-host'
import type { WslRunner } from './wsl-bootstrap'

const DISTRO = 'Ubuntu'

function fakeProbeRunner(node: {
  nodePath: string | null
  nodeVersion?: string | null
  nodePlatform?: string | null
}): { runner: WslRunner; calls: { args: string[]; stdin?: Buffer }[] } {
  const calls: { args: string[]; stdin?: Buffer }[] = []
  const runner: WslRunner = async (args, stdin) => {
    calls.push({ args, stdin })
    const script = args[args.length - 1] ?? ''
    // 安装脚本：模拟远端双校验 + 原子启用
    if (script.includes('mv "$stage" "$final"')) {
      if (script.includes('__FAIL__')) {
        return { exitCode: 3, stdout: Buffer.alloc(0), stderr: 'bundle 校验失败' }
      }
      const home = '/home/test'
      const build = /staging-([^\s"']+)/.exec(script)?.[1] ?? 'build-x'
      return {
        exitCode: 0,
        stdout: Buffer.from(`installed=${home}/.cache/montree/remote-server/${build}\n`, 'utf8'),
        stderr: '',
      }
    }
    if (script.includes('cat > "$stage/')) {
      return { exitCode: 0, stdout: Buffer.alloc(0), stderr: '' }
    }
    // 探针脚本
    const lines = [
      'home=/home/test',
      'shell=/bin/bash',
      node.nodePath ? `node=${node.nodePath}` : 'node=NONE',
      node.nodePath && node.nodeVersion
        ? `nodever=${node.nodeVersion} platform=${node.nodePlatform ?? 'linux'} arch=x64`
        : 'nodever=BROKEN',
    ]
    return { exitCode: 0, stdout: Buffer.from(`${lines.join('\n')}\n`, 'utf8'), stderr: 'MOTD banner（应被分离）' }
  }
  return { runner, calls }
}

describe('toWorkspaceRelative（协议只传相对路径）', () => {
  it('根内绝对路径转相对，根本身为空', () => {
    expect(toWorkspaceRelative('/home/u/blog', '/home/u/blog')).toEqual({ ok: true, rel: '' })
    expect(toWorkspaceRelative('/home/u/blog', '/home/u/blog/a.md')).toEqual({ ok: true, rel: 'a.md' })
    expect(toWorkspaceRelative('/home/u/blog/', '/home/u/blog/sub/')).toEqual({ ok: true, rel: 'sub' })
  })

  it('越界与非绝对路径拒绝', () => {
    expect(toWorkspaceRelative('/home/u/blog', '/home/u/other').ok).toBe(false)
    expect(toWorkspaceRelative('/home/u/blog', 'relative').ok).toBe(false)
  })
})

describe('WslWorkspaceHost 未连接行为（禁回落/空树/假成功）', () => {
  it('浏览与 stat 返回 REMOTE_NOT_CONNECTED', async () => {
    const host = new WslWorkspaceHost()
    const browse = await host.browseDirectory('/home/u')
    expect(browse.ok).toBe(false)
    if (!browse.ok) expect(browse.error.code).toBe('REMOTE_NOT_CONNECTED')
    const stat = await host.statPath('/home/u/a.md')
    expect(stat.ok).toBe(false)
    if (!stat.ok) expect(stat.error.code).toBe('REMOTE_NOT_CONNECTED')
    expect(host.status()).toBeNull()
  })

  it('disconnect 后代际递增、旧状态失效', async () => {
    const host = new WslWorkspaceHost()
    host.disconnect()
    expect(host.status()).toBeNull()
    const browse = await host.browseDirectory('/home/u')
    expect(browse.ok).toBe(false)
  })
})

describe('WslWorkspaceHost 连接失败路径（明确错误）', () => {
  const assets = { bundlePath: 'C:\\none\\x.cjs', manifestPath: 'C:\\none\\m.json' }

  it('探针失败 → REMOTE_CONNECTION_FAILED', async () => {
    const host = new WslWorkspaceHost({
      runner: async () => ({ exitCode: 1, stdout: Buffer.alloc(0), stderr: 'boom' }),
      serverAssets: assets,
    })
    const res = await host.connect(DISTRO, '/home/test')
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.error.code).toBe('REMOTE_CONNECTION_FAILED')
  })

  it('远端无 Node → REMOTE_NODE_MISSING（含安装指引）', async () => {
    const { runner } = fakeProbeRunner({ nodePath: null })
    const host = new WslWorkspaceHost({ runner, serverAssets: assets })
    const res = await host.connect(DISTRO, '/home/test')
    expect(res.ok).toBe(false)
    if (!res.ok) {
      expect(res.error.code).toBe('REMOTE_NODE_MISSING')
      expect(res.error.message).toContain('sudo')
    }
  })

  it('Windows Node 冒充 → REMOTE_WINDOWS_NODE', async () => {
    const { runner } = fakeProbeRunner({
      nodePath: '/mnt/c/Program Files/nodejs/node',
      nodeVersion: 'v22.14.0',
      nodePlatform: 'win32',
    })
    const host = new WslWorkspaceHost({ runner, serverAssets: assets })
    const res = await host.connect(DISTRO, '/home/test')
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.error.code).toBe('REMOTE_WINDOWS_NODE')
  })

  it('产物缺失 → REMOTE_INSTALL_FAILED（不伪装已安装）', async () => {
    const { runner } = fakeProbeRunner({
      nodePath: '/usr/bin/node',
      nodeVersion: 'v22.14.0',
      nodePlatform: 'linux',
    })
    const host = new WslWorkspaceHost({ runner, serverAssets: assets })
    const res = await host.connect(DISTRO, '/home/test')
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.error.code).toBe('REMOTE_INSTALL_FAILED')
  })
})

describe('WslWorkspaceHost 本地 loopback（正统 bundle + 本机 Node）', () => {
  let root: string
  let serverDir: string

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'montree-wsl-root-'))
    writeFileSync(join(root, 'a.md'), '# hello\n', 'utf8')
    mkdirSync(join(root, 'sub'))
    writeFileSync(join(root, '空 格-中文.md'), 'unicode\n', 'utf8')
    serverDir = mkdtempSync(join(tmpdir(), 'montree-wsl-srv-'))
  })

  afterEach(() => {
    rmSync(root, { recursive: true, force: true })
    rmSync(serverDir, { recursive: true, force: true })
  })

  it('建连→浏览→外部写入回读→stat→断开（全程无 UNC I/O）', async () => {
    // 用正统构建脚本产出 bundle（T9：可部署产物定位）
    const { execFileSync } = await import('node:child_process')
    execFileSync('bun', ['run', 'packages/remote-server/scripts/build.ts', '--outDir', serverDir], {
      stdio: 'pipe',
    })
    const bundlePath = join(serverDir, 'montree-remote-server.cjs')
    const manifestPath = join(serverDir, 'manifest.json')

    const { runner, calls } = fakeProbeRunner({
      // 探针报 Linux 风格路径/平台（产品行为）；spawn 接缝实际拉起本机 Node
      nodePath: '/usr/bin/node',
      nodeVersion: process.version,
      nodePlatform: 'linux',
    })
    // 安装落到刚构建的 bundle 所在目录（模拟远端已启用产物）
    const installRunner: WslRunner = async (args, stdin) => {
      calls.push({ args, stdin })
      const script = args[args.length - 1] ?? ''
      if (script.includes('mv "$stage" "$final"')) {
        return { exitCode: 0, stdout: Buffer.from(`installed=${serverDir}\n`, 'utf8'), stderr: '' }
      }
      return runner(args, stdin)
    }
    // spawn 接缝：把 wsl.exe 换成本机直启（传输启动器可替换，协议不变）。
    // 注意：忽略探针报的远端 nodePath，直接拉起本机 Node 做 loopback。
    const spawnFn = (command: string, args: string[]): ChildProcess => {
      expect(command).toBe('wsl.exe')
      const execIndex = args.indexOf('--exec')
      expect(execIndex).toBeGreaterThanOrEqual(0)
      const rest = args.slice(execIndex + 2)
      return spawn(process.execPath, rest, { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] })
    }
    const logs: string[] = []
    const host = new WslWorkspaceHost({
      runner: installRunner,
      spawnFn,
      serverAssets: { bundlePath, manifestPath },
      expectedPlatform: process.platform,
      // loopback 用本地临时根：规划直接采用，不走远端探测
      planConnection: async (distro, linuxRoot) => ({
        ok: true as const,
        plan: {
          distro,
          linuxRoot: linuxRoot ?? root,
          home: '/home/test',
          probe: {
            home: '/home/test',
            loginShell: '/bin/bash',
            nodePath: '/usr/bin/node',
            nodeVersion: process.version,
            nodePlatform: 'linux',
            nodeArch: process.arch,
          },
        },
      }),
      onLog: (line) => logs.push(line),
    })

    const connected = await host.connect(DISTRO, root)
    expect(connected.ok).toBe(true)
    if (!connected.ok) return
    expect(connected.value.handshake?.protocolMajor).toBe(1)
    expect(connected.value.handshake?.nodeVersion).toBe(process.version)
    // 安装确经管道（stdin 传产物字节），脚本含 temp→校验→原子启用
    const installCall = calls.find((c) => (c.args.at(-1) ?? '').includes('mv "$stage" "$final"'))
    expect(installCall).toBeDefined()

    const first = await host.browseDirectory()
    expect(first.ok).toBe(true)
    if (!first.ok) return
    const names = first.value.entries.map((e) => e.name)
    expect(names).toContain('a.md')
    expect(names).toContain('sub')
    expect(names).toContain('空 格-中文.md')
    expect(first.value.currentPath).toBe(root)
    // 目录排前面
    expect(first.value.entries[0]?.isDirectory).toBe(true)

    // 外部写入经服务回读（非 UNC）
    appendFileSync(join(root, 'external.md'), 'from outside\n')
    const second = await host.browseDirectory()
    expect(second.ok && second.value.entries.some((e) => e.name === 'external.md')).toBe(true)

    const st = await host.statPath(`${root.replace(/\\/g, '/')}/a.md`)
    expect(st.ok).toBe(true)
    if (!st.ok) return
    expect(st.value.size).toBeGreaterThan(0)
    expect(st.value.path).toBe('a.md')

    const missing = await host.statPath(`${root.replace(/\\/g, '/')}/no-such.md`)
    expect(missing.ok).toBe(false)
    // 缺失文件必须明确失败（不回空成功）：正统服务返回 ENOENT/FILE_NOT_FOUND 类显式码
    if (!missing.ok) expect(['FILE_NOT_FOUND', 'ENOENT']).toContain(missing.error.code)

    host.disconnect()
    expect(host.status()).toBeNull()
    const after = await host.browseDirectory()
    expect(after.ok).toBe(false)
    // 日志脱敏：无正文内容
    expect(logs.join('\n')).not.toContain('# hello')
  }, 60000)
})
