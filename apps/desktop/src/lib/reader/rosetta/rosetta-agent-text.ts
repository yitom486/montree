import type { BookDbBlockHit } from '@montree/contracts'

/**
 * 罗盘块 → Agent 可读文本：标题恢复 ## 层级，表格/列表/段落原样拼回。
 * 空块集抛错（调用方回退旧链路，不要让 AI 读到空页）。
 */
export function formatRosettaBlocksForAgent(blocks: readonly BookDbBlockHit[]): string {
  const parts: string[] = []
  for (const block of blocks) {
    const content = block.content.trim()
    if (!content) continue
    parts.push(block.type === 'heading' ? `## ${content}` : content)
  }
  const text = parts.join('\n\n').trim()
  if (!text) {
    throw new Error('罗盘页块为空')
  }
  return text
}
