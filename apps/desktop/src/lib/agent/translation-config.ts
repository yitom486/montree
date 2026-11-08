import type { AcpConfigOption } from '@yitom/contracts'
import { rankPrimary, splitConfigOptions } from './acp-config-menu'
import { findListedVariantId, listedModelOptionValues, selectModelThinkingControl } from './acp-model-thinking'

export const TRANSLATION_LOWEST_THOUGHT = '__lowest__'
export const TRANSLATION_DEFAULT_THOUGHT = '__default__'

export function translationModelOption(options: AcpConfigOption[]): AcpConfigOption | undefined {
  return splitConfigOptions(options).primary.find((option) => rankPrimary(option) === 1)
}

export function translationThoughtOption(options: AcpConfigOption[]): AcpConfigOption | undefined {
  const { primary } = splitConfigOptions(options)
  const independent = primary.find((option) => rankPrimary(option) === 2)
  if (independent) return independent
  const suffix = selectModelThinkingControl(primary)
  if (!suffix) return undefined
  return {
    configId: suffix.configId, name: '思考档位', type: 'select', category: 'thought_level',
    currentValue: suffix.current,
    options: suffix.candidates.map((value) => ({ value, name: value })),
  }
}

/** 只在 Agent 已提供的档位里选；未知档名不猜顺序，保留运行时默认。 */
export function lowestTranslationThought(option: AcpConfigOption): string | undefined {
  const ranks: Record<string, number> = {
    none: 0, off: 0, false: 0, minimal: 1, min: 1, low: 2,
    medium: 3, normal: 3, standard: 3, high: 4, xhigh: 5, extrahigh: 5, max: 6, on: 7, true: 7,
  }
  return option.options?.map((item) => ({
    value: item.value,
    rank: ranks[item.value.toLowerCase().replace(/[-_\s]+/g, '')]
      ?? ranks[item.name.toLowerCase().replace(/[-_\s]+/g, '')],
  })).filter((item) => item.rank !== undefined).sort((a, b) => a.rank! - b.rank!)[0]?.value
}

export function translationThoughtPatch(options: AcpConfigOption[], preference: string) {
  if (preference === TRANSLATION_DEFAULT_THOUGHT) return null
  const option = translationThoughtOption(options)
  if (!option?.options?.length) {
    if (preference === TRANSLATION_LOWEST_THOUGHT) return null
    throw new Error('当前翻译模型未提供可调思考档位，请重新选择')
  }
  const value = preference === TRANSLATION_LOWEST_THOUGHT ? lowestTranslationThought(option) : preference
  if (!value) return null
  if (!option.options.some((item) => item.value === value)) throw new Error('当前翻译模型不支持所选思考档位，请重新选择')
  if (option.currentValue === value) return null
  const model = translationModelOption(options)
  if (model?.configId === option.configId) {
    const suffix = selectModelThinkingControl(splitConfigOptions(options).primary)
    if (!suffix) return null
    const variant = findListedVariantId(listedModelOptionValues(model), suffix, { key: suffix.key, value })
    if (!variant) throw new Error('当前模型未提供对应的思考档位')
    return { configId: model.configId, value: variant }
  }
  return { configId: option.configId, value }
}
