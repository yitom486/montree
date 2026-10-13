import { execFile, spawnSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import {
  err,
  ok,
  type AppError,
  type RemoteBrowseResult,
  type Result,
  type SshConfigHost,
  type WslDistroInfo,
} from '@montree/contracts'
import { wslWorkspaceHost } from './wsl-workspace-host'

/**
 * 解析 `wsl.exe -l -v` 命令的输出文本（纯函数，跨平台单测友好）。
 * 提取分发版名称，并将以 `*` 开头的分发版标记为默认分发版。
 */
export function parseWslListOutput(raw: string): WslDistroInfo[] {
  if (!raw || !raw.trim()) return []
  const lines = raw.split(/\r?\n/).map((l) => l.trim()).filter(Boolean)
  const distros: WslDistroInfo[] = []

  for (const line of lines) {
    // 忽略表头行（NAME STATE VERSION）
    if (/^NAME\s+STATE/i.test(line)) continue

    const isDefault = line.startsWith('*')
    const cleanLine = line.replace(/^\*\s*/, '').trim()
    const parts = cleanLine.split(/\s+/)
    const name = parts[0]

    // 过滤掉内部数据分发版（如 docker-desktop-data）与空行
    if (name && name !== 'docker-desktop-data') {
      distros.push({ name, isDefault })
    }
  }

  return distros
}

/** 解码 wsl.exe 输出缓冲区（Windows 常见 UTF-16LE 或 UTF-8） */
export function decodeWslBuffer(buf: Buffer): string {
  // 如果缓冲区包含大量 0 字节（BOM 或空字节交替），按 utf16le 解码
  if (buf.length >= 2 && (buf[1] === 0 || buf[0] === 0xff || buf[0] === 0xfe)) {
    return buf.toString('utf16le')
  }
  return buf.toString('utf8')
}

/**
 * 动态列出当前系统安装的 WSL 分发版列表。
 * 非 Windows 环境或未安装 WSL 时安全返回空数组，绝不硬编码。
 */
export async function listWslDistros(): Promise<Result<WslDistroInfo[], AppError>> {
  if (process.platform !== 'win32') {
    return ok([])
  }

  try {
    const res = spawnSync('wsl.exe', ['-l', '-v'], {
      windowsHide: true,
      timeout: 5000,
    })

    if (res.error || res.status !== 0 || !res.stdout) {
      return ok([])
    }

    const decoded = decodeWslBuffer(res.stdout)
    const distros = parseWslListOutput(decoded)
    return ok(distros)
  } catch {
    return ok([])
  }
}

/**
 * 动态获取指定 WSL 分发版对应的用户家目录（$HOME，例如 /home/username）。
 * 若无法获取，优雅回落至 /
 */
export async function getWslHome(distro: string): Promise<Result<string, AppError>> {
  if (process.platform !== 'win32') {
    return ok('/')
  }

  try {
    const res = spawnSync('wsl.exe', ['-d', distro, 'sh', '-c', 'echo $HOME'], {
      windowsHide: true,
      timeout: 5000,
    })

    if (res.status === 0 && res.stdout) {
      const home = res.stdout.toString('utf8').trim()
      if (home && home.startsWith('/')) {
        return ok(home)
      }
    }

    return ok('/home')
  } catch {
    return ok('/')
  }
}

/**
 * 解析并规范化 Linux 路径的父级路径。
 */
export function getLinuxParentPath(linuxPath: string): string | null {
  const normalized = linuxPath.replace(/\\/g, '/').replace(/\/+$/, '')
  if (!normalized || normalized === '/') return null
  const idx = normalized.lastIndexOf('/')
  if (idx <= 0) return '/'
  return normalized.slice(0, idx)
}

/**
 * 应用内浏览 WSL 目录（B1 起经 Ubuntu 远端服务原生执行）。
 *
 * 兼容边界：本入口不再使用 Windows UNC/9P（`\\wsl.localhost\…`）+
 * 本机 readdir；调用前须先经 `remote:wsl-connect` 建连（见
 * `wsl-workspace-host.ts`）。未连接/发行版不一致时返回明确的
 * REMOTE_NOT_CONNECTED，禁止静默回落 UNC、伪装空树。
 * UNC 语法仅保留于路径识别与日志诊断（`@montree/contracts` 的
 * `isWslPath`/`parseWslPath`），不生成 UNC 路径交给本机 fs。
 */
export async function browseWslDirectory(
  distro: string,
  linuxPath = '/',
): Promise<Result<RemoteBrowseResult, AppError>> {
  if (process.platform !== 'win32') {
    return err({ code: 'UNSUPPORTED_FORMAT', message: '仅在 Windows 环境下支持 WSL 浏览' })
  }

  const normalizedLinuxPath = linuxPath.trim().replace(/\\/g, '/') || '/'
  if (!wslWorkspaceHost.isConnectedTo(distro)) {
    return err({
      code: 'REMOTE_NOT_CONNECTED',
      message: `WSL 远端未连接 (${distro})：请先连接后再浏览（B1 已移除 UNC 直读，不回落本机文件系统）`,
    })
  }
  return wslWorkspaceHost.browseDirectory(normalizedLinuxPath)
}

/**
 * 解析用户本机 ~/.ssh/config 纯文本，提取配置的远程主机。
 */
export function parseSshConfigFile(content: string): SshConfigHost[] {
  if (!content) return []
  const lines = content.split(/\r?\n/)
  const hosts: SshConfigHost[] = []
  let current: SshConfigHost | null = null

  for (const rawLine of lines) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#')) continue

    const matchHost = /^Host\s+(.+)$/i.exec(line)
    if (matchHost) {
      const hostVal = matchHost[1]?.trim()
      // 忽略泛通配符 Host *
      if (hostVal && hostVal !== '*') {
        current = { host: hostVal }
        hosts.push(current)
      } else {
        current = null
      }
      continue
    }

    if (!current) continue

    const matchHostName = /^HostName\s+(.+)$/i.exec(line)
    if (matchHostName && matchHostName[1]) {
      current.hostname = matchHostName[1].trim()
      continue
    }

    const matchUser = /^User\s+(.+)$/i.exec(line)
    if (matchUser && matchUser[1]) {
      current.user = matchUser[1].trim()
      continue
    }

    const matchPort = /^Port\s+(\d+)$/i.exec(line)
    if (matchPort && matchPort[1]) {
      current.port = parseInt(matchPort[1], 10)
      continue
    }
  }

  return hosts
}

/**
 * 读取本机 ~/.ssh/config 配置文件中的可用主机列表（对齐 VS Code Remote-SSH）。
 */
export async function listSshConfigHosts(): Promise<Result<SshConfigHost[], AppError>> {
  try {
    const configPath = join(homedir(), '.ssh', 'config')
    if (!existsSync(configPath)) {
      return ok([])
    }

    const content = readFileSync(configPath, 'utf8')
    const hosts = parseSshConfigFile(content)
    return ok(hosts)
  } catch {
    return ok([])
  }
}
