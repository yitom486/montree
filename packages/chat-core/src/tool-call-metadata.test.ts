import { describe, expect, it } from 'vitest'
import { parseToolCallMetadata } from './tool-call-metadata'

describe('ACP 工具展示元数据', () => {
  it('解开 agy MCP 包装和字符串参数，只保留展示字段', () => {
    expect(parseToolCallMetadata({ name: 'call_mcp_tool', rawInput: {
      tool_name: 'montree_present', arguments: JSON.stringify({
        kind: 'preset', preset: 'diagram', diagramType: 'sequence', title: '登录过程',
        source: 'large source', token: 'private', nodes: [{ id: 'a' }],
      }),
    } })).toEqual({ name: 'montree_present', inputSummary: {
      kind: 'preset', preset: 'diagram', diagramType: 'sequence', title: '登录过程',
    } })
  })

  it('坏 JSON、空参数和超长输入不阻断事件，摘要有上限', () => {
    for (const rawInput of ['{', ' '.repeat(131073), null, []]) {
      expect(parseToolCallMetadata({ name: 'montree_read', rawInput })).toEqual({ name: 'montree_read' })
    }
    expect(parseToolCallMetadata({ rawInput: { title: 'x'.repeat(500), password: 'private' } }).inputSummary)
      .toEqual({ title: 'x'.repeat(200) })
  })

  it('普通工具的 name 参数不误判为 MCP 包装', () => {
    expect(parseToolCallMetadata({ name: 'custom_tool', rawInput: { name: 'another', arguments: { title: 'nested' }, title: 'outer' } }))
      .toEqual({ name: 'custom_tool', inputSummary: { title: 'outer' } })
  })
})
