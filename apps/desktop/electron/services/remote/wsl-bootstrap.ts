import { spawn } from 'node:child_process'
import { WORKSPACE_MIN_NODE_MAJOR } from '@montree/contracts'
import { checkNodeVersionCompatible } from '@montree/workspace-core'
import { getWslHome, listWslDistros } from './remote-service'

/**
 * WSL 远端 bootstrap（B1）：发行版 + root 选择复用
 * listWslDistros/getWslHome；经 wsl.exe 管道安装正统 A2 服务产物。
 *
 * 硬约束：
 * - 传输安装走 stdin 管道（staging→双文件校验→原子 mv 启用），不依赖 UNC/SFTP。
 * - 目标目录从远端 $HOME 动态得出，按 buildId 存放，不写死发行版/用户/路径。
 * - 探针 stdout 按 KV 行解析，stderr 杂音直接丢弃（分离 banner）。
 * - 探测实际登录 shell；拒绝 PATH 中的 Windows node.exe（/mnt/ 或 .exe）。
 * - 含空格/非 ASCII 路径全程单引号转义。
 * - 任何失败返回明确错误，禁静默回落 UNC、空树、假保存。
 * - 服务启动与握手复用 `RemoteServerPipeClient`（A2），本模块只负责
 *   wsl.exe 侧的探测与管道安装。
 */

export interface WslRunnerResult {
  exitCode: number
  stdout: Buffer
  stderr: string
}

/** 可注入的 wsl.exe 执行器（单测用假实现，产品用真 spawn）。 */
export type WslRunner = (
  args: string[],
  stdin?: Buffer,
  timeoutMs?: number,
) => Promise<WslRunnerResult>

export function realWslRunner(
  args: string[],
  stdin?: Buffer,
  timeoutMs = 30000,
): Promise<WslRunnerResult> {
  return new Promise((resolve) => {
    let child
    try {
      child = spawn('wsl.exe', args, { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] })
    } catch (e) {
      resolve({ exitCode: -1, stdout: Buffer.alloc(0), stderr: e instanceof Error ? e.message : String(e) })
      return
    }
    const out: Buffer[] = []
    let stderr = ''
    const timer = setTimeout(() => {
      child.kill()
      resolve({ exitCode: -1, stdout: Buffer.concat(out), stderr: `${stderr}\nTimed out after ${timeoutMs}ms` })
    }, timeoutMs)
    child.stdout?.on('data', (c: Buffer) => out.push(Buffer.from(c)))
    child.stderr?.on('data', (c: Buffer) => {
      stderr += c.toString('utf8')
      if (stderr.length > 8192) stderr = stderr.slice(-8192)
    })
    child.on('error', (e: Error) => {
      clearTimeout(timer)
      resolve({ exitCode: -1, stdout: Buffer.concat(out), stderr: `${stderr} ${e.message}`.trim() })
    })
    child.on('close', (code: number | null) => {
      clearTimeout(timer)
      resolve({ exitCode: code ?? -1, stdout: Buffer.concat(out), stderr: stderr.trim() })
    })
    if (stdin && stdin.length > 0) {
      child.stdin?.write(stdin, (e?: Error | null) => {
        if (e) {
          clearTimeout(timer)
          resolve({ exitCode: -1, stdout: Buffer.concat(out), stderr: `stdin 写入失败: ${e.message}` })
          return
        }
        child.stdin?.end()
      })
    } else {
      child.stdin?.end()
    }
  })
}

/** POSIX 单引号转义（含空格/非 ASCII 路径安全）。 */
export function shSingleQuote(s: string): string {
  return `'${s.replace(/'/g, `'\\''`)}'`
}

/** 远端安装基址：$HOME/.cache/montree/remote-server（动态 home，不写死）。 */
export function resolveRemoteBaseDir(home: string): string {
  const clean = home.trim().replace(/\/+$/, '') || '/'
  return `${clean}/.cache/montree/remote-server`
}

export function resolveRemoteInstallDir(home: string, buildId: string): string {
  return `${resolveRemoteBaseDir(home)}/${buildId}`
}

/** 拒绝 WSL PATH 中的 Windows Node（/mnt/ 映射或 .exe），防冒充 Linux Node。 */
export function isWindowsNodePath(nodePath: string): boolean {
  const p = nodePath.trim()
  return p.includes('/mnt/') || p.toLowerCase().endsWith('.exe') || p.includes(':\\') || /^[a-zA-Z]:\//.test(p)
}

export interface WslProbe {
  home: string
  loginShell: string
  nodePath: string | null
  nodeVersion: string | null
  nodePlatform: string | null
  nodeArch: string | null
}

const PROBE_SCRIPT = [
  'printf \'home=%s\\n\' "$HOME"',
  'login_shell=""',
  'if command -v getent >/dev/null 2>&1; then login_shell=$(getent passwd "$(id -un 2>/dev/null)" 2>/dev/null | cut -d: -f7); fi',
  'if [ -z "$login_shell" ]; then login_shell="$SHELL"; fi',
  'if [ -z "$login_shell" ]; then login_shell="/bin/sh"; fi',
  'printf \'shell=%s\\n\' "$login_shell"',
  'if command -v node >/dev/null 2>&1; then',
  '  node_bin=$(command -v node)',
  '  printf \'node=%s\\n\' "$node_bin"',
  '  "$node_bin" -e \'console.log("nodever=" + process.version + " platform=" + process.platform + " arch=" + process.arch)\' 2>/dev/null || printf \'nodever=BROKEN\\n\'',
  'else',
  '  printf \'node=NONE\\n\'',
  'fi',
].join('\n')

/** 解析探针 stdout（KV 行；stderr 杂音直接丢弃=分离 banner）。 */
export function parseProbeOutput(stdout: string): WslProbe | null {
  const lines = stdout.replace(/\r/g, '').split('\n')
  const get = (key: string): string | null => {
    const line = lines.find((l) => l.startsWith(`${key}=`))
    return line ? line.slice(key.length + 1) : null
  }
  const home = get('home')
  const shell = get('shell')
  if (!home || !shell) return null
  const nodeRaw = get('node')
  const nodeverRaw = get('nodever')
  let nodePath: string | null = null
  let nodeVersion: string | null = null
  let nodePlatform: string | null = null
  let nodeArch: string | null = null
  if (nodeRaw && nodeRaw !== 'NONE') nodePath = nodeRaw.trim() || null
  if (nodeverRaw && nodeverRaw !== 'BROKEN') {
    const m = /(\S+)\s+platform=(\S+)\s+arch=(\S+)/.exec(nodeverRaw)
    if (m) {
      nodeVersion = m[1] ?? null
      nodePlatform = m[2] ?? null
      nodeArch = m[3] ?? null
    }
  }
  return { home: home.trim(), loginShell: shell.trim(), nodePath, nodeVersion, nodePlatform, nodeArch }
}

export async function probeWslEnvironment(
  distro: string,
  runner: WslRunner = realWslRunner,
): Promise<{ ok: true; probe: WslProbe } | { ok: false; code: string; message: string }> {
  if (process.platform !== 'win32') {
    return { ok: false, code: 'REMOTE_CONNECTION_FAILED', message: 'WSL bootstrap 仅支持 Windows' }
  }
  const res = await runner(['-d', distro, '--exec', 'sh', '-c', PROBE_SCRIPT], undefined, 15000)
  if (res.exitCode !== 0) {
    return {
      ok: false,
      code: 'REMOTE_CONNECTION_FAILED',
      message: `WSL 发行版不可用 (${distro})：${res.stderr || `exit=${res.exitCode}`}（未改 wsl 配置）`,
    }
  }
  const probe = parseProbeOutput(res.stdout.toString('utf8'))
  if (!probe || !probe.home.startsWith('/')) {
    return { ok: false, code: 'REMOTE_CONNECTION_FAILED', message: `WSL 环境探测失败 (${distro})：无法获取远端家目录` }
  }
  return { ok: true, probe }
}

export interface WslInstallOptions {
  distro: string
  home: string
  buildId: string
  bundleName: string
  bundleBytes: Buffer
  bundleSha256: string
  manifestName: string
  manifestBytes: Buffer
  manifestSha256: string
  runner?: WslRunner
}

/**
 * 经管道传输安装（两次 stdin 管道：bundle + manifest），远端校验 sha256 与
 * 大小后原子 `mv` 到按 buildId 存放的目标目录。失败清理 staging，
 * 不留下“已安装”假状态。
 */
export async function installRemoteServerViaPipe(
  options: WslInstallOptions,
): Promise<{ ok: true; installDir: string } | { ok: false; code: string; message: string }> {
  const runner = options.runner ?? realWslRunner
  const base = resolveRemoteBaseDir(options.home)
  const finalDir = resolveRemoteInstallDir(options.home, options.buildId)
  const stageName = `.staging-${options.buildId}`
  const q = shSingleQuote

  // 1) bundle 经 stdin 管道写入 staging（不走 UNC/SFTP 文件系统）
  const writeBundle = [
    'set -e',
    `base=${q(base)}`,
    `stage="$base/${stageName}"`,
    'mkdir -p "$base"',
    'rm -rf "$stage"',
    'mkdir -p "$stage"',
    `cat > "$stage/${options.bundleName}"`,
  ].join('\n')
  const r1 = await runner(['-d', options.distro, '--exec', 'sh', '-c', writeBundle], options.bundleBytes, 120000)
  if (r1.exitCode !== 0) {
    return { ok: false, code: 'REMOTE_INSTALL_FAILED', message: `远端传输失败 (${options.distro})：${r1.stderr || `exit=${r1.exitCode}`}` }
  }

  // 2) manifest 管道写入 + 双文件校验 + 原子启用
  const activate = [
    'set -e',
    `base=${q(base)}`,
    `final=${q(finalDir)}`,
    `stage="$base/${stageName}"`,
    `cat > "$stage/${options.manifestName}"`,
    `actual_bundle=$(sha256sum "$stage/${options.bundleName}" | cut -d' ' -f1)`,
    `actual_bundle_size=$(wc -c < "$stage/${options.bundleName}" | tr -d ' ')`,
    `actual_manifest=$(sha256sum "$stage/${options.manifestName}" | cut -d' ' -f1)`,
    `actual_manifest_size=$(wc -c < "$stage/${options.manifestName}" | tr -d ' ')`,
    `[ "$actual_bundle" = "${options.bundleSha256}" ] || { echo "bundle 校验失败" >&2; rm -rf "$stage"; exit 3; }`,
    `[ "$actual_bundle_size" = "${options.bundleBytes.length}" ] || { echo "bundle 大小不一致" >&2; rm -rf "$stage"; exit 3; }`,
    `[ "$actual_manifest" = "${options.manifestSha256}" ] || { echo "manifest 校验失败" >&2; rm -rf "$stage"; exit 3; }`,
    `[ "$actual_manifest_size" = "${options.manifestBytes.length}" ] || { echo "manifest 大小不一致" >&2; rm -rf "$stage"; exit 3; }`,
    'rm -rf "$final"',
    'mv "$stage" "$final"',
    'printf \'installed=%s\\n\' "$final"',
  ].join('\n')
  const r2 = await runner(['-d', options.distro, '--exec', 'sh', '-c', activate], options.manifestBytes, 60000)
  if (r2.exitCode !== 0) {
    return { ok: false, code: 'REMOTE_INSTALL_FAILED', message: `远端安装校验/启用失败 (${options.distro})：${r2.stderr || `exit=${r2.exitCode}`}` }
  }
  const m = /installed=(.+)/.exec(r2.stdout.toString('utf8').replace(/\r/g, ''))
  const installed = m?.[1]?.trim() || finalDir
  return { ok: true, installDir: installed }
}

export interface WslConnectPlan {
  distro: string
  linuxRoot: string
  home: string
  probe: WslProbe
}

/**
 * 发行版 + root 选择（复用发现能力，不写死发行版/用户/路径）。
 * linuxRoot 缺省时取远端 $HOME。
 */
export async function planWslConnection(
  distro: string,
  linuxRoot: string | undefined,
  runner: WslRunner = realWslRunner,
): Promise<{ ok: true; plan: WslConnectPlan } | { ok: false; code: string; message: string }> {
  const distros = await listWslDistros()
  if (distros.ok && distros.value.length > 0 && !distros.value.some((d) => d.name === distro)) {
    return { ok: false, code: 'INVALID_ARGUMENT', message: `WSL 发行版不存在: ${distro}` }
  }
  const probed = await probeWslEnvironment(distro, runner)
  if (!probed.ok) return probed
  let root = linuxRoot?.trim().replace(/\\/g, '/')
  if (!root) {
    const homeRes = await getWslHome(distro)
    root = homeRes.ok && homeRes.value.startsWith('/') ? homeRes.value : probed.probe.home
  }
  if (!root || !root.startsWith('/')) {
    return { ok: false, code: 'INVALID_ARGUMENT', message: '远端根须为 Ubuntu 内绝对路径' }
  }
  return { ok: true, plan: { distro, linuxRoot: root, home: probed.probe.home, probe: probed.probe } }
}

/** Node 可用性判定（缺失/Windows 冒充/版本不足均明确错误，不静默）。 */
export function checkProbeNodeUsable(probe: WslProbe): { ok: true; nodePath: string } | { ok: false; code: string; message: string } {
  if (!probe.nodePath) {
    return {
      ok: false,
      code: 'REMOTE_NODE_MISSING',
      message: `WSL 内未检测到 Node（要求 Node ${WORKSPACE_MIN_NODE_MAJOR}+）。请在该发行版内安装 Node 后重试；Montree 不会自动 sudo 安装系统软件`,
    }
  }
  if (isWindowsNodePath(probe.nodePath)) {
    return {
      ok: false,
      code: 'REMOTE_WINDOWS_NODE',
      message: `拒绝使用 Windows Node 冒充 Linux Node: ${probe.nodePath}（WSL PATH 混入了 Windows 路径，请在 WSL 内安装原生 Linux Node）`,
    }
  }
  if (!probe.nodeVersion || !probe.nodePlatform) {
    return { ok: false, code: 'REMOTE_NODE_MISSING', message: `WSL 内 Node 无法执行 (${probe.nodePath})，请检查后重试` }
  }
  if (probe.nodePlatform !== 'linux') {
    return {
      ok: false,
      code: 'REMOTE_WINDOWS_NODE',
      message: `远端 Node 平台非 Linux: ${probe.nodePlatform}（拒绝 Windows node.exe 冒充）`,
    }
  }
  if (!checkNodeVersionCompatible(probe.nodeVersion, WORKSPACE_MIN_NODE_MAJOR)) {
    return {
      ok: false,
      code: 'REMOTE_NODE_VERSION',
      message: `远端 Node 版本过低: ${probe.nodeVersion}，要求 Node ${WORKSPACE_MIN_NODE_MAJOR}+（不自动 sudo/下载）`,
    }
  }
  return { ok: true, nodePath: probe.nodePath }
}

export function formatNodeMissingHelp(distro: string): string {
  return [
    `在 ${distro} 内安装 Node ${WORKSPACE_MIN_NODE_MAJOR}+（任选其一）：`,
    '1) Nodesource: curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash - && sudo apt install -y nodejs',
    '2) 直接解压官方 tarball 到 ~/.local（无需 sudo），并将其 bin 加入 PATH',
    '安装后重新连接；连接前会校验实际 process.platform=linux 与 Node 版本。',
  ].join('\n')
}
