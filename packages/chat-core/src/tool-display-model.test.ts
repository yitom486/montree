import { describe, expect, it } from 'vitest'
import type { ChatMessage } from './chat-message'
import {
  classifyToolResultKind,
  isPromotedToolResultKind,
  readableToolTitle,
  summarizeToolTarget,
  toToolDisplayModel,
  toToolDisplayState,
  toolStateLabel,
} from './tool-display-model'

function tool(overrides: Partial<ChatMessage> = {}): ChatMessage {
  return {
    id: 'tool-1',
    role: 'tool',
    text: '',
    createdAt: 1000,
    toolTitle: 'Read: /a.ts',
    toolStatus: 'completed',
    ...overrides,
  }
}

describe('toToolDisplayState', () => {
  it('审批优先于普通工具状态', () => {
    expect(
      toToolDisplayState(tool({ toolStatus: 'completed' }), { needsApproval: true }),
    ).toBe('awaiting-approval')
    expect(
      toToolDisplayState(tool({ toolStatus: 'failed' }), { needsApproval: true }),
    ).toBe('awaiting-approval')
  })

  it('映射全部已知状态（终态不看 streaming，非终态需仍在接收）', () => {
    expect(toToolDisplayState(tool({ toolStatus: 'pending', streaming: true }))).toBe('pending')
    expect(toToolDisplayState(tool({ toolStatus: 'in_progress', streaming: true }))).toBe('in-progress')
    expect(toToolDisplayState(tool({ toolStatus: 'completed' }))).toBe('completed')
    expect(toToolDisplayState(tool({ toolStatus: 'failed' }))).toBe('failed')
    expect(toToolDisplayState(tool({ toolStatus: 'cancelled' }))).toBe('cancelled')
  })

  it('缺失状态保守兜底：流式算接收中，静止算未知', () => {
    expect(toToolDisplayState(tool({ toolStatus: undefined, streaming: true }))).toBe(
      'in-progress',
    )
    expect(toToolDisplayState(tool({ toolStatus: undefined, streaming: false }))).toBe(
      'unknown',
    )
    expect(toToolDisplayState(tool({ toolStatus: 'weird-status', streaming: true }))).toBe(
      'in-progress',
    )
    expect(
      toToolDisplayState(tool({ toolStatus: 'weird-status', streaming: false })),
    ).toBe('unknown')
  })

  it('落定的非终态一律未知：pending/in_progress 静止不再显示等待/执行中', () => {
    // store 收尾不再把残留补成 completed；展示层是第二道防线
    expect(toToolDisplayState(tool({ toolStatus: 'pending', streaming: false }))).toBe(
      'unknown',
    )
    expect(toToolDisplayState(tool({ toolStatus: 'in_progress', streaming: false }))).toBe(
      'unknown',
    )
    expect(toToolDisplayState(tool({ toolStatus: 'pending', streaming: true }))).toBe(
      'pending',
    )
    expect(toToolDisplayState(tool({ toolStatus: 'in_progress', streaming: true }))).toBe(
      'in-progress',
    )
  })

  it('取消与未知绝不显示成成功', () => {
    for (const state of [
      toToolDisplayState(tool({ toolStatus: 'cancelled' })),
      toToolDisplayState(tool({ toolStatus: undefined })),
      toToolDisplayState(tool({ toolStatus: 'zzz' })),
    ]) {
      expect(state).not.toBe('completed')
      expect(toolStateLabel(state)).not.toContain('完成')
    }
    expect(toolStateLabel('cancelled')).toBe('已取消')
    expect(toolStateLabel('unknown')).toBe('状态未知')
  })
})

describe('readableToolTitle', () => {
  it('已知工具映射中文能力标题', () => {
    expect(readableToolTitle('mcp.montree.montree_read')).toBe('读取文档')
    expect(readableToolTitle('montree_cross_reference')).toBe('跨章引证')
    expect(readableToolTitle('montree_generate_diagram')).toBe('图表推演')
  })

  it('未知工具保留原名，空标题回退通用名', () => {
    expect(readableToolTitle('some_future_tool_xyz')).toBe('some_future_tool_xyz')
    expect(readableToolTitle('')).toBe('工具调用')
    expect(readableToolTitle(undefined)).toBe('工具调用')
  })

  it('montree_present 映射中文标题并分类提升', () => {
    expect(readableToolTitle('mcp.montree.montree_present')).toBe('展示呈现')
  })
})

describe('summarizeToolTarget', () => {
  it('只用已有文件元数据，不编造目标', () => {
    expect(
      summarizeToolTarget(tool({ toolDiffs: [{ path: '/w/a.ts', oldText: '', newText: '' }] })),
    ).toBe('a.ts')
    expect(
      summarizeToolTarget(
        tool({ toolDiffs: [], toolLocations: [{ path: '/w/a.ts' }, { path: '/w/b.ts' }] }),
      ),
    ).toBe('2 个文件')
    expect(summarizeToolTarget(tool({ toolDiffs: [], toolLocations: [] }))).toBeNull()
  })
})

describe('classifyToolResultKind', () => {
  it('读取 present schema 不改成展示工具或提升为结果卡', () => {
    const title = 'Read: C:/mcp/montree/montree_present.json'
    expect(readableToolTitle(title)).toBe('读取文件')
    expect(classifyToolResultKind(tool({ toolTitle: title, toolContentText: '{"name":"montree_present","chapters":{},"kind":{"enum":["html-artifact"]}}' }))).toBe('text')
  })
  it('分类富业务结果与普通文本', () => {
    expect(
      classifyToolResultKind(
        tool({ toolTitle: 'montree_generate_diagram', toolContentText: '{"mermaidCode":"x"}' }),
      ),
    ).toBe('diagram')
    expect(
      classifyToolResultKind(
        tool({ toolTitle: 'Read', toolContentText: 'const x = 1', toolDiffs: [] }),
      ),
    ).toBe('text')
    expect(classifyToolResultKind(tool({ toolTitle: 'Read', text: 'Read' }))).toBe('none')
  })

  it('present 结果优先 enrich 挂载，其次标题门限，并提升', () => {
    expect(
      classifyToolResultKind(
        tool({
          toolTitle: 'montree_present',
          toolContentText: '{"kind":"chapter-comparison","schemaVersion":1}',
          text: '{"kind":"chapter-comparison","schemaVersion":1}',
        }),
      ),
    ).toBe('chapter-comparison')
    expect(
      classifyToolResultKind(
        tool({
          toolTitle: 'montree_present',
          toolContentText: '{"kind":"html-artifact","schemaVersion":1}',
          text: '{"kind":"html-artifact","schemaVersion":1}',
        }),
      ),
    ).toBe('html-artifact')
    expect(isPromotedToolResultKind('chapter-comparison')).toBe(true)
    expect(isPromotedToolResultKind('html-artifact')).toBe(true)
  })
})

describe('toToolDisplayModel', () => {
  it('通用 MCP 标题使用真实工具名、图形类型与主题，缺失时不猜测', () => {
    expect(toToolDisplayModel(tool({ toolTitle: 'Call Mcp Tool', toolName: 'montree_present',
      toolInputSummary: { kind: 'preset', preset: 'diagram', diagramType: 'sequence', title: '登录过程' },
    }))).toMatchObject({ title: '绘制时序图', targetSummary: '登录过程', activityLabel: '正在绘制时序图：登录过程' })
    expect(toToolDisplayModel(tool({ toolTitle: 'Call Mcp Tool' }))).toMatchObject({ title: '工具调用', targetSummary: null })
    expect(toToolDisplayModel(tool({ toolTitle: 'Call Mcp Tool', toolName: 'montree_read' })).title).toBe('读取文档')
    expect(toToolDisplayModel(tool({ toolTitle: 'Montree Read', toolName: 'montree_read' })).title).toBe('读取文档')
    expect(toToolDisplayModel(tool({ toolTitle: 'Call Mcp Tool', toolName: 'montree_diagram_guide',
      toolInputSummary: { diagramType: 'sequence' },
    })).title).not.toContain('绘制')
  })
  it('失败携带业务解释，成功不带错误', () => {
    const failed = toToolDisplayModel(
      tool({ toolStatus: 'failed', toolContentText: '未知工具 xxx' }),
    )
    expect(failed.state).toBe('failed')
    expect(failed.errorHeadline).toBeTruthy()
    expect(failed.errorBody).toBeTruthy()
    const ok = toToolDisplayModel(tool({ toolStatus: 'completed' }))
    expect(ok.errorHeadline).toBeNull()
    expect(ok.errorBody).toBeNull()
  })

  it('时长只用可证实数据，缺失时省略', () => {
    expect(
      toToolDisplayModel(tool({ createdAt: 1000, updatedAt: 2500 })).durationMs,
    ).toBe(1500)
    expect(toToolDisplayModel(tool({ createdAt: 1000 })).durationMs).toBeNull()
    expect(
      toToolDisplayModel(tool({ createdAt: 2000, updatedAt: 1000 })).durationMs,
    ).toBeNull()
  })

  it('不修改输入消息', () => {
    const msg = tool({ toolStatus: 'failed', toolContentText: 'boom' })
    const frozen = JSON.parse(JSON.stringify(msg))
    toToolDisplayModel(msg)
    expect(msg).toEqual(frozen)
  })
})
