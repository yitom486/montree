import { describe, expect, it } from 'vitest'
import MarkdownIt from 'markdown-it'
import { markdownItWikilinks, parseWikilinkContent } from './markdown-it-wikilinks'

describe('markdown-it-wikilinks', () => {
  it('parses target and label', () => {
    expect(parseWikilinkContent('React Hooks')).toEqual({
      target: 'React Hooks',
      label: 'React Hooks',
    })
    expect(parseWikilinkContent('Vue.js设计与实现.epub#page=10 | 深入响应式')).toEqual({
      target: 'Vue.js设计与实现.epub#page=10',
      label: '深入响应式',
    })
  })

  it('renders wikilink for regular note', () => {
    const md = new MarkdownIt().use(markdownItWikilinks)
    const html = md.render('参考笔记 [[学习总结]] 即可')
    expect(html).toContain('class="montree-wikilink montree-wikilink-note"')
    expect(html).toContain('data-wikilink-target="学习总结"')
    expect(html).toContain('学习总结</span></a>')
    expect(html).toContain('montree-wikilink-svg')
  })

  it('renders wikilink for book with page anchor', () => {
    const md = new MarkdownIt().use(markdownItWikilinks)
    const html = md.render('出处：[[深入理解Java虚拟机.pdf#page=42|Java第42页]]')
    expect(html).toContain('class="montree-wikilink montree-wikilink-book"')
    expect(html).toContain('data-wikilink-target="深入理解Java虚拟机.pdf#page=42"')
    expect(html).toContain('Java第42页</span></a>')
    expect(html).toContain('montree-wikilink-svg')
  })

  it('does not parse across newlines', () => {
    const md = new MarkdownIt().use(markdownItWikilinks)
    const html = md.render('[[未闭合\n第二行]]')
    expect(html).not.toContain('montree-wikilink')
  })
})
