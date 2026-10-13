import { describe, expect, it } from 'vitest'
import { shouldIgnoreWatchFilename, watchEventDir } from './workspace-watcher'

describe('shouldIgnoreWatchFilename', () => {
  it('忽略隐藏文件与临时文件', () => {
    expect(shouldIgnoreWatchFilename('.vs\\settings.json')).toBe(true)
    expect(shouldIgnoreWatchFilename('~$draft.epub')).toBe(true)
    expect(shouldIgnoreWatchFilename('book.tmp')).toBe(true)
  })

  it('不忽略普通新增文件', () => {
    expect(shouldIgnoreWatchFilename('三言二拍.epub')).toBe(false)
    expect(shouldIgnoreWatchFilename('subdir\\新书.pdf')).toBe(false)
  })

  it('filename 为 null 时不忽略（触发全量重扫）', () => {
    expect(shouldIgnoreWatchFilename(null)).toBe(false)
  })

  it('B3：忽略依赖/构建产物/Git 内部/应用缓存噪声', () => {
    expect(shouldIgnoreWatchFilename('node_modules/pkg/readme.md')).toBe(true)
    expect(shouldIgnoreWatchFilename('dist/out.md')).toBe(true)
    expect(shouldIgnoreWatchFilename('out/bundle.js')).toBe(true)
    expect(shouldIgnoreWatchFilename('release/app.exe')).toBe(true)
    expect(shouldIgnoreWatchFilename('.montree/cache.json')).toBe(true)
    expect(shouldIgnoreWatchFilename('.git/index.lock')).toBe(true)
    // 同名文件不在噪声目录内不误杀
    expect(shouldIgnoreWatchFilename('dist.md')).toBe(false)
    expect(shouldIgnoreWatchFilename('notes/distilled.md')).toBe(false)
  })
})

describe('watchEventDir（B3 按目录刷新）', () => {
  it('根直属文件记 `.`，子目录取父级', () => {
    expect(watchEventDir('a.md')).toBe('.')
    expect(watchEventDir('sub\\a.md')).toBe('sub')
    expect(watchEventDir('sub/deep/a.md')).toBe('sub/deep')
  })

  it('null 回落全量重扫', () => {
    expect(watchEventDir(null)).toBeNull()
    expect(watchEventDir('')).toBeNull()
  })
})
