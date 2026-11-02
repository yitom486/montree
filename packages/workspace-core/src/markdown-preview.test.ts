import { describe, expect, it } from 'vitest'
import { isMarkdownPreviewAnchor, markdownPreviewUrl } from './markdown-preview'

describe('Markdown preview identity', () => {
  it('binds encoded local and remote paths without a network address', () => {
    for (const path of ['D:/books/测试 #1.md', 'workspace://server/docs/readme.markdown']) {
      const url = markdownPreviewUrl(path)
      expect(new URL(url).protocol).toBe('montree-markdown:')
      expect(isMarkdownPreviewAnchor(path, { format: 'web', url })).toBe(true)
      expect(isMarkdownPreviewAnchor(path + '.pdf', { format: 'web', url })).toBe(false)
      expect(isMarkdownPreviewAnchor('another.md', { format: 'web', url })).toBe(false)
    }
  })
})
