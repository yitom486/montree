import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { extractGenericWebDocToc } from './extract-toc-links'
import { extractLlmsTxtToc, looksLikeDocsIndexCandidate, resolveLlmsTxtCandidates } from './extract-llms-toc'

const fixture = (name: string) => readFileSync(new URL(`./__fixtures__/${name}`, import.meta.url), 'utf8')
const PAGE = 'https://tanstack.com/ai/latest/docs/getting-started/overview'

describe('TanStack 文档（多产品站、顶栏 nav 链接比侧栏多）', () => {
  it('选中当前分区的文档侧栏，而不是全站顶栏', () => {
    const entries = extractGenericWebDocToc(fixture('tanstack-ai-overview.html'), PAGE)
    const hrefs = entries.map((e) => e.href)
    expect(hrefs).toContain('https://tanstack.com/ai/latest/docs/getting-started/quick-start')
    expect(hrefs).toContain('https://tanstack.com/ai/latest/docs/getting-started/devtools')
    expect(hrefs).not.toContain('https://tanstack.com/blog')
    expect(hrefs.every((h) => h.startsWith('https://tanstack.com/ai/'))).toBe(true)
  })

  it('页面带自身 .md 版本时视为可尝试 llms.txt，并优先分区路径下的 llms.txt', () => {
    const html = fixture('tanstack-ai-overview.html')
    expect(looksLikeDocsIndexCandidate(html)).toBe(true)
    expect(resolveLlmsTxtCandidates(PAGE, html)).toEqual([
      'https://tanstack.com/ai/latest/llms.txt',
      'https://tanstack.com/ai/llms.txt',
      'https://tanstack.com/llms.txt',
    ])
  })

  it('llms.txt 按 ## / ### 分组建树，跳过首个标题前的自引用链接与跨站链接', () => {
    const entries = extractLlmsTxtToc(fixture('tanstack-ai-llms.txt'), 'https://tanstack.com')
    expect(entries[0]).toMatchObject({ label: 'Get Started', level: 0 })
    expect(entries[1]).toMatchObject({ label: 'Getting Started', level: 1 })
    expect(entries[2]).toMatchObject({
      label: 'Overview',
      level: 2,
      href: 'https://tanstack.com/ai/latest/docs/getting-started/overview',
    })
    expect(entries.some((e) => e.href.includes('github.com'))).toBe(false)
    expect(entries.some((e) => e.label === 'Docs index')).toBe(false)
    expect(entries.find((e) => e.label === 'Transports')?.level).toBe(1)
  })
})
