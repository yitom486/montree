import { describe, expect, it, vi } from 'vitest'
vi.mock('./remote-service', () => ({
  listWslDistros: async () => ({ ok: true, value: [{ name: 'Ubuntu' }] }),
  getWslHome: async () => ({ ok: true, value: '/home/tomy' }),
}))
import {
  checkProbeNodeUsable,
  installRemoteServerViaPipe,
  isWindowsNodePath,
  parseProbeOutput,
  planWslConnection,
  probeWslEnvironment,
  resolveRemoteBaseDir,
  resolveRemoteInstallDir,
  shSingleQuote,
  type WslRunner,
  type WslRunnerResult,
} from './wsl-bootstrap'
import { listWslDistros } from './remote-service'

function canned(stdout: string, exitCode = 0, stderr = ''): WslRunner {
  return async (): Promise<WslRunnerResult> => ({
    exitCode,
    stdout: Buffer.from(stdout, 'utf8'),
    stderr,
  })
}

const GOOD_PROBE = [
  'home=/home/tomy',
  'shell=/bin/bash',
  'node=/home/tomy/.local/bin/node',
  'nodever=v22.14.0 platform=linux arch=x64',
].join('\n')

describe('shSingleQuote（含空格/非 ASCII 路径）', () => {
  it('空格与中文原样包裹，单引号转义', () => {
    expect(shSingleQuote('/home/u/my blog/中文 dir')).toBe("'/home/u/my blog/中文 dir'")
    expect(shSingleQuote("a'b")).toBe(`'a'\\''b'`)
  })
})

describe('远端安装目录（动态 home + buildId，不写死）', () => {
  it('从远端 home 派生，去除尾部斜杠', () => {
    expect(resolveRemoteBaseDir('/home/tomy/')).toBe('/home/tomy/.cache/montree/remote-server')
    expect(resolveRemoteInstallDir('/home/tomy', 'b1-abc')).toBe(
      '/home/tomy/.cache/montree/remote-server/b1-abc',
    )
  })
})

describe('Windows Node 拒绝（/mnt/ 或 .exe 冒充）', () => {
  it('拦截 WSL PATH 中的 Windows node', () => {
    expect(isWindowsNodePath('/mnt/c/Program Files/nodejs/node')).toBe(true)
    expect(isWindowsNodePath('/mnt/c/Program Files/nodejs/node.exe')).toBe(true)
    expect(isWindowsNodePath('C:\\Program Files\\nodejs\\node.exe')).toBe(true)
    expect(isWindowsNodePath('node.exe')).toBe(true)
  })

  it('放行原生 Linux Node', () => {
    expect(isWindowsNodePath('/usr/bin/node')).toBe(false)
    expect(isWindowsNodePath('/home/tomy/.local/bin/node')).toBe(false)
  })
})

describe('parseProbeOutput（stderr 杂音分离，只认 stdout KV）', () => {
  it('解析 home/shell/node 三行', () => {
    const probe = parseProbeOutput(GOOD_PROBE)
    expect(probe).toMatchObject({
      home: '/home/tomy',
      loginShell: '/bin/bash',
      nodePath: '/home/tomy/.local/bin/node',
      nodeVersion: 'v22.14.0',
      nodePlatform: 'linux',
      nodeArch: 'x64',
    })
  })

  it('无 Node 时 nodePath 为 null', () => {
    const probe = parseProbeOutput('home=/root\nshell=/bin/bash\nnode=NONE\n')
    expect(probe?.nodePath).toBeNull()
  })

  it('缺 home/shell 返回 null', () => {
    expect(parseProbeOutput('MOTD banner\nnode=NONE\n')).toBeNull()
  })
})

describe('checkProbeNodeUsable（明确错误，不静默）', () => {
  it('缺失报 REMOTE_NODE_MISSING', () => {
    const r = checkProbeNodeUsable({
      home: '/home/u',
      loginShell: '/bin/bash',
      nodePath: null,
      nodeVersion: null,
      nodePlatform: null,
      nodeArch: null,
    })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.code).toBe('REMOTE_NODE_MISSING')
  })

  it('Windows 路径报 REMOTE_WINDOWS_NODE', () => {
    const r = checkProbeNodeUsable({
      home: '/home/u',
      loginShell: '/bin/bash',
      nodePath: '/mnt/c/Program Files/nodejs/node',
      nodeVersion: 'v22.14.0',
      nodePlatform: 'win32',
      nodeArch: 'x64',
    })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.code).toBe('REMOTE_WINDOWS_NODE')
  })

  it('低版本报 REMOTE_NODE_VERSION', () => {
    const r = checkProbeNodeUsable({
      home: '/home/u',
      loginShell: '/bin/bash',
      nodePath: '/usr/bin/node',
      nodeVersion: 'v18.20.0',
      nodePlatform: 'linux',
      nodeArch: 'x64',
    })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.code).toBe('REMOTE_NODE_VERSION')
  })

  it('合格 Linux Node 放行', () => {
    const r = checkProbeNodeUsable({
      home: '/home/u',
      loginShell: '/bin/bash',
      nodePath: '/usr/bin/node',
      nodeVersion: 'v22.14.0',
      nodePlatform: 'linux',
      nodeArch: 'x64',
    })
    expect(r).toEqual({ ok: true, nodePath: '/usr/bin/node' })
  })
})

describe('installRemoteServerViaPipe（temp→校验→原子启用）', () => {
  const bundle = Buffer.from('fake-bundle-bytes')
  const manifest = Buffer.from('{"buildId":"b1-x"}')

  it('两次管道传输 + 远端双校验 + 原子 mv', async () => {
    const calls: { args: string[]; stdin?: Buffer }[] = []
    const runner: WslRunner = async (args, stdin) => {
      calls.push({ args, stdin })
      if (calls.length === 1) return { exitCode: 0, stdout: Buffer.alloc(0), stderr: '' }
      return {
        exitCode: 0,
        stdout: Buffer.from('installed=/home/tomy/.cache/montree/remote-server/b1-x\n', 'utf8'),
        stderr: '',
      }
    }
    const res = await installRemoteServerViaPipe({
      distro: 'Ubuntu',
      home: '/home/tomy',
      buildId: 'b1-x',
      bundleName: 'montree-remote-server.cjs',
      bundleBytes: bundle,
      bundleSha256: 'sha-of-bundle',
      manifestName: 'manifest.json',
      manifestBytes: manifest,
      manifestSha256: 'sha-of-manifest',
      runner,
    })
    expect(res).toEqual({ ok: true, installDir: '/home/tomy/.cache/montree/remote-server/b1-x' })
    expect(calls).toHaveLength(2)
    // 经 wsl.exe 管道，不走 UNC；stdin 即产物字节
    expect(calls[0]?.args.slice(0, 4)).toEqual(['-d', 'Ubuntu', '--exec', 'sh'])
    expect(calls[0]?.stdin).toBe(bundle)
    expect(calls[1]?.stdin).toBe(manifest)
    const script = calls[1]?.args[5] ?? ''
    expect(script).toContain('sha256sum')
    expect(script).toContain('rm -rf "$stage"')
    expect(script).toContain('mv "$stage" "$final"')
    expect(script).toContain('sha-of-bundle')
  })

  it('校验失败返回 REMOTE_INSTALL_FAILED，不伪装成功', async () => {
    const runner: WslRunner = async (_args, stdin) => {
      if (stdin === bundle) return { exitCode: 0, stdout: Buffer.alloc(0), stderr: '' }
      return { exitCode: 3, stdout: Buffer.alloc(0), stderr: 'bundle 校验失败' }
    }
    const res = await installRemoteServerViaPipe({
      distro: 'Ubuntu',
      home: '/home/tomy',
      buildId: 'b1-x',
      bundleName: 'montree-remote-server.cjs',
      bundleBytes: bundle,
      bundleSha256: 'sha-of-bundle',
      manifestName: 'manifest.json',
      manifestBytes: manifest,
      manifestSha256: 'sha-of-manifest',
      runner,
    })
    expect(res.ok).toBe(false)
    if (!res.ok) {
      expect(res.code).toBe('REMOTE_INSTALL_FAILED')
      expect(res.message).toContain('bundle 校验失败')
    }
  })
})

describe('probeWslEnvironment', () => {
  it('wsl.exe 失败返回明确错误', async () => {
    const res = await probeWslEnvironment('Ubuntu', canned('', 1, 'wsl: 发行版不存在'))
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.code).toBe('REMOTE_CONNECTION_FAILED')
  })
})

describe('planWslConnection（复用发行版发现，不写死）', () => {
  it('显式 root 直接采用，home 取探针', async () => {
    const distros = await listWslDistros()
    const distro =
      distros.ok && distros.value.length > 0 ? distros.value[0]!.name : 'Ubuntu'
    const plan = await planWslConnection(distro, '/tmp/montree-plan-probe', canned(GOOD_PROBE))
    expect(plan.ok).toBe(true)
    if (!plan.ok) return
    expect(plan.plan.linuxRoot).toBe('/tmp/montree-plan-probe')
    expect(plan.plan.home).toBe('/home/tomy')
  })
})
