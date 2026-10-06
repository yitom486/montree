import { describe, expect, it } from 'vitest'
import { basename, dirname, joinPath } from '@montree/contracts'

describe('path-utils', () => {
  it('dirname 支持 Windows 与 POSIX 路径', () => {
    expect(dirname('D:\\project\\notes\\readme.md')).toBe('D:\\project\\notes')
    expect(dirname('/home/user/docs/readme.md')).toBe('/home/user/docs')
  })

  it('basename 支持 Windows 与 POSIX 路径', () => {
    expect(basename('D:\\books\\novel.epub')).toBe('novel.epub')
    expect(basename('/tmp/readme.md')).toBe('readme.md')
  })

  it('joinPath 按目录分隔符拼接文件名', () => {
    expect(joinPath('D:\\project\\notes', 'untitled.md')).toBe('D:\\project\\notes\\untitled.md')
    expect(joinPath('/home/user/docs/', 'untitled.md')).toBe('/home/user/docs/untitled.md')
  })
})
