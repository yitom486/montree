import { describe, expect, it } from 'vitest'
import { supportsCodeModeCaps } from './code-mode-support'

describe('supportsCodeModeCaps', () => {
  it('only accepts an explicit ptc declaration', () => {
    expect(supportsCodeModeCaps({ _meta: { toolsMode: { values: ['native', 'ptc'] } } })).toBe(true)
    expect(supportsCodeModeCaps({ _meta: { toolsMode: { values: ['native'] } } })).toBe(false)
    expect(supportsCodeModeCaps({ _meta: {} })).toBe(false)
    expect(supportsCodeModeCaps({})).toBe(false)
    expect(supportsCodeModeCaps(undefined)).toBe(false)
  })

  it('ignores malformed declarations instead of enabling code mode', () => {
    expect(supportsCodeModeCaps({ _meta: { toolsMode: { values: 'ptc' } } })).toBe(false)
    expect(supportsCodeModeCaps({ _meta: { toolsMode: { values: [1, null] } } })).toBe(false)
    expect(supportsCodeModeCaps({ _meta: null } as unknown as Record<string, unknown>)).toBe(false)
  })
})
