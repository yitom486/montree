import { readdir } from 'fs/promises'
import { join, extname } from 'path'
import { getDocumentKind, isWorkspaceFileExtension } from '@montree/contracts'
import type { FileTreeNode } from '@montree/contracts'

/** 工作区目录树最大递归深度 */
export const WORKSPACE_MAX_DEPTH = 6

/** 工作区扫描时跳过的目录名 */
export const WORKSPACE_IGNORED_DIR_NAMES = new Set(['node_modules'])

/** 移除不含支持文档的空目录，便于侧栏发现有效文件 */
export function pruneEmptyDirectories(nodes: FileTreeNode[]): FileTreeNode[] {
  return nodes.flatMap((node) => {
    if (node.type === 'file') return [node]

    const children = pruneEmptyDirectories(node.children ?? [])
    if (children.length === 0) return []

    return [{ ...node, children }]
  })
}

export async function scanWorkspace(
  dirPath: string,
  depth = 0,
): Promise<FileTreeNode[]> {
  if (depth > WORKSPACE_MAX_DEPTH) return []

  const entries = await readdir(dirPath, { withFileTypes: true })
  const nodes: FileTreeNode[] = []

  const sorted = entries.sort((a, b) => {
    if (a.isDirectory() && !b.isDirectory()) return -1
    if (!a.isDirectory() && b.isDirectory()) return 1
    return a.name.localeCompare(b.name)
  })

  for (const entry of sorted) {
    if (entry.name.startsWith('.') || WORKSPACE_IGNORED_DIR_NAMES.has(entry.name)) continue

    const fullPath = join(dirPath, entry.name)

    if (entry.isDirectory()) {
      const children = await scanWorkspace(fullPath, depth + 1)
      nodes.push({
        name: entry.name,
        path: fullPath,
        type: 'directory',
        children,
      })
      continue
    }

    if (!entry.isFile()) continue

    const extension = extname(entry.name).toLowerCase()
    if (!isWorkspaceFileExtension(extension)) continue

    const documentKind = getDocumentKind(fullPath)
    if (documentKind === 'unknown') continue

    nodes.push({
      name: entry.name,
      path: fullPath,
      type: 'file',
      documentKind,
    })
  }

  return nodes
}
