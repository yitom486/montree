/** 批注助手：先聊天；带方向的写批注命令直接整理；按钮先追问方向。 */

export type AnnotationIntentId =
  | 'explain'
  | 'thesis'
  | 'challenge'
  | 'plain'
  | 'custom'

export type AnnotationRefineId =
  | 'retry'
  | 'shorter'
  | 'longer'
  | 'casual'
  | 'formal'

export interface AnnotationIntentChip {
  id: AnnotationIntentId
  label: string
}

export interface AnnotationRefineChip {
  id: AnnotationRefineId
  label: string
}

export const ANNOTATION_INTENT_CHIPS: AnnotationIntentChip[] = [
  { id: 'explain', label: '解释这段' },
  { id: 'thesis', label: '提炼观点' },
  { id: 'challenge', label: '质疑一下' },
  { id: 'plain', label: '白话说说' },
  { id: 'custom', label: '其他…' },
]

export const ANNOTATION_REFINE_CHIPS: AnnotationRefineChip[] = [
  { id: 'retry', label: '换一种' },
  { id: 'shorter', label: '更短' },
  { id: 'longer', label: '更长' },
  { id: 'casual', label: '更口语' },
  { id: 'formal', label: '更正式' },
]

/** 点「写成批注」后立刻展示；点选即作为方向去生成 */
export interface AnnotationDirectionChip {
  id: string
  label: string
  /** 交给 compose 的方向文案 */
  hint: string
}

export const ANNOTATION_DIRECTION_ASK =
  '可以补一句写法方向（可选）；直接发送空白或点「直接写」也会按默认整理一条批注。'

export const ANNOTATION_DIRECTION_CHIPS: AnnotationDirectionChip[] = [
  { id: 'direct', label: '直接写', hint: '' },
  { id: 'explain', label: '侧重解释', hint: '侧重解释这段在说什么' },
  { id: 'thesis', label: '提炼观点', hint: '提炼核心观点写成批注' },
  { id: 'question', label: '记下疑问', hint: '记下我对这段的疑问' },
  { id: 'casual', label: '口语一点', hint: '用口语写一条短批注' },
]

const CHAT_INTENT: Record<Exclude<AnnotationIntentId, 'custom'>, string> = {
  explain: '请解释这段选区在说什么，用轻松对话的方式，不必写成最终批注。',
  thesis: '请帮我提炼这段选区的核心观点，先讨论清楚，不必急着定稿批注。',
  challenge: '请对这段选区提出一两个值得思考的疑问或反例，我们先聊聊。',
  plain: '请用大白话讲讲这段选区，方便我理解，先不用写成批注格式。',
}

const REFINE_INSTRUCTIONS: Record<AnnotationRefineId, string> = {
  retry: '换一种写法，保持同一意图，不要重复上一版措辞。',
  shorter: '把当前草稿改得更短，保留要点。',
  longer: '把当前草稿稍写长一点，补充必要说明，仍保持批注长度。',
  casual: '把当前草稿改得更口语、好读。',
  formal: '把当前草稿改得更正式、克制。',
}

const CHAT_RULES = [
  '你在阅读器的「批注助手」里与用户多轮讨论选区。',
  '默认是普通聊天：解答、讨论、追问都可以。',
  '全程使用用户的语言（通常为中文）；禁止输出 English: / Natural English: 等英译前缀或对照翻译。',
  '不要调用 montree_propose_mark，除非用户已明确要求整理批注正文。',
  '不要每次回复都输出「最终批注」。',
].join('\n')

const DRAFT_RULES = [
  '用户已明确要求整理成可保存的阅读批注草稿。',
  '只输出批注正文本身，必须能直接贴进批注框。',
  '禁止：标题、markdown 围栏、「以下是批注」、English:/Natural English:、中英对照、思考过程、客套话。',
  '语言与用户一致（用户用中文就写中文）。',
  '可调用 montree_propose_mark（仅传 note，用当前选区）提交草稿；不入库，等人确认后才写入。',
].join('\n')

const WRITE_INTENT_RE =
  /写(?:成|一下|一个|条)?批注|整理成批注|记(?:一)?条批注|帮我写批注|给这段写批注/

function excerptBlock(excerpt: string): string {
  return ['选区原文（用户划线）：', excerpt.trim() || '（无选区文本）'].join('\n')
}

/** 用户是否在命令里明确要求写批注；direction 为整句（含写法要求）。 */
export function detectAnnotationWriteIntent(text: string): {
  write: boolean
  /** 除「写批注」套话外是否还有写法方向 */
  hasDirection: boolean
  direction: string
} {
  const trimmed = text.trim()
  if (!trimmed || !WRITE_INTENT_RE.test(trimmed)) {
    return { write: false, hasDirection: false, direction: '' }
  }
  const stripped = trimmed
    .replace(WRITE_INTENT_RE, ' ')
    .replace(/^[，,。.\s:：]+|[，,。.\s]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim()
  const hasDirection = stripped.length >= 2
  return { write: true, hasDirection, direction: trimmed }
}

/** 多轮聊天（意图 chip / 自由提问） */
export function buildAnnotationChatPrompt(options: {
  excerpt: string
  intent: AnnotationIntentId
  customText?: string
}): { displayText: string; promptText: string } {
  const excerpt = options.excerpt.trim()
  if (options.intent === 'custom') {
    const ask = options.customText?.trim() || '我们先聊聊这段选区'
    return {
      displayText: ask,
      promptText: [CHAT_RULES, '', `用户说：${ask}`, '', excerptBlock(excerpt)].join('\n'),
    }
  }

  const chip = ANNOTATION_INTENT_CHIPS.find((item) => item.id === options.intent)
  return {
    displayText: chip?.label ?? options.intent,
    promptText: [
      CHAT_RULES,
      '',
      `用户点了「${chip?.label ?? options.intent}」。`,
      CHAT_INTENT[options.intent],
      '',
      excerptBlock(excerpt),
    ].join('\n'),
  }
}

/** 按钮「写成批注」：只追问方向，不写正文 */
export function buildAskComposeDirectionPrompt(options: {
  excerpt: string
}): { displayText: string; promptText: string } {
  return {
    displayText: '写成批注',
    promptText: [
      CHAT_RULES,
      '',
      '用户点了「写成批注」，但尚未说明想怎么写。',
      '请只用一两句中文追问：希望批注侧重什么（解释 / 评价 / 疑问 / 摘录要点等），或想强调哪一点？',
      '不要写批注正文，不要英译，不要工具调用。',
      '',
      excerptBlock(options.excerpt),
    ].join('\n'),
  }
}

/** 已有明确方向：整理可编辑草稿 */
export function buildAnnotationComposePrompt(options: {
  excerpt: string
  hint?: string
}): { displayText: string; promptText: string } {
  const hint = options.hint?.trim()
  return {
    displayText: hint && WRITE_INTENT_RE.test(hint) ? hint : '写成批注',
    promptText: [
      DRAFT_RULES,
      '',
      '请按用户给出的方向，根据对话与选区，写一条可保存的批注正文。',
      hint ? `用户方向：${hint}` : '用户未补充方向时，写一条简洁的理解性批注。',
      '',
      excerptBlock(options.excerpt),
    ].join('\n'),
  }
}

/** 润色用户已写批注 */
export function buildAnnotationPolishPrompt(options: {
  excerpt: string
  draft: string
}): { displayText: string; promptText: string } {
  return {
    displayText: '润色批注',
    promptText: [
      DRAFT_RULES,
      '',
      '请润色用户已写的阅读批注：更清晰、通顺，尽量保留原意与语气，不要写成另一篇长文。',
      '只输出润色后的批注正文，不要对照说明。',
      '',
      excerptBlock(options.excerpt),
      '',
      '用户原文：',
      options.draft.trim() || '（空）',
    ].join('\n'),
  }
}

export function buildAnnotationRefinePrompt(options: {
  excerpt: string
  draft: string
  refine: AnnotationRefineId
  lastIntentLabel?: string
}): { displayText: string; promptText: string } {
  const chip = ANNOTATION_REFINE_CHIPS.find((item) => item.id === options.refine)
  return {
    displayText: chip?.label ?? options.refine,
    promptText: [
      DRAFT_RULES,
      '',
      `任务：${REFINE_INSTRUCTIONS[options.refine]}`,
      options.lastIntentLabel ? `上下文：${options.lastIntentLabel}` : '',
      '',
      excerptBlock(options.excerpt),
      '',
      '当前草稿（用户可已改过）：',
      options.draft.trim() || '（空）',
    ]
      .filter(Boolean)
      .join('\n'),
  }
}

export function buildAnnotationIntentPrompt(options: {
  excerpt: string
  intent: AnnotationIntentId
  customText?: string
}): { displayText: string; promptText: string } {
  return buildAnnotationChatPrompt(options)
}

/** 从 Agent 回复中抽出可当作批注的纯文本。 */
export function extractAnnotationDraft(raw: string): string {
  let text = raw.trim()
  if (!text) return ''

  const fenced = text.match(/```(?:\w+)?\s*([\s\S]*?)```/)
  if (fenced?.[1]?.trim()) {
    text = fenced[1].trim()
  }

  text = text
    .replace(/^这里是(?:批注|草稿)[:：]\s*/i, '')
    .replace(/^批注(?:正文)?[:：]\s*/i, '')
    .replace(/^草稿[:：]\s*/i, '')
    .trim()

  // 丢掉英译前缀行（English: / Natural English:）
  text = text
    .split(/\n/)
    .filter((line) => !/^(English|Natural English)\s*:/i.test(line.trim()))
    .join('\n')
    .replace(/^(English|Natural English)\s*:\s*/gim, '')
    .trim()

  return text
}
