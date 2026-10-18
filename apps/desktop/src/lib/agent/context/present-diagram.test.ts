import { describe, expect, it } from 'vitest'
import { Window } from 'happy-dom'
import { buildDiagramHtml } from './present-diagram'

describe('present-diagram mindmap collapse/expand', () => {
  const sampleMindmap = {
    diagramType: 'mindmap',
    title: '《红色工程师的崛起》导言脉络',
    nodes: [
      { id: 'root', label: '红色工程师的崛起', details: '全书核心主题' },
      { id: 'm1', label: '核心命题', details: '圣西门式技术治国' },
      { id: 'm2', label: '核心问题', details: '对苏联式阶级分析的反思' },
      { id: 'm2_1', label: '与康拉德/塞勒尼辩论', details: '关于知识分子阶级地位的讨论' },
      { id: 'm2_1_1', label: '作者的反对', details: '作者提出相反的历史事实' },
      { id: 'm3', label: '案例与方法', details: '清华大学案例' },
    ],
    edges: [
      { from: 'root', to: 'm1' },
      { from: 'root', to: 'm2' },
      { from: 'm2', to: 'm2_1' },
      { from: 'm2_1', to: 'm2_1_1' },
      { from: 'root', to: 'm3' },
    ],
  }

  it('renders .mindmap-toggle only for non-leaf nodes', () => {
    const html = buildDiagramHtml(sampleMindmap)
    const window = new Window()
    window.document.body.innerHTML = html

    // Parent nodes with children: root, m2, m2_1 (total 3)
    const toggles = window.document.querySelectorAll('.mindmap-toggle')
    expect(toggles.length).toBe(3)

    const toggleTargets = Array.from(toggles).map((t) => t.getAttribute('data-toggle'))
    expect(toggleTargets).toEqual(['root', 'm2', 'm2_1'])

    // Leaf nodes (m1, m2_1_1, m3) do not have .mindmap-toggle
    const leafNodes = ['m1', 'm2_1_1', 'm3']
    for (const leafId of leafNodes) {
      const node = window.document.querySelector(`.node[data-node="${leafId}"]`)
      expect(node).toBeTruthy()
      expect(node?.querySelector('.mindmap-toggle')).toBeNull()
    }
  })

  it('adds data-from and data-to attributes to mindmap edges', () => {
    const html = buildDiagramHtml(sampleMindmap)
    const window = new Window()
    window.document.body.innerHTML = html

    const edges = window.document.querySelectorAll('path.edge')
    expect(edges.length).toBe(5)
    for (const edge of edges) {
      expect(edge.getAttribute('data-from')).toBeTruthy()
      expect(edge.getAttribute('data-to')).toBeTruthy()
    }
  })

  it('executes inline script and toggles sub-branch visibility on click', () => {
    const html = buildDiagramHtml(sampleMindmap)
    const window = new Window({ url: 'http://localhost' })
    window.document.write(html)
    const script = window.document.querySelector('script')
    expect(script).toBeTruthy()
    new Function('window', 'document', script!.textContent!)(window, window.document)

    // Initial state: all nodes visible
    const rootNode = window.document.querySelector('.node[data-node="root"]') as unknown as HTMLElement
    const m2Node = window.document.querySelector('.node[data-node="m2"]') as unknown as HTMLElement
    const m2_1Node = window.document.querySelector('.node[data-node="m2_1"]') as unknown as HTMLElement
    const m2_1_1Node = window.document.querySelector('.node[data-node="m2_1_1"]') as unknown as HTMLElement
    const m1Node = window.document.querySelector('.node[data-node="m1"]') as unknown as HTMLElement

    expect(rootNode.style.display).not.toBe('none')
    expect(m2Node.style.display).not.toBe('none')
    expect(m2_1Node.style.display).not.toBe('none')
    expect(m2_1_1Node.style.display).not.toBe('none')
    expect(m1Node.style.display).not.toBe('none')

    // Click toggle on m2 (which has children m2_1 -> m2_1_1)
    const m2Toggle = window.document.querySelector('.mindmap-toggle[data-toggle="m2"]') as unknown as HTMLElement
    expect(m2Toggle).toBeTruthy()
    m2Toggle.dispatchEvent(new window.MouseEvent('click', { bubbles: true }) as unknown as Event)

    // Now m2 is collapsed: m2 remains visible with .collapsed class
    expect(m2Node.classList.contains('collapsed')).toBe(true)
    expect(m2Node.style.display).not.toBe('none')

    // Children of m2 are hidden
    expect(m2_1Node.style.display).toBe('none')
    expect(m2_1_1Node.style.display).toBe('none')

    // Sibling branches (m1) remain visible
    expect(m1Node.style.display).not.toBe('none')

    // Edge between m2 and m2_1 should be hidden
    const edgeM2 = window.document.querySelector('path.edge[data-from="m2"][data-to="m2_1"]') as unknown as HTMLElement
    expect(edgeM2.style.display).toBe('none')

    // Clicking m2 toggle again via keyboard Enter should expand it
    m2Toggle.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }) as unknown as Event)
    expect(m2Node.classList.contains('collapsed')).toBe(false)
    expect(m2_1Node.style.display).not.toBe('none')
    expect(m2_1_1Node.style.display).not.toBe('none')
    expect(edgeM2.style.display).not.toBe('none')

    // Collapsing root should hide all child nodes (m1, m2, m2_1, m2_1_1, m3)
    const rootToggle = window.document.querySelector('.mindmap-toggle[data-toggle="root"]') as unknown as HTMLElement
    expect(rootToggle).toBeTruthy()
    rootToggle.dispatchEvent(new window.MouseEvent('click', { bubbles: true }) as unknown as Event)
    expect(rootNode.classList.contains('collapsed')).toBe(true)
    expect(rootNode.style.display).not.toBe('none')
    expect(m1Node.style.display).toBe('none')
    expect(m2Node.style.display).toBe('none')
    expect(m2_1Node.style.display).toBe('none')
    expect(m2_1_1Node.style.display).toBe('none')
  })

  it('keeps other diagram types unaffected (no mindmap-toggle)', () => {
    const flowchart = buildDiagramHtml({
      diagramType: 'flowchart',
      title: '流程',
      nodes: [
        { id: 'start', label: '开始', kind: 'start', layer: 0 },
        { id: 'step', label: '执行', kind: 'process', layer: 1 },
      ],
      edges: [{ from: 'start', to: 'step' }],
    })
    const window = new Window()
    window.document.body.innerHTML = flowchart
    expect(window.document.querySelectorAll('.mindmap-toggle').length).toBe(0)
    expect(window.document.querySelectorAll('.node').length).toBe(2)
  })
})
