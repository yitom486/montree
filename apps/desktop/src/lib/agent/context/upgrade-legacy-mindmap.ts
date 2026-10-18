/**
 * 历史思维导图快照热升级：
 * 为早前会话中已固化为旧版静态 HTML 的思维导图动态注入展开/折叠按钮与交互逻辑，
 * 使得历史消息无需重新向模型发起请求，即可平滑获得分支折叠/展开能力。
 */
export function upgradeLegacyMindmapHtml(html: string): string {
  if (!html || html.includes('mindmap-toggle') || !html.includes('class="edge"') || !html.includes(' C ')) {
    return html
  }

  // 匹配所有节点及其矩形坐标
  const nodeRegex = /<g class="node[^"]*" data-node="([^"]+)"[^>]*>[\s\S]*?<rect x="([0-9.]+)" y="([0-9.]+)"/g
  const nodes = new Map<string, { id: string; x: number; y: number; rightX: number; rightY: number; leftX: number; leftY: number }>()
  let nodeMatch: RegExpExecArray | null
  while ((nodeMatch = nodeRegex.exec(html)) !== null) {
    const id = nodeMatch[1]!
    const x = parseFloat(nodeMatch[2]!)
    const y = parseFloat(nodeMatch[3]!)
    nodes.set(id, {
      id,
      x,
      y,
      rightX: x + 192,
      rightY: y + 40,
      leftX: x,
      leftY: y + 40,
    })
  }

  if (nodes.size === 0) return html

  // 匹配所有贝塞尔曲线连线并反解父子节点关系（C 包含两组控制点与一组终点）
  const edgeRegex = /<path\b[^>]*?\bd="M\s*([0-9.]+),([0-9.]+)\s+C(?:\s+[0-9.-]+,[0-9.-]+){2}\s+([0-9.]+),([0-9.]+)"[^>]*?\bclass="edge([^"]*)"[^>]*?\/?>/g
  const edges: Array<{ from: string; to: string; raw: string }> = []
  let edgeMatch: RegExpExecArray | null
  while ((edgeMatch = edgeRegex.exec(html)) !== null) {
    const raw = edgeMatch[0]!
    const ax = parseFloat(edgeMatch[1]!)
    const ay = parseFloat(edgeMatch[2]!)
    const bx = parseFloat(edgeMatch[3]!)
    const by = parseFloat(edgeMatch[4]!)

    let fromNode: string | null = null
    let toNode: string | null = null

    for (const [id, n] of nodes.entries()) {
      if (Math.abs(n.rightX - ax) < 1.5 && Math.abs(n.rightY - ay) < 1.5) {
        fromNode = id
      }
      if (Math.abs(n.leftX - bx) < 1.5 && Math.abs(n.leftY - by) < 1.5) {
        toNode = id
      }
    }

    if (fromNode && toNode) {
      edges.push({ from: fromNode, to: toNode, raw })
    }
  }

  if (edges.length === 0) return html

  // 聚合父子节点表与根节点
  const childMap: Record<string, string[]> = {}
  const toNodes = new Set<string>()
  for (const e of edges) {
    if (!childMap[e.from]) childMap[e.from] = []
    childMap[e.from].push(e.to)
    toNodes.add(e.to)
  }

  const roots = Array.from(nodes.keys()).filter((id) => !toNodes.has(id))

  let upgraded = html

  // 1. 给边补充 data-from 与 data-to
  for (const e of edges) {
    const upgradedEdge = e.raw.replace('class="edge', `data-from="${e.from}" data-to="${e.to}" class="edge`)
    upgraded = upgraded.replace(e.raw, upgradedEdge)
  }

  // 2. 为非叶子节点注入折叠按钮
  for (const [parentId, children] of Object.entries(childMap)) {
    if (!children.length) continue
    const parentNode = nodes.get(parentId)
    if (!parentNode) continue
    const toggleSvg = `<g class="mindmap-toggle" data-toggle="${parentId}" role="button" tabindex="0" aria-label="折叠分支" title="折叠/展开分支"><circle class="toggle-hit" cx="${parentNode.rightX}" cy="${parentNode.rightY}" r="14" fill="transparent"/><circle class="toggle-circle" cx="${parentNode.rightX}" cy="${parentNode.rightY}" r="8"/><path d="M ${parentNode.rightX - 4},${parentNode.rightY} h 8" class="toggle-h"/><path d="M ${parentNode.rightX},${parentNode.rightY - 4} v 8" class="toggle-v"/></g>`

    const nodePattern = new RegExp(`(<g class="node[^"]*" data-node="${parentId}"[\\s\\S]*?)(</g>)`)
    upgraded = upgraded.replace(nodePattern, `$1${toggleSvg}$2`)
  }

  // 3. 注入折叠与展开样式
  const toggleCss = `.mindmap-toggle{cursor:pointer}.mindmap-toggle .toggle-circle{fill:var(--paper);stroke:var(--line);stroke-width:1.5;transition:stroke .15s}.mindmap-toggle path{stroke:var(--ink);stroke-width:1.5;stroke-linecap:round}.mindmap-toggle:hover .toggle-circle,.mindmap-toggle:focus-visible .toggle-circle{stroke:var(--accent)}.mindmap-toggle:hover path,.mindmap-toggle:focus-visible path{stroke:var(--accent)}.node:not(.collapsed) .toggle-v{display:none}.node.collapsed .toggle-v{display:block}.node.collapsed .toggle-circle{stroke:var(--accent);fill:var(--paper)}.node.collapsed .mindmap-toggle path{stroke:var(--accent)}`
  upgraded = upgraded.replace('</style>', `${toggleCss}</style>`)

  // 4. 注入思维导图折叠交互脚本
  const toggleScript = `const type='mindmap';const childMap=${JSON.stringify(childMap)};const roots=${JSON.stringify(roots)};const collapsed=new Set();function updateMindmap(){const visibleNodes=new Set();const visibleEdges=new Set();function traverse(nodeId){visibleNodes.add(nodeId);if(collapsed.has(nodeId))return;const children=childMap[nodeId]||[];for(let i=0;i<children.length;i++){const childId=children[i];visibleEdges.add(nodeId+'->'+childId);traverse(childId)}}for(let i=0;i<roots.length;i++)traverse(roots[i]);document.querySelectorAll('.node').forEach(node=>{const id=node.dataset.node;node.style.display=visibleNodes.has(id)?'':'none';node.classList.toggle('collapsed',collapsed.has(id));const btn=node.querySelector('.mindmap-toggle');if(btn){btn.setAttribute('aria-label',(collapsed.has(id)?'展开':'折叠')+'分支');btn.setAttribute('title',(collapsed.has(id)?'展开':'折叠')+'分支')}});document.querySelectorAll('.edge').forEach(edge=>{const from=edge.dataset.from;const to=edge.dataset.to;if(from&&to){edge.style.display=visibleEdges.has(from+'->'+to)?'':'none'}})}document.querySelectorAll('.mindmap-toggle').forEach(btn=>{function toggle(e){e.stopPropagation();const id=btn.dataset.toggle;if(collapsed.has(id)){collapsed.delete(id)}else{collapsed.add(id)}updateMindmap();const node=btn.closest('.node');if(node)select(node)}btn.onclick=toggle;btn.onkeydown=e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();toggle(e)}}});`

  if (upgraded.includes("window.addEventListener('message'")) {
    upgraded = upgraded.replace("window.addEventListener('message'", `${toggleScript}window.addEventListener('message'`)
  } else {
    upgraded = upgraded.replace('})();</script>', `${toggleScript}})();</script>`)
  }

  return upgraded
}
