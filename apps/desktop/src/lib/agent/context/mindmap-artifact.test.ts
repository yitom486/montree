// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest'
import { buildDiagramHtml } from './present-diagram'
import { escapeMindmapLabel, parseMindmapArtifactHtml } from './mindmap-artifact'

const base = {
  diagramType: 'mindmap',
  title: 'session/update 14 种通知 → 前端 UI 组件映射',
  nodes: [
    { id: 'root', label: 'session/update 通知', details: 'ACP 服务端推送的会话更新' },
    {
      id: 'content',
      label: '内容流 (3 种)',
      details:
        '【agent_message_chunk】Agent 正文 -> 流式 Markdown 气泡\n【agent_thought_chunk】思考过程 -> 可折叠灰字区\n【user_message_chunk】回放用户消息 -> 用户气泡',
    },
    { id: 'tool', label: '工具活动 (2 种)', details: '【tool_call】开始\n【tool_call_update】进度与结果' },
    { id: 'plan', label: '计划与命令 (2 种)', details: '【plan】计划更新\n【available_commands_update】命令更新' },
    { id: 'state', label: '会话状态 (3 种)', details: '【current_mode_update】模式\n【usage_update】用量' },
  ],
  edges: [
    { from: 'root', to: 'content' },
    { from: 'root', to: 'tool' },
    { from: 'root', to: 'plan' },
    { from: 'root', to: 'state' },
  ],
}

/** 还原 bb6b70b 之前的快照：没有 data-from/data-to 与折叠按钮，只留贝塞尔连线 */
function legacyHtml(html: string): string {
  return html
    .replace(' data-diagram-type="mindmap"', '')
    .replace(/ data-from="[^"]*" data-to="[^"]*"/g, '')
    .replace(/<g class="mindmap-toggle"[\s\S]*?<\/g>/g, '')
    .replaceAll('mindmap-toggle', 'legacy-toggle')
}

describe('parseMindmapArtifactHtml', () => {
  it('从图解快照还原 Markmap 大纲、标题与节点数', () => {
    const artifact = parseMindmapArtifactHtml(buildDiagramHtml(base))
    expect(artifact).not.toBeNull()
    expect(artifact!.title).toBe(base.title)
    expect(artifact!.nodeCount).toBe(5)
    expect(artifact!.source).toContain('# session/update 通知')
    expect(artifact!.source).toContain('- 内容流 (3 种)')
    expect(artifact!.source).toContain('- 工具活动 (2 种)')
    // 兄弟顺序按 edges 顺序输出
    expect(artifact!.source.indexOf('- 内容流')).toBeLessThan(artifact!.source.indexOf('- 工具活动'))
  })

  it('把详情里的清单行展开为子节点，并返回展开数量', () => {
    const artifact = parseMindmapArtifactHtml(buildDiagramHtml(base))
    expect(artifact!.detailNodeCount).toBe(9)
    expect(artifact!.source).toContain('  - 【agent\\_message\\_chunk】Agent 正文 -> 流式 Markdown 气泡')
    expect(artifact!.source).toContain('  - 【tool\\_call】开始')
    // 节点自身详情前缀「标签：」不进入大纲
    expect(artifact!.source).not.toContain('内容流 (3 种)：')
  })

  it('单行详情或长段落不展开为子节点', () => {
    const single = parseMindmapArtifactHtml(
      buildDiagramHtml({
        ...base,
        nodes: base.nodes.map((node) => ({ ...node, details: node.id === 'root' ? '只有一行说明' : undefined })),
      }),
    )
    expect(single!.detailNodeCount).toBe(0)

    const long = parseMindmapArtifactHtml(
      buildDiagramHtml({
        ...base,
        nodes: base.nodes.map((node) => ({
          ...node,
          details: node.id === 'content' ? `第一行\n${'很长的说明'.repeat(20)}` : undefined,
        })),
      }),
    )
    expect(long!.detailNodeCount).toBe(0)
  })

  it('详情清单超过上限时截断，不整段丢弃', () => {
    const artifact = parseMindmapArtifactHtml(
      buildDiagramHtml({
        ...base,
        nodes: base.nodes.map((node) => ({
          ...node,
          details:
            node.id === 'content'
              ? Array.from({ length: 12 }, (_, i) => `【条目 ${i + 1}】说明`).join('\n')
              : undefined,
        })),
      }),
    )
    expect(artifact!.detailNodeCount).toBe(10)
    expect(artifact!.source).toContain('【条目 10】说明')
    expect(artifact!.source).not.toContain('【条目 11】说明')
  })

  it('旧快照没有 data-from/data-to 时按贝塞尔端点补全父子关系', () => {
    const artifact = parseMindmapArtifactHtml(legacyHtml(buildDiagramHtml(base)))
    expect(artifact).not.toBeNull()
    expect(artifact!.nodeCount).toBe(5)
    expect(artifact!.source).toContain('- 内容流 (3 种)')
  })

  it('非思维导图与普通 HTML Artifact 不误判', () => {
    const flowchart = buildDiagramHtml({
      diagramType: 'flowchart',
      title: '流程',
      nodes: [
        { id: 'start', label: '开始', kind: 'start', layer: 0 },
        { id: 'end', label: '结束', kind: 'end', layer: 1 },
      ],
      edges: [{ from: 'start', to: 'end' }],
    })
    expect(parseMindmapArtifactHtml(flowchart)).toBeNull()
    expect(parseMindmapArtifactHtml('<button>按</button>')).toBeNull()
    expect(parseMindmapArtifactHtml('')).toBeNull()
  })

  it('标签按纯文本转义，不能注入 Markdown 链接或 HTML', () => {
    const artifact = parseMindmapArtifactHtml(
      buildDiagramHtml({
        ...base,
        nodes: [
          { id: 'root', label: '根 [链接](https://example.com) <b>粗</b>' },
          { id: 'child', label: '- 看起来像列表' },
        ],
        edges: [{ from: 'root', to: 'child' }],
      }),
    )
    expect(artifact!.source).toContain('# 根 \\[链接\\](https://example.com) \\<b>粗\\</b>')
    expect(artifact!.source).toContain('- \\- 看起来像列表')
  })
})

describe('escapeMindmapLabel', () => {
  it('压缩空白并转义 Markdown 控制字符', () => {
    expect(escapeMindmapLabel('  a\n b  ')).toBe('a b')
    expect(escapeMindmapLabel('*重点* `代码` [链接]')).toBe('\\*重点\\* \\`代码\\` \\[链接\\]')
    expect(escapeMindmapLabel('# 标题')).toBe('\\# 标题')
    expect(escapeMindmapLabel('#不是标题')).toBe('#不是标题')
  })
})
