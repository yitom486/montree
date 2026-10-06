// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderAgentMarkdown } from '@/lib/agent/agent-markdown'

const renderMock = vi.fn(async (_id: string, source: string) => ({
  svg: `<svg xmlns="http://www.w3.org/2000/svg" data-test="1"><title>${source.slice(0, 12)}</title></svg>`,
}))

vi.mock('mermaid', () => ({
  default: {
    initialize: vi.fn(),
    render: renderMock,
    run: vi.fn(),
  },
}))

describe('hydrateMermaidInElement', () => {
  beforeEach(() => {
    renderMock.mockReset()
    renderMock.mockImplementation(async (_id: string, source: string) => ({
      svg: `<svg xmlns="http://www.w3.org/2000/svg" data-test="1"><title>${source.slice(0, 12)}</title></svg>`,
    }))
    document.body.innerHTML = ''
    window.localStorage.setItem('montree:mermaid-debug', '0')
  })

  it('uses mermaid.render and keeps source on data attribute', async () => {
    const { hydrateMermaidInElement } = await import('./mermaid-hydrate')
    const html = renderAgentMarkdown(
      ['```mermaid', 'flowchart LR', 'A --> B', '```'].join('\n'),
    )
    const root = document.createElement('div')
    root.innerHTML = html
    document.body.appendChild(root)

    await hydrateMermaidInElement(root, 'light')

    const node = root.querySelector<HTMLElement>('.mermaid')
    expect(node?.querySelector('svg')).not.toBeNull()
    expect(node?.getAttribute('data-mermaid-source')).toContain('flowchart LR')
    expect(renderMock).toHaveBeenCalled()
  })

  it('does not remove the inserted svg when cleanup runs (空灰框回归)', async () => {
    renderMock.mockImplementationOnce(async (id: string) => ({
      svg: `<svg id="${id}" xmlns="http://www.w3.org/2000/svg"><text>ok</text></svg>`,
    }))
    const { hydrateMermaidInElement } = await import('./mermaid-hydrate')
    const root = document.createElement('div')
    root.innerHTML = '<pre class="mermaid">flowchart LR\nA --> B</pre>'
    document.body.appendChild(root)

    await hydrateMermaidInElement(root, 'light')
    const svg = root.querySelector('.mermaid svg')
    expect(svg).not.toBeNull()
    expect(svg?.id.startsWith('montree-mmd-')).toBe(true)
  })

  it('hydrates when root itself is the mermaid host (MermaidBlock)', async () => {
    const { hydrateMermaidInElement } = await import('./mermaid-hydrate')
    const host = document.createElement('div')
    host.className = 'mermaid'
    host.textContent = 'flowchart LR\nA[用户] --> B[任务]'
    document.body.appendChild(host)

    await hydrateMermaidInElement(host, 'light', { force: true, reason: 'test-block' })

    expect(host.querySelector('svg')).not.toBeNull()
    expect(host.getAttribute('data-mermaid-source')).toContain('用户')
    expect(host.classList.contains('mermaid')).toBe(true)
  })

  it('skips nodes that already have svg unless force', async () => {
    const { hydrateMermaidInElement } = await import('./mermaid-hydrate')
    const root = document.createElement('div')
    root.innerHTML =
      '<pre class="mermaid" data-mermaid-source="flowchart LR\nA --> B"><svg></svg></pre>'
    document.body.appendChild(root)

    await hydrateMermaidInElement(root, 'light')
    expect(renderMock).not.toHaveBeenCalled()

    await hydrateMermaidInElement(root, 'dark', { force: true })
    expect(renderMock).toHaveBeenCalled()
  })

  it('cancelled after render must not write svg or wipe to empty (竞态回归)', async () => {
    let release!: () => void
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    renderMock.mockImplementationOnce(async (id: string) => {
      await gate
      return {
        svg: `<svg id="${id}" xmlns="http://www.w3.org/2000/svg"><text>late</text></svg>`,
      }
    })

    const { hydrateMermaidInElement } = await import('./mermaid-hydrate')
    const host = document.createElement('div')
    host.className = 'mermaid'
    host.textContent = 'flowchart LR\nA --> B'
    document.body.appendChild(host)

    let cancelled = false
    const pending = hydrateMermaidInElement(host, 'light', {
      force: true,
      cancelled: () => cancelled,
      reason: 'stale',
    })
    cancelled = true
    release()
    await pending

    // 取消后不得写入 SVG；也不得清成空壳
    expect(host.querySelector('svg')).toBeNull()
    expect((host.textContent ?? '').trim().length).toBeGreaterThan(0)
  })

  it('stale cancelled run must not overwrite a newer successful svg', async () => {
    let releaseStale!: () => void
    const staleGate = new Promise<void>((resolve) => {
      releaseStale = resolve
    })

    let call = 0
    renderMock.mockImplementation(async (id: string) => {
      call += 1
      if (call === 1) {
        await staleGate
        return {
          svg: `<svg id="${id}" xmlns="http://www.w3.org/2000/svg"><text>stale</text></svg>`,
        }
      }
      return {
        svg: `<svg id="${id}" xmlns="http://www.w3.org/2000/svg"><text>fresh</text></svg>`,
      }
    })

    const { hydrateMermaidInElement } = await import('./mermaid-hydrate')
    const host = document.createElement('div')
    host.className = 'mermaid'
    host.textContent = 'flowchart LR\nA --> B'
    document.body.appendChild(host)

    let staleCancelled = false
    const stale = hydrateMermaidInElement(host, 'light', {
      force: true,
      cancelled: () => staleCancelled,
      reason: 'stale',
    })

    // 等第一轮 render 已挂起，再启动成功的一轮
    await vi.waitFor(() => expect(call).toBe(1))

    await hydrateMermaidInElement(host, 'light', {
      force: true,
      cancelled: () => false,
      reason: 'fresh',
    })
    expect(host.querySelector('svg')?.textContent).toBe('fresh')

    staleCancelled = true
    releaseStale()
    await stale

    expect(host.querySelector('svg')?.textContent).toBe('fresh')
  })

  it('restores source when render returns empty svg', async () => {
    renderMock.mockResolvedValueOnce({ svg: '   ' })
    const { hydrateMermaidInElement } = await import('./mermaid-hydrate')
    const host = document.createElement('div')
    host.className = 'mermaid'
    host.textContent = 'flowchart LR\nA --> B'
    document.body.appendChild(host)

    await hydrateMermaidInElement(host, 'light', { force: true })
    expect(host.querySelector('svg')).toBeNull()
    expect(host.textContent).toContain('flowchart LR')
  })

  it('restores source when render throws', async () => {
    renderMock.mockRejectedValueOnce(new Error('boom'))
    const { hydrateMermaidInElement } = await import('./mermaid-hydrate')
    const host = document.createElement('div')
    host.className = 'mermaid'
    host.textContent = 'flowchart LR\nA --> B'
    document.body.appendChild(host)

    await hydrateMermaidInElement(host, 'light', { force: true })
    expect(host.querySelector('svg')).toBeNull()
    expect(host.textContent).toContain('flowchart LR')
  })
})
