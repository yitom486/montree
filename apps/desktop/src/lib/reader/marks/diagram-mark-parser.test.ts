import { describe, expect, it } from 'vitest'
import type { ReadingMark } from '@montree/contracts'
import { parseDiagramFromMark } from './diagram-mark-parser'

describe('parseDiagramFromMark', () => {
  it('正确解析包含 Markdown 语法和 Mermaid 的图谱卡片', () => {
    const mark: ReadingMark = {
      id: 'mark-1',
      filePath: 'book.epub',
      fileFingerprint: 'fp',
      kind: 'note',
      category: 'diagram',
      title: '义和团研究的两种史学范式',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      anchor: { format: 'epub', cfi: '' },
      note: `> **核心解读**：对比中国史学界与西方学者的视角差异。

### 推演流转步骤
1. **聚焦功过是非定性**（传统视角 → 价值评价维度）：传统倾向二元定性。
2. **超越两极褒贬争论**（西方视角 → 去道德化考量）：避免扮演政治法官。

### 架构图表
\`\`\`mermaid
flowchart TD
  A["研究视角"] --> B["价值评价"]
  A --> C["发生逻辑"]
\`\`\``,
    }

    const payload = parseDiagramFromMark(mark)
    expect(payload).not.toBeNull()
    expect(payload?.title).toBe('义和团研究的两种史学范式')
    expect(payload?.summary).toBe('对比中国史学界与西方学者的视角差异。')
    expect(payload?.diagramType).toBe('flowchart')
    expect(payload?.mermaidCode).toContain('A["研究视角"] --> B["价值评价"]')
    expect(payload?.visualSteps).toHaveLength(2)
    expect(payload?.visualSteps?.[0]?.action).toBe('聚焦功过是非定性')
    expect(payload?.visualSteps?.[0]?.from).toBe('传统视角')
    expect(payload?.visualSteps?.[0]?.to).toBe('价值评价维度')
    expect(payload?.visualSteps?.[0]?.desc).toBe('传统倾向二元定性。')
  })

  it('普通笔记且不含 mermaid 时返回 null', () => {
    const mark: ReadingMark = {
      id: 'mark-2',
      filePath: 'book.epub',
      fileFingerprint: 'fp',
      kind: 'note',
      category: 'concept',
      title: '普通札记',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      anchor: { format: 'epub', cfi: '' },
      note: '这是一条普通随手记，没有任何图表或推演。',
    }

    expect(parseDiagramFromMark(mark)).toBeNull()
  })
})
