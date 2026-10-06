// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from 'vitest'
import { MONTREE_SETTLE_COMPLETE_KIND } from '@montree/contracts'
import { buildMontreePromptPrefix } from '@/lib/agent/context/build-prompt-prefix'
import { formatTurnContextBlock } from '@/lib/agent/context/turn-context'
import {
  selectActiveThreadHasSubstantiveMessages,
  useAcpUiStore,
} from '@/stores/acp-ui-store'

describe('acp-ui-store history + plan', () => {
  beforeEach(() => {
    const fresh = useAcpUiStore.getState().createThread()
    useAcpUiStore.setState({
      prompting: false,
      sessionId: null,
      status: 'disconnected',
      pendingMarkProposalSnapshotContents: [],
    })
    // 只保留刚建的空线程，避免持久化干扰
    const thread = useAcpUiStore.getState().threads.find((t) => t.id === fresh)
    useAcpUiStore.setState({
      threads: thread ? [thread] : useAcpUiStore.getState().threads.slice(0, 1),
      activeThreadId: fresh,
    })
  })

  it('setSession(null) keeps thread.agentSessionIds for reconnect', () => {
    useAcpUiStore.getState().setSession('sess-keep-me')
    const threadId = useAcpUiStore.getState().activeThreadId
    expect(
      useAcpUiStore.getState().threads.find((t) => t.id === threadId)?.agentSessionIds?.[
        'codex-acp'
      ],
    ).toBe('sess-keep-me')
    useAcpUiStore.getState().setSession(null)
    const state = useAcpUiStore.getState()
    expect(state.sessionId).toBeNull()
    expect(
      state.threads.find((t) => t.id === threadId)?.agentSessionIds?.['codex-acp'],
    ).toBe('sess-keep-me')
  })

  it('ingestPermissionRequest surfaces pending + tool card for approval UI', () => {
    useAcpUiStore.getState().ingestPermissionRequest({
      requestId: 42,
      summary: 'Delete demo.md',
      toolCallId: 'tc-del',
      options: [
        { optionId: 'allow-once', name: '允许', kind: 'allow_once' },
        { optionId: 'reject-once', name: '拒绝', kind: 'reject_once' },
      ],
      toolCall: {
        toolCallId: 'tc-del',
        title: 'Delete demo.md',
        kind: 'delete',
        status: 'pending',
      },
    })

    const state = useAcpUiStore.getState()
    expect(state.pendingPermission?.requestId).toBe(42)
    expect(state.pendingPermission?.toolCallId).toBe('tc-del')
    const tool = state.threads
      .find((t) => t.id === state.activeThreadId)
      ?.messages.find((m) => m.role === 'tool' && m.toolCallId === 'tc-del')
    expect(tool?.toolTitle).toBe('Delete demo.md')
    expect(tool?.toolStatus).toBe('pending')
    expect(tool?.streaming).toBe(true)

    useAcpUiStore.getState().clearPendingPermission(42)
    expect(useAcpUiStore.getState().pendingPermission).toBeNull()
  })

  it('createThread switches to empty conversation', () => {
    useAcpUiStore.getState().appendUserMessage('hello')
    const id = useAcpUiStore.getState().createThread()
    const state = useAcpUiStore.getState()
    expect(state.activeThreadId).toBe(id)
    const active = state.threads.find((t) => t.id === id)
    expect(active?.messages).toEqual([])
    expect(state.threads.length).toBeGreaterThanOrEqual(2)
  })

  it('createThread drops the previous blank draft', () => {
    const first = useAcpUiStore.getState().activeThreadId
    const second = useAcpUiStore.getState().createThread()
    expect(useAcpUiStore.getState().threads.some((t) => t.id === first)).toBe(false)
    expect(useAcpUiStore.getState().activeThreadId).toBe(second)
    expect(useAcpUiStore.getState().threads).toHaveLength(1)
  })

  it('opening panel keeps the active conversation instead of a blank draft', () => {
    useAcpUiStore.getState().appendUserMessage('旧会话')
    const oldId = useAcpUiStore.getState().activeThreadId
    useAcpUiStore.getState().setPanelOpen(false)
    useAcpUiStore.getState().setPanelOpen(true)
    const state = useAcpUiStore.getState()
    expect(state.panelOpen).toBe(true)
    expect(state.activeThreadId).toBe(oldId)
    expect(state.threads.find((t) => t.id === oldId)?.messages[0]?.text).toBe('旧会话')
  })

  it('closing panel prunes blank drafts', () => {
    useAcpUiStore.getState().appendUserMessage('保留')
    useAcpUiStore.getState().createThread()
    expect(useAcpUiStore.getState().threads.length).toBeGreaterThanOrEqual(2)
    useAcpUiStore.getState().setPanelOpen(false)
    const state = useAcpUiStore.getState()
    expect(state.panelOpen).toBe(false)
    expect(state.threads.every((t) => t.messages.some((m) => m.role === 'user'))).toBe(
      true,
    )
  })

  it('switchThread restores prior messages', () => {
    useAcpUiStore.getState().appendUserMessage('first thread')
    const firstId = useAcpUiStore.getState().activeThreadId
    const secondId = useAcpUiStore.getState().createThread()
    useAcpUiStore.getState().appendUserMessage('second thread')
    useAcpUiStore.getState().switchThread(firstId)
    const state = useAcpUiStore.getState()
    expect(state.activeThreadId).toBe(firstId)
    expect(state.threads.find((t) => t.id === firstId)?.messages[0]?.text).toBe('first thread')
    expect(state.threads.find((t) => t.id === secondId)?.messages[0]?.text).toBe('second thread')
  })

  it('finishStreaming prunes intermediate agent replies in the current turn', () => {
    useAcpUiStore.getState().appendUserMessage('retry please')
    useAcpUiStore.getState().applySessionUpdate({
      sessionUpdate: 'agent_thought_chunk',
      content: { type: 'text', text: 'plan' },
    })
    useAcpUiStore.setState((s) => {
      const thread = s.threads.find((t) => t.id === s.activeThreadId)
      if (!thread) return s
      const messages = [
        ...thread.messages,
        {
          id: 'a-mid',
          role: 'agent' as const,
          text: '中间进度：准备重试',
          createdAt: Date.now(),
          streaming: false,
        },
        {
          id: 'a-final',
          role: 'agent' as const,
          text: '最终结果：已完成',
          createdAt: Date.now(),
          streaming: true,
        },
      ]
      return {
        threads: s.threads.map((t) =>
          t.id === s.activeThreadId ? { ...t, messages } : t,
        ),
      }
    })

    useAcpUiStore.getState().finishStreaming()
    const messages =
      useAcpUiStore.getState().threads.find(
        (t) => t.id === useAcpUiStore.getState().activeThreadId,
      )?.messages ?? []
    const agents = messages.filter((m) => m.role === 'agent')
    expect(agents).toHaveLength(1)
    expect(agents[0]?.text).toBe('最终结果：已完成')
    expect(agents[0]?.streaming).toBe(false)
    expect(messages.some((m) => m.role === 'thought')).toBe(true)
  })

  it('promotes late batch proposal chunks after the turn has already finished', () => {
    useAcpUiStore.getState().appendUserMessage('给这一章划重点')
    useAcpUiStore.getState().beginAgentReply()
    useAcpUiStore.getState().applySessionUpdate({
      sessionUpdate: 'agent_message_chunk',
      content: { type: 'text', text: '已生成建议，请确认采用。' },
    })
    useAcpUiStore.getState().applySessionUpdate({
      sessionUpdate: 'tool_call',
      toolCallId: 'late-propose',
      title: 'mcp.montree.montree_propose_mark',
      kind: 'other',
      status: 'in_progress',
    })

    // ACP 的 prompt 已结束，但最后一个 tool content chunk 仍在路上。
    useAcpUiStore.getState().finishStreaming()
    useAcpUiStore.getState().applySessionUpdate({
      sessionUpdate: 'tool_call_content_chunk',
      toolCallId: 'late-propose',
      content: {
        type: 'text',
        text: JSON.stringify({
          proposed: true,
          count: 2,
          marks: [
            { proposed: true, excerpt: '重点一', note: '', message: '' },
            { proposed: true, excerpt: '重点二', note: '补充说明', message: '' },
          ],
          message: '等待采用',
        }),
      },
    })

    const messages =
      useAcpUiStore.getState().threads.find(
        (t) => t.id === useAcpUiStore.getState().activeThreadId,
      )?.messages ?? []
    const agent = messages.find((m) => m.role === 'agent')
    const tool = messages.find((m) => m.role === 'tool' && m.toolCallId === 'late-propose')
    expect(agent?.markProposals).toHaveLength(2)
    expect(agent?.markProposals?.map((row) => row.proposal.excerpt)).toEqual(['重点一', '重点二'])
    expect(tool?.streaming).toBe(false)
  })

  it('attaches batch proposals from the MCP snapshot when ACP omits tool result content', () => {
    useAcpUiStore.getState().appendUserMessage('给这一章划重点')
    useAcpUiStore.getState().beginAgentReply()
    useAcpUiStore.getState().applySessionUpdate({
      sessionUpdate: 'agent_message_chunk',
      content: { type: 'text', text: '已生成建议，请确认采用。' },
    })
    useAcpUiStore.getState().applySessionUpdate({
      sessionUpdate: 'tool_call',
      toolCallId: 'mcp-propose',
      title: 'mcp.montree.montree_propose_mark',
      kind: 'other',
      status: 'completed',
    })

    // codex-acp 的 tool_call 只有标题和状态；真实 result.content 在 MCP 快照响应里。
    useAcpUiStore.getState().attachMarkProposalsFromSnapshot(
      JSON.stringify({
        proposed: true,
        count: 2,
        marks: [
          { proposed: true, excerpt: '重点一', note: '', message: '' },
          { proposed: true, excerpt: '重点二', note: '补充说明', message: '' },
        ],
        message: '等待采用',
      }),
    )
    useAcpUiStore.getState().finishStreaming()

    const messages =
      useAcpUiStore.getState().threads.find(
        (t) => t.id === useAcpUiStore.getState().activeThreadId,
      )?.messages ?? []
    const agent = messages.find((m) => m.role === 'agent')
    expect(agent?.markProposals).toHaveLength(2)
    expect(agent?.markProposals?.[0]?.proposal.id).toBe('tool:mcp-propose:0')
  })

  it('queues an MCP snapshot that arrives before its propose-mark tool event', () => {
    useAcpUiStore.getState().appendUserMessage('给这一章划重点')
    useAcpUiStore.getState().beginAgentReply()
    useAcpUiStore.getState().applySessionUpdate({
      sessionUpdate: 'agent_message_chunk',
      content: { type: 'text', text: '正在整理。' },
    })

    // MCP HTTP 请求会先向渲染进程索取快照；codex-acp 的 tool_call 事件随后才到。
    useAcpUiStore.getState().attachMarkProposalsFromSnapshot(
      JSON.stringify({
        proposed: true,
        count: 1,
        marks: [{ proposed: true, excerpt: '重点一', note: '补充说明', message: '' }],
        message: '等待采用',
      }),
    )
    expect(useAcpUiStore.getState().pendingMarkProposalSnapshotContents).toHaveLength(1)

    useAcpUiStore.getState().applySessionUpdate({
      sessionUpdate: 'tool_call',
      toolCallId: 'mcp-late-tool-event',
      title: 'mcp.montree.montree_propose_mark',
      kind: 'other',
      status: 'completed',
    })
    useAcpUiStore.getState().finishStreaming()

    const messages =
      useAcpUiStore.getState().threads.find(
        (t) => t.id === useAcpUiStore.getState().activeThreadId,
      )?.messages ?? []
    const agent = messages.find((m) => m.role === 'agent')
    expect(agent?.markProposals).toHaveLength(1)
    expect(useAcpUiStore.getState().pendingMarkProposalSnapshotContents).toEqual([])
  })

  it('rememberConfigPreference persists per runtime', () => {
    useAcpUiStore.getState().rememberConfigPreference('codex-acp', 'mode', 'ask-for-approval')
    useAcpUiStore.getState().rememberConfigPreference('codex-acp', 'model', 'gpt-x')
    expect(useAcpUiStore.getState().preferredConfigByRuntime['codex-acp']).toEqual({
      mode: 'ask-for-approval',
      model: 'gpt-x',
    })
  })

  it('applies plan sessionUpdate and replaces entries', () => {
    useAcpUiStore.getState().applySessionUpdate({
      sessionUpdate: 'plan',
      entries: [
        { content: 'A', status: 'pending' },
        { content: 'B', status: 'in_progress' },
      ],
    })
    let messages =
      useAcpUiStore.getState().threads.find(
        (t) => t.id === useAcpUiStore.getState().activeThreadId,
      )?.messages ?? []
    expect(messages.some((m) => m.role === 'plan')).toBe(true)
    expect(messages.find((m) => m.role === 'plan')?.planEntries).toHaveLength(2)

    useAcpUiStore.getState().applySessionUpdate({
      sessionUpdate: 'plan_update',
      plan: {
        entries: [{ content: 'A', status: 'completed' }],
      },
    })
    messages =
      useAcpUiStore.getState().threads.find(
        (t) => t.id === useAcpUiStore.getState().activeThreadId,
      )?.messages ?? []
    const plan = messages.find((m) => m.role === 'plan')
    expect(plan?.planEntries).toEqual([
      { content: 'A', priority: undefined, status: 'completed' },
    ])
    expect(plan?.streaming).toBe(false)
  })

  it('hudDisplayMode 支持 docked / floating / capsule 三态流转与划选自动展开', () => {
    useAcpUiStore.getState().setHudDisplayMode('docked')
    expect(useAcpUiStore.getState().hudDisplayMode).toBe('docked')
    useAcpUiStore.getState().setHudDisplayMode('floating')
    expect(useAcpUiStore.getState().hudDisplayMode).toBe('floating')

    useAcpUiStore.getState().setHudDisplayMode('capsule')
    expect(useAcpUiStore.getState().hudDisplayMode).toBe('capsule')

    // 划词时调用 openPanelAndFocusComposer 会自动将 capsule 展开为 floating
    useAcpUiStore.getState().openPanelAndFocusComposer()
    expect(useAcpUiStore.getState().panelOpen).toBe(true)
    expect(useAcpUiStore.getState().hudDisplayMode).toBe('floating')
  })

  it('setChatScroll 按线程记忆滚动，deleteThread 连带清理', () => {
    const threadId = useAcpUiStore.getState().activeThreadId
    useAcpUiStore.getState().setChatScroll(threadId, { scrollTop: 123, pinned: false })
    expect(useAcpUiStore.getState().chatScrollByThread[threadId]).toEqual({
      scrollTop: 123,
      pinned: false,
    })
    useAcpUiStore.getState().deleteThread(threadId)
    expect(useAcpUiStore.getState().chatScrollByThread[threadId]).toBeUndefined()
  })

  it('requestConnect 只发 nonce 信令（连接本身由 useAcpSession 驱动）', () => {
    expect(useAcpUiStore.getState().connectRequestedAt).toBe(0)
    useAcpUiStore.getState().requestConnect()
    expect(useAcpUiStore.getState().connectRequestedAt).toBeGreaterThan(0)
  })

  it('modelCatalogByRuntime 内存态：写入按运行时分桶，断开/切换清空', () => {
    useAcpUiStore.getState().setModelCatalog('cursor-cli', ['grok-4.7-high', 'grok-4.7-high-fast'])
    expect(useAcpUiStore.getState().modelCatalogByRuntime['cursor-cli']).toEqual([
      'grok-4.7-high',
      'grok-4.7-high-fast',
    ])
    // 空值清单 runtime
    useAcpUiStore.getState().setModelCatalog('cursor-cli', null)
    expect(useAcpUiStore.getState().modelCatalogByRuntime['cursor-cli']).toBeUndefined()
    // 断开清空全表（沿用 setStatus 现有清位语义）
    useAcpUiStore.getState().setModelCatalog('cursor-cli', ['grok-4.7-high'])
    useAcpUiStore.getState().setStatus('disconnected')
    expect(useAcpUiStore.getState().modelCatalogByRuntime).toEqual({})
  })
})

describe('load 定居收尾（freezeSettledStreaming + 空线程例外）', () => {
  beforeEach(() => {
    const fresh = useAcpUiStore.getState().createThread()
    useAcpUiStore.setState({
      prompting: false,
      sessionId: null,
      status: 'disconnected',
      pendingMarkProposalSnapshotContents: [],
    })
    const thread = useAcpUiStore.getState().threads.find((t) => t.id === fresh)
    useAcpUiStore.setState({
      threads: thread ? [thread] : useAcpUiStore.getState().threads.slice(0, 1),
      activeThreadId: fresh,
    })
  })

  function activeMessages() {
    const s = useAcpUiStore.getState()
    return s.threads.find((t) => t.id === s.activeThreadId)?.messages ?? []
  }

  it('空线程判定：空白与纯系统消息无历史，user/agent 即有历史', () => {
    expect(selectActiveThreadHasSubstantiveMessages(useAcpUiStore.getState())).toBe(false)
    useAcpUiStore.getState().appendSystemMessage('已连接')
    expect(selectActiveThreadHasSubstantiveMessages(useAcpUiStore.getState())).toBe(false)
    useAcpUiStore.getState().appendUserMessage('hello')
    expect(selectActiveThreadHasSubstantiveMessages(useAcpUiStore.getState())).toBe(true)
  })

  it('空占位 streaming agent 气泡也算实质消息（回放照常压制）', () => {
    useAcpUiStore.getState().beginAgentReply()
    expect(selectActiveThreadHasSubstantiveMessages(useAcpUiStore.getState())).toBe(true)
  })

  it('freezeSettledStreaming 冻结残留且不碰 prompting（true/false 均保持）', () => {
    for (const prompting of [false, true] as const) {
      useAcpUiStore.getState().appendUserMessage('hi')
      useAcpUiStore.getState().applySessionUpdate({
        sessionUpdate: 'agent_message_chunk',
        content: { type: 'text', text: 'leak' },
      })
      useAcpUiStore.getState().applySessionUpdate({
        sessionUpdate: 'tool_call',
        toolCallId: 'tc-run',
        title: 'run',
        kind: 'execute',
        status: 'in_progress',
      })
      useAcpUiStore.setState({ prompting })
      useAcpUiStore.getState().freezeSettledStreaming()
      const messages = activeMessages()
      // user 等非流式消息本就没有 streaming 字段（undefined），只断言无残留 true
      expect(messages.every((m) => !m.streaming)).toBe(true)
      expect(messages.find((m) => m.role === 'tool')?.toolStatus).toBe('completed')
      expect(useAcpUiStore.getState().prompting).toBe(prompting)
      // 回合收尾语义：prompting 由调用方（prompt 流程）负责，定居收尾不断言
      useAcpUiStore.getState().clearMessages()
    }
  })

  it('定居完成标记经 applySessionUpdate 冻结，不新增气泡', () => {
    useAcpUiStore.getState().applySessionUpdate({
      sessionUpdate: 'agent_message_chunk',
      content: { type: 'text', text: 'leak' },
    })
    const before = activeMessages().length
    useAcpUiStore.getState().applySessionUpdate({
      sessionUpdate: MONTREE_SETTLE_COMPLETE_KIND,
    })
    const messages = activeMessages()
    expect(messages).toHaveLength(before)
    expect(messages.every((m) => !m.streaming)).toBe(true)
    expect(useAcpUiStore.getState().prompting).toBe(false)
  })

  it('空线程回放重建时间线：chunks 合并为 streaming 消息，收尾一次冻结', () => {
    // 主进程 monitorOnly 放行回放 → 渲染端直接 append（streaming:true）
    useAcpUiStore.getState().applySessionUpdate({
      sessionUpdate: 'user_message_chunk',
      content: { type: 'text', text: '旧问题' },
    })
    useAcpUiStore.getState().applySessionUpdate({
      sessionUpdate: 'agent_message_chunk',
      content: { type: 'text', text: '旧回答一' },
    })
    useAcpUiStore.getState().applySessionUpdate({
      sessionUpdate: 'agent_message_chunk',
      content: { type: 'text', text: '旧回答二' },
    })
    let messages = activeMessages()
    expect(messages.map((m) => m.text)).toEqual(['旧问题', '旧回答一旧回答二'])
    expect(messages.every((m) => m.streaming)).toBe(true)
    // 现在已有实质消息（重建中），但 prompting 仍 false
    expect(selectActiveThreadHasSubstantiveMessages(useAcpUiStore.getState())).toBe(true)
    expect(useAcpUiStore.getState().prompting).toBe(false)

    // 静默超时/过期收尾：一次冻结，多轮历史不丢失
    useAcpUiStore.getState().applySessionUpdate({
      sessionUpdate: MONTREE_SETTLE_COMPLETE_KIND,
    })
    messages = activeMessages()
    expect(messages.map((m) => m.text)).toEqual(['旧问题', '旧回答一旧回答二'])
    expect(messages.every((m) => !m.streaming)).toBe(true)
    expect(useAcpUiStore.getState().prompting).toBe(false)
  })

  it('finishStreaming 仍负责 prompt 回合收尾（prompting 置 false，回归语义不变）', () => {
    useAcpUiStore.getState().appendUserMessage('hi')
    useAcpUiStore.getState().beginAgentReply()
    useAcpUiStore.setState({ prompting: true })
    useAcpUiStore.getState().finishStreaming()
    expect(useAcpUiStore.getState().prompting).toBe(false)
    expect(activeMessages().every((m) => !m.streaming)).toBe(true)
  })
})

describe('cursor load 回放清洗（user-chunk 第二道网）', () => {
  beforeEach(() => {
    const fresh = useAcpUiStore.getState().createThread()
    useAcpUiStore.setState({
      prompting: false,
      sessionId: null,
      status: 'disconnected',
      pendingMarkProposalSnapshotContents: [],
      pendingReplayUserText: null,
    })
    const thread = useAcpUiStore.getState().threads.find((t) => t.id === fresh)
    useAcpUiStore.setState({
      threads: thread ? [thread] : useAcpUiStore.getState().threads.slice(0, 1),
      activeThreadId: fresh,
    })
  })

  function activeReplayMessages() {
    const s = useAcpUiStore.getState()
    return s.threads.find((t) => t.id === s.activeThreadId)?.messages ?? []
  }

  function userChunk(text: string) {
    useAcpUiStore.getState().applySessionUpdate({
      sessionUpdate: 'user_message_chunk',
      content: { type: 'text', text },
    })
  }

  /** 真实发送前缀（bootstrap 已套稳定标记）+ turn-context + 原文 */
  function replayFixture(userText: string): string {
    const prefix = buildMontreePromptPrefix('replay-wash-fixture', {
      includeBootstrap: true,
    })
      .filter((b) => b.type === 'text')
      .map((b) => (b.type === 'text' ? b.text : ''))
      .join('\n')
    const turn = formatTurnContextBlock({
      documentChanged: false,
      activeDocument: { path: '/books/dune.epub', kind: 'epub', name: 'dune.epub' },
      reading: { percent: 42, current: '第七章' },
    })
    return `${prefix}\n${turn}\n${userText}`
  }

  it('脚手架+原文混合回放只剩原文单气泡，定居后冻结', () => {
    userChunk(replayFixture('你好'))
    const users = activeReplayMessages().filter((m) => m.role === 'user')
    expect(users).toHaveLength(1)
    expect(users[0]?.text).toBe('你好')
    expect(users[0]?.streaming).toBe(true)

    useAcpUiStore.getState().applySessionUpdate({
      sessionUpdate: MONTREE_SETTLE_COMPLETE_KIND,
    })
    const after = activeReplayMessages().filter((m) => m.role === 'user')
    expect(after.map((m) => m.text)).toEqual(['你好'])
    expect(after.every((m) => !m.streaming)).toBe(true)
  })

  it('纯脚手架回放洗空丢弃，不建气泡', () => {
    const turn = formatTurnContextBlock({
      documentChanged: true,
      activeDocument: { path: '/a.md', kind: 'markdown', name: 'a.md' },
    })
    userChunk(turn)
    expect(activeReplayMessages()).toHaveLength(0)
    expect(useAcpUiStore.getState().pendingReplayUserText).toBeNull()
  })

  it('跨 chunk 撕裂：悬垂暂缓渲染，续接后合成单气泡', () => {
    const turn = formatTurnContextBlock({
      documentChanged: false,
      activeDocument: { path: '/books/dune.epub', kind: 'epub', name: 'dune.epub' },
    })
    const cut = Math.floor(turn.length / 2)
    userChunk(`第一问\n${turn.slice(0, cut)}`)
    // 悬垂：未建消息，只缓存原文
    expect(activeReplayMessages()).toHaveLength(0)
    expect(useAcpUiStore.getState().pendingReplayUserText).not.toBeNull()

    userChunk(`${turn.slice(cut)}\n第二问`)
    const users = activeReplayMessages().filter((m) => m.role === 'user')
    expect(users).toHaveLength(1)
    expect(users[0]?.text).toBe('第一问\n\n第二问')
    expect(useAcpUiStore.getState().pendingReplayUserText).toBeNull()
  })

  it('定居收尾落定悬垂残余（截断未闭合脚手架）', () => {
    const turn = formatTurnContextBlock({
      documentChanged: false,
      activeDocument: { path: '/books/dune.epub', kind: 'epub', name: 'dune.epub' },
    })
    userChunk(`半句\n${turn.slice(0, Math.floor(turn.length / 2))}`)
    expect(activeReplayMessages()).toHaveLength(0)
    useAcpUiStore.getState().applySessionUpdate({
      sessionUpdate: MONTREE_SETTLE_COMPLETE_KIND,
    })
    const users = activeReplayMessages().filter((m) => m.role === 'user')
    expect(users.map((m) => m.text)).toEqual(['半句'])
    expect(users.every((m) => !m.streaming)).toBe(true)
    expect(useAcpUiStore.getState().pendingReplayUserText).toBeNull()
  })

  it('prompt 回合内无标记 user chunk 原样（零影响）', () => {
    useAcpUiStore.setState({ prompting: true })
    userChunk('普通追问  ')
    const users = activeReplayMessages().filter((m) => m.role === 'user')
    expect(users).toHaveLength(1)
    expect(users[0]?.text).toBe('普通追问  ')
  })

  it('本地输入含标记串原文不动（正常输入走 appendUserMessage，不洗）', () => {
    const turn = formatTurnContextBlock({
      documentChanged: false,
      activeDocument: { path: '/a.md', kind: 'markdown', name: 'a.md' },
    })
    const raw = `请解释 ${turn} 这个`
    useAcpUiStore.getState().appendUserMessage(raw)
    expect(activeReplayMessages().filter((m) => m.role === 'user')[0]?.text).toBe(raw)
  })
})
