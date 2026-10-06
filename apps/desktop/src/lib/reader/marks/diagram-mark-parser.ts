import type { ReadingMark } from '@montree/contracts'
import type { DiagramPayload, DiagramVisualStep } from '@/components/agent/tools/DiagramViewerCard'

/**
 * 从 ReadingMark 的 note 或属性中深度解析 DiagramPayload。
 * 兼容纯 JSON 结构与带 Markdown 标记的结构化图谱卡片笔记。
 */
export function parseDiagramFromMark(mark: ReadingMark): DiagramPayload | null {
  const note = mark.note?.trim() ?? ''

  // 1. 若为序列化 JSON 载荷直接反序列化
  if (note.startsWith('{') && note.endsWith('}')) {
    try {
      const obj = JSON.parse(note)
      if (obj && typeof obj === 'object' && typeof obj.mermaidCode === 'string') {
        return obj as DiagramPayload
      }
    } catch {
      // 容错回退
    }
  }

  // 2. 检查 Mermaid 代码块或图谱标识
  const mermaidMatch = note.match(/```mermaid\s*([\s\S]*?)```/)
  const hasMermaid = Boolean(mermaidMatch)
  const isDiagramCategory = mark.category === 'diagram' || Boolean(mark.diagramId)

  if (!hasMermaid && !isDiagramCategory) {
    return null
  }

  const mermaidCode = mermaidMatch ? mermaidMatch[1]!.trim() : ''

  // 3. 提取核心解读（优先从 Markdown > 核心解读 提取，次取 aiSummary）
  const summaryMatch = note.match(/>\s*\*\*核心解读\*\*[：:]\s*([^\n]+)/)
  const summary = summaryMatch
    ? summaryMatch[1]!.trim()
    : mark.aiSummary || mark.excerpt

  // 4. 正则提取结构化推演步骤
  const visualSteps: DiagramVisualStep[] = []
  const stepRegex = /(\d+)\.\s+\*\*([^*]+)\*\*(?:\s*[（(]([^）)]+)[）)])?(?:\s*[：:]\s*([^\n]+))?/g
  let match: RegExpExecArray | null
  while ((match = stepRegex.exec(note)) !== null) {
    const rawAction = match[2]?.trim() ?? ''
    const rawRoute = match[3]?.trim() ?? ''
    const rawDesc = match[4]?.trim() ?? ''

    let from = '前置阶段'
    let to = '推演演进'
    if (rawRoute.includes('→')) {
      const parts = rawRoute.split('→')
      from = parts[0]?.trim() || from
      to = parts[1]?.trim() || to
    } else if (rawRoute) {
      from = rawRoute
      to = rawRoute
    }

    visualSteps.push({
      action: rawAction,
      from,
      to,
      desc: rawDesc || undefined,
    })
  }

  // 若无文本匹配步骤但包含 keyPoints 则做回落映射
  if (visualSteps.length === 0 && mark.keyPoints && mark.keyPoints.length > 0) {
    mark.keyPoints.forEach((kp, idx) => {
      visualSteps.push({
        action: kp,
        from: `阶段 ${idx + 1}`,
        to: `阶段 ${idx + 2}`,
        desc: kp,
      })
    })
  }

  // 5. 推断 diagramType
  let diagramType: DiagramPayload['diagramType'] = 'flowchart'
  const lowerCode = mermaidCode.toLowerCase()
  if (lowerCode.includes('sequencediagram')) {
    diagramType = 'sequence'
  } else if (lowerCode.includes('mindmap')) {
    diagramType = 'mindmap'
  } else if (lowerCode.includes('statediagram')) {
    diagramType = 'stateDiagram'
  } else if (lowerCode.includes('classdiagram')) {
    diagramType = 'classDiagram'
  } else if (lowerCode.includes('erdiagram')) {
    diagramType = 'erDiagram'
  } else if (mark.tags) {
    for (const tag of mark.tags) {
      if (
        ['sequence', 'flowchart', 'mindmap', 'stateDiagram', 'classDiagram', 'erDiagram'].includes(
          tag,
        )
      ) {
        diagramType = tag as DiagramPayload['diagramType']
        break
      }
    }
  }

  return {
    diagramId: mark.diagramId || mark.id,
    diagramType,
    title: mark.title || mark.label || '交互式时序图谱',
    mermaidCode: mermaidCode || 'flowchart TD\nA["核心概念"] --> B["推演延伸"]',
    summary,
    visualSteps: visualSteps.length > 0 ? visualSteps : undefined,
    anchorExcerpt: mark.excerpt,
  }
}
