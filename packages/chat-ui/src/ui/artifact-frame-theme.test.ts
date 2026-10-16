import { describe, expect, it, vi } from 'vitest'
import {
  notifyArtifactThemeParticipants,
  registerArtifactThemeParticipant,
} from './artifact-frame'

describe('notifyArtifactThemeParticipants', () => {
  it('空集合直接 resolve', async () => {
    await expect(notifyArtifactThemeParticipants('dark')).resolves.toBeUndefined()
  })

  it('通知全部参与者并透传主题，单个异常不牵连', async () => {
    const seen: string[] = []
    const bad = vi.fn(async () => {
      throw new Error('boom')
    })
    const unregisterGood = registerArtifactThemeParticipant(async (theme) => {
      seen.push(theme)
    })
    const unregisterBad = registerArtifactThemeParticipant(bad)
    try {
      await notifyArtifactThemeParticipants('sepia')
      expect(seen).toEqual(['sepia'])
      expect(bad).toHaveBeenCalledTimes(1)
    } finally {
      unregisterGood()
      unregisterBad()
    }
  })

  it('unregister 后不再收到通知', async () => {
    const fn = vi.fn(async () => {})
    const unregister = registerArtifactThemeParticipant(fn)
    unregister()
    await notifyArtifactThemeParticipants('light')
    expect(fn).not.toHaveBeenCalled()
  })
})
