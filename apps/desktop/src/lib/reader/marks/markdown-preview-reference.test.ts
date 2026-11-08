// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest'
import { captureMarkdownReference, resolveMarkdownReference } from './markdown-preview-reference'

function root(html: string) { const node = document.createElement('div'); node.innerHTML = html; return node }
function select(element: Element) { const range = document.createRange(); range.selectNodeContents(element); return range }

describe('Markdown quote references', () => {
  it('retains the snapshot when unrelated paragraphs move and markup changes', () => {
    const original = root('<h1 id="a">章一</h1><p>Before.</p><p>Quoted <strong>words</strong>.</p><p>After.</p>')
    const anchor = captureMarkdownReference(original, select(original.querySelectorAll('p')[1]), 'note.md')
    const changed = root('<p>New paragraph.</p><h1 id="a">章一</h1><p>Before.</p><p>Quoted words.</p><p>After.</p>')
    const result = resolveMarkdownReference(changed, anchor)
    expect(result.status).toBe('matched')
    if (result.status === 'matched') expect(result.range.toString()).toBe('Quoted words.')
    expect(anchor.quote?.exact).toBe('Quoted words.')
  })
  it('uses context to distinguish repeated text inside the same chapter', () => {
    const original = root('<h1 id="a">章一</h1><p>Left one.</p><p>Repeated.</p><p>Middle.</p><p>Repeated.</p><p>Last.</p>')
    const anchor = captureMarkdownReference(original, select(original.querySelectorAll('p')[3]), 'note.md')
    const result = resolveMarkdownReference(original, anchor)
    expect(result.status).toBe('matched')
    if (result.status === 'matched') expect(result.range.startContainer.parentElement).toBe(original.querySelectorAll('p')[3])
  })
  it('reports ambiguous duplicates and missing rewritten text without fuzzy relocation', () => {
    const changed = root('<h1 id="a">章一</h1><p>Repeated.</p><p>Repeated.</p>')
    expect(resolveMarkdownReference(changed, { format: 'web', url: '', selectedText: 'Repeated.' }).status).toBe('ambiguous')
    expect(resolveMarkdownReference(changed, { format: 'web', url: '', selectedText: 'Repeated with old meaning.' }).status).toBe('missing')
  })
  it('does not lose references while an annotation dialog hides the application from accessibility', () => {
    const container = root('<p>Unique text.</p>')
    const modalBackground = document.createElement('div')
    modalBackground.setAttribute('aria-hidden', 'true')
    modalBackground.append(container)
    expect(resolveMarkdownReference(container, { format: 'web', url: '', selectedText: 'Unique text.' }).status).toBe('matched')
  })
  it('falls back to an unchanged unique quote after heading renames', () => {
    const changed = root('<h1 id="new">New title</h1><p>Unique text.</p>')
    expect(resolveMarkdownReference(changed, { format: 'web', url: '', headingId: 'old', selectedText: 'Unique text.' }).status).toBe('matched')
  })
})
