import { describe, expect, it } from 'vitest'
import { agyAdapter, probeAgyAuth } from './index'

describe('agyAdapter（中性探测 + 直连优先）', () => {
  it('probe 中性空结果（authMethods 为 []，直连即可）', () => {
    const probed = probeAgyAuth()
    expect(probed.looksLoggedIn).toBe(false)
    expect(probed.hasAuthFile).toBe(false)
    expect(probed.hasApiKeyEnv).toBe(false)
    expect(agyAdapter.probeAuth()).toEqual(probed)
  })

  it('tryDirectSessionFirst=true（authMethods 为空时直建会话）', () => {
    expect(agyAdapter.tryDirectSessionFirst).toBe(true)
    expect(agyAdapter.id).toBe('agy')
  })

  it('无 resolveSpawnCommand（模板 bunx 直调，无覆盖）', () => {
    expect(agyAdapter.resolveSpawnCommand).toBeUndefined()
  })
})
