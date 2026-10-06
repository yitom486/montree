import { describe, expect, it } from 'vitest'
import type { BookDbBlockHit } from '@montree/contracts'
import { formatRosettaBlocksForAgent } from './rosetta-agent-text'

function hit(partial: Partial<BookDbBlockHit> & { content: string }): BookDbBlockHit {
  return {
    id: 0,
    type: 'paragraph',
    pageNumber: 1,
    chapterIndex: 0,
    chapterTitle: null,
    blockIndex: 0,
    snippet: '',
    source: 'unknown',
    extractVersion: '',
    ...partial,
  }
}

describe('formatRosettaBlocksForAgent', () => {
  it('标题加 ## 前缀，表格列表段落原样，空数组抛错', () => {
    expect(
      formatRosettaBlocksForAgent([
        hit({ type: 'heading', content: '第1章 概述' }),
        hit({ type: 'paragraph', content: '正文' }),
        hit({ type: 'table', content: '| a |\n|---|' }),
      ]),
    ).toBe('## 第1章 概述\n\n正文\n\n| a |\n|---|')
    expect(() => formatRosettaBlocksForAgent([])).toThrow()
  })
})
