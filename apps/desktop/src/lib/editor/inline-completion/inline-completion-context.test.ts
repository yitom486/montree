import { describe, expect, it } from 'vitest'
import { EditorState } from '@codemirror/state'
import { markdown } from '@codemirror/lang-markdown'
import { buildInlineCompletionHints, fenceLanguageAt } from './inline-completion-context'

function stateOf(doc: string): EditorState {
  return EditorState.create({ doc, extensions: [markdown()] })
}

describe('inline completion context', () => {
  it('collects the document title, heading path and block type', () => {
    const doc = '# Title\n\n## Section\n\nText'
    const hints = buildInlineCompletionHints(stateOf(doc), doc.length)
    expect(hints).toEqual({
      title: 'Title',
      section: ['Title', 'Section'],
      block: 'paragraph',
    })
  })

  it('does not treat the heading being typed as its own section', () => {
    const doc = '# Title\n\n## Section'
    const hints = buildInlineCompletionHints(stateOf(doc), doc.length)
    expect(hints).toEqual({
      title: 'Title',
      section: ['Title'],
      block: 'heading',
    })
  })

  it('recognizes list, table and code blocks, and ignores headings inside fences', () => {
    const list = '# Title\n\n- item'
    expect(buildInlineCompletionHints(stateOf(list), list.length).block).toBe('list item')

    const table = '# Title\n\n| A | B |\n| --- | --- |\n| x | y |'
    expect(buildInlineCompletionHints(stateOf(table), table.length).block).toBe('table cell')

    const fenced = '# Title\n\n```md\n## Not a heading\n```'
    const state = stateOf(fenced)
    const insideFence = fenced.indexOf('## Not')
    expect(buildInlineCompletionHints(state, insideFence)).toEqual({
      title: 'Title',
      section: ['Title'],
      block: 'code block',
    })
    expect(fenceLanguageAt(state, insideFence)).toBe('md')
  })
})
