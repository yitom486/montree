import type { InlineCompletionRequest } from '../../../contracts/inline-completion'

export const MAX_PREFIX = 3000
export const MAX_SUFFIX = 1000
export const MAX_COMPLETION = 400

export function buildInlineCompletionPrompt(request: InlineCompletionRequest): { system: string; prompt: string } {
  const prefix = request.prefix.slice(-MAX_PREFIX)
  const suffix = request.suffix.slice(0, MAX_SUFFIX)
  const kind = request.language === 'markdown' ? 'Markdown 文档' : request.language === 'typst' ? 'Typst 源码' : `${request.language} 代码（位于文档代码块中）`
  return {
    system: [
      '你是编辑器里的行内补全引擎。只输出要插入在 <CURSOR> 处的文本本身，不要解释、不要引号、不要代码围栏、不要重复光标前已有的内容。',
      '续写应自然衔接光标前后文，保持原文语言、语气与格式；通常补全到当前句子或当前行结束，最多一两句。若无需补全，输出空。',
      '若有明显不同的续写方向，可额外给出至多 2 个候选，每个候选之间用单独一行 <ALT> 分隔。',
    ].join('\n'),
    prompt: `文件：${request.filePath.split(/[/\\]/).pop() ?? ''}（${kind}）\n<BEFORE>${prefix}<CURSOR></BEFORE>\n<AFTER>${suffix}</AFTER>`,
  }
}

/** 清理模型输出：去围栏/标签、去掉与光标前文重复的开头与后文重复的结尾、限长。 */
export function cleanCompletion(raw: string, request: Pick<InlineCompletionRequest, 'prefix' | 'suffix'>): string {
  let text = raw.replace(/^```[\w-]*\n?/, '').replace(/\n?```\s*$/, '').replace(/<\/?(CURSOR|BEFORE|AFTER)>/g, '')
  // 模型有时复述光标前最后一段
  const tail = request.prefix.slice(-80)
  for (let n = Math.min(tail.length, text.length); n >= 4; n--) {
    if (text.startsWith(tail.slice(-n))) { text = text.slice(n); break }
  }
  const head = request.suffix.slice(0, 80).trimEnd()
  if (head.length >= 4) {
    const at = text.indexOf(head)
    if (at >= 0) text = text.slice(0, at)
  }
  if (text.length > MAX_COMPLETION) {
    const cut = text.slice(0, MAX_COMPLETION)
    const boundary = Math.max(cut.lastIndexOf('\n'), cut.search(/[。！？.!?][^。！？.!?]*$/) + 1)
    text = boundary > 20 ? cut.slice(0, boundary) : cut
  }
  if (!text.trim()) return ''
  // 光标前已是空白时去掉重复的前导空格
  if (/\s$/.test(request.prefix) && !request.prefix.endsWith('\n')) text = text.replace(/^[ \t]+/, '')
  return text.replace(/\s+$/, '')
}
