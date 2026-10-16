import type { ChatMessage } from './chat-message'
import { explainToolFailure } from './tool-failure-message'
import { isPresentToolTitle } from './parse-present-result'
import { isGenericToolName } from './tool-call-metadata'

/**
 * 工具调用纯展示模型（R1）。
 *
 * 只读 `ChatMessage` 已有字段做映射，不改消息、不读 store、不碰 IPC。
 * AI SDK `ToolUIPart` 不进入本模型；社区 `Tool` 组件的状态只在渲染边界映射。
 */
export type ToolDisplayState =
  | 'awaiting-approval'
  | 'pending'
  | 'in-progress'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'unknown'

export type ToolResultKind =
  | 'diagram'
  | 'cross-reference'
  | 'content-audit'
  | 'chapter-suggestion'
  | 'chapter-comparison'
  | 'html-artifact'
  | 'component-ui'
  | 'react-artifact'
  | 'diff'
  | 'text'
  | 'none'

export interface ToolDisplayModel {
  messageId: string
  toolCallId?: string
  /** 中文能力标题（未知工具保留原名） */
  title: string
  activityLabel: string
  rawTitle: string
  /** 来自工具输入或文件位置的目标摘要；无元数据时为 null。 */
  targetSummary: string | null
  state: ToolDisplayState
  stateLabel: string
  errorHeadline: string | null
  errorBody: string | null
  resultKind: ToolResultKind
  /** 可证实的创建→更新耗时；缺失或不可信时为 null（直接省略，不估算） */
  durationMs: number | null
  hasBodyDetails: boolean
}

const STATE_LABEL: Record<ToolDisplayState, string> = {
  'awaiting-approval': '等待批准',
  pending: '等待执行',
  'in-progress': '执行中',
  completed: '已完成',
  failed: '失败',
  cancelled: '已取消',
  unknown: '状态未知',
}

const DIAGRAM_NAMES = new Map([
  ['flowchart', '流程图'], ['sequence', '时序图'], ['architecture', '架构图'], ['mindmap', '思维导图'],
  ['swimlane', '泳道图'], ['timeline', '时间线'], ['fishbone', '鱼骨图'], ['cycle', '循环图'], ['er', '实体关系图'],
])

export function toolStateLabel(state: ToolDisplayState): string {
  return STATE_LABEL[state]
}

/**
 * 状态映射：pending 审批优先于一切普通状态。
 * 终态（completed / failed / cancelled）按原值表达，不看 streaming。
 * 非终态只在仍在接收（streaming）时表达为等待/执行中；一旦落定，
 * 缺失 / 未识别 / 未完成的残留一律“状态未知”，绝不推断成功。
 * （store 收尾冻结不再把残留补成 completed，此处是第二道防线。）
 */
export function toToolDisplayState(
  message: Pick<ChatMessage, 'toolStatus' | 'streaming'>,
  opts?: { needsApproval?: boolean },
): ToolDisplayState {
  if (opts?.needsApproval) return 'awaiting-approval'
  const status = message.toolStatus
  if (status === 'failed') return 'failed'
  if (status === 'cancelled') return 'cancelled'
  if (status === 'completed') return 'completed'
  if (status === 'pending') return message.streaming ? 'pending' : 'unknown'
  if (status === 'in_progress') return message.streaming ? 'in-progress' : 'unknown'
  return message.streaming ? 'in-progress' : 'unknown'
}

/** 已知工具名 → 中文能力标题（能力标签，不断言执行成果）。 */
const TITLE_RULES: Array<{ test: RegExp; title: string }> = [
  { test: /montree_generate_diagram/i, title: '图表推演' },
  { test: /montree_cross_reference/i, title: '跨章引证' },
  { test: /montree_inspect_content/i, title: '内容审计' },
  { test: /montree_suggest_chapters/i, title: '章节建议' },
  { test: /montree_propose_mark|propose.?mark/i, title: '批注提议' },
  { test: /(?:^|[.:]|__)montree_present$/i, title: '展示呈现' },
  { test: /montree_read|mcp\.montree\.montree_read/i, title: '读取文档' },
  { test: /montree_get_selection/i, title: '读取选区' },
  { test: /montree_capture_viewport/i, title: '读取当前页' },
  { test: /\bsearch\b|montree_search|全文检索/i, title: '搜索文档' },
  { test: /terminal/i, title: '终端执行' },
  { test: /read_text_file|\bread\b/i, title: '读取文件' },
  { test: /write_text_file|\bwrite\b|\bedit\b/i, title: '写入文件' },
]

export function readableToolTitle(rawTitle?: string): string {
  const raw = (rawTitle ?? '').trim()
  if (!raw) return '工具调用'
  if (isGenericToolName(raw)) return '工具调用'
  for (const rule of TITLE_RULES) {
    if (rule.test.test(raw)) return rule.title
  }
  return raw
}

function basename(path: string): string {
  const parts = path.replace(/\\/g, '/').split('/')
  return parts[parts.length - 1] || path
}

export function summarizeToolTarget(
  message: Pick<ChatMessage, 'toolDiffs' | 'toolLocations' | 'toolInputSummary'>,
): string | null {
  const input = message.toolInputSummary
  if (input?.title) return input.title
  const diffs = message.toolDiffs ?? []
  const locations = message.toolLocations ?? []
  if (diffs.length === 1) return basename(diffs[0]!.path)
  if (locations.length === 1) return basename(locations[0]!.path)
  if (diffs.length > 1) return `${diffs.length} 个文件`
  if (locations.length > 1) return `${locations.length} 个文件`
  if (input?.path) return basename(input.path)
  if (input?.query) return input.query
  return null
}

/** 富业务结果分类：与展示提升共用同一判定（present 优先用 enrich 结果，其余不解析 JSON，只做字符串门限）。 */
export function classifyToolResultKind(
  message: Pick<ChatMessage, 'role' | 'toolTitle' | 'toolContentText' | 'text' | 'toolDiffs' | 'presentResult'>,
): ToolResultKind {
  if (message.role !== 'tool') return 'none'
  const title = message.toolTitle || ''
  const detail = message.toolContentText || message.text || ''
  if (message.presentResult?.kind === 'chapter-comparison') return 'chapter-comparison'
  if (message.presentResult?.kind === 'html-artifact') return 'html-artifact'
  if (message.presentResult?.kind === 'component-ui') return 'component-ui'
  if (message.presentResult?.kind === 'react-artifact') return 'react-artifact'
  // agy 会先读取 MCP schema 文件；它包含所有结果种类，但不是执行结果。
  if (/montree_present\.json\b/i.test(title)) return 'text'
  if (title.includes('montree_generate_diagram') || detail.includes('mermaidCode')) {
    return 'diagram'
  }
  if (title.includes('montree_cross_reference') || detail.includes('chapterDistribution')) {
    return 'cross-reference'
  }
  if (title.includes('montree_inspect_content') || detail.includes('"hits"')) {
    return 'content-audit'
  }
  if (title.includes('montree_suggest_chapters') || detail.includes('"chapters"')) {
    return 'chapter-suggestion'
  }
  if (isPresentToolTitle(title) && detail.includes('chapter-comparison')) {
    return 'chapter-comparison'
  }
  if (isPresentToolTitle(title) && detail.includes('html-artifact')) {
    return 'html-artifact'
  }
  if (isPresentToolTitle(title) && detail.includes('component-ui')) {
    return 'component-ui'
  }
  if ((message.toolDiffs ?? []).length > 0) return 'diff'
  if (isPresentToolTitle(title) && detail.includes('react-artifact')) return 'react-artifact'
  if (detail && detail !== title) return 'text'
  return 'none'
}

/** 富业务结果是否应提升到主时间线（原 isRichToolMessage 语义）。 */
export function isPromotedToolResultKind(kind: ToolResultKind): boolean {
  return (
    kind === 'diagram' ||
    kind === 'cross-reference' ||
    kind === 'content-audit' ||
    kind === 'chapter-suggestion' ||
    kind === 'chapter-comparison' ||
    kind === 'html-artifact' ||
    kind === 'component-ui' || kind === 'react-artifact'
  )
}

export function toToolDisplayModel(
  message: ChatMessage,
  opts?: { needsApproval?: boolean },
): ToolDisplayModel {
  const needsApproval = opts?.needsApproval ?? false
  const state = toToolDisplayState(message, { needsApproval })
  const rawTitle = (message.toolTitle ?? '').trim()
  const detail = message.toolContentText || message.text
  const failed = state === 'failed'
  const failure = failed
    ? explainToolFailure(detail && detail !== message.toolTitle ? detail : '', message.toolTitle)
    : null
  const resultKind = classifyToolResultKind(message)
  const targetSummary = summarizeToolTarget(message)
  const name = message.toolName || rawTitle
  const input = message.toolInputSummary
  const diagram = /(?:^|[.:]|__)montree_generate_diagram$/i.test(name) ||
    (isPresentToolTitle(name) && input?.kind === 'preset' && input.preset === 'diagram')
  const namedTitle = readableToolTitle(name)
  const title = diagram ? `绘制${DIAGRAM_NAMES.get(input?.diagramType ?? '') ?? '图表'}`
    : namedTitle !== name ? namedTitle : readableToolTitle(rawTitle || name)
  const action = diagram ? `正在${title}` : `正在调用${title}`
  const hasTextDetail = Boolean(
    detail && detail !== message.toolTitle && (message.toolDiffs ?? []).length === 0,
  )
  const durationMs =
    typeof message.updatedAt === 'number' &&
    typeof message.createdAt === 'number' &&
    message.updatedAt >= message.createdAt
      ? message.updatedAt - message.createdAt
      : null
  return {
    messageId: message.id,
    toolCallId: message.toolCallId,
    title,
    activityLabel: `${action}${targetSummary ? `：${targetSummary}` : ''}`,
    rawTitle: rawTitle || '工具调用',
    targetSummary,
    state,
    stateLabel: toolStateLabel(state),
    errorHeadline: failure?.headline ?? null,
    errorBody: failure?.body ?? null,
    resultKind,
    durationMs,
    hasBodyDetails:
      hasTextDetail ||
      (message.toolDiffs ?? []).length > 0 ||
      (message.toolLocations ?? []).length > 0 ||
      failure != null ||
      isPromotedToolResultKind(resultKind),
  }
}
