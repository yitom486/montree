import { describe, expect, it } from 'vitest'
import { parseAcpConfigOptions } from '@yitom/acp-client'
import { flattenGroupedConfigOptions } from './config-options'

describe('flattenGroupedConfigOptions', () => {
  it('flattens grouped model choices so the model option survives the SDK parser', () => {
    const raw = [{
      id: 'model',
      name: 'Model',
      category: 'model',
      type: 'select',
      currentValue: '["deepseek-official","deepseek-v4"]',
      options: [
        {
          group: 'deepseek-official',
          name: 'DeepSeek',
          options: [
            {
              value: '["deepseek-official","deepseek-v4"]',
              name: 'DeepSeek V4',
            },
          ],
        },
        {
          group: 'openai',
          name: 'OpenAI',
          options: [{ value: '["openai","gpt-x"]', name: 'GPT X' }],
        },
      ],
    }, {
      id: 'reasoning_effort',
      name: 'Reasoning effort',
      type: 'select',
      currentValue: 'high',
      options: [{ value: 'low', name: 'Low' }, { value: 'high', name: 'High' }],
    }]

    const parsed = parseAcpConfigOptions(flattenGroupedConfigOptions(raw))
    const model = parsed.find((option) => option.configId === 'model')
    expect(model?.currentValue).toBe('["deepseek-official","deepseek-v4"]')
    expect(model?.options?.map((option) => option.value)).toEqual([
      '["deepseek-official","deepseek-v4"]',
      '["openai","gpt-x"]',
    ])
    expect(model?.options?.map((option) => option.name)).toEqual([
      'deepseek-official · DeepSeek V4',
      'openai · GPT X',
    ])
    expect(parsed.find((option) => option.configId === 'reasoning_effort')?.options).toHaveLength(2)
  })

  it('leaves flat options and non-array payloads unchanged', () => {
    const flat = [{
      id: 'model',
      name: 'Model',
      type: 'select',
      options: [{ value: 'a', name: 'A' }],
    }]
    expect(flattenGroupedConfigOptions(flat)).toEqual(flat)
    expect(flattenGroupedConfigOptions(undefined)).toBeUndefined()
  })
})
