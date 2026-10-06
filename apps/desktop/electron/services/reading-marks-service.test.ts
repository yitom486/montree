import { mkdtemp, readFile } from 'node:fs/promises'
import { rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

let tempUserData = ''

vi.mock('electron', () => ({
  app: {
    getPath: () => tempUserData,
  },
}))

import {
  createReadingMark,
  deleteReadingMark,
  listReadingMarks,
  updateReadingMark,
} from './reading-marks-service'
import { isOk } from '@montree/contracts'

describe('reading-marks-service', () => {
  beforeEach(async () => {
    // 本文件锁定文件后端（同时证明回滚开关有效）；DB 后端由 marks-db.test.ts 覆盖
    process.env.MONTREE_MARKS_BACKEND = 'file'
    tempUserData = await mkdtemp(join(tmpdir(), 'reading-marks-'))
  })

  afterEach(() => {
    delete process.env.MONTREE_MARKS_BACKEND
    // 文件后端无 DB 句柄，直接删目录；用后即焚，不留 tmp 堆积
    if (tempUserData) rmSync(tempUserData, { recursive: true, force: true })
    tempUserData = ''
  })

  it('创建、列出、更新并删除书签', async () => {
    const createResult = await createReadingMark({
      filePath: 'D:\\books\\demo.epub',
      fileFingerprint: 'fp-1',
      kind: 'bookmark',
      anchor: { format: 'epub', cfi: 'cfi-1' },
      label: '第一章',
    })
    expect(isOk(createResult)).toBe(true)
    if (!isOk(createResult)) return

    const listResult = await listReadingMarks('D:\\books\\demo.epub')
    expect(isOk(listResult)).toBe(true)
    if (!isOk(listResult)) return
    expect(listResult.value).toHaveLength(1)
    expect(listResult.value[0]?.label).toBe('第一章')

    const updateResult = await updateReadingMark({
      id: createResult.value.id,
      note: '读后感',
    })
    expect(isOk(updateResult)).toBe(true)
    if (!isOk(updateResult)) return
    expect(updateResult.value.note).toBe('读后感')

    const highlightResult = await updateReadingMark({
      id: createResult.value.id,
      note: '',
    })
    expect(isOk(highlightResult)).toBe(true)
    if (!isOk(highlightResult)) return
    expect(highlightResult.value.note).toBeUndefined()
    expect(highlightResult.value.kind).toBe('bookmark')

    const deleteResult = await deleteReadingMark(createResult.value.id)
    expect(isOk(deleteResult)).toBe(true)

    const emptyList = await listReadingMarks('D:\\books\\demo.epub')
    expect(isOk(emptyList)).toBe(true)
    if (!isOk(emptyList)) return
    expect(emptyList.value).toHaveLength(0)

    const raw = await readFile(join(tempUserData, 'reading-marks.json'), 'utf-8')
    const parsed = JSON.parse(raw)
    expect(parsed.marks).toEqual([])
    expect(typeof parsed.tombstones?.[createResult.value.id]).toBe('number')
  })

  it('空路径创建失败', async () => {
    const result = await createReadingMark({
      filePath: '   ',
      fileFingerprint: 'fp',
      kind: 'bookmark',
      anchor: { format: 'pdf', page: 1 },
    })
    expect(isOk(result)).toBe(false)
  })

  it('在线文档 anchor 需合法 http(s) URL', async () => {    const bad = await createReadingMark({
      filePath: 'https://react.dev/learn',
      fileFingerprint: 'web|https://react.dev/learn',
      kind: 'highlight',
      anchor: { format: 'web', url: 'not-a-url' },
      excerpt: 'test',
    })
    expect(isOk(bad)).toBe(false)

    const good = await createReadingMark({
      filePath: 'https://react.dev/learn',
      fileFingerprint: 'web|https://react.dev/learn',
      kind: 'highlight',
      anchor: { format: 'web', url: 'https://react.dev/learn/installation' },
      excerpt: 'test',
    })
    expect(isOk(good)).toBe(true)
  })

  it('原子写：成功后无 tmp 残留，崩溃残留 tmp 下次自愈', async () => {
    const { writeFile, access } = await import('node:fs/promises')
    const mainPath = join(tempUserData, 'reading-marks.json')
    // 模拟上次崩溃留下的半写 tmp
    await writeFile(`${mainPath}.tmp`, 'garbage-half-write', 'utf-8')

    const created = await createReadingMark({
      filePath: 'D:\\books\\atomic.epub',
      fileFingerprint: 'fp-atomic',
      kind: 'bookmark',
      anchor: { format: 'epub', cfi: 'cfi-a' },
    })
    expect(isOk(created)).toBe(true)

    const raw = await readFile(mainPath, 'utf-8')
    expect(JSON.parse(raw).marks).toHaveLength(1)
    await expect(access(`${mainPath}.tmp`)).rejects.toThrow()
  })

  it('[3] 文件后端搜索与按章查询：内存过滤与 DB 后端同语义', async () => {
    const { searchReadingMarks, listReadingMarksByChapter } = await import(
      './reading-marks-service'
    )
    const { toChapterKey } = await import('@montree/contracts')
    const created = await createReadingMark({
      filePath: 'D:\\books\\file-svc.epub',
      fileFingerprint: 'fp-file-svc',
      kind: 'note',
      anchor: { format: 'epub', cfi: 'cfi-f' },
      excerpt: '文件后端荒野摘录',
      note: '文件后端观察笔记',
      chapter: { key: toChapterKey('text/f1'), label: '首章', index: 0 },
    })
    expect(isOk(created)).toBe(true)

    // 搜索命中摘录/批注；空串与别书回空
    const hit = await searchReadingMarks({ filePath: 'D:\\books\\file-svc.epub', query: '荒野' })
    expect(isOk(hit) && hit.value).toHaveLength(1)
    const empty = await searchReadingMarks({ filePath: 'D:\\books\\file-svc.epub', query: '  ' })
    expect(isOk(empty) && empty.value).toEqual([])
    const ghost = await searchReadingMarks({ filePath: 'D:\\books\\ghost.epub', query: '荒野' })
    expect(isOk(ghost) && ghost.value).toEqual([])

    // 按章查询：文件后端返回本书全量，调用方窄化（此处只验返回全量）
    const byChapter = await listReadingMarksByChapter({
      filePath: 'D:\\books\\file-svc.epub',
      chapterKeys: ['text/f1'],
    })
    expect(isOk(byChapter) && byChapter.value).toHaveLength(1)
    const noKeys = await listReadingMarksByChapter({
      filePath: 'D:\\books\\file-svc.epub',
      chapterKeys: [],
    })
    expect(isOk(noKeys) && noKeys.value).toEqual([])
  })
})
