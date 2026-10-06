import type { ReadingMarkCategory } from '@montree/contracts'

/**
 * AI 制卡预设（P1，见 `.plan/ai-cards/01-card-studio-plan.md`）。
 * 每条只约束输出结构与视角，不约束主题/立场/详略；
 * 用户补充走显式分隔 + 冲突优先声明（见 buildCardStudioPrompt）。
 */

export type CardStudioPresetId =
  | 'distill'
  | 'concept'
  | 'argue'
  | 'quote'
  | 'question'
  | 'link'

export interface CardStudioPreset {
  id: CardStudioPresetId
  /** 菜单按钮文案（用户只选这个） */
  label: string
  /** 落卡分类；auto 由模型在 5 类里定 */
  category: ReadingMarkCategory | 'auto'
  directive: string
}

const OUTPUT_SHAPE = `只输出一个 JSON 对象（无前后缀解释），字段如下：
{"title": "≤24字标题", "category": "concept|quote|method|diagram|question 之一", "aiSummary": "精炼洞见", "keyPoints": ["要点一", "要点二", "要点三（最多3条）"]}
禁区：不编造原文没有的出处、数字与结论。`

export const CARD_STUDIO_PRESETS: readonly CardStudioPreset[] = [
  {
    id: 'distill',
    label: '通用提炼',
    category: 'auto',
    directive: `把划选段压缩为"一句话主张 + 至多3条要点"，category 在5类里自选最贴切的一项。${OUTPUT_SHAPE}`,
  },
  {
    id: 'concept',
    label: '概念界定',
    category: 'concept',
    directive: `讲清这个概念的"所指与所不指"，给出辨析维度；category 固定填 concept。${OUTPUT_SHAPE}`,
  },
  {
    id: 'argue',
    label: '论证拆解',
    category: 'concept',
    directive: `拆出前提/推论/证据，要点写可继续追问的攻击点；只拆解，不下对错判断。category 固定填 concept。${OUTPUT_SHAPE}`,
  },
  {
    id: 'quote',
    label: '金句摘存',
    category: 'quote',
    directive: `title 用出处式短语；aiSummary 只写一句点评、不复述摘录（摘录由卡片摘录区展示，复述即复读）。category 固定填 quote。${OUTPUT_SHAPE}`,
  },
  {
    id: 'question',
    label: '诘问设题',
    category: 'question',
    directive: `只出题不出答案（供复习/测验用），可附追问方向。category 固定填 question。${OUTPUT_SHAPE}`,
  },
  {
    id: 'link',
    label: '联想发散',
    category: 'concept',
    directive: `给出与本书其他章节或其他著作的可能呼应，不确定的标"待核实"。category 固定填 concept。${OUTPUT_SHAPE}`,
  },
]

const presetById = new Map<CardStudioPresetId, CardStudioPreset>(
  CARD_STUDIO_PRESETS.map((preset) => [preset.id, preset]),
)

export function getCardStudioPreset(id: string): CardStudioPreset | null {
  return presetById.get(id as CardStudioPresetId) ?? null
}

/**
 * 组装制卡 prompt：预设 directive + 原文 + 用户补充（显式分隔，冲突用户优先）。
 * 宽泛预设与补充从机制上不打架：预设不管主题，补充只管要求。
 */
export function buildCardStudioPrompt(
  excerpt: string,
  preset: CardStudioPreset,
  customText?: string,
): string {
  const custom = customText?.trim()
  const supplement = custom
    ? `<用户补充要求>\n${custom}\n</用户补充要求>\n以上补充与预设冲突时，以用户补充为准；补充为空时忽略本节。\n\n`
    : ''
  return `你是读书卡片助手。根据下面<原文>按要求提炼一张知识卡片。\n\n${preset.directive}\n\n${supplement}<原文>\n${excerpt.trim()}\n</原文>`
}
