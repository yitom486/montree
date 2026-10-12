import { execFile, spawnSync } from 'node:child_process'
import { readdir, stat } from 'node:fs/promises'
import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import {
  err,
  ok,
  type AppError,
  type RemoteBrowseResult,
  type RemoteDirectoryEntry,
  type Result,
  type SshConfigHost,
  type WslDistroInfo,
} from '@montree/contracts'

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
 * 将 Linux 路径拼接进 WSL UNC 访问路径。
 * 兼容优先使用 \\wsl.localhost，若不存在则回落至 \\wsl$
 */
export function resolveWslUncPath(distro: string, linuxPath: string): string {
  const clean = linuxPath.replace(/\\/g, '/').replace(/^\/+/, '')
  const localhostBase = `\\\\wsl.localhost\\${distro}`
  const wslDollarBase = `\\\\wsl$\\${distro}`

  const base = existsSync(localhostBase) ? localhostBase : wslDollarBase
  return clean ? `${base}\\${clean.replace(/\//g, '\\')}` : base
}

/**
 * 应用内直接浏览 WSL 内部目录结构，返回子文件夹列表，完全规避原生弹窗。
 */
export async function browseWslDirectory(
  distro: string,
  linuxPath = '/',
): Promise<Result<RemoteBrowseResult, AppError>> {
  if (process.platform !== 'win32') {
    return err({ code: 'UNSUPPORTED_FORMAT', message: '仅在 Windows 环境下支持 WSL 浏览' })
  }

  const normalizedLinuxPath = linuxPath.trim().replace(/\\/g, '/') || '/'
  const uncTarget = resolveWslUncPath(distro, normalizedLinuxPath)

  try {
    const dirents = await readdir(uncTarget, { withFileTypes: true })
    const entries: RemoteDirectoryEntry[] = []

    for (const d of dirents) {
      // 忽略特殊隐藏文件与挂载伪文件
      entries.push({
        name: d.name,
        isDirectory: d.isDirectory(),
      })
    }

    // 排序：目录排在前面，同类按字典序排
    entries.sort((a, b) => {
      if (a.isDirectory && !b.isDirectory) return -1
      if (!a.isDirectory && b.isDirectory) return 1
      return a.name.localeCompare(b.name)
    })

    return ok({
      distro,
      currentPath: normalizedLinuxPath,
      parentPath: getLinuxParentPath(normalizedLinuxPath),
      entries,
    })
  } catch (e) {
    return err({
      code: 'FILE_READ_ERROR',
      message: `无法访问 WSL 路径 (${distro}:${normalizedLinuxPath}): ${e instanceof Error ? e.message : String(e)}`,
    })
  }
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
