import type { EditorState } from '@codemirror/state'
import { syntaxTree } from '@codemirror/language'
import { stripMarkdownInline } from '@/lib/editor/markdown-headings'
import type {
  InlineCompletionBlock,
  InlineCompletionHints,
} from '../../../../contracts/inline-completion'

/** 光标处所在的代码块语言（Markdown 围栏）；不在代码块返回 undefined，无语言的代码块返回 ''。 */
export function fenceLanguageAt(state: EditorState, pos: number): string | undefined {
  const node = syntaxTree(state).resolveInner(pos, -1)
  for (let cur: typeof node | null = node; cur; cur = cur.parent) {
    if (cur.name === 'FencedCode' || cur.name === 'CodeBlock') {
      if (cur.name === 'CodeBlock') return ''
      const info = cur.getChild('CodeInfo')
      return info ? state.sliceDoc(info.from, info.to).trim().toLowerCase() : ''
    }
  }
  return undefined
}

function blockTypeAt(state: EditorState, pos: number): InlineCompletionBlock {
  if (fenceLanguageAt(state, pos) !== undefined) return 'code block'
  const line = state.doc.lineAt(pos).text
  if (/^ {0,3}#{1,6}\s/.test(line)) return 'heading'
  if (/^\s{0,3}>\s?/.test(line)) return 'blockquote'
  if (/^\s{0,3}(?:[-*+]|\d+[.)])\s+/.test(line)) return 'list item'
  if (/^\s*\|/.test(line)) return 'table cell'
  return 'paragraph'
}

function headingTrail(state: EditorState, pos: number): Array<{ level: number; text: string }> {
  const headings: Array<{ level: number; text: string }> = []
  const cursorLine = state.doc.lineAt(pos).number
  let inFence = false

  for (let lineNumber = 1; lineNumber <= cursorLine; lineNumber += 1) {
    const text = state.doc.line(lineNumber).text
    if (/^ {0,3}(?:```|~~~)/.test(text)) {
      inFence = !inFence
      continue
    }
    if (inFence) continue
    const match = /^ {0,3}(#{1,6})\s+(.+?)\s*#*\s*$/.exec(text)
    if (match) {
      headings.push({
        level: match[1]!.length,
        text: stripMarkdownInline(match[2]!).trim(),
      })
    }
  }

  return headings
}

/**
 * 给补全模型的最小上下文：文档标题、当前标题路径和块类型。
 * 只发送结构，不扩大正文上下文；文本越界由调用方的 prefix/suffix 上限控制。
 */
export function buildInlineCompletionHints(
  state: EditorState,
  pos: number,
): InlineCompletionHints {
  const block = blockTypeAt(state, pos)
  const headings = headingTrail(state, pos)
  const title = headings[0]?.text

  const stack: Array<{ level: number; text: string }> = []
  for (const heading of headings) {
    while (stack.length && stack[stack.length - 1]!.level >= heading.level) stack.pop()
    stack.push(heading)
  }
  // 正在输入的标题还不是“所在章节”。
  if (block === 'heading') stack.pop()

  const section = stack.slice(-4).map((heading) => heading.text).filter(Boolean)
  return {
    ...(title ? { title } : {}),
    ...(section.length ? { section } : {}),
    block,
  }
}
