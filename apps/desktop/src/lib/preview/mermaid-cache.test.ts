// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest'

const render = vi.fn(async (_id: string, source: string) => {
  await new Promise((resolve) => setTimeout(resolve, 5))
  return { svg: `<svg data-src="${source}"></svg>` }
})
let active = 0, maxActive = 0
vi.mock('mermaid', () => ({ default: { initialize: vi.fn(), render: async (id: string, source: string) => {
  active++; maxActive = Math.max(maxActive, active)
  try { return await render(id, source) } finally { active-- }
} } }))

import { getCachedMermaidSvg, renderMermaidSvg } from './mermaid-hydrate'

describe('Mermaid SVG 缓存', () => {
  it('同源码同主题只渲染一次，之后同步命中缓存；渲染串行', async () => {
    expect(getCachedMermaidSvg('flowchart LR\n  A --> B', 'light')).toBeUndefined()
    const [a, b, c] = await Promise.all([
      renderMermaidSvg('flowchart LR\n  A --> B', 'light'),
      renderMermaidSvg('flowchart LR\n  A --> B', 'light'),
      renderMermaidSvg('flowchart LR\n  B --> C', 'light'),
    ])
    expect(a).toBe(b)
    expect(c).not.toBe(a)
    expect(render).toHaveBeenCalledTimes(2)
    expect(maxActive).toBe(1)
    expect(getCachedMermaidSvg('flowchart LR\n  A --> B', 'light')).toBe(a)
    expect(getCachedMermaidSvg('flowchart LR\n  A --> B', 'dark')).toBeUndefined()
  })

  it('渲染失败不污染缓存，后续请求可继续', async () => {
    render.mockRejectedValueOnce(new Error('parse error'))
    await expect(renderMermaidSvg('graph TD\n  X', 'light')).rejects.toThrow('parse error')
    expect(getCachedMermaidSvg('graph TD\n  X', 'light')).toBeUndefined()
    await expect(renderMermaidSvg('graph TD\n  Y --> Z', 'light')).resolves.toContain('<svg')
  })
})
