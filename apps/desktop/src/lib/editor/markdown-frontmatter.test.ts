import { describe, expect, it } from 'vitest'
import {
  frontmatterField,
  readFrontmatter,
  stripFrontmatter,
} from './markdown-frontmatter'
import { renderMarkdown } from './markdown'

describe('markdown-frontmatter', () => {
  it('识别文档首部 YAML frontmatter 并保留属性', () => {
    const source = [
      '---',
      'title: 比特漫笔',
      'excerpt: 记录技术之外的火花。',
      'cover: media/cover.png',
      'icon: "\\U0001F4DF"',
      'sort: 5',
      '---',
      '',
      '# 正文',
    ].join('\n')

    const frontmatter = readFrontmatter(source)
    expect(frontmatter?.lineCount).toBe(7)
    expect(frontmatterField(frontmatter!.entries, 'title')).toBe('比特漫笔')
    expect(frontmatterField(frontmatter!.entries, 'icon')).toBe('📟')
    expect(frontmatterField(frontmatter!.entries, 'sort')).toBe('5')
  })

  it('替换为等量空行，正文标题行号保持不变', () => {
    const source = ['---', 'title: A', '---', '', '# 正文'].join('\n')
    const stripped = stripFrontmatter(source)
    expect(stripped.split('\n')).toHaveLength(source.split('\n').length)
    expect(stripped.split('\n')[4]).toBe('# 正文')
  })

  it('不把普通 Markdown 水平线误判为 frontmatter', () => {
    const source = ['---', '', '段落一', '', '---', '', '段落二'].join('\n')
    expect(readFrontmatter(source)).toBeNull()
    expect(stripFrontmatter(source)).toBe(source)
  })

  it('预览渲染省略 frontmatter 原文', () => {
    const source = ['---', 'title: 隐藏的属性', '---', '', '# 正文'].join('\n')
    const html = renderMarkdown(source)
    expect(html).not.toContain('title:')
    expect(html).not.toContain('---')
    expect(html).toContain('<h1 id="正文">正文</h1>')
  })
})
