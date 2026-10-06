import type { DocumentKind } from '@montree/contracts'

/** 附加到用户消息前的 turn-context 体积上限（字符数） */
export const TURN_CONTEXT_MAX_CHARS = 1200

export interface MontreeActiveDocument {
  /** 绝对路径 */
  path: string
  kind: DocumentKind
  /** 文件名（含扩展名） */
  name: string
}

export interface MontreeReadingState {
  /** 阅读进度百分比，0–100 的整数 */
  percent?: number
  /** 当前所在章节 / 页 */
  current?: string
  previous?: string
  next?: string
  /** 目录单元总数（EPUB/MOBI 为章节数，PDF 为大纲项数） */
  unitCount?: number
  /** T1：PDF 当前页（正整数）；EPUB 不填，禁止编造 */
  page?: number
}

export interface MontreeTurnContext {
  /** 相比上次附加的 turn-context，用户是否换了文件 */
  documentChanged: boolean
  activeDocument: MontreeActiveDocument | null
  reading?: MontreeReadingState
  /** 发送时用户是否选中了文本（不含选区正文，正文走 montree_get_selection） */
  hasSelection?: boolean
  /** 目录顶层标题（最多约 10 条），便于记住全书结构；完整目录仍走 montree_get_toc */
  tocTopLevel?: string[]
}

/** turn-context 块的稳定首尾标记：回放清洗（strip-replay-scaffolding）据此剥离 */
export const MONTREE_TURN_CONTEXT_OPEN_TAG = '<montree-turn-context>'
export const MONTREE_TURN_CONTEXT_CLOSE_TAG = '</montree-turn-context>'

const OPEN_TAG = MONTREE_TURN_CONTEXT_OPEN_TAG
const CLOSE_TAG = MONTREE_TURN_CONTEXT_CLOSE_TAG

/** 同一文件同一格式视为同一文档；无打开文件时为 null */
export function documentKey(doc: MontreeActiveDocument | null): string | null {
  if (!doc) return null
  return `${doc.kind}:${doc.path}`
}

function compactReading(reading: MontreeReadingState): MontreeReadingState | undefined {
  const entries = Object.entries(reading).filter(([, v]) => v !== undefined && v !== '')
  if (entries.length === 0) return undefined
  return Object.fromEntries(entries) as MontreeReadingState
}

/**
 * 序列化为附加在用户消息前的文本块。
 * 超出 {@link TURN_CONTEXT_MAX_CHARS} 时逐级丢弃可选字段，保证不会撑爆上下文。
 */
export function formatTurnContextBlock(
  context: MontreeTurnContext,
  maxChars = TURN_CONTEXT_MAX_CHARS,
): string {
  const reading = context.reading ? compactReading(context.reading) : undefined

  const candidates: MontreeTurnContext[] = [
    { ...context, reading },
    // 退化 1：丢掉顶层目录（可选、体积最大）
    { ...context, reading, tocTopLevel: undefined },
    // 退化 2：只保留进度与当前位置（T1：页码是位置本身，退化也不丢）
    {
      documentChanged: context.documentChanged,
      activeDocument: context.activeDocument,
      ...(context.hasSelection ? { hasSelection: true } : {}),
      reading: reading
        ? compactReading({ percent: reading.percent, current: reading.current, page: reading.page })
        : undefined,
    },
    // 退化 3：只剩文件本身
    { documentChanged: context.documentChanged, activeDocument: context.activeDocument },
  ]

  for (const candidate of candidates) {
    const text = `${OPEN_TAG}\n${JSON.stringify(candidate)}\n${CLOSE_TAG}`
    if (text.length <= maxChars) return text
  }

  const fallback: MontreeTurnContext = {
    documentChanged: context.documentChanged,
    activeDocument: context.activeDocument
      ? {
          path: context.activeDocument.path.slice(-160),
          kind: context.activeDocument.kind,
          name: context.activeDocument.name.slice(0, 80),
        }
      : null,
  }
  return `${OPEN_TAG}\n${JSON.stringify(fallback)}\n${CLOSE_TAG}`
}
