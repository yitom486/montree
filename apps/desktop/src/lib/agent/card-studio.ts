import type { ReadingMarkCategory } from '@montree/contracts'
import type { HeuristicCardResult } from '@/lib/reader/marks/card-shape'
import { highlightColorForCategory } from '@/lib/reader/marks/card-shape'
import {
  buildCardStudioPrompt,
  getCardStudioPreset,
} from '@/lib/agent/card-studio-presets'
import { sendCardStudioPrompt } from '@/lib/agent/card-studio-session'
import { extractJsonFromResponse } from '@/lib/quiz/quiz-evaluator'

/**
 * AI 制卡编排（P1）：预设 prompt → 本书会话调模型 → 校验成卡。
 * 返回 null 仅当入参非法（调用方 toast 报错）；
 * 模型无响应/结果非法直接返回失败（无启发式兜底，调用方报错），
 * 形状恒为 `HeuristicCardResult`，下游 `saveHighlight` 零改。
 */

const CARD_CATEGORIES: readonly ReadingMarkCategory[] = [
  'concept',
  'quote',
  'method',
  'diagram',
  'question',
]

export interface AiCardInput {
  excerpt: string
  presetId: string
  customText?: string
  bookKey: string
}

/**
 * AI 制卡结果：ok 必有卡；失败无卡（启发式兜底已删除——调不通就是调不通，
 * 调用方按 reason 报错，不许拿假卡充数）。
 */
export type AiCardOutcome =
  | { ok: true; card: HeuristicCardResult }
  | { ok: false; reason: 'auth-required' | 'failed' }

interface AiCardJson {
  title?: unknown
  category?: unknown
  aiSummary?: unknown
  keyPoints?: unknown
}

function toCleanString(value: unknown, maxLen: number): string {
  if (typeof value !== 'string') return ''
  return value.trim().slice(0, maxLen)
}

function toKeyPoints(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value
    .map((item) => (typeof item === 'string' ? item.trim() : ''))
    .filter(Boolean)
    .slice(0, 3)
}

export function parseAiCardJson(
  raw: string,
  presetCategory: ReadingMarkCategory | 'auto',
  excerpt: string,
): Omit<HeuristicCardResult, 'color'> | null {
  const parsed = extractJsonFromResponse<AiCardJson>(raw)
  if (!parsed) return null
  const title = toCleanString(parsed.title, 24)
  const aiSummary = toCleanString(parsed.aiSummary, 500)
  const keyPoints = toKeyPoints(parsed.keyPoints)
  if (!title || !aiSummary || keyPoints.length === 0) return null
  let category: ReadingMarkCategory
  if (presetCategory === 'auto') {
    if (typeof parsed.category !== 'string') return null
    const normalized = parsed.category.trim() as ReadingMarkCategory
    if (!CARD_CATEGORIES.includes(normalized)) return null
    category = normalized
  } else {
    category = presetCategory
  }
  return { title, category, aiSummary, keyPoints }
}

export async function generateAiCardContent(input: AiCardInput): Promise<AiCardOutcome | null> {
  const excerpt = input.excerpt.trim()
  if (!excerpt) return null
  const preset = getCardStudioPreset(input.presetId)
  if (!preset) return null

  const sent = await sendCardStudioPrompt(
    input.bookKey,
    buildCardStudioPrompt(excerpt, preset, input.customText),
  )
  if (sent.status === 'ok' && sent.reply) {
    const parsed = parseAiCardJson(sent.reply, preset.category, excerpt)
    if (parsed) {
      return { ok: true, card: { ...parsed, color: highlightColorForCategory(parsed.category) } }
    }
    console.info('[card-studio] parse:invalid-json')
    return { ok: false, reason: 'failed' }
  }
  console.info(`[card-studio] model-unavailable status=${sent.status}`)
  return { ok: false, reason: sent.status === 'auth-required' ? 'auth-required' : 'failed' }
}
