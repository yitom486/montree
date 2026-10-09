import {
  backfillMissingPages,
  computeTocPageRanges,
  isBareChapterTitle,
  isWatermarkTocEntry,
} from '@montree/ocr-core'
import type { OcrTocEntrySource } from '@montree/contracts'

/**
 * 目录 Agent 草稿本（渲染进程内存单例）。
 * 目录工具（toc_* MCP）经快照回路写到这里，人点保存才进真正的
 * ocr-toc-cache；与 prompt-JSON 解析路径互斥消费（take 即清空）。
 */

export interface TocDraftEntry {
  title: string
  printedPage: number
  endPage?: number | null
  level: number
  /** 工具写入一律标 ai（0-based 已归一，合并裁决用） */
  source?: OcrTocEntrySource
}

interface TocDraftState {
  fingerprint: string
  entries: TocDraftEntry[]
  updatedAt: number
  /**
   * 草稿世代（模块单调递增，clear 不回退）：区分“本轮开始前已存在”
   * 与“本轮开始后落袋”的同指纹草稿。entries 形状不变，不进缓存 schema。
   */
  seq: number
}

let draft: TocDraftState | null = null
let draftSeqCounter = 0

function nextDraftSeq(): number {
  draftSeqCounter += 1
  return draftSeqCounter
}

function toPrintedPage(value: unknown): number | null {
  const n = typeof value === 'number' ? value : Number.parseInt(String(value ?? ''), 10)
  if (!Number.isInteger(n) || n < 1 || n > 3000) return null
  return n
}

/**
 * 工具入参 1-based（章=1，见提示词）→ 存储 0-based（章=0，与启发式同口径）。
 * 与 toc-ai JSON 路径同口径，合并裁决不再错位。
 */
function toLevel(value: unknown): number {
  const n = typeof value === 'number' ? value : Number.parseInt(String(value ?? ''), 10)
  if (!Number.isInteger(n)) return 0
  return Math.min(6, Math.max(0, n - 1))
}

/** 单条校验（与 toc-ai 解析同口径：空标题/非法页码/水印一律丢弃） */
export function sanitizeTocDraftEntry(raw: unknown): TocDraftEntry | null {
  if (typeof raw !== 'object' || raw === null) return null
  const record = raw as Record<string, unknown>
  const title = typeof record.title === 'string' ? record.title.trim() : ''
  if (!title) return null
  const printedPage = toPrintedPage(record.printedPage)
  if (printedPage === null) return null
  if (isWatermarkTocEntry(title)) return null
  const endPage = toPrintedPage(record.endPage)
  return {
    title,
    printedPage,
    endPage: endPage ?? undefined,
    level: toLevel(record.level),
    source: 'ai' as const,
  }
}

/** 整单替换（toc_replace_all 主路径，幂等） */
export function writeTocDraft(
  fingerprint: string,
  rawEntries: unknown,
): { count: number; dropped: number } {
  if (!Array.isArray(rawEntries)) {
    draft = { fingerprint, entries: [], updatedAt: Date.now(), seq: nextDraftSeq() }
    return { count: 0, dropped: 0 }
  }
  // 宽松过一遍：留空页码给回填（与启发式同口径），无号章行直接丢弃
  const prelim: {
    title: string
    printedPage: number | null
    endPage?: number | null
    level: number
    raw: string
    source: OcrTocEntrySource
  }[] = []
  let dropped = 0
  for (const item of rawEntries) {
    if (typeof item !== 'object' || item === null) {
      dropped += 1
      continue
    }
    const record = item as Record<string, unknown>
    const title = typeof record.title === 'string' ? record.title.trim() : ''
    if (!title || isWatermarkTocEntry(title)) {
      dropped += 1
      continue
    }
    const printedPage = toPrintedPage(record.printedPage)
    if (printedPage === null && isBareChapterTitle(title)) {
      dropped += 1
      continue
    }
    const endPage = toPrintedPage(record.endPage)
    prelim.push({
      title,
      printedPage,
      endPage: endPage ?? undefined,
      level: toLevel(record.level),
      raw: title,
      source: 'ai',
    })
  }
  const filled = backfillMissingPages(prelim)
  const entries: TocDraftEntry[] = []
  for (const entry of filled) {
    if (entry.printedPage === null) {
      dropped += 1
      continue
    }
    entries.push({
      title: entry.title,
      printedPage: entry.printedPage,
      endPage: (entry as { endPage?: number | null }).endPage,
      level: entry.level,
      source: entry.source,
    })
  }
  // 自动根据后继章节推导 endPage（若未明确指定）
  const withRanges = computeTocPageRanges(
    entries.map((e) => ({ ...e, raw: e.title })),
  )
  const finalEntries: TocDraftEntry[] = withRanges.map((e) => ({
    title: e.title,
    printedPage: e.printedPage,
    endPage: e.endPage,
    level: e.level,
    source: e.source,
  }))

  draft = { fingerprint, entries: finalEntries, updatedAt: Date.now(), seq: nextDraftSeq() }
  return { count: finalEntries.length, dropped }
}

/** 同标题更新页码/层级，否则追加 */
export function upsertTocDraftEntry(
  fingerprint: string,
  rawEntry: unknown,
): { action: 'added' | 'updated'; count: number } | { error: string } {
  const entry = sanitizeTocDraftEntry(rawEntry)
  if (!entry) return { error: '条目无效（空标题/非法页码/水印）' }
  if (!draft || draft.fingerprint !== fingerprint) {
    draft = { fingerprint, entries: [entry], updatedAt: Date.now(), seq: nextDraftSeq() }
    return { action: 'added', count: 1 }
  }
  const index = draft.entries.findIndex((item) => item.title === entry.title)
  if (index >= 0) {
    draft.entries[index] = entry
  } else {
    draft.entries.push(entry)
  }
  draft.updatedAt = Date.now()
  draft.seq = nextDraftSeq()
  return { action: index >= 0 ? 'updated' : 'added', count: draft.entries.length }
}

/** 按序号或标题删一条 */
export function deleteTocDraftEntry(
  fingerprint: string,
  selector: { index?: unknown; title?: unknown },
): { removed: number; count: number } {
  if (!draft || draft.fingerprint !== fingerprint) return { removed: 0, count: draft?.entries.length ?? 0 }
  const { index, title } = selector
  let at = -1
  if (typeof index === 'number' && Number.isInteger(index)) {
    at = index >= 0 && index < draft.entries.length ? index : -1
  } else if (typeof title === 'string' && title.trim()) {
    at = draft.entries.findIndex((item) => item.title === title.trim())
  }
  if (at < 0) return { removed: 0, count: draft.entries.length }
  draft.entries.splice(at, 1)
  draft.updatedAt = Date.now()
  draft.seq = nextDraftSeq()
  return { removed: 1, count: draft.entries.length }
}

export function readTocDraft(): TocDraftState | null {
  return draft
}

/**
 * 取走草稿（指纹一致才给，且取即清空，避免与 JSON 回退路径重复应用）。
 * 指纹不符返回 null 且保留草稿。
 */
export function takeTocDraft(expectedFingerprint: string): TocDraftEntry[] | null {
  if (!draft || draft.fingerprint !== expectedFingerprint || draft.entries.length === 0) {
    return null
  }
  const entries = draft.entries
  draft = null
  return entries
}

export function clearTocDraft(): void {
  draft = null
}

/** 当前草稿世代（无草稿为 0）：新轮次开始时记录为基线用 */
export function peekTocDraftSeq(fingerprint: string): number {
  if (!draft || draft.fingerprint !== fingerprint || draft.entries.length === 0) {
    return 0
  }
  return draft.seq
}

/**
 * 门控消费：只取走 seq 严格大于 minSeq 的草稿（本轮开始后落袋的）。
 * 旧草稿既不消费也不清除——旧超时操作随后写入会推进 seq，
 * 正在等待的同文件轮次仍可消费；下一次写入会自然覆盖，无泄漏。
 */
export function takeTocDraftSince(
  fingerprint: string,
  minSeq: number,
): TocDraftEntry[] | null {
  if (!draft || draft.fingerprint !== fingerprint || draft.entries.length === 0) {
    return null
  }
  if (draft.seq <= minSeq) return null
  const entries = draft.entries
  draft = null
  return entries
}

export interface TocDraftWaitOptions {
  /** 总等待上限，默认 180_000（3 分钟，为后台工具执行留足余量） */
  deadlineMs?: number
  /** 轮询间隔，默认 2_000 */
  intervalMs?: number
  /** 取消谓词（卸载/切文件/新一轮开始即停） */
  isCancelled?: () => boolean
  /** 可注入时钟与睡眠（单测确定性用；默认真实时间） */
  now?: () => number
  sleep?: (ms: number) => Promise<void>
  /** 取草稿实现（默认读内存单例；单测注入假序列） */
  take?: (fingerprint: string) => TocDraftEntry[] | null
  /**
   * 世代下限（排他）：只接受 seq 严格大于它的草稿。
   * 调用方传本轮开始时 peekTocDraftSeq 的值；默认 0（接受一切现存草稿）。
   */
  minSeq?: number
}

export interface TocDraftWaitResult {
  entries: TocDraftEntry[] | null
  waitedMs: number
  outcome: 'hit' | 'timeout' | 'cancelled'
}

/**
 * 等工具草稿落袋（send 超时/空回复后）：命中即消费返回；
 * 超时或取消返回空，调用方走“AI 无回复”。指纹门由 take 保证——
 * 旧文档/旧操作的草稿 key 不同，不会被误消费。
 */
export async function waitForTocDraft(
  fingerprint: string,
  options?: TocDraftWaitOptions,
): Promise<TocDraftWaitResult> {
  const deadlineMs = options?.deadlineMs ?? 180_000
  const intervalMs = options?.intervalMs ?? 2_000
  const now = options?.now ?? Date.now
  const sleep =
    options?.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)))
  const minSeq = options?.minSeq ?? 0
  const take = options?.take ?? ((fp: string) => takeTocDraftSince(fp, minSeq))
  const startedAt = now()
  for (;;) {
    if (options?.isCancelled?.()) {
      return { entries: null, waitedMs: now() - startedAt, outcome: 'cancelled' }
    }
    const entries = take(fingerprint)
    if (entries) {
      return { entries, waitedMs: now() - startedAt, outcome: 'hit' }
    }
    if (now() - startedAt >= deadlineMs) {
      return { entries: null, waitedMs: now() - startedAt, outcome: 'timeout' }
    }
    await sleep(Math.min(intervalMs, Math.max(0, deadlineMs - (now() - startedAt))))
  }
}

/**
 * prompt 回来后的出路裁决（纯函数，被 TocAiPolishControl 实际调用）：
 * - 有工具草稿 → 用草稿（工具优先），**无论文字回复是否为空**
 *   （工具型 Agent 可能零正文回复；先判空回复会丢弃已写好的草稿）；
 * - 无草稿但有文字 → 走 JSON 解析回退；
 * - 两者皆无 → AI 无回复。
 */
export type TocAiPromptOutcome =
  | { action: 'apply-draft'; source: 'tool' }
  | { action: 'parse-reply' }
  | { action: 'no-reply' }

export function decideTocAiPromptOutcome(
  hasDraft: boolean,
  hasReply: boolean,
): TocAiPromptOutcome {
  if (hasDraft) return { action: 'apply-draft', source: 'tool' }
  if (hasReply) return { action: 'parse-reply' }
  return { action: 'no-reply' }
}
