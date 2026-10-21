import { describe, expect, it, vi } from 'vitest'
import { callDocumentTool, DOCUMENT_TOOLS } from './document-tools'

describe('montree_text_propose', () => {
  it('shares the montree_text_edit input schema', () => {
    const edit = DOCUMENT_TOOLS.find((tool) => tool.name === 'montree_text_edit')!
    const propose = DOCUMENT_TOOLS.find((tool) => tool.name === 'montree_text_propose')!
    expect(propose.inputSchema).toEqual(edit.inputSchema)
    expect(propose.annotations).toMatchObject({ readOnlyHint: false, destructiveHint: false })
  })
  it('routes to the text-propose snapshot resource with untouched arguments', async () => {
    const readSnapshot = vi.fn(async () => '{"status":"proposal_created"}')
    const args = { documentPath: '/a.md', revision: 3, expectedCount: 1, edits: [{ from: 0, to: 1, expectedText: 'a', text: 'b' }] }
    const result = await callDocumentTool('montree_text_propose', { readSnapshot }, args)
    expect(readSnapshot).toHaveBeenCalledWith('text-propose', args)
    expect(result.content[0].text).toContain('proposal_created')
  })
})
