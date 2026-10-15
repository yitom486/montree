import type { ComponentUiNode } from '@montree/contracts'
import { buildDiagramHtml } from './present-diagram'

function text(value: unknown, label: string, maximum: number): string {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > maximum) throw new Error(`${label} 须为 1–${maximum} 字文本`)
  return value.trim()
}

function rows(value: unknown, label: string, maximum: number): Record<string, unknown>[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > maximum) throw new Error(`${label} 须为 1–${maximum} 项`)
  return value.map((item) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) throw new Error(`${label} 的每项须为对象`)
    return item as Record<string, unknown>
  })
}

/** 预置模板只组装既有组件；文档归属、原文及界面校验仍由 builder 执行。 */
export function expandPresentPreset(args: Record<string, unknown>): Record<string, unknown> {
  if (args.ui !== undefined) throw new Error('preset 不接受 ui 树，请只填写模板数据')
  if (args.preset === 'diagram') {
    if (args.source !== undefined || args.html !== undefined) throw new Error('diagram 模板只接收参数，不接受源码')
    return { ...args, kind: 'html-artifact', html: buildDiagramHtml(args), inline: true }
  }
  if (args.preset === 'chapter-comparison') return { ...args, kind: 'chapter-comparison' }
  const children: ComponentUiNode[] = []
  let submitLabel: string
  if (args.preset === 'citation-guide') {
    const citations = rows(args.citations, 'citations', 8)
    children.push({ component: 'Select', props: {
      id: 'citation', label: '选择一条引用继续分析',
      options: citations.map((item, index) => ({ value: `citation-${index + 1}`, label: text(item.label, 'citation.label', 200) })),
    } })
    for (const item of citations) {
      const excerpt = text(item.excerpt, 'citation.excerpt', 2000)
      const chapterKey = text(item.chapterKey, 'citation.chapterKey', 120)
      children.push({ component: 'Card', props: { title: text(item.label, 'citation.label', 200), ...(item.note !== undefined ? { description: text(item.note, 'citation.note', 2000) } : {}) }, children: [
        { component: 'Evidence', props: { excerpt, chapterKey } },
      ] })
    }
    submitLabel = '分析所选引用'
  } else if (args.preset === 'reading-quiz') {
    const questions = rows(args.questions, 'questions', 5)
    children.push({ component: 'Text', props: { variant: 'caption', text: '选择答案后提交给助手点评；答案不会在本地自动判分。' } })
    questions.forEach((item, index) => {
      const question = text(item.question, 'question', 200)
      if (!Array.isArray(item.options) || item.options.length < 2 || item.options.length > 6) throw new Error('每题 options 须为 2–6 个选项')
      const options = item.options.map((option) => text(option, 'option', 120))
      if (new Set(options).size !== options.length) throw new Error('每题选项不得重复')
      children.push({ component: 'Select', props: { id: `question-${index + 1}`, label: question, options: options.map((option) => ({ value: option, label: option })) } })
    })
    submitLabel = '提交答案，请助手点评'
  } else {
    throw new Error('preset 须为 chapter-comparison、citation-guide、reading-quiz 或 diagram')
  }
  children.push({ component: 'Button', props: { label: submitLabel, action: 'submit-selection' } })
  return { ...args, kind: 'component-ui', submitLabel, ui: { root: { component: 'Column', children } } }
}
