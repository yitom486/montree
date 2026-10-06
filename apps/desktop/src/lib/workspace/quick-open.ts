import type { FileTreeNode } from '@montree/contracts'
import { getFileExtension, getDocumentKind, type DocumentKind } from '@montree/contracts'

export interface QuickOpenFileItem {
  path: string
  name: string
  relativePath: string
  folderPath: string
  extension: string
  documentKind: DocumentKind
  isRecent?: boolean
}

export interface QuickOpenMatchResult {
  item: QuickOpenFileItem
  score: number
  matchedIndices: number[]
}

function normalizeSlash(p: string): string {
  return p.replace(/\\/g, '/')
}

/**
 * 递归扁平化工作区文件树为快速启动条目列表。
 */
export function flattenFileTree(
  tree: FileTreeNode[],
  workspaceRoot?: string,
  recentPaths: string[] = [],
): QuickOpenFileItem[] {
  const result: QuickOpenFileItem[] = []
  const recentSet = new Set(recentPaths.map(normalizeSlash))
  const rootNormalized = workspaceRoot ? normalizeSlash(workspaceRoot).replace(/\/+$/, '') : ''

  function walk(nodes: FileTreeNode[]) {
    for (const node of nodes) {
      if (node.type === 'file') {
        const normPath = normalizeSlash(node.path)
        let rel = normPath
        if (rootNormalized && normPath.startsWith(rootNormalized)) {
          rel = normPath.slice(rootNormalized.length).replace(/^\/+/, '')
        }
        const lastSlash = rel.lastIndexOf('/')
        const folderPath = lastSlash !== -1 ? rel.slice(0, lastSlash) : ''

        result.push({
          path: node.path,
          name: node.name,
          relativePath: rel,
          folderPath,
          extension: getFileExtension(node.name),
          documentKind: node.documentKind ?? getDocumentKind(node.name),
          isRecent: recentSet.has(normPath),
        })
      } else if (node.children && node.children.length > 0) {
        walk(node.children)
      }
    }
  }

  walk(tree)
  return result
}

/**
 * 模糊字符匹配与评分算法。
 * 针对文件名和相对路径进行打分：
 * - 优先匹配文件名；
 * - 连续匹配有额外加分；
 * - 词首（/、-、_、空格、点）后匹配有词首加分；
 * - 完全包含子串有最高基础分。
 */
export function scoreFuzzyMatch(
  query: string,
  target: string,
): { match: boolean; score: number; indices: number[] } {
  const q = query.trim().toLowerCase()
  if (!q) {
    return { match: true, score: 0, indices: [] }
  }

  const t = target.toLowerCase()
  const indices: number[] = []

  // 1. 完全连续子串匹配（最高优先级）
  const exactIndex = t.indexOf(q)
  if (exactIndex !== -1) {
    const isWordStart =
      exactIndex === 0 || /[\s/\\._-]/.test(target[exactIndex - 1] ?? '')
    const baseScore = 1000 + (isWordStart ? 300 : 100) - exactIndex * 2
    for (let i = 0; i < q.length; i++) {
      indices.push(exactIndex + i)
    }
    return { match: true, score: baseScore, indices }
  }

  // 2. 子序列模糊匹配
  let tIdx = 0
  let qIdx = 0
  let score = 100
  let prevMatchIdx = -2

  while (qIdx < q.length && tIdx < t.length) {
    if (q[qIdx] === t[tIdx]) {
      indices.push(tIdx)

      // 连续字符匹配加分
      if (tIdx === prevMatchIdx + 1) {
        score += 20
      }

      // 词首加分（位于边界字符之后）
      if (tIdx === 0 || /[\s/\\._-]/.test(target[tIdx - 1] ?? '')) {
        score += 25
      }

      prevMatchIdx = tIdx
      qIdx++
    }
    tIdx++
  }

  if (qIdx === q.length) {
    // 扣除跨距惩罚（跨度越短越好）
    const span = (indices[indices.length - 1] ?? 0) - (indices[0] ?? 0)
    score -= span * 2
    return { match: true, score: Math.max(score, 10), indices }
  }

  return { match: false, score: 0, indices: [] }
}

/**
 * 检索并对工作区文件排序。
 * - 无 query：最近文件排在前面，其余按字典序；
 * - 有 query：根据文件名与相对路径评分排序。
 */
export function searchQuickOpenFiles(
  items: QuickOpenFileItem[],
  query: string,
  recentPaths: string[] = [],
): QuickOpenMatchResult[] {
  const q = query.trim()
  const recentOrderMap = new Map<string, number>()
  recentPaths.forEach((path, index) => {
    recentOrderMap.set(normalizeSlash(path), index)
  })

  if (!q) {
    return items
      .slice()
      .sort((a, b) => {
        const aNorm = normalizeSlash(a.path)
        const bNorm = normalizeSlash(b.path)
        const aRecentIdx = recentOrderMap.has(aNorm) ? recentOrderMap.get(aNorm)! : 9999
        const bRecentIdx = recentOrderMap.has(bNorm) ? recentOrderMap.get(bNorm)! : 9999

        if (aRecentIdx !== bRecentIdx) {
          return aRecentIdx - bRecentIdx
        }
        return a.name.localeCompare(b.name, 'zh-CN')
      })
      .map((item) => ({
        item,
        score: recentOrderMap.has(normalizeSlash(item.path)) ? 50 : 0,
        matchedIndices: [],
      }))
  }

  const results: QuickOpenMatchResult[] = []

  for (const item of items) {
    // 优先匹配文件名
    const nameMatch = scoreFuzzyMatch(q, item.name)
    if (nameMatch.match) {
      let finalScore = nameMatch.score + 200
      if (recentOrderMap.has(normalizeSlash(item.path))) {
        finalScore += 50
      }
      results.push({
        item,
        score: finalScore,
        matchedIndices: nameMatch.indices,
      })
      continue
    }

    // 其次尝试匹配包含目录的相对路径
    const relMatch = scoreFuzzyMatch(q, item.relativePath)
    if (relMatch.match) {
      let finalScore = relMatch.score
      if (recentOrderMap.has(normalizeSlash(item.path))) {
        finalScore += 50
      }
      results.push({
        item,
        score: finalScore,
        matchedIndices: [],
      })
    }
  }

  return results.sort((a, b) => {
    if (b.score !== a.score) {
      return b.score - a.score
    }
    return a.item.name.length - b.item.name.length
  })
}
