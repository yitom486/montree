import { describe, expect, it } from 'vitest'
import type { AcpChatMessage } from '@/stores/acp-chat-types'
import {
  groupAgentMessages,
  isRichToolMessage,
} from './AgentActivityGroup'

function createMsg(overrides: Partial<AcpChatMessage>): AcpChatMessage {
  return {
    id: 'msg-' + Math.random().toString(36).slice(2),
    role: 'agent',
    text: '',
    createdAt: Date.now(),
    ...overrides,
  }
}

describe('isRichToolMessage', () => {
  it('识别 montree_generate_diagram 工具为富卡片', () => {
    const msg = createMsg({
      role: 'tool',
      toolTitle: 'montree_generate_diagram',
      text: JSON.stringify({ mermaidCode: 'graph TD; A-->B' }),
    })
    expect(isRichToolMessage(msg)).toBe(true)
  })

  it('识别包含 mermaidCode 的工具输出为富卡片', () => {
    const msg = createMsg({
      role: 'tool',
      toolTitle: 'custom_diagram_tool',
      toolContentText: '{"diagramId":"1","mermaidCode":"flowchart LR; X-->Y"}',
    })
    expect(isRichToolMessage(msg)).toBe(true)
  })

  it('普通文件读取工具不应被判定为富卡片', () => {
    const msg = createMsg({
      role: 'tool',
      toolTitle: 'Read: /path/to/file.ts',
      toolContentText: 'const x = 1',
    })
    expect(isRichToolMessage(msg)).toBe(false)
  })
})

describe('groupAgentMessages', () => {
  it('将普通 tool 和 thought 消息打包成 activity 组', () => {
    const messages: AcpChatMessage[] = [
      createMsg({ role: 'user', text: '你好' }),
      createMsg({ role: 'thought', text: '思考中...' }),
      createMsg({ role: 'tool', toolTitle: 'Read: /a.ts' }),
      createMsg({ role: 'tool', toolTitle: 'Read: /b.ts' }),
      createMsg({ role: 'agent', text: '回答内容' }),
    ]

    const timeline = groupAgentMessages(messages)
    expect(timeline).toHaveLength(3)
    expect(timeline[0]?.type).toBe('single')
    expect(timeline[1]?.type).toBe('activity')
    if (timeline[1]?.type === 'activity') {
      expect(timeline[1].messages).toHaveLength(3)
    }
    expect(timeline[2]?.type).toBe('single')
  })

  it('富交互卡片从活动组中提升为 single，独立展示在主时间线', () => {
    const messages: AcpChatMessage[] = [
      createMsg({ role: 'user', text: '请制作卡片' }),
      createMsg({ role: 'thought', text: '分析材料' }),
      createMsg({ role: 'tool', toolTitle: 'Read: chapter.html' }),
      createMsg({
        role: 'tool',
        toolTitle: 'montree_generate_diagram',
        toolContentText: JSON.stringify({
          diagramId: 'diag-1',
          title: '义和团运动范式',
          mermaidCode: 'graph TD; A-->B',
        }),
      }),
      createMsg({ role: 'agent', text: '3. 作者在此表达的态度与意图' }),
    ]

    const timeline = groupAgentMessages(messages)
    // 应该分为：
    // 1. user msg (single)
    // 2. 前置 thought + read tool (activity)
    // 3. diagram tool card (single, 提升到主时间线)
    // 4. agent response msg (single)
    expect(timeline).toHaveLength(4)
    expect(timeline[0]?.type).toBe('single')
    expect(timeline[1]?.type).toBe('activity')
    if (timeline[1]?.type === 'activity') {
      expect(timeline[1].messages).toHaveLength(2)
      expect(timeline[1].messages[0]?.role).toBe('thought')
      expect(timeline[1].messages[1]?.toolTitle).toBe('Read: chapter.html')
    }
    expect(timeline[2]?.type).toBe('single')
    if (timeline[2]?.type === 'single') {
      expect(timeline[2].message.toolTitle).toBe('montree_generate_diagram')
    }
    expect(timeline[3]?.type).toBe('single')
    if (timeline[3]?.type === 'single') {
      expect(timeline[3].message.text).toContain('3. 作者在此表达的态度与意图')
    }
  })
})
