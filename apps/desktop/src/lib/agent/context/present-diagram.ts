import { DIAGRAM_TYPES, type DiagramType } from '@yitom/contracts'

type EntityField = { name: string; type: string; key: string; details: string }
type Node = { id: string; label: string; kind: string; layer: number; details: string; lane: string; when: string; fields: EntityField[] }
type Edge = { from: string; to: string; label: string; reply: boolean; fromCardinality: string; toCardinality: string; fromField: string; toField: string }
const escape = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!)
function rounded(points: number[][]): string {
  let d = `M ${points[0]![0]},${points[0]![1]}`
  for (let i = 1; i < points.length - 1; i++) {
    const previous = points[i - 1]!, current = points[i]!, next = points[i + 1]!
    const before = Math.hypot(previous[0]! - current[0]!, previous[1]! - current[1]!)
    const after = Math.hypot(next[0]! - current[0]!, next[1]! - current[1]!)
    if (!before || !after) continue
    const radius = Math.min(8, before / 2, after / 2)
    const enter = current.map((n, j) => n + (previous[j]! - n) * radius / before)
    const exit = current.map((n, j) => n + (next[j]! - n) * radius / after)
    d += ` L ${enter[0]},${enter[1]} Q ${current[0]},${current[1]} ${exit[0]},${exit[1]}`
  }
  const end = points[points.length - 1]!
  return `${d} L ${end[0]},${end[1]}`
}
function field(v: unknown, name: string, max: number): string {
  if (typeof v !== 'string' || !v.trim() || v.length > max) throw new Error(`${name} 须为 1–${max} 字文本`)
  return v.trim()
}
function list(v: unknown, name: string, min: number, max: number): Record<string, unknown>[] {
  if (!Array.isArray(v) || v.length < min || v.length > max) throw new Error(`${name} 须为 ${min}–${max} 项，请拆分复杂图`)
  return v.map((x) => { if (!x || typeof x !== 'object' || Array.isArray(x)) throw new Error(`${name} 须为对象数组`); return x as Record<string, unknown> })
}
function label(value: string, x: number, y: number): string {
  const chars = Array.from(value), lines: string[] = []
  let line = '', units = 0
  for (const c of chars) { const n = /[\u0000-\u007f]/.test(c) ? 1 : 2; if (units + n > 22) { lines.push(line); line = ''; units = 0 } line += c; units += n }
  if (line) lines.push(line)
  return `<text x="${x}" y="${y - (lines.length - 1) * 8}" text-anchor="middle">${lines.map((s, i) => `<tspan x="${x}" dy="${i ? 16 : 0}">${escape(s)}</tspan>`).join('')}</text>`
}

export function buildDiagramHtml(args: Record<string, unknown>): string {
  const type = args.diagramType as DiagramType
  if (!DIAGRAM_TYPES.includes(type)) throw new Error(`diagramType 须为 ${DIAGRAM_TYPES.join('、')}`)
  const title = field(args.title, 'title', 200)
  if (type !== 'swimlane' && args.lanes !== undefined) throw new Error('lanes 仅泳道图支持')
  const lanes = type === 'swimlane' ? list(args.lanes, 'lanes', 2, 4).map((lane) => {
    if (Object.keys(lane).some((key) => !['id', 'label'].includes(key))) throw new Error('泳道包含未支持的属性')
    const id = field(lane.id, 'lane.id', 40)
    if (!/^[a-zA-Z][a-zA-Z0-9_-]*$/.test(id)) throw new Error('lane.id 须为英文标识')
    return { id, label: field(lane.label, 'lane.label', 20) }
  }) : []
  if (new Set(lanes.map((lane) => lane.id)).size !== lanes.length) throw new Error('lane.id 不得重复')
  const nodes: Node[] = list(args.nodes, 'nodes', 2, type === 'sequence' ? 6 : 12).map((n, index) => {
    if (Object.keys(n).some((key) => !['id', 'label', 'kind', 'layer', 'details', 'lane', 'when', 'fields'].includes(key))) throw new Error('节点包含未支持的属性')
    const id = field(n.id, 'node.id', 40)
    if (!/^[a-zA-Z][a-zA-Z0-9_-]*$/.test(id)) throw new Error('node.id 须为英文标识')
    const kind = n.kind ?? 'process'
    if (!['start', 'end', 'process', 'decision'].includes(String(kind))) throw new Error('node.kind 不支持')
    if (!['flowchart', 'swimlane'].includes(type) && kind !== 'process') throw new Error('节点 kind 仅流程图与泳道图支持 start/end/decision')
    if (type === 'mindmap' && (n.layer !== undefined || n.kind !== undefined)) throw new Error('思维导图由树结构布局，不接受 layer/kind')
    if (['timeline', 'fishbone', 'cycle'].includes(type) && (n.layer !== undefined || n.kind !== undefined)) throw new Error('此图型自动布局，不接受 layer/kind')
    if (type !== 'timeline' && n.when !== undefined) throw new Error('when 仅时间线支持')
    if (type !== 'er' && n.fields !== undefined) throw new Error('fields 仅 ER 图支持')
    if (type === 'er' && n.kind !== undefined) throw new Error('ER 图不接受 kind')
    const fields = type === 'er' ? list(n.fields, 'fields', 1, 8).map((f) => {
      if (Object.keys(f).some((key) => !['name', 'type', 'key', 'details'].includes(key))) throw new Error('字段包含未支持的属性')
      if (f.key !== undefined && (typeof f.key !== 'string' || !['PK', 'FK', 'PK,FK', 'UK'].includes(f.key))) throw new Error('field.key 须为 PK/FK/PK,FK/UK')
      return { name: field(f.name, 'field.name', 24), type: field(f.type, 'field.type', 12), key: String(f.key ?? ''), details: f.details === undefined ? '' : field(f.details, 'field.details', 256) }
    }) : []
    if (new Set(fields.map((f) => f.name)).size !== fields.length) throw new Error('同一实体的字段名不得重复')
    if (type !== 'swimlane' && n.lane !== undefined) throw new Error('node.lane 仅泳道图支持')
    if (type === 'swimlane' && (!lanes.some((lane) => lane.id === n.lane) || n.layer === undefined)) throw new Error('泳道图节点须指定有效 lane 与 layer')
    if (type === 'sequence' && n.layer !== undefined) throw new Error('时序图参与者按 nodes 顺序排列，不接受 layer')
    const layer = n.layer ?? (['architecture', 'er'].includes(type) ? Math.min(index, 5) : index)
    if (!Number.isInteger(layer) || Number(layer) < 0 || Number(layer) > (n.layer === undefined ? 11 : 5)) throw new Error('node.layer 须为 0–5 整数')
    return { id, label: field(n.label, 'node.label', kind === 'decision' ? 20 : 40), kind: String(kind), layer: Number(layer), details: n.details === undefined ? '' : field(n.details, 'node.details', 1000), lane: String(n.lane ?? ''), when: n.when === undefined ? '' : field(n.when, 'node.when', 20), fields }
  })
  if (new Set(nodes.map((n) => n.id)).size !== nodes.length) throw new Error('node.id 不得重复')
  const edges: Edge[] = list(args.edges, 'edges', 1, 20).map((e) => {
    if (Object.keys(e).some((key) => !['from', 'to', 'label', 'reply', 'fromCardinality', 'toCardinality', 'fromField', 'toField'].includes(key))) throw new Error('连线包含未支持的属性')
    if (!nodes.some((n) => n.id === e.from) || !nodes.some((n) => n.id === e.to)) throw new Error('连线引用了不存在的节点')
    if (e.reply !== undefined && typeof e.reply !== 'boolean') throw new Error('edge.reply 须为布尔值')
    if (type !== 'er' && ['fromCardinality', 'toCardinality', 'fromField', 'toField'].some((key) => e[key] !== undefined)) throw new Error('关系基数与字段引用仅 ER 图支持')
    if (type === 'er') {
      if (e.reply !== undefined) throw new Error('ER 图不接受 reply')
      if (e.from === e.to) throw new Error('首版 ER 图不支持自关联，请拆图说明')
      if (![e.fromCardinality, e.toCardinality].every((value) => typeof value === 'string' && ['1', '0..1', '1..*', '0..*'].includes(value))) throw new Error('ER 关系两端须指定合法基数')
      if ((e.fromField === undefined) !== (e.toField === undefined)) throw new Error('fromField/toField 须同时提供')
      if (e.fromField !== undefined && (!nodes.find((n) => n.id === e.from)!.fields.some((f) => f.name === e.fromField) || !nodes.find((n) => n.id === e.to)!.fields.some((f) => f.name === e.toField))) throw new Error('ER 关系引用了不存在的字段')
    }
    return { from: String(e.from), to: String(e.to), label: e.label === undefined ? '' : field(e.label, 'edge.label', 32), reply: e.reply === true, fromCardinality: String(e.fromCardinality ?? ''), toCardinality: String(e.toCardinality ?? ''), fromField: String(e.fromField ?? ''), toField: String(e.toField ?? '') }
  })
  if (type === 'er' && new Set(edges.map((e) => [e.from, e.to].sort().join(':'))).size !== edges.length) throw new Error('首版 ER 图每对实体只支持一条关系，请拆图说明')
  if (edges.some((e) => [...e.label].reduce((sum, c) => sum + (/[\u0000-\u007f]/.test(c) ? 1 : 2), 0) > 28)) throw new Error('连线标签过长，请缩短为 14 个中文字符或 28 个英文字符')
  if (type === 'sequence' && edges.some((e) => !e.label)) throw new Error('时序图每条消息需要 label')
  if (type === 'mindmap' && edges.some((e) => e.reply)) throw new Error('思维导图不支持 reply')
  if (['timeline', 'fishbone', 'cycle'].includes(type) && edges.some((e) => e.reply)) throw new Error('此图型不支持 reply')
  if (type === 'timeline' || type === 'cycle') {
    if (type === 'cycle' && (nodes.length < 3 || nodes.length > 8)) throw new Error('循环图须为 3–8 个节点')
    const count = type === 'cycle' ? nodes.length : nodes.length - 1
    if (edges.length !== count || nodes.slice(0, count).some((n, i) => edges.filter((e) => e.from === n.id && e.to === nodes[(i + 1) % nodes.length]!.id).length !== 1)) throw new Error('连线须按 nodes 顺序连接；循环图末节点须回到首节点')
  }
  const effect = type === 'fishbone' ? nodes.filter((n) => !edges.some((e) => e.from === n.id)) : []
  const categories = type === 'fishbone' && effect.length === 1 ? nodes.filter((n) => edges.some((e) => e.from === n.id && e.to === effect[0]!.id)) : []
  if (type === 'fishbone') {
    if (edges.some((e) => e.label)) throw new Error('鱼骨图请用节点表达原因，不接受连线 label')
    if (effect.length !== 1 || categories.length < 2 || categories.length > 4 || edges.length !== nodes.length - 1) throw new Error('鱼骨图须为一个结果与 2–4 类原因')
    for (const n of nodes.filter((n) => n !== effect[0])) {
      const outgoing = edges.filter((e) => e.from === n.id)
      if (outgoing.length !== 1 || (!categories.includes(n) && !categories.some((c) => c.id === outgoing[0]!.to))) throw new Error('鱼骨图原因须唯一归属，且最多两级')
    }
    if (categories.some((n) => edges.filter((e) => e.to === n.id).length > 2)) throw new Error('每类原因最多两个子原因')
  }
  if (type === 'swimlane' && new Set(nodes.map((n) => `${n.lane}:${n.layer}`)).size !== nodes.length) throw new Error('同一泳道同一阶段只能一个节点')
  for (const node of nodes.filter((n) => n.kind === 'decision')) {
    const outgoing = edges.filter((e) => e.from === node.id)
    if (outgoing.length > 3 || outgoing.some((e) => !e.label)) throw new Error('决策节点最多三个出口，每条出口须有 label')
  }
  const positions = new Map<string, { x: number; y: number }>()
  const layers = [...new Set(nodes.map((n) => n.layer))].sort((a, b) => a - b)
  const entityHeight = 80 + Math.max(...nodes.map((n) => n.fields.length)) * 56
  if (type === 'er') for (const [rank, layer] of layers.entries()) nodes.filter((n) => n.layer === layer).forEach((n, i) => positions.set(n.id, { x: 240 + rank * 600, y: 40 + entityHeight / 2 + i * (entityHeight + 140) }))
  else if (type === 'timeline') nodes.forEach((n, i) => positions.set(n.id, { x: 144 + i * 300, y: 164 }))
  else if (type === 'cycle') {
    const rx = Math.max(300, nodes.length * 60), ry = Math.max(220, nodes.length * 45)
    nodes.forEach((n, i) => { const angle = -Math.PI / 2 + i * Math.PI * 2 / nodes.length; positions.set(n.id, { x: 144 + rx + rx * Math.cos(angle), y: 64 + ry + ry * Math.sin(angle) }) })
  } else if (type === 'fishbone') {
    positions.set(effect[0]!.id, { x: Math.ceil(categories.length / 2) * 400 + 280, y: 340 })
    categories.forEach((n, i) => {
      const x = 240 + Math.floor(i / 2) * 400, top = i % 2 === 0
      positions.set(n.id, { x, y: top ? 64 : 616 })
      nodes.filter((child) => edges.some((e) => e.from === child.id && e.to === n.id)).forEach((child, j) => positions.set(child.id, { x: x - 100, y: top ? 176 + j * 100 : 504 - j * 100 }))
    })
  } else if (type === 'mindmap') {
    const roots = nodes.filter((n) => !edges.some((e) => e.to === n.id))
    if (roots.length !== 1 || edges.length !== nodes.length - 1 || nodes.some((n) => edges.filter((e) => e.to === n.id).length > 1)) throw new Error('思维导图须为唯一根节点的连通树')
    const visited = new Set<string>()
    let leaf = 0
    const place = (node: Node, depth: number): number => {
      if (visited.has(node.id)) throw new Error('思维导图不得有循环或重复连线')
      visited.add(node.id)
      const children = nodes.filter((n) => edges.some((e) => e.from === node.id && e.to === n.id))
      const rows = children.map((child) => place(child, depth + 1))
      const y = rows.length ? (rows[0]! + rows[rows.length - 1]!) / 2 : 64 + leaf++ * 128
      positions.set(node.id, { x: 144 + depth * 280, y })
      return y
    }
    place(roots[0]!, 0)
    if (visited.size !== nodes.length) throw new Error('思维导图不得有循环或孤立节点')
  } else if (type === 'swimlane') nodes.forEach((n) => positions.set(n.id, { x: 260 + layers.indexOf(n.layer) * 280, y: 100 + lanes.findIndex((lane) => lane.id === n.lane) * 200 }))
  else if (type === 'sequence') nodes.forEach((n, i) => positions.set(n.id, { x: 120 + i * 240, y: 64 }))
  else for (const [rank, layer] of layers.entries()) nodes.filter((n) => n.layer === layer).forEach((n, i) => positions.set(n.id, type === 'flowchart' ? { x: 144 + i * 280, y: 64 + rank * 176 } : { x: 144 + rank * 280, y: 64 + i * 176 }))
  const width = Math.max(...[...positions.values()].map((p) => p.x)) + (type === 'er' ? 240 : 184)
  const height = type === 'sequence' ? 176 + edges.length * 80 : type === 'swimlane' ? lanes.length * 200 + 24 : Math.max(...[...positions.values()].map((p) => p.y)) + (type === 'er' ? entityHeight / 2 + 80 : 104)
  const lines = edges.map((e, i) => {
    const a = positions.get(e.from)!, b = positions.get(e.to)!
    let d: string, x: number, y: number
    let cardinalities = ''
    if (type === 'er') {
      const horizontal = a.x !== b.x, direction = horizontal ? Math.sign(b.x - a.x) : Math.sign(b.y - a.y)
      const ax = a.x + (horizontal ? direction * 200 : 0), ay = a.y + (horizontal ? 0 : direction * entityHeight / 2)
      const bx = b.x - (horizontal ? direction * 200 : 0), by = b.y - (horizontal ? 0 : direction * entityHeight / 2)
      const mid = horizontal ? (ax + bx) / 2 : (ay + by) / 2
      d = horizontal ? rounded([[ax, ay], [mid, ay], [mid, by], [bx, by]]) : `M ${ax},${ay} L ${bx},${by}`
      x = (ax + bx) / 2; y = (ay + by) / 2 - 40
      cardinalities = `<text class="edge-label" x="${ax + (horizontal ? direction * 28 : 32)}" y="${ay + (horizontal ? -12 : direction * 24)}" text-anchor="middle">${escape(e.fromCardinality)}</text><text class="edge-label" x="${bx - (horizontal ? direction * 28 : -32)}" y="${by + (horizontal ? -12 : -direction * 24)}" text-anchor="middle">${escape(e.toCardinality)}</text>`
    } else if (type === 'timeline') {
      d = `M ${a.x + 96},${a.y} H ${b.x - 96}`; x = (a.x + b.x) / 2; y = a.y - 12
    } else if (type === 'cycle') {
      const dx = b.x - a.x, dy = b.y - a.y
      const scale = Math.min(96 / Math.max(Math.abs(dx), .001), 40 / Math.max(Math.abs(dy), .001))
      d = `M ${a.x + dx * scale},${a.y + dy * scale} L ${b.x - dx * scale},${b.y - dy * scale}`
      x = (a.x + b.x) / 2; y = (a.y + b.y) / 2 - 16
    } else if (type === 'fishbone') {
      const category = categories.find((n) => n.id === e.from || n.id === e.to)!
      const c = positions.get(category.id)!, top = c.y < 340
      if (e.to === effect[0]!.id) { d = `M ${c.x + 48},${c.y + (top ? 40 : -40)} L ${c.x + 180},340`; x = c.x + 130; y = 324 }
      else {
        const joinX = c.x + 48 + (a.y - (c.y + (top ? 40 : -40))) / (340 - (c.y + (top ? 40 : -40))) * 132
        d = `M ${a.x + 96},${a.y} H ${joinX}`; x = (a.x + 96 + joinX) / 2; y = a.y - 12
      }
    } else if (type === 'sequence') {
      y = 144 + i * 80; x = (a.x + b.x) / 2
      d = a.x === b.x ? rounded([[a.x, y], [a.x + 56, y], [a.x + 56, y + 32], [a.x, y + 32]]) : `M ${a.x},${y} H ${b.x}`
      if (a.x === b.x) x += 64
    } else if (type === 'mindmap') {
      const ax = a.x + 96, bx = b.x - 96, mid = (ax + bx) / 2
      d = `M ${ax},${a.y} C ${mid},${a.y} ${mid},${b.y} ${bx},${b.y}`; x = mid; y = (a.y + b.y) / 2 - 12
    } else if (['architecture', 'swimlane'].includes(type) && a.x !== b.x) {
      const sign = b.x > a.x ? 1 : -1, ax = a.x + sign * 96, bx = b.x - sign * 96, mid = (ax + bx) / 2
      d = rounded([[ax, a.y], [mid, a.y], [mid, b.y], [bx, b.y]]); x = mid; y = (a.y + b.y) / 2 - 12
    } else {
      const ay = a.y + 40, by = b.y - 40, mid = (ay + by) / 2
      if (b.y <= a.y) { x = Math.max(a.x, b.x) + 144; y = (a.y + b.y) / 2; d = rounded([[a.x + 96, a.y], [x, a.y], [x, b.y], [b.x + 96, b.y]]) }
      else { d = rounded([[a.x, ay], [a.x, mid], [b.x, mid], [b.x, by]]); x = (a.x + b.x) / 2; y = mid - 12 }
    }
    return `<path d="${d}" class="edge${e.reply ? ' reply' : ''}"${['mindmap', 'er'].includes(type) ? '' : ' marker-end="url(#arrow)"'}/>${cardinalities}${e.label ? `<text class="edge-label" x="${x}" y="${y - (type === 'sequence' ? 12 : 0)}" text-anchor="middle">${escape(e.label)}</text>` : ''}`
  }).join('')
  const boxes = nodes.map((n) => {
    const p = positions.get(n.id)!
    if (type === 'er') {
      const top = p.y - entityHeight / 2
      return `<g class="node entity" data-node="${n.id}" tabindex="0" role="button" aria-label="${escape(n.label)}"><rect x="${p.x - 200}" y="${top}" width="400" height="${entityHeight}" rx="6"/>${label(n.label, p.x, top + 38)}<path d="M ${p.x - 200},${top + 72} h 400"/>${n.fields.map((f, i) => `<g class="entity-field">${label(f.key, p.x - 160, top + 106 + i * 56)}${label(f.name, p.x - 30, top + 106 + i * 56)}${label(f.type, p.x + 120, top + 106 + i * 56)}</g>`).join('')}</g>`
    }
    const shape = n.kind === 'decision' && ['flowchart', 'swimlane'].includes(type) ? `<path d="M ${p.x},${p.y - 40} L ${p.x + 96},${p.y} L ${p.x},${p.y + 40} L ${p.x - 96},${p.y} Z"/>` : `<rect x="${p.x - 96}" y="${p.y - 40}" width="192" height="80" rx="${['start', 'end'].includes(n.kind) ? 20 : 6}"/>`
    return `<g class="node" data-node="${n.id}" tabindex="0" role="button" aria-label="${escape(n.label)}">${shape}${label(n.label, p.x, p.y + 4)}${n.when ? `<g class="time-label">${label(n.when, p.x, p.y - 72)}</g>` : ''}</g>`
  }).join('')
  const lifelines = type === 'sequence' ? nodes.map((n) => { const p = positions.get(n.id)!; return `<path class="lifeline" d="M ${p.x},104 V ${height - 16}"/>` }).join('') : ''
  const spine = type === 'fishbone' ? `<path class="edge" d="M 48,340 H ${positions.get(effect[0]!.id)!.x - 96}" marker-end="url(#arrow)"/>` : ''
  const laneBands = lanes.map((lane, i) => `<g class="lane" aria-label="${escape(lane.label)}"><rect x="12" y="${i * 200 + 12}" width="${width - 24}" height="200" fill="var(--paper)" stroke="var(--line)" stroke-opacity=".4"/><path d="M 140,${i * 200 + 12} v 200" stroke="var(--line)" stroke-opacity=".4"/>${label(lane.label, 76, i * 200 + 104)}</g>`).join('')
  const details = JSON.stringify(Object.fromEntries(nodes.map((n) => [n.id, `${n.label}${n.details ? '：' + n.details : ''}${n.fields.length ? '\n' + n.fields.map((f) => `${f.key ? f.key + ' ' : ''}${f.name}: ${f.type}${f.details ? ' — ' + f.details : ''}`).join('\n') : ''}${type === 'er' ? '\n' + edges.filter((e) => e.from === n.id || e.to === n.id).map((e) => `${e.from}${e.fromField ? '.' + e.fromField : ''} [${e.fromCardinality}] — ${e.to}${e.toField ? '.' + e.toField : ''} [${e.toCardinality}]${e.label ? '：' + e.label : ''}`).join('\n') : ''}`]))).replace(/</g, String.fromCharCode(92) + 'u003c')
  return `<!doctype html><html><head><meta charset="utf-8"><style>
  :root{color-scheme:light;--paper:#fafaf9;--ink:#292524;--line:#78716c;--accent:#39715b}html[data-theme=dark]{color-scheme:dark;--paper:#202322;--ink:#e7e5e4;--line:#a8a29e;--accent:#8bc6aa}html[data-theme=sepia]{color-scheme:light;--paper:#f4ecd8;--ink:#433422;--line:#88745a;--accent:#71623b}*{box-sizing:border-box}html,body{height:100%;overflow:hidden}body{display:flex;flex-direction:column;margin:0;padding:12px;background:var(--paper);color:var(--ink);font:14px system-ui,"Microsoft YaHei",sans-serif}nav{display:flex;flex-shrink:0;gap:8px;align-items:center;flex-wrap:wrap;margin-bottom:12px}button{background:transparent;color:inherit;border:1px solid var(--line);border-radius:6px;padding:6px 10px;cursor:pointer}button:focus-visible,.node:focus-visible{outline:2px solid var(--accent);outline-offset:3px}#viewport{flex:1;min-height:0;overflow:auto}svg{display:block;width:${width}px;height:auto}.node rect,.node path{fill:var(--paper);stroke:var(--line);stroke-width:1}.node{cursor:pointer}.node.selected rect,.node.selected path{stroke:var(--accent);stroke-width:2}.lane text,.node text{fill:var(--ink);font-size:14px;pointer-events:none}.edge{fill:none;stroke:var(--line);stroke-width:1.2;stroke-linejoin:round}.reply,.lifeline{stroke-dasharray:4 4}.lifeline{fill:none;stroke:var(--line);opacity:.5}.edge-label{fill:var(--ink);font-size:12px;paint-order:stroke;stroke:var(--paper);stroke-width:5px;stroke-linejoin:round}#details{flex-shrink:0;white-space:pre-wrap;overflow-wrap:anywhere;overflow:auto;min-height:28px;max-height:80px;font-size:13px;line-height:1.5;border-top:1px solid var(--line);padding-top:8px;margin-top:8px}
  </style></head><body><nav aria-label="图表控制"><button id="minus" aria-label="缩小">−</button><button id="plus" aria-label="放大">+</button><button id="reset">适应宽度</button><output id="zoom" aria-label="缩放比例">100%</output></nav><div id="viewport"><svg role="img" aria-labelledby="diagram-title diagram-desc" viewBox="0 0 ${width} ${height}"><title id="diagram-title">${escape(title)}</title><desc id="diagram-desc">${nodes.length} 个节点，${edges.length} 条连线；点击或按回车查看节点详情。</desc><defs><marker id="arrow" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto"><path d="M 0,0 L 8,4 L 0,8 Z" fill="var(--line)"/></marker></defs>${laneBands}${spine}${lifelines}${lines}${boxes}</svg></div><div id="details" role="status" aria-label="节点详情">${type === 'timeline' ? '等距事件轴，不代表实际时间间隔；' : type === 'er' ? '1=一个 · 0..1=零或一个 · 1..*=至少一个 · 0..*=任意数量；' : ''}点击节点查看详情</div><script>(function(){const details=${details};const svg=document.querySelector('svg');let zoom=100;function resize(){svg.style.width=(${width}*zoom/100)+'px';document.getElementById('zoom').textContent=zoom+'%'}document.getElementById('plus').onclick=()=>{zoom=Math.min(300,zoom+25);resize()};document.getElementById('minus').onclick=()=>{zoom=Math.max(50,zoom-25);resize()};document.getElementById('reset').onclick=()=>{zoom=Math.min(100,Math.max(25,Math.floor(document.getElementById('viewport').clientWidth/${width}*100)));resize()};function select(node){document.querySelectorAll('.node').forEach(n=>n.classList.toggle('selected',n===node));document.getElementById('details').textContent=details[node.dataset.node]}document.querySelectorAll('.node').forEach(node=>{node.onclick=()=>select(node);node.onkeydown=e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();select(node)}}});window.addEventListener('message',e=>{if(e.source===parent&&e.data?.type==='artifact-theme'&&document.documentElement.dataset.artifactMountId===e.data.mountId)document.documentElement.dataset.theme=['dark','sepia'].includes(e.data.value)?e.data.value:'light'});})();</script></body></html>`
}
