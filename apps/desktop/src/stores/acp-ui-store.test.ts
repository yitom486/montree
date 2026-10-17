// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from 'vitest'
import { MONTREE_SETTLE_COMPLETE_KIND } from '@yitom/contracts'
import { toToolDisplayModel } from '@yitom/chat-core'
import { buildMontreePromptPrefix } from '@/lib/agent/context/build-prompt-prefix'
import { formatTurnContextBlock } from '@/lib/agent/context/turn-context'
import {
  selectActiveThreadHasSubstantiveMessages,
  useAcpUiStore,
} from '@/stores/acp-ui-store'

describe('acp-ui-store history + plan', () => {
  it('agy 实际消息形状保留思考、解开 MCP 工具参数且稀疏完成不丢主题', () => {
    const store = useAcpUiStore.getState()
    store.appendUserMessage('画登录时序图')
    store.beginAgentReply()
    store.applySessionUpdate({ sessionUpdate: 'agent_thought_chunk', content: { type: 'text', text: '分析登录步骤。' } })
    store.applySessionUpdate({ sessionUpdate: 'tool_call', toolCallId: 'agy-diagram', name: 'call_mcp_tool', title: 'Call Mcp Tool', status: 'in_progress',
      rawInput: { tool_name: 'montree_present', arguments: { kind: 'preset', preset: 'diagram', diagramType: 'sequence', title: '登录过程' } },
    })
    store.applySessionUpdate({ sessionUpdate: 'tool_call_update', toolCallId: 'agy-diagram', status: 'completed' })
    const active = useAcpUiStore.getState()
    const messages = active.threads.find(t => t.id === active.activeThreadId)!.messages
    expect(messages.find(m => m.role === 'thought')).toMatchObject({ text: '分析登录步骤。', streaming: false })
    expect(toToolDisplayModel(messages.find(m => m.toolCallId === 'agy-diagram')!))
      .toMatchObject({ title: '绘制时序图', targetSummary: '登录过程', state: 'completed' })
  })

  it('审批入口也保留工具名与参数摘要', () => {
    const store = useAcpUiStore.getState()
    store.ingestPermissionRequest({ requestId: 56, summary: '允许绘图', options: [], toolCallId: 'agy-permission',
      toolCall: { name: 'montree_generate_diagram', rawInput: { diagramType: 'flowchart', title: '审批流程' } },
    })
    const active = useAcpUiStore.getState()
    const message = active.threads.find(t => t.id === active.activeThreadId)!.messages.find(m => m.toolCallId === 'agy-permission')!
    expect(toToolDisplayModel(message)).toMatchObject({ title: '绘制流程图', targetSummary: '审批流程' })
  })
  it.each(['content', 'structuredContent'])('接收 codex-acp rawOutput.result.%s 并生成交互卡数据', (field) => {
    const store = useAcpUiStore.getState()
    const payload = { schemaVersion: 1, kind: 'react-artifact', id: 'raw-result', title: '交互组件', source: 'export default ()=> <button>点击</button>' }
    store.applySessionUpdate({ sessionUpdate: 'tool_call', toolCallId: 'raw-tool', title: 'mcp.montree.montree_present', status: 'in_progress' })
    store.applySessionUpdate({ sessionUpdate: 'tool_call_update', toolCallId: 'raw-tool', status: 'completed', content: [], rawOutput: { result: field === 'content' ? { content: [{ type: 'text', text: JSON.stringify(payload) }] } : { structuredContent: payload }, error: null } })
    const state = useAcpUiStore.getState()
    const tools = state.threads.find((t) => t.id === state.activeThreadId)!.messages.filter((m) => m.toolCallId === 'raw-tool')
    expect(tools).toHaveLength(1)
    expect(tools[0]!.presentResult).toEqual(payload)
    expect(tools[0]!.streaming).toBe(false)
  })

  it('rawOutput 不绕过呈现协议校验，错误结果不生成组件', () => {
    useAcpUiStore.getState().applySessionUpdate({ sessionUpdate: 'tool_call', toolCallId: 'bad-raw', title: 'montree_present', status: 'completed', rawOutput: { result: { structuredContent: { schemaVersion: 2, kind: 'react-artifact' } }, error: null } })
    const state = useAcpUiStore.getState()
    const tool = state.threads.find((t) => t.id === state.activeThreadId)!.messages.find((m) => m.toolCallId === 'bad-raw')!
    expect(tool.presentResult).toBeUndefined()
    expect(tool.toolContentText).toContain('schemaVersion')
  })

  it('未知 kind 不进消息（留痕由 acpDevLog 负责，不抛错）', () => {
    const store = useAcpUiStore.getState()
    store.appendUserMessage('hi')
    const threadId = useAcpUiStore.getState().activeThreadId
    const count = () => useAcpUiStore.getState().threads.find((t) => t.id === threadId)!.messages.length
    const before = count()
    store.applySessionUpdate({ sessionUpdate: 'usage_update', used: 1, size: 100 })
    store.applySessionUpdate({ sessionUpdate: 'available_commands_update', availableCommands: [] })
    store.applySessionUpdate({ sessionUpdate: 'future_kind', content: { type: 'text', text: 'x' } })
    // 有文本的未知 kind 按旧语义走 agent 文本（非静默），其余不新增消息
    expect(count()).toBe(before + 1)
  })

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

  it('迟到 agent 文本 chunk 在收尾后到达：合入正文但不再点亮流式', () => {
    // 复现：prompt 结果（end_turn）先于文本通知到达，主线程收尾冻结后，
    // 迟到文本另起 streaming 气泡且永不落定（光环常亮）。修：冻结标记。
    const msgs = () => {
      const s = useAcpUiStore.getState()
      return s.threads.find((t) => t.id === s.activeThreadId)?.messages ?? []
    }
    const store = useAcpUiStore.getState()
    store.appendUserMessage('hi')
    store.beginAgentReply()
    expect(useAcpUiStore.getState().turnSettled).toBe(false)
    store.applySessionUpdate({
      sessionUpdate: 'agent_message_chunk',
      content: { type: 'text', text: '首段' },
    })
    // prompt 结果先到：收尾冻结（prompting 置 false，残留 streaming 清零）
    store.finishStreaming()
    expect(useAcpUiStore.getState().turnSettled).toBe(true)
    expect(msgs().every((m) => !m.streaming)).toBe(true)
    // 文本通知迟到：正文必须合入（不丢字），但不再点亮流式
    store.applySessionUpdate({
      sessionUpdate: 'agent_message_chunk',
      content: { type: 'text', text: '尾段' },
    })
    const messages = msgs()
    expect(messages.map((m) => m.text).join('')).toContain('首段尾段')
    expect(messages.every((m) => !m.streaming)).toBe(true)
  })

  it('回放重建不受冻结标记影响：无 begin 即 streaming，收尾统一冻结', () => {
    // 定居回放分批到达（freezeSettledStreaming 故意不碰标记），中间态保持
    // streaming；与“迟到 chunk”场景的区分点是有无 preceding finishStreaming。
    const msgs = () => {
      const s = useAcpUiStore.getState()
      return s.threads.find((t) => t.id === s.activeThreadId)?.messages ?? []
    }
    useAcpUiStore.getState().applySessionUpdate({
      sessionUpdate: 'agent_message_chunk',
      content: { type: 'text', text: '旧回答' },
    })
    expect(msgs().some((m) => m.role === 'agent' && m.streaming)).toBe(true)
    useAcpUiStore.getState().finishStreaming()
    expect(msgs().every((m) => !m.streaming)).toBe(true)
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
      // 收尾只冻结 streaming，不推断执行结果：残留 in_progress 保留原状态，
      // 由展示层标“状态未知”，绝不补成 completed
      expect(messages.find((m) => m.role === 'tool')?.toolStatus).toBe('in_progress')
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

  it('收尾保留明确终态：completed/failed/cancelled 不动，pending 随回合取消', () => {
    const store = useAcpUiStore.getState()
    store.applySessionUpdate({ sessionUpdate: 'tool_call', toolCallId: 'tc-ok', title: 'ok', status: 'completed' })
    store.applySessionUpdate({ sessionUpdate: 'tool_call', toolCallId: 'tc-bad', title: 'bad', status: 'failed' })
    store.applySessionUpdate({ sessionUpdate: 'tool_call', toolCallId: 'tc-can', title: 'can', status: 'cancelled' })
    store.applySessionUpdate({ sessionUpdate: 'tool_call', toolCallId: 'tc-wait', title: 'wait', status: 'pending' })
    store.applySessionUpdate({ sessionUpdate: 'tool_call', toolCallId: 'tc-run', title: 'run', status: 'in_progress' })
    store.finishStreaming()
    const byId = new Map(activeMessages().map((m) => [m.toolCallId, m]))
    expect(byId.get('tc-ok')?.toolStatus).toBe('completed')
    expect(byId.get('tc-bad')?.toolStatus).toBe('failed')
    expect(byId.get('tc-can')?.toolStatus).toBe('cancelled')
    expect(byId.get('tc-wait')?.toolStatus).toBe('cancelled')
    // in_progress 残留不断言成功：保留原状态，展示层标“状态未知”
    expect(byId.get('tc-run')?.toolStatus).toBe('in_progress')
    expect(byId.get('tc-run')?.streaming).toBe(false)
  })

  it('cancelActiveTools 只标仍在进行的调用，已落定不动', () => {
    const store = useAcpUiStore.getState()
    store.applySessionUpdate({ sessionUpdate: 'tool_call', toolCallId: 'tc-live', title: 'live', status: 'in_progress' })
    store.applySessionUpdate({ sessionUpdate: 'tool_call', toolCallId: 'tc-done', title: 'done', status: 'completed' })
    store.cancelActiveTools()
    const byId = new Map(activeMessages().map((m) => [m.toolCallId, m]))
    expect(byId.get('tc-live')?.toolStatus).toBe('cancelled')
    expect(byId.get('tc-done')?.toolStatus).toBe('completed')
  })

  it('同运行时切线程保留 pending（会话级审批仍需响应）', () => {
    const store = useAcpUiStore.getState()
    const first = store.activeThreadId
    store.setPendingPermission({
      requestId: 9,
      summary: '删文件',
      options: [{ optionId: 'allow', name: '允许', kind: 'allow_once' }],
      toolCallId: 'tc-old',
    })
    const second = store.createThread()
    expect(second).not.toBe(first)
    store.switchThread(second)
    expect(useAcpUiStore.getState().pendingPermission?.requestId).toBe(9)
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

describe('usage_update 落库（线程级纯记录）', () => {
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

  function activeThread() {
    const s = useAcpUiStore.getState()
    return s.threads.find((t) => t.id === s.activeThreadId)!
  }

  it('usage_update 写入 used/size/cost 与 _meta.thinkingTokens，不新建消息', () => {
    useAcpUiStore.getState().appendUserMessage('hi')
    const before = activeThread().messages.length
    useAcpUiStore.getState().applySessionUpdate({
      sessionUpdate: 'usage_update',
      used: 8281,
      size: 262144,
      cost: { amount: 0, currency: 'USD' },
      _meta: { thinkingTokens: 20 },
    })
    const thread = activeThread()
    expect(thread.messages).toHaveLength(before)
    expect(thread.usage).toEqual({
      used: 8281,
      size: 262144,
      cost: { amount: 0, currency: 'USD' },
      thinkingTokens: 20,
    })
  })

  it('无 _meta 时不写 thinkingTokens，不新建消息', () => {
    useAcpUiStore.getState().appendUserMessage('hi')
    const before = activeThread().messages.length
    useAcpUiStore.getState().applySessionUpdate({
      sessionUpdate: 'usage_update',
      used: 100,
      size: 1000,
    })
    const thread = activeThread()
    expect(thread.messages).toHaveLength(before)
    expect(thread.usage).toEqual({ used: 100, size: 1000 })
    expect(thread.usage?.thinkingTokens).toBeUndefined()
  })
})

describe('SDK 联合分发（plan_removed/新成员/未知兼容）', () => {
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

  function activeThread() {
    const s = useAcpUiStore.getState()
    return s.threads.find((t) => t.id === s.activeThreadId)!
  }

  it('plan_removed 删掉计划卡', () => {
    const store = useAcpUiStore.getState()
    store.appendUserMessage('hi')
    store.applySessionUpdate({ sessionUpdate: 'plan', entries: [{ content: '做', status: 'in_progress' }] })
    expect(activeThread().messages.some((m) => m.role === 'plan')).toBe(true)
    store.applySessionUpdate({ sessionUpdate: 'plan_removed', planId: 'p1' })
    expect(activeThread().messages.some((m) => m.role === 'plan')).toBe(false)
  })

  it('session_message 系列转 agent 文本', () => {
    const store = useAcpUiStore.getState()
    store.appendUserMessage('hi')
    store.applySessionUpdate({ sessionUpdate: 'session_message', content: [{ type: 'text', text: '子会话说' }] })
    store.applySessionUpdate({ sessionUpdate: 'session_message_chunk', content: { type: 'text', text: '续' } })
    const texts = activeThread().messages.filter((m) => m.role === 'agent').map((m) => m.text).join('')
    expect(texts).toContain('子会话说')
    expect(texts).toContain('续')
  })

  it('notice/compaction/subagent/mode/session_info 明确丢弃不进历史', () => {
    const store = useAcpUiStore.getState()
    store.appendUserMessage('hi')
    const before = activeThread().messages.length
    store.applySessionUpdate({ sessionUpdate: 'notice', title: 't' })
    store.applySessionUpdate({ sessionUpdate: 'compaction_update', status: 'completed' })
    store.applySessionUpdate({ sessionUpdate: 'subagent_update', sessionId: 's1' })
    store.applySessionUpdate({ sessionUpdate: 'current_mode_update', currentModeId: 'm' })
    store.applySessionUpdate({ sessionUpdate: 'session_info_update', title: 't' })
    store.applySessionUpdate({ sessionUpdate: 'available_commands_update', availableCommands: [] })
    expect(activeThread().messages).toHaveLength(before)
  })

  it('compaction_summary_chunk 不再污染 agent 正文', () => {
    const store = useAcpUiStore.getState()
    store.appendUserMessage('hi')
    const before = activeThread().messages.length
    store.applySessionUpdate({ sessionUpdate: 'compaction_summary_chunk', content: { type: 'text', text: '摘要' } })
    expect(activeThread().messages).toHaveLength(before)
  })

  it('未来未知 kind 有文本仍走 agent（前向兼容）', () => {
    const store = useAcpUiStore.getState()
    store.appendUserMessage('hi')
    store.applySessionUpdate({ sessionUpdate: 'future_kind_xyz', content: 't' })
    expect(activeThread().messages.some((m) => m.role === 'agent' && m.text.includes('t'))).toBe(true)
  })
})

describe('会话 prompt 模式（native/compatibility）', () => {
  it('缺省兼容：写入 native 后断开回落', () => {
    expect(useAcpUiStore.getState().sessionPromptMode).toBe('compatibility')
    useAcpUiStore.getState().setPromptMode('native')
    expect(useAcpUiStore.getState().sessionPromptMode).toBe('native')
    // 断开清空（沿用 setStatus 现有清位语义）
    useAcpUiStore.getState().setStatus('disconnected')
    expect(useAcpUiStore.getState().sessionPromptMode).toBe('compatibility')
    expect(useAcpUiStore.getState().sessionPromptModeReason).toBeUndefined()
  })

  it('setPromptMode 同值不重设（遵 zustand action 规范）', () => {
    useAcpUiStore.getState().setPromptMode('native', 'new-session')
    const before = useAcpUiStore.getState()
    useAcpUiStore.getState().setPromptMode('native', 'new-session')
    expect(useAcpUiStore.getState()).toBe(before)
  })
})

describe('失败回合回滚（额度/网络报错不粘气泡）', () => {
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

  it('prompt 失败回滚掉本回合 agent 文本，工具记录与用户消息保留', () => {
    const store = useAcpUiStore.getState()
    // 历史回合先落定一条正常回答（回滚不得误删）
    store.appendUserMessage('old q')
    store.beginAgentReply()
    store.applySessionUpdate({
      sessionUpdate: 'agent_message_chunk',
      content: [{ type: 'text', text: 'old a' }],
    })
    store.finishStreaming()
    // 首回合落定：旧回答在位（prune 只在后续回合压缩，见下）
    expect(
      useAcpUiStore
        .getState()
        .threads.find((t) => t.id === useAcpUiStore.getState().activeThreadId)!
        .messages.map((m) => m.role),
    ).toEqual(['user', 'agent'])
    const keepIds = useAcpUiStore
      .getState()
      .threads.find((t) => t.id === useAcpUiStore.getState().activeThreadId)!
      .messages.map((m) => m.id)
    // 新回合：用户提问 → 占位 → 流进来额度报错文本 → 工具执行记录 → prompt 返回失败
    store.appendUserMessage('new q')
    store.beginAgentReply()
    store.applySessionUpdate({
      sessionUpdate: 'agent_message_chunk',
      content: [{ type: 'text', text: 'Individual quota reached. Please upgrade.' }],
    })
    store.applySessionUpdate({
      sessionUpdate: 'tool_call',
      toolCallId: 'tk-1',
      title: '搜索文档',
      status: 'completed',
      content: [{ type: 'text', text: 'done' }],
    })
    store.finishStreaming()
    store.rollbackFailedTurn(keepIds)
    const messages = useAcpUiStore
      .getState()
      .threads.find((t) => t.id === useAcpUiStore.getState().activeThreadId)!.messages
    // prune 只压缩当前回合内中间气泡，旧回合真实回答保留；关键是：
    // 额度报错文本消失、新回合结构正确、工具记录保留
    expect(messages.map((m) => m.role)).toEqual(['user', 'agent', 'user', 'tool'])
    expect(messages.map((m) => m.text)).toEqual(['old q', 'old a', 'new q', 'done'])
    expect(messages.some((m) => m.text.includes('quota'))).toBe(false)
    expect(messages.find((m) => m.toolCallId === 'tk-1')?.toolStatus).toBe('completed')
  })
})

describe('C1 协议适配分发（同一事件只应用一次、各状态不串位）', () => {
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

  function activeThread() {
    const s = useAcpUiStore.getState()
    return s.threads.find((t) => t.id === s.activeThreadId)!
  }

  it('一条 update 只落一次：正文、工具、计划、usage 各归其位', () => {
    const store = useAcpUiStore.getState()
    store.appendUserMessage('跑一遍')
    store.beginAgentReply()

    store.applySessionUpdate({
      sessionUpdate: 'agent_message_chunk',
      content: [{ type: 'text', text: '唯一正文' }],
    })
    expect(activeThread().messages.filter((m) => m.role === 'agent')).toHaveLength(1)
    expect(activeThread().messages.filter((m) => m.role === 'agent')[0]?.text).toBe('唯一正文')

    store.applySessionUpdate({
      sessionUpdate: 'tool_call',
      toolCallId: 'c1-tool',
      title: '读文件',
      status: 'in_progress',
    })
    expect(activeThread().messages.filter((m) => m.toolCallId === 'c1-tool')).toHaveLength(1)

    store.applySessionUpdate({
      sessionUpdate: 'plan',
      entries: [{ content: '第一步', status: 'in_progress' }],
    })
    expect(activeThread().messages.filter((m) => m.role === 'plan')).toHaveLength(1)

    const beforeUsage = activeThread().messages.length
    store.applySessionUpdate({
      sessionUpdate: 'usage_update',
      used: 12,
      size: 100,
    })
    // usage 是线程字段，不新增消息、不改正文
    expect(activeThread().messages).toHaveLength(beforeUsage)
    expect(activeThread().usage).toEqual({ used: 12, size: 100 })
    expect(activeThread().messages.find((m) => m.role === 'agent')?.text).toBe('唯一正文')
    expect(activeThread().messages.find((m) => m.toolCallId === 'c1-tool')?.text ?? '').not.toContain(
      '第一步',
    )
  })

  it('工具内容分块只进工具气泡，不进正文/计划', () => {
    const store = useAcpUiStore.getState()
    store.appendUserMessage('跑一遍')
    store.beginAgentReply()
    store.applySessionUpdate({
      sessionUpdate: 'tool_call',
      toolCallId: 'c1-chunk',
      title: '读文件',
      status: 'in_progress',
    })
    store.applySessionUpdate({
      sessionUpdate: 'tool_call_content_chunk',
      toolCallId: 'c1-chunk',
      content: { type: 'text', text: '分块正文' },
    })
    const messages = activeThread().messages
    expect(messages.filter((m) => m.role === 'tool' && m.toolCallId === 'c1-chunk')).toHaveLength(1)
    expect(messages.find((m) => m.toolCallId === 'c1-chunk')?.text).toContain('分块正文')
    expect(messages.filter((m) => m.role === 'agent').map((m) => m.text).join('')).not.toContain(
      '分块正文',
    )
  })

  it('空 camelCase id 的更新不误写 snake_case 指向的已有工具', () => {
    const store = useAcpUiStore.getState()
    store.appendUserMessage('继续处理')
    store.beginAgentReply()
    store.applySessionUpdate({ sessionUpdate: 'agent_message_chunk', content: '处理中' })
    store.applySessionUpdate({ sessionUpdate: 'tool_call', toolCallId: 'existing-tool', title: '原工具', status: 'in_progress' })

    store.applySessionUpdate({ sessionUpdate: 'tool_call_update', toolCallId: '', tool_call_id: 'existing-tool', title: '不应覆盖', status: 'completed' })
    const tools = activeThread().messages.filter((message) => message.role === 'tool')
    expect(tools).toHaveLength(1)
    expect(tools[0]).toMatchObject({ toolCallId: 'existing-tool', toolTitle: '原工具', toolStatus: 'in_progress' })
    expect(activeThread().messages.find((message) => message.role === 'agent')?.text).toBe('处理中')
  })
})
