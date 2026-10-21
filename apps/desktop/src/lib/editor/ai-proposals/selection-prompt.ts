import type { TextSelection } from '@yitom/contracts'

export type SelectionAction = 'rewrite' | 'polish' | 'shorten' | 'expand' | 'translate' | 'custom'

export const SELECTION_ACTIONS: ReadonlyArray<{ id: Exclude<SelectionAction, 'custom'>; label: string; instruction: string }> = [
  { id: 'rewrite', label: '改写', instruction: '换一种表达方式改写，保持原意' },
  { id: 'polish', label: '润色', instruction: '润色语言，使其更通顺、准确、自然，保持原意与语气' },
  { id: 'shorten', label: '缩短', instruction: '在不丢失关键信息的前提下精简压缩' },
  { id: 'expand', label: '扩写', instruction: '在保持原意与风格的前提下适度扩写，补充细节' },
  { id: 'translate', label: '翻译', instruction: '翻译：中文译为英文，其他语言译为中文；保留 Markdown/Typst 标记' },
]

const MAX_QUOTE = 4000

/**
 * 生成发给当前 Agent 的选区编辑请求：要求用 montree_text_propose（带 selectionId）提交建议，
 * 结果以编辑器内修改建议呈现，由用户确认；不得直接改动文档。
 */
export function buildSelectionEditPrompt(selection: TextSelection, action: SelectionAction, customInstruction?: string): { displayText: string; promptText: string } {
  const preset = SELECTION_ACTIONS.find((item) => item.id === action)
  const instruction = action === 'custom' ? (customInstruction ?? '').trim() : preset!.instruction
  if (!instruction) throw new Error('请输入修改指令')
  const text = selection.ranges.map((range) => range.text).join('\n')
  const quote = text.length > MAX_QUOTE ? `${text.slice(0, MAX_QUOTE)}…（已截断，请用 montree_text_read target=selection 读取完整选区）` : text
  const label = action === 'custom' ? instruction : preset!.label
  const format = /\.typ$/i.test(selection.documentPath) ? 'Typst' : 'Markdown'
  const displayText = `【${label}】选区（${format}，${text.length} 字）`
  const promptText = [
    `请对当前 ${format} 文档中用户选中的文本执行：${instruction}。`,
    `documentPath: ${selection.documentPath}`,
    `revision: ${selection.revision}`,
    `selectionId: ${selection.selectionId}`,
    `选区范围（UTF-16）：${selection.ranges.map((range) => `${range.from}–${range.to}`).join(', ')}`,
    '选中文本：', '"""', quote, '"""',
    '要求：只修改选区内文本；调用 montree_text_propose（带上述 documentPath、revision、selectionId，expectedText 为原文），由用户在编辑器中审阅确认。不要调用 montree_text_edit，不要保存文件。提交后简短说明改动要点即可。',
  ].join('\n')
  return { displayText, promptText }
}
