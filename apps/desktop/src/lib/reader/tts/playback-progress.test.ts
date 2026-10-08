import { describe, expect, it } from 'vitest'
import { getTtsPlaybackProgress } from './playback-progress'

describe('TTS playback bar', () => {
  it('shows the reported 22 seconds against 448.88 seconds of available audio, not an unknown chapter estimate', () => {
    const progress = getTtsPlaybackProgress(22, 7954 / 4.3, 448.88, true)
    expect(progress.duration).toBe(448.88)
    expect(progress.percent).toBeCloseTo(4.901, 2)
    expect(getTtsPlaybackProgress(44, 7954 / 4.3, 448.88, true).percent).toBeGreaterThan(progress.percent)
  })
  it('uses the actual chapter duration after reception completes and handles empty buffers', () => {
    expect(getTtsPlaybackProgress(50, 100, 80, false)).toEqual({ duration: 100, percent: 50 })
    expect(getTtsPlaybackProgress(0, 2000, 0, true)).toEqual({ duration: 0, percent: 0 })
    expect(getTtsPlaybackProgress(200, 100, 100, false).percent).toBe(100)
  })
})
