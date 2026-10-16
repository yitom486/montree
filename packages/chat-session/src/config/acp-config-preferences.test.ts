import { describe, expect, it } from 'vitest'
import {
  getPreferredConfigValue,
  listPreferredConfigPatches,
  rememberPreferredConfig,
} from './acp-config-preferences'
import type { AcpConfigOption } from '@montree/contracts'

describe('acp-config-preferences', () => {
  it('remembers and reads preferred values per runtime', () => {
    let map = rememberPreferredConfig({}, 'codex-acp', 'mode', 'ask-for-approval')
    map = rememberPreferredConfig(map, 'codex-acp', 'model', 'gpt-5.6')
    expect(getPreferredConfigValue(map, 'codex-acp', 'mode')).toBe('ask-for-approval')
    expect(getPreferredConfigValue(map, 'other', 'mode')).toBeUndefined()
  })

  it('lists patches only when preferred differs and is still valid', () => {
    const options: AcpConfigOption[] = [
      {
        configId: 'mode',
        name: 'Mode',
        type: 'select',
        currentValue: 'approve-for-me',
        options: [
          { value: 'ask-for-approval', name: 'Ask for approval' },
          { value: 'approve-for-me', name: 'Approve for me' },
          { value: 'full-access', name: 'Full access' },
        ],
      },
      {
        configId: 'model',
        name: 'Model',
        type: 'select',
        currentValue: 'a',
        options: [
          { value: 'a', name: 'A' },
          { value: 'b', name: 'B' },
        ],
      },
    ]

    expect(
      listPreferredConfigPatches(options, {
        mode: 'ask-for-approval',
        model: 'a',
        gone: 'x',
      }),
    ).toEqual([{ configId: 'mode', value: 'ask-for-approval' }])

    expect(
      listPreferredConfigPatches(options, {
        model: 'legacy-removed',
      }),
    ).toEqual([])
  })
})
