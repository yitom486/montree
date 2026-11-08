import { describe, expect, it } from 'vitest'
import type { AcpConfigOption } from '@yitom/contracts'
import { lowestTranslationThought, translationModelOption, translationThoughtOption, translationThoughtPatch, TRANSLATION_LOWEST_THOUGHT } from './translation-config'

function model(currentValue = 'mini[reasoning_effort=max,fast=false]'): AcpConfigOption {
  return {
    configId: 'session-model', category: 'model', name: 'Model', type: 'select', currentValue,
    options: ['mini[reasoning_effort=max,fast=false]', 'mini[reasoning_effort=low,fast=false]', 'mini[reasoning_effort=minimal,fast=true]'].map((value) => ({ value, name: value })),
  }
}

describe('translation model capabilities', () => {
  it('reads advertised models without a Cursor CLI catalog', () => {
    expect(translationModelOption([model()])?.options).toHaveLength(3)
  })

  it('only chooses compatible listed suffix variants and preserves fast mode', () => {
    expect(translationThoughtOption([model()])?.options?.map((item) => item.value)).toEqual(['max', 'low'])
    expect(translationThoughtPatch([model()], TRANSLATION_LOWEST_THOUGHT)).toEqual({ configId: 'session-model', value: 'mini[reasoning_effort=low,fast=false]' })
  })

  it('does not invent a thinking selector for fixed models', () => {
    expect(translationThoughtOption([{ ...model(), options: [{ value: 'fixed', name: 'Fixed' }], currentValue: 'fixed' }])).toBeUndefined()
    expect(translationThoughtPatch([], TRANSLATION_LOWEST_THOUGHT)).toBeNull()
  })

  it('ranks known effort levels independently of advertised list order', () => {
    const option: AcpConfigOption = {
      configId: 'reasoning_effort', name: 'Effort', type: 'select', currentValue: 'max',
      options: ['max', 'high', 'low', 'minimal', 'none'].map((value) => ({ value, name: value })),
    }
    expect(lowestTranslationThought(option)).toBe('none')
    expect(translationThoughtPatch([option], 'low')).toEqual({ configId: 'reasoning_effort', value: 'low' })
    expect(() => translationThoughtPatch([option], 'removed')).toThrow('不支持')
  })

  it('keeps the runtime default when lowest cannot be determined', () => {
    const option: AcpConfigOption = { configId: 'effort', name: 'Effort', type: 'select', currentValue: 'special', options: [{ value: 'special', name: 'Special' }] }
    expect(lowestTranslationThought(option)).toBeUndefined()
    expect(translationThoughtPatch([option], TRANSLATION_LOWEST_THOUGHT)).toBeNull()
  })
})
