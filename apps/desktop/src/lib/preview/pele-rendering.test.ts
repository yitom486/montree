// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest'
import { hydrateMermaidInElement, renderMermaidSvg } from './mermaid-hydrate'

vi.mock('mermaid', () => ({ default: { initialize: vi.fn(), render: vi.fn(() => { throw new Error('Unexpected Mermaid fallback') }) } }))

describe('Pele rendering', () => {
  it.each([
    'flowchart LR\n  A[用户] --> B[任务]',
    'sequenceDiagram\n  Alice->>Bob: Hello',
    'mindmap\n  root((Montree))\n    Markdown\n    Reader',
  ])('renders with the real Pele engine: %s', async (source) => {
    const svg = await renderMermaidSvg(source, 'light')
    expect(svg).toContain('data-montree-renderer="pele"')
    expect(svg).toContain('viewBox=')
    expect(svg).toContain('--pele-bg: #ffffff')
    expect(svg).toContain('id="montree-mmd-')
  })

  it('embeds light and dark colors so exported SVGs retain the selected theme', async () => {
    const source = 'flowchart TD\n  A[Theme] --> B[Export]'
    const light = await renderMermaidSvg(source, 'light')
    const dark = await renderMermaidSvg(source, 'dark')
    expect(light).toContain('--pele-fg: #312e81')
    expect(dark).toContain('--pele-fg: #e0e7ff')
    expect(dark).toContain('--pele-bg: #0f172a')
  })

  it('hydrates preview hosts and redraws them in the requested theme', async () => {
    const host = document.createElement('pre')
    host.className = 'mermaid'
    host.textContent = 'flowchart TD\n  A --> B'
    await hydrateMermaidInElement(host, 'light')
    expect(host.querySelector('svg')?.style.getPropertyValue('--pele-bg')).toBe('#ffffff')
    await hydrateMermaidInElement(host, 'dark', { force: true })
    expect(host.querySelector('svg')?.style.getPropertyValue('--pele-bg')).toBe('#0f172a')
  })

  it('keeps diagram text inert and blocks executable links', async () => {
    const svg = await renderMermaidSvg('flowchart TD\n  A["<script>alert(1)</script>"]\n  click A "javascript:alert(1)"', 'light')
    const host = document.createElement('div')
    host.innerHTML = svg
    expect(host.querySelector('script, [onclick], [onload]')).toBeNull()
    expect(host.querySelector('[href^="javascript:"], [xlink\\:href^="javascript:"]')).toBeNull()
  })

  it('does not bypass Pele resource limits through the fallback', async () => {
    await expect(renderMermaidSvg(`flowchart TD\n  A[${'x'.repeat(50_000)}]`, 'light')).rejects.toMatchObject({ code: 'limit' })
  })
})
