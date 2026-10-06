import { describe, expect, it } from 'vitest'
import {
  buildReaderUnitTree,
  shouldExpandReaderUnitNode,
} from '@/lib/reader/reader-unit-tree'
import { estimatePageOffsetTop, PDF_PAGE_GAP_PX } from '@montree/reader-core'

describe('pdf-page-metrics', () => {
  it('按统一页高估算 offsetTop', () => {
    expect(estimatePageOffsetTop(1, 800)).toBe(0)
    expect(estimatePageOffsetTop(3, 800, PDF_PAGE_GAP_PX)).toBe(2 * (800 + PDF_PAGE_GAP_PX))
  })
})

describe('reader-unit-tree', () => {
  const units = [
    { label: 'Chapter 1', href: '1', level: 0 },
    { label: '1.1', href: '5', level: 1 },
    { label: '1.2', href: '10', level: 1 },
    { label: 'Chapter 2', href: '20', level: 0 },
  ]

  it('扁平目录还原为树', () => {
    const tree = buildReaderUnitTree(units)
    expect(tree).toHaveLength(2)
    expect(tree[0]!.children).toHaveLength(2)
    expect(tree[1]!.children).toHaveLength(0)
  })

  it('默认展开到二级', () => {
    expect(shouldExpandReaderUnitNode(0)).toBe(true)
    expect(shouldExpandReaderUnitNode(1)).toBe(true)
    expect(shouldExpandReaderUnitNode(2)).toBe(false)
  })

  it('孤儿不进错章节（缺 5.7 时 5.7.1/6.1.1/7.1.2 挂 root，不塞 5.6 下面）', () => {
    const tree = buildReaderUnitTree([
      { label: '第5章 中央处理器', href: '100', level: 0 },
      { label: '5.6指令流水线', href: '110', level: 1 },
      { label: '5.6.1基本概念', href: '110', level: 2 },
      { label: '5.7.1多核概念', href: '120', level: 2 },
      { label: '6.1.1总线的分类', href: '130', level: 2 },
      { label: '7.1.2外部设备', href: '140', level: 2 },
    ])
    // root：章节 + 真父缺失的孤儿（摆出来，不藏）
    expect(tree.map((node) => node.unit.label)).toEqual([
      '第5章 中央处理器',
      '5.7.1多核概念',
      '6.1.1总线的分类',
      '7.1.2外部设备',
    ])
    const chapter = tree[0]!
    expect(chapter.children.map((node) => node.unit.label)).toEqual(['5.6指令流水线'])
    expect(chapter.children[0]!.children.map((node) => node.unit.label)).toEqual(['5.6.1基本概念'])
  })

  it('真父在就正常挂（5.6.1 进 5.6，5.1 进章节）', () => {
    const tree = buildReaderUnitTree([
      { label: '第5章 中央处理器', href: '100', level: 0 },
      { label: '5.6指令流水线', href: '110', level: 1 },
      { label: '5.6.1基本概念', href: '110', level: 2 },
      { label: '5.1功能结构', href: '101', level: 1 },
    ])
    // 5.1 按层级栈回到章节下（无号章节无法验编号，信任层级）
    expect(tree).toHaveLength(1)
    expect(tree[0]!.children.map((node) => node.unit.label)).toEqual(['5.6指令流水线', '5.1功能结构'])
  })
})
