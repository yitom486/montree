import type { AcpConfigOption, AcpConfigOptionValue } from "../contracts"

/** 选项值 coercion：string 原样（空串视为缺失），number/boolean 转 string；其余返回 null。 */
function coerceOptionValue(raw: unknown): string | null {
  if (typeof raw === 'string') return raw || null
  if (typeof raw === 'number' && Number.isFinite(raw)) return String(raw)
  if (typeof raw === 'boolean') return String(raw)
  return null
}

/** currentValue coercion：string/boolean 原样保留，number 转 string；其余返回 undefined。 */
function coerceCurrentValue(raw: unknown): string | boolean | undefined {
  if (typeof raw === 'string') return raw
  if (typeof raw === 'boolean') return raw
  if (typeof raw === 'number' && Number.isFinite(raw)) return String(raw)
  return undefined
}

export function parseAcpConfigOptions(raw: unknown): AcpConfigOption[] {
  if (!Array.isArray(raw)) return []
  const options: AcpConfigOption[] = []
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue
    const row = item as Record<string, unknown>
    const configId =
      typeof row.configId === 'string'
        ? row.configId
        : typeof row.id === 'string'
          ? row.id
          : null
    if (!configId) continue
    const name = typeof row.name === 'string' ? row.name : configId
    const type = typeof row.type === 'string' ? row.type : 'select'
    const values: AcpConfigOptionValue[] = []
    if (Array.isArray(row.options)) {
      for (const opt of row.options) {
        if (!opt || typeof opt !== 'object') continue
        const o = opt as Record<string, unknown>
        // 声明 parameterizedModelPicker 后 cursor 下发布尔/数字型选项值
        // （如 { value: false, name: 'Off' }），统一转 string 存（AcpConfigOptionValue.value 仍为 string）。
        const value = coerceOptionValue(o.value) ?? coerceOptionValue(o.id)
        if (!value) continue
        values.push({
          value,
          name: typeof o.name === 'string' ? o.name : String(value),
          description: typeof o.description === 'string' ? o.description : undefined,
        })
      }
    }
    options.push({
      configId,
      name,
      description: typeof row.description === 'string' ? row.description : undefined,
      category: typeof row.category === 'string' ? row.category : undefined,
      type,
      // boolean 原样保留（Boolean(currentValue) 语义：'false' 字符串会误判为真）；
      // number 转 string 以便与字符串化后的 options 对齐。
      currentValue: coerceCurrentValue(row.currentValue),
      options: values.length > 0 ? values : undefined,
    })
  }
  return options
}

export function findModelConfigOption(options: AcpConfigOption[]): AcpConfigOption | undefined {
  return (
    options.find((o) => o.category === 'model') ??
    options.find((o) => o.configId === 'model' || o.configId.includes('model'))
  )
}

/** 单个模型条目 coercion：string 取原串；{id|value/name} 对象取对应字段。 */
function coerceTopLevelModelEntry(raw: unknown): { value: string; name: string } | null {
  if (typeof raw === 'string') {
    const trimmed = raw.trim()
    if (!trimmed) return null
    return { value: trimmed, name: trimmed }
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const row = raw as Record<string, unknown>
  const valueRaw = row.value ?? row.id
  const value = coerceOptionValue(valueRaw)
  if (!value) return null
  const name = typeof row.name === 'string' && row.name.trim() ? row.name : value
  return { value, name }
}

function coerceTopLevelModelList(raw: unknown): { value: string; name: string }[] {
  if (!Array.isArray(raw)) return []
  const out: { value: string; name: string }[] = []
  for (const item of raw) {
    const coerced = coerceTopLevelModelEntry(item)
    if (coerced) out.push(coerced)
  }
  return out
}

/**
 * dsh 方言兼容：session/new（及 load）返回顶层 `models`，而 SDK
 * NewSessionResponse schema 仅有 sessionId/modes/configOptions。
 * 顶层 models 属于 agent 方言：数组（string 或 {id|value/name} 对象），
 * 或 {availableModels, currentModelId} 对象形。
 * 无 model 类 configOption 时合成一项 {configId:'model', category:'model'}，
 * 已有则不覆盖（调用方先 parse 再判定）。
 */
export function synthesizeModelOptionFromTopLevelModels(
  models: unknown,
  response?: Record<string, unknown>,
): AcpConfigOption | null {
  let list: { value: string; name: string }[] = []
  let currentValue: string | undefined
  if (Array.isArray(models)) {
    list = coerceTopLevelModelList(models)
  } else if (models && typeof models === 'object' && !Array.isArray(models)) {
    const row = models as Record<string, unknown>
    list = coerceTopLevelModelList(row.availableModels)
    const currentRaw = row.currentModelId ?? response?.currentModelId
    if (typeof currentRaw === 'string' && currentRaw.trim()) currentValue = currentRaw
  } else {
    return null
  }
  if (list.length === 0) return null
  // currentModelId 兜底：对象形自身缺失时看响应顶层
  if (!currentValue && response && typeof response.currentModelId === 'string') {
    const trimmed = response.currentModelId.trim()
    if (trimmed) currentValue = trimmed
  }
  return {
    configId: 'model',
    name: 'Model',
    category: 'model',
    type: 'select',
    ...(currentValue ? { currentValue } : {}),
    options: list.map((item) => ({ value: item.value, name: item.name })),
  }
}

/**
 * session/new（及 load/resume）响应合并：已有 model 类 configOption 直接返回原样；
 * 否则顶层 `models` 存在时合成一项追加。返回仍为未知形状，由调用方再 parse。
 */
export function mergeTopLevelModelsIntoConfigOptions(
  configOptionsRaw: unknown,
  response: Record<string, unknown> | null | undefined,
): unknown {
  const parsed = parseAcpConfigOptions(configOptionsRaw)
  if (findModelConfigOption(parsed)) return configOptionsRaw
  const models = response?.models
  if (models === undefined) return configOptionsRaw
  const synthesized = synthesizeModelOptionFromTopLevelModels(
    models,
    response ?? undefined,
  )
  if (!synthesized) return configOptionsRaw
  const base = Array.isArray(configOptionsRaw) ? [...configOptionsRaw] : []
  base.push({
    configId: synthesized.configId,
    name: synthesized.name,
    category: synthesized.category,
    type: synthesized.type,
    ...(synthesized.currentValue !== undefined
      ? { currentValue: synthesized.currentValue }
      : {}),
    options: synthesized.options?.map((o: AcpConfigOptionValue) => ({ value: o.value, name: o.name })),
  })
  return base
}
