/**
 * 聊天内思维导图快照 → Markmap 大纲。
 *
 * `preset=diagram` 的 mindmap 历史快照已固化为离线 HTML（内联 SVG + 折叠脚本），
 * 这里只读取节点、父子连线与详情文本，不执行快照脚本，也不信任其中的 HTML：
 * 标签与详情按纯文本转义后交给 MarkmapBlock，由 Markmap 负责树布局、fit 与折叠。
 */
import { upgradeLegacyMindmapHtml } from './upgrade-legacy-mindmap'

export interface MindmapArtifact {
  title: string
  /** Markmap 大纲（Markdown），标签与详情已转义为纯文本 */
  source: string
  nodeCount: number
  /** 由详情行展开出的子节点数；用于决定初始展开层级 */
  detailNodeCount: number
}

const MAX_DETAIL_LINES = 10
const MAX_DETAIL_LINE_CHARS = 80

/** 标签来自模型，按纯文本转义，禁止 Markdown/HTML 语法改变节点结构或注入标签 */
export function escapeMindmapLabel(value: string): string {
  return value
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/([\\`*_[\]<|~])/g, '\\$1')
    .replace(/^([#>+-])(?=\s|$)/, '\\$1')
}

interface RawNode {
  id: string
  label: string
}

interface RawEdge {
  from: string
  to: string
}

function readNodes(doc: Document): RawNode[] {
  const nodes: RawNode[] = []
  doc.querySelectorAll('g.node[data-node]').forEach((group) => {
    const id = group.getAttribute('data-node')?.trim()
    const label = (group.querySelector('text')?.textContent ?? '').replace(/\s+/g, ' ').trim()
    if (id && label) nodes.push({ id, label })
  })
  return nodes
}

function readEdges(doc: Document): RawEdge[] {
  const edges: RawEdge[] = []
  doc.querySelectorAll('path.edge[data-from][data-to]').forEach((path) => {
    const from = path.getAttribute('data-from')
    const to = path.getAttribute('data-to')
    if (from && to) edges.push({ from, to })
  })
  return edges
}

/** 详情存于快照内联脚本的 `const details=...`，只做 JSON 解析，不执行脚本 */
function readDetails(html: string): Record<string, string> {
  const match = /const details=(\{[\s\S]*?\});const svg=/.exec(html)
  if (!match) return {}
  try {
    const parsed: unknown = JSON.parse(match[1]!)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
    return Object.fromEntries(
      Object.entries(parsed).filter((entry): entry is [string, string] => typeof entry[1] === 'string'),
    )
  } catch {
    return {}
  }
}

/**
 * 只把「像清单的详情」展开为子节点：多行、每行短、行数有限。
 * 单行说明或长段落留在快照里，不污染树结构。
 */
function detailLines(label: string, raw: string | undefined): string[] {
  if (!raw) return []
  const prefix = `${label}：`
  const body = raw.startsWith(prefix) ? raw.slice(prefix.length) : raw
  const lines = body
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && Array.from(line).length <= MAX_DETAIL_LINE_CHARS)
  if (lines.length < 2) return []
  return lines.slice(0, MAX_DETAIL_LINES)
}

/**
 * 识别并转换 `present-diagram` 生成的思维导图快照。
 * 返回 null 时调用方继续走隔离 iframe 的 HTML Artifact 渲染。
 */
export function parseMindmapArtifactHtml(html: string): MindmapArtifact | null {
  if (!html || !html.includes('<svg')) return null
  // 旧快照缺少 data-from/data-to 时，先按贝塞尔端点补全父子关系（幂等；新快照原样返回）
  const upgraded = upgradeLegacyMindmapHtml(html)
  const doc = new DOMParser().parseFromString(upgraded, 'text/html')
  const svg = doc.querySelector('svg')
  if (!svg) return null
  // 只认本项目的图解模板：优先用类型标记；无标记的旧快照须同时具备固定标题/详情/控制条与父子标记
  const diagramType = svg.getAttribute('data-diagram-type')
  const isDiagramTemplate =
    diagramType === 'mindmap' ||
    (diagramType === null &&
      Boolean(doc.querySelector('svg title#diagram-title')) &&
      Boolean(doc.querySelector('#details')) &&
      Boolean(doc.querySelector('#reset')) &&
      Boolean(doc.querySelector('path.edge[data-from][data-to]')))
  if (!isDiagramTemplate) return null

  const nodes = readNodes(doc)
  if (nodes.length < 2) return null
  const nodeMap = new Map(nodes.map((node) => [node.id, node]))
  if (nodeMap.size !== nodes.length) return null
  const children = new Map<string, string[]>()
  const incoming = new Set<string>()
  for (const edge of readEdges(doc)) {
    if (!nodeMap.has(edge.from) || !nodeMap.has(edge.to)) return null
    if (incoming.has(edge.to)) return null
    incoming.add(edge.to)
    const list = children.get(edge.from)
    if (list) list.push(edge.to)
    else children.set(edge.from, [edge.to])
  }
  const roots = nodes.filter((node) => !incoming.has(node.id))
  if (roots.length !== 1) return null

  // 单根连通树校验：重复访问即多父/环
  const visited = new Set<string>()
  const visit = (id: string): boolean => {
    if (visited.has(id)) return false
    visited.add(id)
    return (children.get(id) ?? []).every(visit)
  }
  if (!visit(roots[0]!.id) || visited.size !== nodes.length) return null

  const details = readDetails(upgraded)
  const title =
    (doc.querySelector('svg title#diagram-title')?.textContent ?? roots[0]!.label).replace(/\s+/g, ' ').trim() ||
    roots[0]!.label
  let detailNodeCount = 0
  const lines: string[] = []
  const walk = (id: string, depth: number): void => {
    const node = nodeMap.get(id)!
    if (depth === 0) lines.push(`# ${escapeMindmapLabel(node.label)}`)
    else lines.push(`${'  '.repeat(depth - 1)}- ${escapeMindmapLabel(node.label)}`)
    const kids = children.get(id) ?? []
    if (kids.length > 0) {
      for (const kid of kids) walk(kid, depth + 1)
      return
    }
    for (const line of detailLines(node.label, details[id])) {
      lines.push(`${'  '.repeat(depth)}- ${escapeMindmapLabel(line)}`)
      detailNodeCount += 1
    }
  }
  walk(roots[0]!.id, 0)

  return {
    title,
    source: `${lines.join('\n')}\n`,
    nodeCount: nodes.length,
    detailNodeCount,
  }
}
