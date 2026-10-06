import { describe, expect, it } from 'vitest'
import {
  currentLabel,
  findFastToggle,
  isSelectOption,
  rankPrimary,
  selectFastDefaultOffTarget,
  splitConfigOptions,
} from './acp-config-menu'
import type { AcpConfigOption } from '@montree/contracts'

function opt(partial: Partial<AcpConfigOption> & Pick<AcpConfigOption, 'configId' | 'name'>): AcpConfigOption {
  return { type: 'select', options: [{ value: 'a', name: 'A' }], currentValue: 'a', ...partial } as AcpConfigOption
}

function bool(partial: Partial<AcpConfigOption> & Pick<AcpConfigOption, 'configId' | 'name'>): AcpConfigOption {
  return { type: 'boolean', currentValue: false, ...partial } as AcpConfigOption
}

describe('isSelectOption', () => {
  it('boolean 类型不参与菜单', () => {
    expect(isSelectOption({ type: 'boolean', configId: 'x', name: 'X' } as AcpConfigOption)).toBe(false)
  })
  it('无选项列表不参与菜单', () => {
    expect(isSelectOption(opt({ configId: 'nonselect', name: 'N', options: [] }))).toBe(false)
  })
  it('category 白名单命中', () => {
    expect(isSelectOption(opt({ configId: 'whatever', name: 'Whatever', category: 'model_config' }))).toBe(true)
  })
  it('无 category 时按名称正则兜底', () => {
    expect(isSelectOption(opt({ configId: 'reasoning-effort', name: '推理档' }))).toBe(true)
    expect(isSelectOption(opt({ configId: 'effort', name: 'Effort' }))).toBe(true)
    expect(isSelectOption(opt({ configId: 'color', name: '颜色' }))).toBe(false)
  })
})

describe('rankPrimary / splitConfigOptions', () => {
  it('mode→0、model→1、thought→2，primary 按 rank 定序', () => {
    const { primary, secondary } = splitConfigOptions([
      opt({ configId: 'thought_level', name: '思考档', category: 'thought_level' }),
      opt({ configId: 'session-mode', name: '模式', category: 'mode' }),
      opt({ configId: 'model', name: '模型', category: 'model' }),
    ])
    expect(primary.map((o) => o.configId)).toEqual(['session-mode', 'model', 'thought_level'])
    expect(secondary).toHaveLength(0)
  })

  it('同一 rank 第二个起进 secondary；name 含 collab 的 mode 不占 primary', () => {
    const { primary, secondary } = splitConfigOptions([
      opt({ configId: 'collab-mode', name: 'Collab Mode', category: 'mode' }),
      opt({ configId: 'session-mode', name: 'Mode', category: 'mode' }),
      opt({ configId: 'model', name: 'Model', category: 'model' }),
      opt({ configId: 'model-fast', name: 'Fast Model' }),
    ])
    expect(primary.map((o) => o.configId)).toEqual(['session-mode', 'model'])
    expect(secondary.map((o) => o.configId)).toEqual(['collab-mode', 'model-fast'])
  })

  it('rankPrimary：无关项返回 null；复合词仅靠自身不命中 mode', () => {
    expect(rankPrimary(opt({ configId: 'verbosity', name: 'Verbose' }))).toBeNull()
    expect(rankPrimary(opt({ configId: 'session-mode', name: '模式' }))).toBeNull()
    expect(rankPrimary(opt({ configId: 'model-fast', name: 'Fast Model' }))).toBe(1)
  })

  it('rankPrimary：effort 本体命中思考档（rank2）', () => {
    expect(rankPrimary(opt({ configId: 'effort', name: 'Effort' }))).toBe(2)
    expect(rankPrimary(opt({ configId: 'reasoning-effort', name: '推理档' }))).toBe(2)
  })

  it('rankPrimary：context 命中 rank3（id / category / 大小写）', () => {
    expect(rankPrimary(opt({ configId: 'context', name: 'Context' }))).toBe(3)
    expect(rankPrimary(opt({ configId: 'CONTEXT', name: '上下文' }))).toBe(3)
    expect(rankPrimary(opt({ configId: 'ctx-window', name: 'Ctx' }))).toBe(3)
    expect(rankPrimary(opt({ configId: 'whatever', name: 'Whatever', category: 'context' }))).toBe(3)
  })

  it('primary 四位定序：mode0/model1/thought2/context3', () => {
    const { primary, secondary } = splitConfigOptions([
      opt({ configId: 'context', name: 'Context', category: 'context' }),
      opt({ configId: 'thought_level', name: '思考档', category: 'thought_level' }),
      opt({ configId: 'model', name: '模型', category: 'model' }),
      opt({ configId: 'session-mode', name: '模式', category: 'mode' }),
    ])
    expect(primary.map((o) => o.configId)).toEqual(['session-mode', 'model', 'thought_level', 'context'])
    expect(secondary).toHaveLength(0)
  })

  it('isSelectOption：context 下拉可进菜单（category 与 id 正则双路）', () => {
    expect(isSelectOption(opt({ configId: 'whatever', name: 'Whatever', category: 'context' }))).toBe(true)
    expect(isSelectOption(opt({ configId: 'context', name: 'Context' }))).toBe(true)
    expect(isSelectOption(opt({ configId: 'CTX', name: '上下文' }))).toBe(true)
  })

  it('splitConfigOptions：boolean 开关不进 primary，直接跟进 secondary', () => {
    const fast = {
      type: 'boolean',
      configId: 'fast-mode',
      name: '快速模式',
      currentValue: true,
    } as AcpConfigOption
    const verbose = {
      type: 'boolean',
      configId: 'verbose',
      name: '详细输出',
      currentValue: false,
    } as AcpConfigOption
    const { primary, secondary, fastToggle } = splitConfigOptions([
      opt({ configId: 'model', name: '模型', category: 'model' }),
      fast,
      verbose,
    ])
    expect(primary.map((o) => o.configId)).toEqual(['model'])
    // fast 命中项单列，不再进 secondary，避免输入栏与更多设置重复
    expect(fastToggle?.configId).toBe('fast-mode')
    expect(secondary.map((o) => o.configId)).toEqual(['verbose'])
  })

  it('splitConfigOptions：无 fast 项时 fastToggle 为 null，界面零变化', () => {
    const { primary, secondary, fastToggle } = splitConfigOptions([
      opt({ configId: 'model', name: '模型', category: 'model' }),
      bool({ configId: 'verbose', name: '详细输出' }),
    ])
    expect(fastToggle).toBeNull()
    expect(primary.map((o) => o.configId)).toEqual(['model'])
    expect(secondary.map((o) => o.configId)).toEqual(['verbose'])
  })
})

describe('findFastToggle', () => {
  it('configId 大小写命中', () => {
    expect(findFastToggle([bool({ configId: 'FAST-mode', name: '极速' })])?.configId).toBe('FAST-mode')
    expect(findFastToggle([bool({ configId: 'enable-fast-path', name: '加速' })])?.configId).toBe(
      'enable-fast-path',
    )
  })
  it('name 大小写命中（category 不限）', () => {
    expect(
      findFastToggle([bool({ configId: 'speed', name: 'Fast Mode', category: 'model' })])?.configId,
    ).toBe('speed')
  })
  it('非 boolean 不命中', () => {
    expect(findFastToggle([opt({ configId: 'fast-model', name: 'Fast Model' })])).toBeNull()
  })
  it('多项取首个；无此项返回 null', () => {
    const first = bool({ configId: 'fast-one', name: 'Fast One' })
    const second = bool({ configId: 'fast-two', name: 'Fast Two' })
    expect(findFastToggle([first, second])).toBe(first)
    expect(findFastToggle([bool({ configId: 'verbose', name: '详细' })])).toBeNull()
  })
})

describe('parameterizedModelPicker 声明后的 cursor 形状', () => {
  // cursor-agent 在 clientCapabilities._meta.parameterizedModelPicker=true 后下发
  // 朴素模型值 + 独立 fast 项 + 独立 thinking 项；以下为 parseAcpConfigOptions 之后形状
  // （parse 兼容见 packages/acp/src/session/config-options.test.ts：布尔选项值转 string，
  // boolean currentValue 原样保留）。
  function cursorOptions(): AcpConfigOption[] {
    return [
      opt({
        configId: 'model',
        name: 'Model',
        category: 'model',
        currentValue: 'grok-4.7',
        options: [
          { value: 'grok-4.7', name: 'grok-4.7' },
          { value: 'claude-sonnet-4', name: 'claude-sonnet-4' },
        ],
      }),
      bool({ configId: 'fast', name: 'Fast', currentValue: false }),
      opt({
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

  it('独立 fast 项点亮输入栏开关（不进 secondary）', () => {
    const options = cursorOptions()
    const fast = findFastToggle(options)
    expect(fast?.configId).toBe('fast')
    const { fastToggle, secondary } = splitConfigOptions(options)
    expect(fastToggle?.configId).toBe('fast')
    expect(secondary.some((o) => o.configId === 'fast')).toBe(false)
  })

  it('select 型 fast（含 fast 字样，布尔值已转 string）同样可进菜单', () => {
    const selectFast = opt({
      configId: 'fast',
      name: 'Fast',
      currentValue: 'false',
      options: [
        { value: 'false', name: 'Off' },
        { value: 'true', name: 'Fast' },
      ],
    })
    expect(isSelectOption(selectFast)).toBe(true)
  })

  // Cursor 原生五个独立维度 → 参数化五件套：mode + 朴素 model + 独立 thinking + 独立 fast + 独立 context
  function cursorFivePiece(): AcpConfigOption[] {
    return [
      opt({
        configId: 'session-mode',
        name: 'Agent 模式',
        category: 'mode',
        currentValue: 'agent',
        options: [
          { value: 'agent', name: 'Agent' },
          { value: 'plan', name: 'Plan' },
        ],
      }),
      opt({
        configId: 'model',
        name: 'Model',
        category: 'model',
        currentValue: 'grok-4.7',
        options: [
          { value: 'grok-4.7', name: 'grok-4.7' },
          { value: 'claude-sonnet-4', name: 'claude-sonnet-4' },
        ],
      }),
      opt({
        configId: 'reasoning-effort',
        name: 'Reasoning effort',
        currentValue: 'high',
        options: [
          { value: 'low', name: 'Low' },
          { value: 'medium', name: 'Medium' },
          { value: 'high', name: 'High' },
        ],
      }),
      bool({ configId: 'fast', name: 'Fast', currentValue: true }),
      opt({
        configId: 'context',
        name: 'Context',
        category: 'context',
        currentValue: '256k',
        options: [
          { value: '256k', name: '256K' },
          { value: '500k', name: '500K' },
        ],
      }),
    ]
  }

  it('cursor 参数化五件套全点亮：primary 四下拉 + fast 独立开关', () => {
    const { primary, secondary, fastToggle } = splitConfigOptions(cursorFivePiece())
    expect(primary.map((o) => o.configId)).toEqual(['session-mode', 'model', 'reasoning-effort', 'context'])
    expect(fastToggle?.configId).toBe('fast')
    expect(secondary.some((o) => o.configId === 'fast')).toBe(false)
  })

  it('缺 fast 时其余正常且无报错：primary 四下拉照旧，fastToggle 为 null', () => {
    const options = cursorFivePiece().filter((o) => o.configId !== 'fast')
    const { primary, secondary, fastToggle } = splitConfigOptions(options)
    expect(fastToggle).toBeNull()
    expect(primary.map((o) => o.configId)).toEqual(['session-mode', 'model', 'reasoning-effort', 'context'])
    expect(secondary).toHaveLength(0)
  })
})

describe('selectFastDefaultOffTarget', () => {
  const RUNTIME = 'codex-acp'
  it('无偏好 + 默认开 → 返回该项（调用方置 false 并记住）', () => {
    const fast = bool({ configId: 'fast-mode', name: 'Fast', currentValue: true })
    expect(selectFastDefaultOffTarget([fast], {}, RUNTIME)).toBe(fast)
  })
  it('有偏好 → 不动（用户拨过之后为准）', () => {
    const fast = bool({ configId: 'fast-mode', name: 'Fast', currentValue: true })
    expect(selectFastDefaultOffTarget([fast], { [RUNTIME]: { 'fast-mode': 'true' } }, RUNTIME)).toBeNull()
    expect(selectFastDefaultOffTarget([fast], { [RUNTIME]: { 'fast-mode': 'false' } }, RUNTIME)).toBeNull()
  })
  it('默认已关 → 不调用', () => {
    expect(
      selectFastDefaultOffTarget([bool({ configId: 'fast-mode', name: 'Fast', currentValue: false })], {}, RUNTIME),
    ).toBeNull()
  })
  it('无 fast 项 → 不调用', () => {
    expect(selectFastDefaultOffTarget([bool({ configId: 'verbose', name: '详细', currentValue: true })], {}, RUNTIME)).toBeNull()
  })
})

describe('currentLabel', () => {
  it('命中选项名；无当前值时回退选项组名', () => {
    expect(
      currentLabel({
        configId: 'model',
        name: '模型',
        type: 'select',
        options: [
          { value: 'a', name: 'Alpha' },
          { value: 'b', name: 'Beta' },
        ],
        currentValue: 'b',
      }),
    ).toBe('Beta')
    expect(currentLabel({ configId: 'model', name: '模型' } as AcpConfigOption)).toBe('模型')
  })
})
