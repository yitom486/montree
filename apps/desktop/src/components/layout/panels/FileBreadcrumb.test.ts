// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest'
import { getBreadcrumbSegments } from './FileBreadcrumb'

describe('文件路径边界', () => {
  it('Windows 工作区折成相对路径并保留可定位的原始路径', () => {
    const parts = getBreadcrumbSegments('D:\\Books\\notes\\正文.md', 'D:\\Books')
    expect(parts.map((part) => part.label)).toEqual(['Books', 'notes', '正文.md'])
    expect(parts[1]).toMatchObject({ path: 'D:\\Books\\notes', navigable: true })
  })
  it('POSIX 根目录与深层路径均可定位', () => {
    expect(getBreadcrumbSegments('/home/u/books/notes/a.md', '/home/u/books').map((part) => part.label)).toEqual(['books', 'notes', 'a.md'])
    expect(getBreadcrumbSegments('/notes/a.md', '/')[0]).toMatchObject({ label: '/', path: '/', navigable: true })
  })
  it('相似前缀和 POSIX 大小写不同的路径不能导航进当前工作区', () => {
    for (const path of ['/ws/books-other/a.md', '/ws/Books/a.md']) {
      expect(getBreadcrumbSegments(path, '/ws/books').every((part) => !part.navigable)).toBe(true)
    }
  })
})
