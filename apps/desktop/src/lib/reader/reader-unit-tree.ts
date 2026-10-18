import type { ReaderUnit } from '@yitom/reader-core'
import { sectionOfHeading } from '@montree/ocr-core'

export interface ReaderUnitTreeNode {
  unit: ReaderUnit
  children: ReaderUnitTreeNode[]
}

function parentSectionOf(section: string): string | null {
  const index = section.lastIndexOf('.')
  return index > 0 ? section.slice(0, index) : null
}

/**
 * 将带 level 的扁平目录还原为树（用于 PDF outline 折叠）。
 *
 * 孤儿保护（王道书实录）：缺父项时经典栈算法会把孤儿挂到上一个同级父下——
 * 如缺 `5.7` 时 `5.7.1`、`6.1.1`、`7.1.2` 全被塞进 `5.6` 下面。
 * 有章节号的节点按编号验亲：真父（`5.7.1`→`5.6`？不是 `5.7`）对不上就挂 root，
 * 宁可摆出来让人看见缺项，也不藏进错的章节。无号节点（第X章）沿用层级栈。
 */
export function buildReaderUnitTree(units: ReaderUnit[]): ReaderUnitTreeNode[] {
  const roots: ReaderUnitTreeNode[] = []
  const stack: Array<{ level: number; section: string | null; node: ReaderUnitTreeNode }> = []

  for (const unit of units) {
    const node: ReaderUnitTreeNode = { unit, children: [] }
    const section = sectionOfHeading(unit.label)

    while (stack.length > 0 && stack[stack.length - 1]!.level >= unit.level) {
      stack.pop()
    }

    const top = stack.length > 0 ? stack[stack.length - 1]! : null
    const expectedParent = section ? parentSectionOf(section) : null
    const mismatched =
      expectedParent !== null &&
      top !== null &&
      top.section !== null &&
      top.section !== expectedParent
    if (top === null || !mismatched) {
      if (top === null) {
        roots.push(node)
      } else {
        top.node.children.push(node)
      }
      stack.push({ level: unit.level, section, node })
    } else {
      // 孤儿：真父缺失，不进错章节，直接挂 root（栈照样推进保序）
      roots.push(node)
      stack.push({ level: unit.level, section, node })
    }
  }

  return roots
}

/** 默认展开到第 2 层（depth 0、1 的节点展开） */
export function shouldExpandReaderUnitNode(depth: number, maxExpandedDepth = 1): boolean {
  return depth <= maxExpandedDepth
}

/**
 * 将书籍目录（ReaderUnit 列表）转换为 Markmap 兼容的 Markdown 标题树
 */
export function readerUnitsToMarkmap(units: ReaderUnit[], title = '书籍全景导图'): string {
  if (!units || units.length === 0) return `# ${title}\n## 暂无章节`
  const tree = buildReaderUnitTree(units)
  const lines: string[] = [`# ${title}`]

  function traverse(nodes: ReaderUnitTreeNode[], depth: number) {
    for (const node of nodes) {
      const headingPrefix = '#'.repeat(Math.min(depth, 6))
      lines.push(`${headingPrefix} ${node.unit.label.trim()}`)
      if (node.children.length > 0) {
        traverse(node.children, depth + 1)
      }
    }
  }

  traverse(tree, 2)
  return lines.join('\n')
}

