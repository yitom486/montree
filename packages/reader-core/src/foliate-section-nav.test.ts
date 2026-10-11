// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest'
import { isSameSpineBase, splitChapterFragment, scrollFoliateSectionToFragment } from '@montree/reader-core'

const normalize = (value: string): string => value.split('#')[0]?.toLowerCase() ?? ''

it('整节高度 iframe 按外层滚动视口验位，重复定位不滚过头', () => {
  const scroller = document.createElement('div')
  const frame = document.createElement('iframe')
  scroller.append(frame); document.body.append(scroller)
  try {
    Object.defineProperties(scroller, { scrollHeight: { value: 1800 }, clientHeight: { value: 600 } })
    scroller.getBoundingClientRect = () => ({ top: 100 } as DOMRect)
    frame.getBoundingClientRect = () => ({ top: 100 - scroller.scrollTop } as DOMRect)
    const doc = frame.contentDocument!
    // happy-dom 不自动维护 iframe 的父帧引用，显式补齐浏览器关联。
    Object.defineProperty(doc.defaultView!, 'frameElement', { value: frame, configurable: true })
    doc.body.innerHTML = '<h2 id="chapter">Chapter</h2>'
    const anchor = doc.getElementById('chapter')!
    anchor.getBoundingClientRect = () => ({ top: 900 } as DOMRect)
    anchor.scrollIntoView = vi.fn()
    expect(scrollFoliateSectionToFragment(doc, 'chapter')).toBe(true)
    expect(scroller.scrollTop).toBe(780)
    expect(scrollFoliateSectionToFragment(doc, 'chapter')).toBe(true)
    expect(scroller.scrollTop).toBe(780)
  } finally { scroller.remove() }
})

describe('splitChapterFragment', () => {
  it('拆分 base 与分片', () => {
    expect(splitChapterFragment('part1.html#chap1')).toEqual({ base: 'part1.html', fragment: 'chap1' })
    expect(splitChapterFragment('part1.html')).toEqual({ base: 'part1.html', fragment: null })
    expect(splitChapterFragment('part1.html#')).toEqual({ base: 'part1.html', fragment: null })
  })
})

describe('isSameSpineBase', () => {
  it('容忍 OEBPS 前缀不对称', () => {
    expect(isSameSpineBase('OEBPS/part1.xhtml#chap1', 'part1.xhtml', normalize)).toBe(true)
    expect(isSameSpineBase('part1.xhtml', 'OEBPS/part1.xhtml', normalize)).toBe(true)
    expect(isSameSpineBase('part1.xhtml', 'part2.xhtml', normalize)).toBe(false)
    expect(isSameSpineBase('', 'part1.xhtml', normalize)).toBe(false)
  })
})
