import { describe, expect, it } from 'vitest'
import type { ChatMessage } from './chat-message'
import { isToolActiveStatus } from './chat-message'
import { enrichToolMessageWithPresentResult, presentRecoveryToolCallIds, recoverPresentToolMessages } from './parse-present-result'

function tool(overrides: Partial<ChatMessage> = {}): ChatMessage {
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
  it('只恢复同线程已有成功工具，保持 ID，不接受非法结果或新增消息', () => {
    const previous = tool({toolTitle: 'Call Mcp Tool', toolContentText: '', text: 'Call Mcp Tool'})
    const ids = presentRecoveryToolCallIds([previous])
    expect(ids).toEqual([previous.toolCallId])
    const messages = recoverPresentToolMessages([previous], [{toolCallId: previous.toolCallId!, text: ENVELOPE}, {toolCallId:'other-thread', text: ENVELOPE}])
    expect(messages).toHaveLength(1)
    expect(messages[0]!.id).toBe(previous.id)
    expect(messages[0]!.presentResult?.kind).toBe('chapter-comparison')
    expect(presentRecoveryToolCallIds(messages)).toEqual([])
    expect(recoverPresentToolMessages([previous], [{toolCallId:previous.toolCallId!,text:'{"schemaVersion":2}'}])[0]).toBe(previous)
  })
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
