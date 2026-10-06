import { describe, expect, it } from 'vitest'
import type { AcpConfigOption } from '@montree/contracts'
import { rankPrimary, splitConfigOptions } from './acp-config-menu'
import {
  collectThinkingCandidates,
  extractModelSuffixThinking,
  findListedVariantId,
  findVariantThinkingKey,
  parseModelVariant,
  pickDashCounterpart,
  selectModelThinkingControl,
  selectReadonlyModelThinking,
  selectSuffixFastState,
} from './acp-model-thinking'

function selectOpt(
  partial: Partial<AcpConfigOption> & Pick<AcpConfigOption, 'configId' | 'name'>,
): AcpConfigOption {
  return {
    type: 'select',
    options: [{ value: 'a', name: 'A' }],
    currentValue: 'a',
    ...partial,
  } as AcpConfigOption
}

describe('extractModelSuffixThinking', () => {
  it('reasoning_effort 取值原文', () => {
    expect(extractModelSuffixThinking('gpt-5.6[reasoning_effort=high]')).toBe('high')
    expect(extractModelSuffixThinking('m[reasoning_effort = xhigh , foo=1]')).toBe('xhigh')
  })
  it('thinking 按开/关折叠', () => {
    expect(extractModelSuffixThinking('m[thinking=true]')).toBe('on')
    expect(extractModelSuffixThinking('m[thinking=false]')).toBe('off')
  })
  it('裸值直接返回原文', () => {
    expect(extractModelSuffixThinking('gpt-5.6-luna[high]')).toBe('high')
  })
  it('无后缀/空后缀/无关键返回 null', () => {
    expect(extractModelSuffixThinking('gpt-5.6')).toBeNull()
    expect(extractModelSuffixThinking('m[]')).toBeNull()
    expect(extractModelSuffixThinking('m[foo=1]')).toBeNull()
    expect(extractModelSuffixThinking(undefined)).toBeNull()
    expect(extractModelSuffixThinking(true)).toBeNull()
  })
})

describe('selectReadonlyModelThinking', () => {
  it('无 rank2 且模型尾缀有档位时返回档位', () => {
    const primary = [
      selectOpt({ configId: 'model', name: '模型', category: 'model', currentValue: 'm[high]' }),
    ]
    expect(selectReadonlyModelThinking(primary)).toBe('high')
  })
  it('有独立思考档时不显示只读徽标', () => {
    const primary = [
      selectOpt({ configId: 'model', name: '模型', category: 'model', currentValue: 'm[high]' }),
      selectOpt({ configId: 'effort', name: 'Effort', currentValue: 'high' }),
    ]
    expect(selectReadonlyModelThinking(primary)).toBeNull()
  })
  it('无模型项或模型无后缀时返回 null', () => {
    expect(selectReadonlyModelThinking([])).toBeNull()
    expect(
      selectReadonlyModelThinking([
        selectOpt({ configId: 'model', name: '模型', category: 'model', currentValue: 'plain' }),
      ]),
    ).toBeNull()
  })
})

/**
 * cursor-cli session configOptions 实测形状（39 项精简为 5 项代表）：
 * 仅 mode + model；同 base 多 variant（claude×2）、单 variant（grok）、
 * 空尾缀（default[]）、thinking 布尔（mini）、fast 缺失（claude/default/mini）。
 */
const CURSOR_MODEL_VALUES = [
  'claude-sonnet-4[reasoning_effort=low]',
  'claude-sonnet-4[reasoning_effort=high]',
  'grok-4.7[context=256k,reasoning_effort=high,fast=true]',
  'default[]',
  'mini[thinking=false]',
] as const

function cursorPrimary(current: string): AcpConfigOption[] {
  return [
    selectOpt({
      configId: 'mode',
      name: 'Mode',
      category: 'mode',
      currentValue: 'agent',
      options: [
        { value: 'agent', name: 'Agent' },
        { value: 'plan', name: 'Plan' },
        { value: 'ask', name: 'Ask' },
      ],
    }),
    selectOpt({
      configId: 'model',
      name: 'Model',
      category: 'model',
      currentValue: current,
      options: CURSOR_MODEL_VALUES.map((v) => ({ value: v, name: v })),
    }),
  ]
}

describe('parseModelVariant', () => {
  it('多 param 解析 + key 顺序保持', () => {
    const parsed = parseModelVariant('grok-4.7[context=256k,reasoning_effort=high,fast=true]')
    expect(parsed.base).toBe('grok-4.7')
    expect(Object.keys(parsed.params)).toEqual(['context', 'reasoning_effort', 'fast'])
    expect(parsed.params).toEqual({ context: '256k', reasoning_effort: 'high', fast: 'true' })
  })
  it('空尾缀 / 无尾缀 / 裸值', () => {
    expect(parseModelVariant('default[]')).toEqual({ base: 'default', params: {} })
    expect(parseModelVariant('gemini-3.1-pro[]')).toEqual({
      base: 'gemini-3.1-pro',
      params: {},
    })
    expect(parseModelVariant('plain')).toEqual({ base: 'plain', params: {} })
    expect(parseModelVariant('m[high]')).toEqual({ base: 'm', params: {} })
    expect(parseModelVariant(undefined)).toEqual({ base: '', params: {} })
  })
})

describe('collectThinkingCandidates', () => {
  it('同 base 多 variant 去重（claude→low/high）', () => {
    expect(collectThinkingCandidates('claude-sonnet-4', [...CURSOR_MODEL_VALUES])).toEqual([
      'low',
      'high',
    ])
  })
  it('单 variant 仅 1 个（grok 不足 2，不可用）', () => {
    expect(collectThinkingCandidates('grok-4.7', [...CURSOR_MODEL_VALUES])).toEqual(['high'])
  })
  it('空尾缀 / 无关 base 返回空', () => {
    expect(collectThinkingCandidates('default', [...CURSOR_MODEL_VALUES])).toEqual([])
    expect(collectThinkingCandidates('', [...CURSOR_MODEL_VALUES])).toEqual([])
    expect(collectThinkingCandidates('missing', [...CURSOR_MODEL_VALUES])).toEqual([])
  })
})

describe('findListedVariantId', () => {
  it('listed 命中：同 base 改思考档返回 listed 原值', () => {
    const listed = [...CURSOR_MODEL_VALUES]
    const current = parseModelVariant('claude-sonnet-4[reasoning_effort=low]')
    expect(
      findListedVariantId(listed, current, { key: 'reasoning_effort', value: 'high' }),
    ).toBe('claude-sonnet-4[reasoning_effort=high]')
  })
  it('多 param 全等才命中：其余 param 有一个不等即 null', () => {
    const listed = [
      'm[a=1,b=1,think=low]',
      'm[a=1,b=1,think=high]',
      'm[a=2,b=1,think=high]',
    ]
    const current = parseModelVariant('m[a=1,b=1,think=low]')
    // 其余 param 全等 → 命中同组 high，不取 a=2 那条
    expect(findListedVariantId(listed, current, { key: 'think', value: 'high' })).toBe(
      'm[a=1,b=1,think=high]',
    )
    // 当前 a=9 与任何 listed 的其余 param 都不等 → null（手搓会出未 listed id）
    const orphan = parseModelVariant('m[a=9,b=1,think=low]')
    expect(findListedVariantId(listed, orphan, { key: 'think', value: 'high' })).toBeNull()
    // listed 多带一个 key 也算不等 → null
    const listedExtra = ['m[a=1,think=high,extra=1]']
    expect(findListedVariantId(listedExtra, current, { key: 'think', value: 'high' })).toBeNull()
  })
  it('找不到返回 null：单 variant / 异 base / 空入参', () => {
    const listed = [...CURSOR_MODEL_VALUES]
    const grok = parseModelVariant('grok-4.7[context=256k,reasoning_effort=high,fast=true]')
    // grok 仅单 variant：fast=false 无 listed 目标
    expect(findListedVariantId(listed, grok, { key: 'fast', value: 'false' })).toBeNull()
    // grok 思考 low 无 listed（仅 high 单值）
    expect(
      findListedVariantId(listed, grok, { key: 'reasoning_effort', value: 'low' }),
    ).toBeNull()
    // 异 base 不串
    const claude = parseModelVariant('claude-sonnet-4[reasoning_effort=low]')
    expect(findListedVariantId(listed, claude, { key: 'reasoning_effort', value: 'low' })).toBe(
      'claude-sonnet-4[reasoning_effort=low]',
    )
    expect(findListedVariantId([], claude, { key: 'reasoning_effort', value: 'high' })).toBeNull()
    expect(findListedVariantId(listed, { base: '', params: {} }, { key: 'fast', value: 'false' })).toBeNull()
    expect(findListedVariantId(listed, grok, { key: '', value: 'false' })).toBeNull()
    expect(findListedVariantId(listed, grok, { key: 'fast', value: '' })).toBeNull()
    expect(findListedVariantId(['a', 1, null], grok, { key: 'fast', value: 'false' })).toBeNull()
  })
})

describe('selectModelThinkingControl', () => {
  it('同 base≥2 且 listed 可达直接可用（claude）', () => {
    const control = selectModelThinkingControl(
      cursorPrimary('claude-sonnet-4[reasoning_effort=low]'),
    )
    expect(control?.key).toBe('reasoning_effort')
    expect(control?.current).toBe('low')
    expect(control?.candidates).toEqual(['low', 'high'])
  })
  it('单 variant 无 listed 可切 → null，保持只读徽标（grok）', () => {
    const primary = cursorPrimary('grok-4.7[context=256k,reasoning_effort=high,fast=true]')
    expect(selectModelThinkingControl(primary)).toBeNull()
    // 只读徽标仍跟随当前值
    expect(selectReadonlyModelThinking(primary)).toBe('high')
    // fast 反向目标同样无 listed（面板应 disabled 开关）
    const grok = parseModelVariant('grok-4.7[context=256k,reasoning_effort=high,fast=true]')
    expect(
      findListedVariantId([...CURSOR_MODEL_VALUES], grok, { key: 'fast', value: 'false' }),
    ).toBeNull()
    expect(findVariantThinkingKey(grok.params)).toBe('reasoning_effort')
  })
  it('候选不足返回 null（空尾缀 / thinking 单值）', () => {
    expect(selectModelThinkingControl(cursorPrimary('default[]'))).toBeNull()
    expect(selectModelThinkingControl(cursorPrimary('mini[thinking=false]'))).toBeNull()
  })
  it('有独立思考档（rank2）时返回 null', () => {
    const primary = [
      ...cursorPrimary('claude-sonnet-4[reasoning_effort=low]'),
      selectOpt({ configId: 'effort', name: 'Effort', currentValue: 'high' }),
    ]
    expect(selectModelThinkingControl(primary)).toBeNull()
  })
})

describe('selectSuffixFastState', () => {
  it('fast=true|false 均返回状态', () => {
    expect(
      selectSuffixFastState(cursorPrimary('grok-4.7[context=256k,reasoning_effort=high,fast=true]'))
        ?.checked,
    ).toBe(true)
    const off = selectOpt({
      configId: 'model',
      name: 'Model',
      category: 'model',
      currentValue: 'm[fast=false]',
      options: [{ value: 'm[fast=false]', name: 'M' }],
    })
    expect(selectSuffixFastState([off])?.checked).toBe(false)
  })
  it('fast 缺失返回 null', () => {
    expect(
      selectSuffixFastState(cursorPrimary('claude-sonnet-4[reasoning_effort=low]')),
    ).toBeNull()
    expect(selectSuffixFastState(cursorPrimary('default[]'))).toBeNull()
  })
})

describe('parameterizedModelPicker 声明后的 cursor 形状：独立思考项取代只读徽标', () => {
  // 声明后模型为朴素值（无尾缀）+ 独立 thinking 项（parse 后形状，parse 兼容见
  // packages/acp/src/session/config-options.test.ts）：rank2 下拉出现，只读徽标退场。
  function cursorOptions(): AcpConfigOption[] {
    return [
      selectOpt({
        configId: 'model',
        name: 'Model',
        category: 'model',
        currentValue: 'grok-4.7',
        options: [
          { value: 'grok-4.7', name: 'grok-4.7' },
          { value: 'claude-sonnet-4', name: 'claude-sonnet-4' },
        ],
      }),
      selectOpt({
        configId: 'reasoning-effort',
        name: 'Reasoning effort',
        currentValue: 'high',
        options: [
          { value: 'low', name: 'Low' },
          { value: 'high', name: 'High' },
        ],
      }),
    ]
  }

  it('独立思考项进 primary rank2，只读徽标返回 null', () => {
    const { primary } = splitConfigOptions(cursorOptions())
    expect(primary.some((o) => rankPrimary(o) === 2)).toBe(true)
    expect(primary.find((o) => rankPrimary(o) === 2)?.configId).toBe('reasoning-effort')
    // 朴素模型值无尾缀 + 已有 rank2 → 无只读徽标（下拉取代展示）
    expect(selectReadonlyModelThinking(primary)).toBeNull()
  })
})

/**
 * 用户实测 `agent models` 输出 fixture（逐行首 token 为横杠 canonical id，
 * 主进程 `parseCursorCatalogOutput` 同口径；`auto` 保留原样）。
 * 覆盖：grok 高档 fast 对子、claude thinking 中缀系列、多词档位（Extra High）。
 */
const CURSOR_AGENT_MODELS_STDOUT = [
  '* grok-4.7-high-fast  Grok 4.7 High Fast (default)',
  'grok-4.7-high  Grok 4.7 High',
  'grok-4.7-medium-fast  Grok 4.7 Medium Fast',
  'grok-4.7-medium  Grok 4.7 Medium',
  'claude-sonnet-4-thinking-low  Claude Sonnet 4 Thinking Low',
  'claude-sonnet-4-thinking-high  Claude Sonnet 4 Thinking High',
  'claude-opus-4-thinking-low  Claude Opus 4 Thinking Low',
  'claude-opus-4-thinking-max  Claude Opus 4 Thinking Max',
  'gpt-5.6-sol-extra-high-fast  GPT-5.6 Sol Extra High Fast',
  'composer-2.5-fast  Fast Composer',
  'composer-2.5  Composer',
  'auto  Automatic',
].join('\n')

/** 与主进程同口径的首 token 提取（渲染端单测本地复刻，不跨层 import 主进程）。 */
const DASH_CATALOG: string[] = CURSOR_AGENT_MODELS_STDOUT.split('\n')
  .map((line) => line.trim().replace(/^\*\s*/, '').split(/\s+/)[0] ?? '')
  .filter((id) => id.length > 0)

describe('pickDashCounterpart（横杠受控尝试，精确匹配才试）', () => {
  it('grok fast 对子命中：开→关去 `-fast`，关→开加 `-fast`', () => {
    expect(
      pickDashCounterpart(DASH_CATALOG, 'grok-4.7[context=256k,reasoning_effort=high,fast=true]', {
        key: 'fast',
        value: 'false',
      }),
    ).toBe('grok-4.7-high')
    expect(
      pickDashCounterpart(DASH_CATALOG, 'grok-4.7[context=256k,reasoning_effort=high,fast=false]', {
        key: 'fast',
        value: 'true',
      }),
    ).toBe('grok-4.7-high-fast')
  })

  it('fast 取值接受 on/off 别名', () => {
    expect(
      pickDashCounterpart(DASH_CATALOG, 'grok-4.7[context=256k,reasoning_effort=high,fast=true]', {
        key: 'fast',
        value: 'off',
      }),
    ).toBe('grok-4.7-high')
    expect(
      pickDashCounterpart(DASH_CATALOG, 'grok-4.7[context=256k,reasoning_effort=medium,fast=false]', {
        key: 'fast',
        value: 'on',
      }),
    ).toBe('grok-4.7-medium-fast')
  })

  it('claude thinking 中缀系列命中（effort 替换，fast 与当前一致）', () => {
    // 当前无 fast 视为关 → 目标须为非 -fast 版
    expect(
      pickDashCounterpart(DASH_CATALOG, 'claude-sonnet-4[reasoning_effort=low]', {
        key: 'reasoning_effort',
        value: 'high',
      }),
    ).toBe('claude-sonnet-4-thinking-high')
    expect(
      pickDashCounterpart(DASH_CATALOG, 'claude-opus-4[reasoning_effort=low]', {
        key: 'reasoning_effort',
        value: 'max',
      }),
    ).toBe('claude-opus-4-thinking-max')
  })

  it('多词档位归一化：`Extra High` ≡ `extra-high`', () => {
    expect(
      pickDashCounterpart(DASH_CATALOG, 'gpt-5.6-sol[reasoning_effort=Extra High,fast=false]', {
        key: 'fast',
        value: 'true',
      }),
    ).toBe('gpt-5.6-sol-extra-high-fast')
  })

  it('多命中取字典序首个', () => {
    const catalog = ['grok-4.7-xhigh', 'grok-4.7-x-high', 'grok-4.7-high']
    // x-high 与 xhigh 归一同值，并列时 `-`（45）< `h`（104），x-high 居首
    expect(
      pickDashCounterpart(catalog, 'grok-4.7[reasoning_effort=xhigh,fast=false]', {
        key: 'fast',
        value: 'false',
      }),
    ).toBe('grok-4.7-x-high')
  })

  it('无对应一律 null：档位无对子 / fast 单边 / 异 base / 空目录', () => {
    // grok 无 low 档
    expect(
      pickDashCounterpart(DASH_CATALOG, 'grok-4.7[context=256k,reasoning_effort=low,fast=true]', {
        key: 'fast',
        value: 'false',
      }),
    ).toBeNull()
    // gpt extra-high 只有 fast 版，关无对应
    expect(
      pickDashCounterpart(DASH_CATALOG, 'gpt-5.6-sol[reasoning_effort=Extra High,fast=true]', {
        key: 'fast',
        value: 'false',
      }),
    ).toBeNull()
    // 前缀边界：`composer-2.5` 不得命中 `composer-2.50`（须 `base-` 边界）
    expect(
      pickDashCounterpart(['composer-2.50'], 'composer-2.5[fast=true]', {
        key: 'fast',
        value: 'false',
      }),
    ).toBeNull()
    expect(
      pickDashCounterpart(DASH_CATALOG, 'missing-model[reasoning_effort=high,fast=true]', {
        key: 'fast',
        value: 'false',
      }),
    ).toBeNull()
    expect(
      pickDashCounterpart([], 'grok-4.7[reasoning_effort=high,fast=true]', {
        key: 'fast',
        value: 'false',
      }),
    ).toBeNull()
  })

  it('暧昧即 null：未知 fast/档位词、非 fast/思考 key、空入参、方括号行跳过', () => {
    const bracket = 'grok-4.7[context=256k,reasoning_effort=high,fast=true]'
    expect(pickDashCounterpart(DASH_CATALOG, bracket, { key: 'fast', value: 'maybe' })).toBeNull()
    expect(
      pickDashCounterpart(DASH_CATALOG, 'claude-sonnet-4[reasoning_effort=low]', {
        key: 'reasoning_effort',
        value: 'ultra',
      }),
    ).toBeNull()
    expect(
      pickDashCounterpart(DASH_CATALOG, bracket, { key: 'context', value: '500k' }),
    ).toBeNull()
    expect(pickDashCounterpart(DASH_CATALOG, '', { key: 'fast', value: 'false' })).toBeNull()
    expect(pickDashCounterpart(DASH_CATALOG, bracket, { key: '', value: 'false' })).toBeNull()
    expect(pickDashCounterpart([1, null, undefined], bracket, { key: 'fast', value: 'false' })).toBeNull()
    // 目录混入方括号行时跳过（只认横杠 canonical）
    expect(
      pickDashCounterpart(
        ['grok-4.7[context=256k,reasoning_effort=high,fast=false]', ...DASH_CATALOG],
        bracket,
        { key: 'fast', value: 'false' },
      ),
    ).toBe('grok-4.7-high')
  })
})
