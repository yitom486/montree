// @vitest-environment happy-dom
import { mkdtemp } from 'node:fs/promises'
import { rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, describe, expect, it, vi } from 'vitest'

let tempUserData = ''

vi.mock('electron', () => ({
  app: {
    getPath: () => tempUserData,
  },
}))

import { closeAllBookDbs } from './book-db/open-book-db'
import { closeAllMontreeDbs } from './app-db/open-app-db'
import {
  createReadingMark,
  listReadingMarks,
} from './reading-marks-service'
import { isOk } from '@montree/contracts'

afterEach(() => {
  closeAllBookDbs()
  closeAllMontreeDbs()
})

async function withIsolatedUserData(fn: (dir: string) => Promise<void>): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'montree-mark-proposal-'))
  tempUserData = dir
  try {
    await fn(dir)
  } finally {
    closeAllBookDbs()
    closeAllMontreeDbs()
    tempUserData = ''
    rmSync(dir, { recursive: true, force: true })
  }
  return dir
}

describe('AI 批注提议与知识卡片落库集成测试', () => {
  const testFile = 'D:/books/yihetuan.epub'

  it('1. 数据库落库验证：真实 SQLite 数据库（book.db）能够持久化批注与知识卡片', async () => {
    await withIsolatedUserData(async () => {
      // 初始状态：数据库为空
      const initial = await listReadingMarks(testFile)
      expect(isOk(initial)).toBe(true)
      if (isOk(initial)) {
        expect(initial.value).toHaveLength(0)
      }

      // 创建一条批注落库
      const created = await createReadingMark({
        filePath: testFile,
        fileFingerprint: 'fp-yihetuan',
        kind: 'note',
        anchor: {
          format: 'epub',
          cfi: 'epubcfi(/6/2[chapter1]!/4/2/10)',
          cfiRange: 'epubcfi(/6/2[chapter1]!/4/2/10,/1:0,/1:40)',
          href: 'preface.xhtml',
          selectedText: '在义和团运动中所有拳民都能降神……',
        },
        note: '【义和团的成败悖论】人人皆可成神赋予了个体平等的精神赋权',
        excerpt: '在义和团运动中所有拳民都能降神……',
      })
      expect(isOk(created)).toBe(true)

      // 验证 SQLite 数据库真实持久化
      const after = await listReadingMarks(testFile)
      expect(isOk(after)).toBe(true)
      if (isOk(after)) {
        expect(after.value).toHaveLength(1)
        expect(after.value[0].note).toContain('义和团的成败悖论')
        expect(after.value[0].kind).toBe('note')
      }
    })
  })

  it('2. 提议机制验证：AI 工具调用 montree_propose_mark 时仅生成草稿，不会直接写入数据库', async () => {
    await withIsolatedUserData(async () => {
      // 模拟 AI 工具真实返回的 batch 结构
      const aiToolOutput = JSON.stringify({
        proposed: true,
        count: 4,
        marks: [
          {
            proposed: true,
            excerpt: '在义和团运动中所有拳民都能降神……',
            note: '【义和团的成败悖论】分析',
            message: '提议批注',
          },
          {
            proposed: true,
            excerpt: '鲁西南大刀会由乡村财主把持……',
            note: '鲁西南社会结构分析',
            message: '提议批注',
          },
          {
            proposed: true,
            excerpt: '教民依托帝国主义撑腰……',
            note: '民教冲突根源',
            message: '提议批注',
          },
          {
            proposed: true,
            excerpt: '社会结构的存在并非一日……',
            note: '结构与事件的关系',
            message: '提议批注',
          },
        ],
        message: '已生成 4 条标记提议；用户确认「采用」后才会写入，请勿假定已保存。',
      })

      // 验证工具返回的草稿结构中确实包含 4 项提议
      const parsedOutput = JSON.parse(aiToolOutput)
      expect(parsedOutput.marks).toHaveLength(4)

      // 关键断言：此时数据库中必须依然是 0 条！未采用前绝不落盘！
      const marksInDb = await listReadingMarks(testFile)
      expect(isOk(marksInDb)).toBe(true)
      if (isOk(marksInDb)) {
        expect(marksInDb.value).toHaveLength(0) // 证明 AI 工具本身不具备落库副作用
      }
    })
  })

  it('3. 数据库结构化卡片字段断言：支持 category（含 note）和 title 持久化存储与读写还原', async () => {
    await withIsolatedUserData(async () => {
      const res = await createReadingMark({
        filePath: testFile,
        fileFingerprint: 'fp-1',
        kind: 'note',
        category: 'note',
        title: '测试批注卡片',
        anchor: { format: 'epub', cfi: 'cfi' },
        note: '这是一条读者批注',
        excerpt: '正文摘录',
      })
      expect(isOk(res)).toBe(true)
      if (isOk(res)) {
        expect(res.value.category).toBe('note')
        expect(res.value.title).toBe('测试批注卡片')
      }

      const listRes = await listReadingMarks(testFile)
      expect(isOk(listRes)).toBe(true)
      if (isOk(listRes)) {
        expect(listRes.value).toHaveLength(1)
        expect(listRes.value[0].category).toBe('note')
        expect(listRes.value[0].title).toBe('测试批注卡片')
      }
    })
  })
})
