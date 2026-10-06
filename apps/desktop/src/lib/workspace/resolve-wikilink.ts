import type { FileTreeNode } from '@montree/contracts'
import { flattenFileTree } from './quick-open'

export interface WikilinkResolvedTarget {
  status: 'found' | 'missing-note' | 'missing-book'
  filePath?: string
  anchor?: string
  targetName?: string
  kind?: string
}

const BOOK_EXTENSIONS = ['.pdf', '.epub', '.mobi', '.azw3']

/**
 * 在工作区文件树中解析双向链接指向的目标文件与锚点
 */
export function resolveWikilinkTarget(
  rawTarget: string,
  fileTree: FileTreeNode[],
  workspaceRoot?: string,
): WikilinkResolvedTarget {
  const trimmed = rawTarget.trim()
  if (!trimmed) {
    return { status: 'missing-note', targetName: 'Untitled.md' }
  }

  const hashIndex = trimmed.indexOf('#')
  const rawPath = (hashIndex >= 0 ? trimmed.slice(0, hashIndex) : trimmed).trim()
  const anchor = hashIndex >= 0 ? trimmed.slice(hashIndex + 1).trim() : undefined

  const items = flattenFileTree(fileTree, workspaceRoot)
  const normPath = rawPath.replace(/\\/g, '/').toLowerCase()

  // 1. 尝试精确匹配 relativePath
  let matched = items.find((item) => {
    const rel = item.relativePath.replace(/\\/g, '/').toLowerCase()
    return rel === normPath || rel === `${normPath}.md`
  })

  // 2. 尝试匹配文件名 name
  if (!matched) {
    matched = items.find((item) => {
      const name = item.name.toLowerCase()
      return name === normPath || name === `${normPath}.md`
    })
  }

  // 3. 尝试匹配末尾路径段
  if (!matched) {
    matched = items.find((item) => {
      const rel = item.relativePath.replace(/\\/g, '/').toLowerCase()
      return rel.endsWith(`/${normPath}`) || rel.endsWith(`/${normPath}.md`)
    })
  }

  if (matched) {
    return {
      status: 'found',
      filePath: matched.path,
      anchor,
      kind: matched.documentKind,
    }
  }

  const isBook = BOOK_EXTENSIONS.some((ext) => rawPath.toLowerCase().endsWith(ext))
  if (isBook) {
    return {
      status: 'missing-book',
      targetName: rawPath,
      anchor,
    }
  }

  const defaultMdName = rawPath.toLowerCase().endsWith('.md') ? rawPath : `${rawPath}.md`
  return {
    status: 'missing-note',
    targetName: defaultMdName,
    anchor,
  }
}
