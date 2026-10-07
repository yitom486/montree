import { describe, expect, it } from 'vitest'
import { repairMermaidSource } from './mermaid-repair'

describe('repairMermaidSource', () => {
  it('splits single-line flowchart with nodes into multiple lines', () => {
    const raw =
      'flowchart TD A["义和团运动的研究视角"] --> B1["传统/中国学界关注：价值评价"] A --> C["【打破层级/社会史视角】：发生逻辑"] B --> B1["动过定性：反帝爱国 vs 封建迷信"] B --> B2["历史评价：雏形成功契机 vs 阻碍现代化"] C --> C1["微观质感经验：不做历史法官"] C --> C2["微观社会生态：鲁西北生态与民间试会"] C --> C3["因果闭环：理解运作逻辑与行动化逻辑"]'

    const repaired = repairMermaidSource(raw)

    expect(repaired).toContain('flowchart TD\n')
    expect(repaired).toContain('A["义和团运动的研究视角"] --> B1["传统/中国学界关注：价值评价"]')
    expect(repaired).toContain('\n  A --> C["【打破层级/社会史视角】：发生逻辑"]')
    expect(repaired).toContain('\n  B --> B1["动过定性：反帝爱国 vs 封建迷信"]')
    expect(repaired).toContain('\n  C --> C1["微观质感经验：不做历史法官"]')
    expect(repaired.split('\n').length).toBeGreaterThan(6)
  })

  it('prepends flowchart TD when diagram type header is missing', () => {
    const raw = 'A --> B\nB --> C'
    const repaired = repairMermaidSource(raw)
    expect(repaired.startsWith('flowchart TD')).toBe(true)
    expect(repaired).toContain('A --> B')
  })

  it('strips redundant markdown code fences', () => {
    const raw = '```mermaid\nflowchart LR\nA --> B\n```'
    const repaired = repairMermaidSource(raw)
    expect(repaired.startsWith('flowchart LR')).toBe(true)
    expect(repaired).not.toContain('```')
  })

  it('splits single-line sequence diagram messages', () => {
    const raw = 'sequenceDiagram Alice->>Bob: Hello Bob->>Alice: Hi'
    const repaired = repairMermaidSource(raw)
    expect(repaired).toContain('sequenceDiagram\n')
    expect(repaired).toContain('Alice->>Bob: Hello')
    expect(repaired).toContain('Bob->>Alice: Hi')
  })

  it('heals arrows broken across line breaks like --\\n>', () => {
    const broken = 'flowchart TD\n  A["起点"] --\n\n> B["终点"]'
    const healed = repairMermaidSource(broken)
    expect(healed).toContain('A["起点"] --> B["终点"]')
  })
})
