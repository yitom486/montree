import type { AcpToolCallKind, AcpToolCallStatus } from '@montree/contracts'
import type { ChapterMarkPlanEntry } from '@montree/annotations'
import type { MarkProposalStatus, ProposedMark } from '@montree/annotations'
import type { AcpPlanEntry } from '@/lib/agent/acp-plan'
import type { AcpMessageAttachment } from '@/lib/agent/acp-composer'

export type AcpChatRole = 'user' | 'agent' | 'thought' | 'tool' | 'plan' | 'system'

export type { AcpPlanEntry, AcpMessageAttachment }

export interface AcpToolDiff {
  path: string
  oldText: string
  newText: string
}

export interface AcpToolLocation {
  path: string
  line?: number
}

export interface AcpChatMessage {
  id: string
  role: AcpChatRole
  text: string
  createdAt: number
  updatedAt?: number
  streaming?: boolean
  /** 用户消息附件摘要（不含 base64） */
  attachments?: AcpMessageAttachment[]
  /** tool 卡片字段 */
  toolCallId?: string
  toolKind?: AcpToolCallKind | string
  toolStatus?: AcpToolCallStatus | string
  toolTitle?: string
  toolContentText?: string
  toolDiffs?: AcpToolDiff[]
  toolLocations?: Array<{ path: string; line?: number }>
  /** plan 卡片 */
  planEntries?: AcpPlanEntry[]
  /** montree_propose_* 工具结果（promote 前） */
  markProposal?: ProposedMark
  markProposalStatus?: MarkProposalStatus
  /** promote 后挂在 Agent 回复下方的内嵌提议 */
  markProposals?: Array<{
    proposal: ProposedMark
    status: MarkProposalStatus
    toolCallId?: string
  }>
  /** montree_suggest_chapters 章级建议（promote 前在 tool，promote 后在 agent） */
  chapterMarkPlan?: ChapterMarkPlanEntry[]
  /** 交互经纬流转分步卡片（带对应章句穿透定位） */
  steps?: Array<{
    num: number
    title: string
    desc: string
    anchorId?: string
  }>
}

export function extractTextFromContent(content: unknown): string {
  if (!content) return ''
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    return content.map(extractTextFromContent).join('')
  }
  if (typeof content === 'object' && content !== null) {
    const row = content as Record<string, unknown>
    if (typeof row.text === 'string') return row.text
    if (typeof row.delta === 'string') return row.delta
    if (row.content) return extractTextFromContent(row.content)
  }
  return ''
}

export function parseToolDiffs(content: unknown): AcpToolDiff[] {
  if (!Array.isArray(content)) return []
  const diffs: AcpToolDiff[] = []
  for (const item of content) {
    if (!item || typeof item !== 'object') continue
    const row = item as Record<string, unknown>
    if (row.type !== 'diff') continue
    diffs.push({
      path: typeof row.path === 'string' ? row.path : 'file',
      oldText: typeof row.oldText === 'string' ? row.oldText : '',
      newText: typeof row.newText === 'string' ? row.newText : '',
    })
  }
  return diffs
}

/** 把 ACP tool content[] 压成可读摘要（卡片展开区；diff 另有可视化） */
export function flattenToolContent(content: unknown): string {
  if (!Array.isArray(content)) {
    return extractTextFromContent(content)
  }

  const parts: string[] = []
  for (const item of content) {
    if (!item || typeof item !== 'object') continue
    const row = item as Record<string, unknown>
    const type = typeof row.type === 'string' ? row.type : ''

    if (type === 'diff') {
      const path = typeof row.path === 'string' ? row.path : 'file'
      const oldText = typeof row.oldText === 'string' ? row.oldText : ''
      const newText = typeof row.newText === 'string' ? row.newText : ''
      const oldLines = oldText ? oldText.split('\n').length : 0
      const newLines = newText ? newText.split('\n').length : 0
      parts.push(`${path}  (~${oldLines} → ~${newLines} 行)`)
      continue
    }

    if (type === 'terminal') {
      parts.push(`终端 ${typeof row.terminalId === 'string' ? row.terminalId : ''}`.trim())
      continue
    }

    if (type === 'content' || row.content) {
      const text = extractTextFromContent(row.content ?? row)
      if (text) parts.push(text)
      continue
    }

    const text = extractTextFromContent(row)
    if (text) parts.push(text)
  }

  return parts.filter(Boolean).join('\n\n')
}

export function parseToolLocations(
  locations: unknown,
): Array<{ path: string; line?: number }> | undefined {
  if (!Array.isArray(locations)) return undefined
  const rows: Array<{ path: string; line?: number }> = []
  for (const item of locations) {
    if (!item || typeof item !== 'object') continue
    const row = item as Record<string, unknown>
    if (typeof row.path !== 'string' || !row.path) continue
    rows.push({
      path: row.path,
      line: typeof row.line === 'number' ? row.line : undefined,
    })
  }
  return rows.length > 0 ? rows : undefined
}

export function isToolActiveStatus(status: string | undefined): boolean {
  return status === 'pending' || status === 'in_progress' || !status
}

export function formatDuration(ms: number): string {
  if (ms < 1000) return '<1s'
  const sec = Math.round(ms / 1000)
  if (sec < 60) return `${sec}s`
  const min = Math.floor(sec / 60)
  const rem = sec % 60
  return rem > 0 ? `${min}m ${rem}s` : `${min}m`
}

export type DiffLineKind = 'same' | 'add' | 'del'

export interface DiffLine {
  kind: DiffLineKind
  text: string
}

/** 简易统一 diff：公共前后缀保留，中间标删/增 */
export function buildSimpleDiffLines(oldText: string, newText: string): DiffLine[] {
  if (oldText === newText) {
    const lines = (newText || '(无变更)').split('\n')
    return lines.map((text) => ({ kind: 'same' as const, text }))
  }

  const oldLines = oldText === '' ? [] : oldText.split('\n')
  const newLines = newText === '' ? [] : newText.split('\n')

  let start = 0
  while (
    start < oldLines.length &&
    start < newLines.length &&
    oldLines[start] === newLines[start]
  ) {
    start += 1
  }

  let oldEnd = oldLines.length - 1
  let newEnd = newLines.length - 1
  while (oldEnd >= start && newEnd >= start && oldLines[oldEnd] === newLines[newEnd]) {
    oldEnd -= 1
    newEnd -= 1
  }

  const lines: DiffLine[] = []
  for (let i = 0; i < start; i++) lines.push({ kind: 'same', text: oldLines[i]! })
  for (let i = start; i <= oldEnd; i++) lines.push({ kind: 'del', text: oldLines[i]! })
  for (let i = start; i <= newEnd; i++) lines.push({ kind: 'add', text: newLines[i]! })
  for (let i = oldEnd + 1; i < oldLines.length; i++) {
    lines.push({ kind: 'same', text: oldLines[i]! })
  }

  if (lines.length > 80) {
    return [
      ...lines.slice(0, 40),
      { kind: 'same', text: `… 另有 ${lines.length - 80} 行未展开 …` },
      ...lines.slice(-40),
    ]
  }
  return lines
}
