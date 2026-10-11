import { describe, expect, it } from 'vitest'
import type { AcpChatMessage } from '@/stores/acp-chat-types'
import { isToolActiveStatus } from '@/stores/acp-chat-types'
import { enrichToolMessageWithPresentResult } from './parse-present-result'

function tool(overrides: Partial<AcpChatMessage> = {}): AcpChatMessage {
  return {
    id: 'tool-present-1',
    role: 'tool',
    text: '',
    createdAt: 1000,
    toolCallId: 'tc-present-1',
    toolTitle: 'montree_present',
    toolStatus: 'completed',
    streaming: false,
    ...overrides,
  }
}

const ENVELOPE = JSON.stringify({
  schemaVersion: 1,
  kind: 'chapter-comparison',
  id: 'present-chapter-comparison-abcdef12',
  title: '比较',
  documentFingerprint: '/books/a.epub',
  chapters: [
    { key: 'c1', label: '第一章', flatIndex: 0 },
    { key: 'c2', label: '第二章', flatIndex: 1 },
  ],
  items: [],
})

describe('enrichToolMessageWithPresentResult', () => {
  it('落定工具挂载呈现结果', () => {
    const enriched = enrichToolMessageWithPresentResult(
      tool({ toolContentText: ENVELOPE, text: ENVELOPE }),
      isToolActiveStatus,
    )
    expect(enriched.presentResult?.kind).toBe('chapter-comparison')
  })

  it('流式未完成跳过，收尾标记后解析', () => {
    const active = tool({ toolContentText: ENVELOPE, text: ENVELOPE, toolStatus: 'in_progress', streaming: true })
    expect(enrichToolMessageWithPresentResult(active, isToolActiveStatus).presentResult).toBeUndefined()
    const settled = { ...active, streaming: false, turnEnded: true }
    expect(enrichToolMessageWithPresentResult(settled, isToolActiveStatus).presentResult?.kind).toBe(
      'chapter-comparison',
    )
  })

  it('无效载荷保持原样', () => {
    const bad = tool({ toolContentText: '{"kind":"chapter-comparison"}', text: '{"kind":"chapter-comparison"}' })
    expect(enrichToolMessageWithPresentResult(bad, isToolActiveStatus).presentResult).toBeUndefined()
  })

  it('非 present 文本不解析', () => {
    const plain = tool({ toolContentText: 'const x = 1', text: 'const x = 1' })
    expect(enrichToolMessageWithPresentResult(plain, isToolActiveStatus).presentResult).toBeUndefined()
  })
})
