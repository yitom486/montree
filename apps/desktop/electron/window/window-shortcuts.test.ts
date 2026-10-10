import { describe, expect, it } from 'vitest'
import { resolveWindowShortcut } from './window-shortcuts'

describe('native window shortcuts', () => {
  it.each([
    ['KeyN', true, 'new-window'], ['KeyO', true, 'open-folder'], ['KeyO', false, 'open-file'],
    ['KeyS', true, 'save-as'], ['KeyS', false, 'save'], ['Comma', false, 'settings'],
    ['KeyP', false, 'quick-open'], ['KeyF', false, 'find'], ['KeyH', false, 'replace'],
  ])('%s shift=%s works with Control and Meta', (code, shift, action) => {
    for (const meta of [false, true]) expect(resolveWindowShortcut({ type: 'keyDown', key: '?', code, shift, control: !meta, meta, alt: false })).toBe(action)
  })
  it('does not intercept text formatting, Alt combinations or keyUp', () => {
    const input = { type: 'keyDown', key: 'b', code: 'KeyB', shift: false, control: true, meta: false, alt: false }
    expect(resolveWindowShortcut(input)).toBeUndefined()
    expect(resolveWindowShortcut({ ...input, code: 'KeyN', shift: true, alt: true })).toBeUndefined()
    expect(resolveWindowShortcut({ ...input, type: 'keyUp', code: 'KeyN', shift: true })).toBeUndefined()
  })
})
