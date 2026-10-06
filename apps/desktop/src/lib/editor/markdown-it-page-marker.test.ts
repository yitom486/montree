// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest'
import DOMPurify from 'dompurify'
import MarkdownIt from 'markdown-it'
import { renderMarkdown } from './markdown'
import { PREVIEW_SANITIZE_OPTIONS } from '@/lib/preview/preview-sanitize'
import { markdownItPageMarker, parsePageMarker } from './markdown-it-page-marker'

function render(source: string): string {
  return new MarkdownIt({ html: false }).use(markdownItPageMarker).render(source)
}

describe('parsePageMarker', () => {
  it('标准与变体写法识别页码', () => {
    expect(parsePageMarker('<!-- Page 19 -->')).toBe(19)
    expect(parsePageMarker('  <!--   page   7   -->  ')).toBe(7)
    expect(parsePageMarker('<!--PAGE 1-->')).toBe(1)
  })

  it('非页标记一律拒绝', () => {
    expect(parsePageMarker('<!-- note -->')).toBeNull()
    expect(parsePageMarker('<!-- Page 0 -->')).toBeNull()
    expect(parsePageMarker('<!-- Page -->')).toBeNull()
    expect(parsePageMarker('<!-- Page 1.5 -->')).toBeNull()
    expect(parsePageMarker('正文 <!-- Page 3 --> 混排')).toBeNull()
    expect(parsePageMarker('')).toBeNull()
  })
})

describe('markdownItPageMarker', () => {
  it('独立成行标记转 chip，上下文保留', () => {
    const html = render('第一章\n\n<!-- Page 19 -->\n\n正文')
    expect(html).toContain('class="montree-page-marker"')
    expect(html).toContain('data-page="19"')
    expect(html).toContain('第 19 页')
    expect(html).toContain('第一章')
    expect(html).toContain('正文')
    expect(html).not.toContain('&lt;!--')
  })

  it('普通注释与混排标记保持转义原文', () => {
    const html = render('<!-- note -->\n\n正文 <!-- Page 3 --> 混排')
    expect(html).not.toContain('montree-page-marker')
    expect(html).toContain('&lt;!-- note --&gt;')
  })

  it('围栏内标记不动', () => {
    const html = render('```text\n<!-- Page 5 -->\n```')
    expect(html).not.toContain('montree-page-marker')
    expect(html).toContain('Page 5')
  })

  it('连续多标记逐个转换', () => {
    const html = render('<!-- Page 1 -->\n\n<!-- Page 2 -->')
    expect(html.match(/data-page="\d+"/g)).toHaveLength(2)
  })

  it('真实管线：chip 存活预览消毒（含 class/data-page），标记原文消失', () => {
    const html = renderMarkdown('前言\n\n<!-- Page 19 -->\n\n# 第 1 章 概述')
    const clean = String(DOMPurify.sanitize(`<div>${html}</div>`, PREVIEW_SANITIZE_OPTIONS))
    expect(clean).toContain('data-page="19"')
    expect(clean).toContain('第 19 页')
    expect(clean).not.toContain('Page 19 -->')
  })
})
