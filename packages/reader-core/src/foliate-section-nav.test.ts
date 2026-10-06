import { describe, expect, it } from 'vitest'
import { isSameSpineBase, splitChapterFragment } from '@montree/reader-core'

const normalize = (value: string): string => value.split('#')[0]?.toLowerCase() ?? ''

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
