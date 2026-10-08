// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest'
import {
  emitAnchorHighlight,
  emitRevealMark,
  locateExcerptInDocuments,
  scrollElementTextIntoView,
  subscribeAnchorHighlight,
  subscribeRevealMark,
} from './mark-linkage'

/**
 * 联动 DOM 层测试（happy-dom 真 DOM，无 mock）：
 * 摘录多文档定位、滚动定位、跨面板 reveal 事件通道。
 * 纯决策层语义见 mark-linkage.test.ts（node 环境）。
 */
describe('locateExcerptInDocuments', () => {
  function docWithParagraphs(...texts: string[]): Document {
    const doc = document.implementation.createHTMLDocument('section')
    for (const text of texts) {
      const p = doc.createElement('p')
      p.textContent = text
      doc.body.appendChild(p)
    }
    return doc
  }

  it('按文档顺序定位，首个命中的文档获胜', () => {
    const first = docWithParagraphs('第一段无关文字', '目标摘录在这里出现')
    const second = docWithParagraphs('目标摘录在这里出现')
    const hit = locateExcerptInDocuments([{ doc: first }, { doc: second }], '目标摘录在这里出现')
    expect(hit?.doc).toBe(first)
    // happy-dom 未实现 Range.toString：改为断言起点容器文本
    expect(hit?.range.startContainer.textContent).toContain('目标摘录在这里出现')
  })

  it('首文档无命中时落到后文档；全无返回 null', () => {
    const first = docWithParagraphs('毫不相关')
    const second = docWithParagraphs('第二文档的目标摘录')
    expect(
      locateExcerptInDocuments([{ doc: first }, { doc: second }], '第二文档的目标摘录')?.doc,
    ).toBe(second)
    expect(locateExcerptInDocuments([{ doc: first }], '不存在的摘录')).toBeNull()
    expect(locateExcerptInDocuments([], '任何')).toBeNull()
  })

  it('空白文本直接返回 null，不触 DOM', () => {
    const doc = docWithParagraphs('内容')
    expect(locateExcerptInDocuments([{ doc }], '   ')).toBeNull()
  })

  it('中英文标点混杂或清洗微小差异时仍可精准定位', () => {
    const doc = docWithParagraphs('那时,我在中国的山东大学和第一历史档案馆待了一年。')
    // 朗读句子清洗后为全角中文逗号，DOM 中为半角西文逗号
    const hit = locateExcerptInDocuments([{ doc }], '那时，我在中国的山东大学和第一历史档案馆待了一年。')
    expect(hit).not.toBeNull()
    expect(hit?.doc).toBe(doc)
  })
})

describe('scrollElementTextIntoView', () => {
  it('命中返回 Range；无命中返回 null；空白返回 null', () => {
    const host = document.createElement('div')
    host.innerHTML = '<p>前言文字</p><p>需要定位的摘录句子</p>'
    document.body.appendChild(host)
    try {
      const range = scrollElementTextIntoView(host, '需要定位的摘录句子')
      expect(range).not.toBeNull()
      expect(range!.startContainer.textContent).toContain('需要定位的摘录句子')
      expect(scrollElementTextIntoView(host, '不存在的句子')).toBeNull()
      expect(scrollElementTextIntoView(host, '  ')).toBeNull()
    } finally {
      host.remove()
    }
  })
})

describe('reveal 事件通道', () => {
  it('emit 后订阅者收到 markId', () => {
    const handler = vi.fn()
    const unsubscribe = subscribeRevealMark(handler)
    try {
      emitRevealMark('mark-123')
      expect(handler).toHaveBeenCalledTimes(1)
      expect(handler).toHaveBeenCalledWith('mark-123')
    } finally {
      unsubscribe()
    }
  })

  it('空 id 不派发；取消订阅后不再收到', () => {
    const handler = vi.fn()
    const unsubscribe = subscribeRevealMark(handler)
    emitRevealMark('')
    expect(handler).not.toHaveBeenCalled()
    unsubscribe()
    emitRevealMark('mark-123')
    expect(handler).not.toHaveBeenCalled()
  })

  it('多订阅者都收到', () => {
    const a = vi.fn()
    const b = vi.fn()
    const offA = subscribeRevealMark(a)
    const offB = subscribeRevealMark(b)
    try {
      emitRevealMark('mark-9')
      expect(a).toHaveBeenCalledWith('mark-9')
      expect(b).toHaveBeenCalledWith('mark-9')
    } finally {
      offA()
      offB()
    }
  })
})

describe('anchor-highlight 事件通道', () => {
  it('派发后订阅者收到摘录文本；空文本不派发；退订后不收到', () => {
    const handler = vi.fn()
    const off = subscribeAnchorHighlight(handler)

    emitAnchorHighlight('义和团运动的起源')
    expect(handler).toHaveBeenCalledWith('义和团运动的起源')

    handler.mockClear()
    emitAnchorHighlight('')
    emitAnchorHighlight('   ')
    expect(handler).not.toHaveBeenCalled()

    off()
    emitAnchorHighlight('再次定位')
    expect(handler).not.toHaveBeenCalled()
  })
})
