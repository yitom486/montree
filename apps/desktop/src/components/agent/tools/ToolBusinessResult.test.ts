import { describe, expect, it } from 'vitest'
import { hasBusinessResult } from './ToolBusinessResult'

describe('hasBusinessResult', () => {
  it('有效图表 payload 可渲染', () => {
    expect(
      hasBusinessResult(
        JSON.stringify({
          diagramId: 'd1',
          diagramType: 'flowchart',
          title: '推演',
          mermaidCode: 'graph TD; A-->B',
        }),
        'montree_generate_diagram',
      ),
    ).toBe(true)
  })

  it('标题命中但 JSON 解析失败时回退普通文本，不留空折叠区', () => {
    expect(hasBusinessResult('not-json-at-all', 'montree_generate_diagram')).toBe(false)
    expect(hasBusinessResult('{"hits":3}', 'montree_inspect_content')).toBe(false)
  })

  it('普通文本无业务结果', () => {
    expect(hasBusinessResult('const x = 1', 'Read: /a.ts')).toBe(false)
    expect(hasBusinessResult('', '工具调用')).toBe(false)
  })

  it('普通 execute 脚本返回不含有效文本的 hits 时不被误判为内容审计卡片', () => {
    // 之前引发空白卡片的场景：execute 输出带 hits 但无 text/content
    expect(
      hasBusinessResult(
        JSON.stringify({ query: 'app-server', hits: [{}, {}] }),
        'execute',
      ),
    ).toBe(false)
  })

  it('含有内容文本的 hits 正确识别并解析为业务卡片', () => {
    expect(
      hasBusinessResult(
        JSON.stringify({
          query: 'app-server',
          hits: [{ text: 'const server = createAppServer()' }],
        }),
        'execute',
      ),
    ).toBe(true)
    expect(
      hasBusinessResult(
        JSON.stringify({
          query: 'app-server',
          hits: [{ snippet: 'const server = createAppServer()' }],
        }),
        'montree_inspect_content',
      ),
    ).toBe(true)
  })
})
