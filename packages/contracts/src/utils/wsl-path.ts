/**
 * WSL 路径识别与 Windows / Linux 路径双向转换工具（跨进程纯逻辑，不依赖 Node 特性）。
 */

export interface ParsedWslPath {
  isWsl: boolean
  distro?: string
  linuxPath?: string
}

/** 规范化斜杠：统一转为单斜杠规范并去除扩展 UNC 前缀 */
function cleanPathSlashes(input: string): string {
  if (!input) return ''
  // 剥离 Windows 扩展路径前缀 \\?\UNC\ 或 \\?\
  let p = input.replace(/^\\\\\?\\UNC\\/i, '//')
  p = p.replace(/^\\\\\?\\/i, '')
  // 转换为正斜杠便于正则处理
  p = p.replace(/\\/g, '/')
  if (!p.startsWith('//') && /^(?:wsl\.localhost|wsl\$)\//i.test(p)) {
    p = `//${p}`
  }
  return p
}

/**
 * 判断给定路径是否为 Windows 下访问 WSL 的 UNC 路径。
 * 支持 //wsl.localhost/<distro> 与 //wsl$/<distro> 两种标准前缀。
 */
export function isWslPath(path: string): boolean {
  if (!path) return false
  const p = cleanPathSlashes(path)
  return /^\/\/(?:wsl\.localhost|wsl\$)\/[^/]+/i.test(p)
}

/**
 * 解析 WSL UNC 路径，提取其关联的发行版名称与 Linux 内部绝对路径。
 * 例：
 *   \\\\wsl.localhost\\Ubuntu\\home\\user\\blog -> { isWsl: true, distro: 'Ubuntu', linuxPath: '/home/user/blog' }
 *   \\\\wsl$\\Debian -> { isWsl: true, distro: 'Debian', linuxPath: '/' }
 */
export function parseWslPath(path: string): ParsedWslPath {
  if (!path) return { isWsl: false }
  const p = cleanPathSlashes(path)
  const match = /^\/\/(?:wsl\.localhost|wsl\$)\/([^/]+)(?:\/(.*))?$/i.exec(p)
  if (!match) {
    return { isWsl: false }
  }
  const distro = match[1]
  const rest = match[2] ? `/${match[2].replace(/\/+$/, '')}` : '/'
  return {
    isWsl: true,
    distro,
    linuxPath: rest,
  }
}

/**
 * 将 Windows 路径转换为 Linux 可消费的原生路径：
 * 1. WSL 路径（\\\\wsl.localhost\\Ubuntu\\home\\user）-> 原生 Linux 路径（/home/user）
 * 2. Windows 盘符路径（C:\\Users\\user 或 D:/notes）-> /mnt/c/Users/user 或 /mnt/d/notes
 */
export function windowsToLinuxPath(winPath: string): string {
  if (!winPath) return ''
  const parsed = parseWslPath(winPath)
  if (parsed.isWsl && parsed.linuxPath) {
    return parsed.linuxPath
  }

  const p = cleanPathSlashes(winPath)
  // 匹配形如 C:/... 或 c:/...
  const driveMatch = /^([a-zA-Z]):\/(.*)$/.exec(p)
  if (driveMatch) {
    const drive = driveMatch[1].toLowerCase()
    const rest = driveMatch[2]
    return `/mnt/${drive}/${rest}`
  }

  return p.startsWith('/') ? p : `/${p}`
}

/**
 * 将 Linux 路径转换为 Windows 下可直接访问的 UNC 路径或盘符路径：
 * 1. /mnt/c/Users/user -> C:\\Users\\user
 * 2. /home/user/blog + Ubuntu -> \\\\wsl.localhost\\Ubuntu\\home\\user\\blog
 */
export function linuxToWindowsPath(linuxPath: string, distro = 'Ubuntu'): string {
  if (!linuxPath) return ''
  const p = linuxPath.replace(/\\/g, '/')

  // 匹配 /mnt/c/... 盘符挂载点
  const mntMatch = /^\/mnt\/([a-zA-Z])(?:\/(.*))?$/.exec(p)
  if (mntMatch) {
    const drive = mntMatch[1].toUpperCase()
    const rest = (mntMatch[2] ?? '').replace(/\//g, '\\')
    return rest ? `${drive}:\\${rest}` : `${drive}:\\`
  }

  // 纯 Linux 路径转为 WSL UNC 访问路径
  const normalizedRest = p.startsWith('/') ? p.slice(1) : p
  const winSubPath = normalizedRest.replace(/\//g, '\\')
  return `\\\\wsl.localhost\\${distro}\\${winSubPath}`
}

/**
 * 规范化工作区路径：去除首尾空格与多余尾部斜杠，统一正斜杠表示（支持本地盘符与 WSL UNC）。
 */
export function normalizeWorkspaceRoot(path?: string | null): string | undefined {
  if (!path) return undefined
  let trimmed = path.trim()
  if (!trimmed) return undefined
  // 剥离 Windows 扩展前缀 \\?\UNC\ 或 \\?\
  trimmed = trimmed.replace(/^\\\\\?\\UNC\\/i, '//').replace(/^\\\\\?\\/i, '')
  // 替换正反斜杠统一为正斜杠便于比较
  trimmed = trimmed.replace(/\\/g, '/')
  if (!trimmed.startsWith('//') && /^(?:wsl\.localhost|wsl\$)\//i.test(trimmed)) {
    trimmed = `//${trimmed}`
  }
  // 去除末尾多余斜杠（除根路径外）
  if (trimmed.length > 1) {
    trimmed = trimmed.replace(/\/+$/, '')
  }
  return trimmed || undefined
}

/**
 * 判断两个工作区路径是否代表同一工作区。
 * - 兼顾本地 Windows 盘符大小写差异（如 C:/blog 与 c:\blog）
 * - 兼顾 WSL UNC 路径的两种标准形式（//wsl.localhost/Ubuntu/blog 与 //wsl$/Ubuntu/blog）
 */
export function isSameWorkspace(a?: string | null, b?: string | null): boolean {
  const normA = normalizeWorkspaceRoot(a)
  const normB = normalizeWorkspaceRoot(b)
  if (!normA && !normB) return true
  if (!normA || !normB) return false
  if (normA === normB) return true

  // WSL 路径互认：//wsl.localhost/Ubuntu/xxx 与 //wsl$/Ubuntu/xxx
  const wslA = parseWslPath(normA)
  const wslB = parseWslPath(normB)
  if (wslA.isWsl && wslB.isWsl) {
    return (
      (wslA.distro ?? '').toLowerCase() === (wslB.distro ?? '').toLowerCase() &&
      wslA.linuxPath === wslB.linuxPath
    )
  }

  // Windows 盘符路径不区分大小写
  return normA.toLowerCase() === normB.toLowerCase()
}

