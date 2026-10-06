import { describe, expect, it } from 'vitest'
import {
  createExternalFileQueue,
  extractExternalFilePaths,
  isExternalFileCandidate,
} from './external-file'

describe('isExternalFileCandidate', () => {
  it('文件路径通过', () => {
    expect(isExternalFileCandidate('D:\\book\\a.md')).toBe(true)
    expect(isExternalFileCandidate('/tmp/a.md')).toBe(true)
  })

  it('开关/协议/空参数过滤', () => {
    expect(isExternalFileCandidate('--user-data-dir=x')).toBe(false)
    expect(isExternalFileCandidate('--squirrel-firstrun')).toBe(false)
    expect(isExternalFileCandidate('montree://open?file=a')).toBe(false)
    expect(isExternalFileCandidate('.')).toBe(false)
    expect(isExternalFileCandidate('  ')).toBe(false)
  })
})

describe('extractExternalFilePaths', () => {
  const isFile = (p: string) => p.endsWith('.md')

  it('跳过首个参数（可执行文件），只收存在的文件', () => {
    expect(
      extractExternalFilePaths(['Montree.exe', 'D:\\a.md', '--flag', 'D:\\b.txt'], isFile),
    ).toEqual(['D:\\a.md'])
  })

  it('去重，isFile 抛错视为不存在', () => {
    const throwing = (p: string) => {
      if (p === 'bad') throw new Error('stat failed')
      return true
    }
    expect(extractExternalFilePaths(['exe', 'a', 'a', 'bad'], throwing)).toEqual(['a'])
  })

  it('无候选返回空数组', () => {
    expect(extractExternalFilePaths(['exe'], isFile)).toEqual([])
  })
})

describe('createExternalFileQueue', () => {
  it('先进先出，空队列取 null', () => {
    const queue = createExternalFileQueue()
    expect(queue.take()).toBeNull()
    queue.push('a')
    queue.push('b')
    expect(queue.size()).toBe(2)
    expect(queue.take()).toBe('a')
    expect(queue.take()).toBe('b')
    expect(queue.take()).toBeNull()
  })

  it('空串与重复入队被忽略', () => {
    const queue = createExternalFileQueue()
    queue.push('  ')
    queue.push('a')
    queue.push('a')
    expect(queue.size()).toBe(1)
  })
})
