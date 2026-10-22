// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest'
import { extractWebDocArticle } from './web-doc-html'
import { extractWebDocHeadings } from './web-doc-outline'
import html from '../../../../../../packages/web-doc/src/__fixtures__/tanstack-ai-overview.html?raw'



describe('无 article/main 的文档页走 Readability 时保留 h2', () => {
  it('TanStack 标题带 scroll-my-* 工具类也不被当成噪音删掉', () => {
    const { bodyHtml } = extractWebDocArticle(html, 'https://tanstack.com/ai/latest/docs/getting-started/overview')
    const headings = extractWebDocHeadings(bodyHtml).map((h) => [h.level, h.text])
    expect(headings).toEqual(
      expect.arrayContaining([
        [2, 'Key Features'],
        [2, 'Core Packages'],
        [3, '@tanstack/ai'],
        [2, 'Next Steps'],
      ]),
    )
    expect(headings.findIndex((h) => h[1] === 'Core Packages')).toBeLessThan(
      headings.findIndex((h) => h[1] === '@tanstack/ai'),
    )
  })
})
