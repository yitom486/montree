/**
 * Montree 虚拟文件：Agent 用 `fs/read_text_file` 读这些路径时，
 * 主进程不落盘读取，而是向渲染进程要一份内存快照。
 *
 * 这样解析结果只存在一份（渲染进程内存），既不重复写盘，也不会被多窗口互相覆盖。
 */
export const MONTREE_VIRTUAL_DIR = '.montree/agent'

export const MONTREE_VIRTUAL_RESOURCES = [
  'focused.json',
  'toc.json',
  'chapter.txt',
  'viewport.txt',
] as const

export type MontreeVirtualResource = (typeof MONTREE_VIRTUAL_RESOURCES)[number]

function toPosix(input: string): string {
  return input.replace(/\\/g, '/').replace(/\/+$/, '')
}

function stripWorkspacePrefix(path: string, workspaceRoot: string): string {
  const root = toPosix(workspaceRoot)
  if (!root) return path
  if (path === root) return ''
  if (path.toLowerCase().startsWith(`${root.toLowerCase()}/`)) {
    return path.slice(root.length + 1)
  }
  return path
}

function isVirtualResource(value: string): value is MontreeVirtualResource {
  return (MONTREE_VIRTUAL_RESOURCES as readonly string[]).includes(value)
}

/**
 * 把 Agent 给的路径解析成虚拟资源名；不是虚拟路径时返回 null（走真实磁盘读）。
 * 绝对路径、相对路径、`./` 前缀、Windows 反斜杠都接受。
 */
export function parseMontreeVirtualPath(
  filePath: string,
  workspaceRoot: string,
): MontreeVirtualResource | null {
  const relative = stripWorkspacePrefix(toPosix(filePath.trim()), workspaceRoot).replace(
    /^\.\//,
    '',
  )
  if (!relative.startsWith(`${MONTREE_VIRTUAL_DIR}/`)) return null

  const resource = relative.slice(MONTREE_VIRTUAL_DIR.length + 1)
  return isVirtualResource(resource) ? resource : null
}

/** 路径落在虚拟目录下，但资源名不认识——用于给 Agent 更准确的报错 */
export function isMontreeVirtualDirPath(filePath: string, workspaceRoot: string): boolean {
  const relative = stripWorkspacePrefix(toPosix(filePath.trim()), workspaceRoot).replace(
    /^\.\//,
    '',
  )
  return relative === MONTREE_VIRTUAL_DIR || relative.startsWith(`${MONTREE_VIRTUAL_DIR}/`)
}
