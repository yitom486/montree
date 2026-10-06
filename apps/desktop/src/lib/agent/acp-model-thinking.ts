import type { AcpConfigOption } from '@montree/contracts'
import { rankPrimary } from './acp-config-menu'

/** 尾缀档位可设：思考类 key（`name[k=v,…]` 内嵌）与 `fast` 开关均编码在模型值尾缀。 */
export const MODEL_THINKING_KEYS = [
  'reasoning_effort',
  'effort',
  'reasoning',
  'thinking',
] as const

const THINKING_SET = new Set<string>(MODEL_THINKING_KEYS)

export interface ModelVariant {
  base: string
  params: Record<string, string>
}

/**
 * 解析模型 variant：`name[k=v,…]` → `{ base, params }`。
 * 无尾缀回退 `{ base: 全串, params: {} }`；空尾缀（`default[]`）回退 params `{}`；
 * 裸值段（无 `=`，如 `m[high]`）跳过（由 `extractModelSuffixThinking` 负责只读展示）。
 */
export function parseModelVariant(value: unknown): ModelVariant {
  if (typeof value !== 'string') return { base: '', params: {} }
  const text = value.trim()
  if (!text) return { base: '', params: {} }
  const m = /\[(.*)\]$/.exec(text)
  if (!m) return { base: text, params: {} }
  const base = text.slice(0, m.index).trim()
  const raw = m[1]!.trim()
  const params: Record<string, string> = {}
  if (!raw) return { base, params }
  for (const part of raw.split(',')) {
    const seg = part.trim()
    if (!seg) continue
    const eq = seg.indexOf('=')
    if (eq < 0) continue
    const k = seg.slice(0, eq).trim()
    const v = seg.slice(eq + 1).trim()
    if (!k) continue
    params[k] = v
  }
  return { base, params }
}

/** params 按插入顺序取首个思考类 key；无则返回 null。 */
export function findVariantThinkingKey(params: Record<string, string>): string | null {
  for (const k of Object.keys(params)) {
    if (THINKING_SET.has(k)) return k
  }
  return null
}

/**
 * 同 base variant 的思考类 key 值去重（保持首见顺序）。
 * 调用方判定 `≥2` 才可设下拉；单 variant（如 grok-4.7）仅 1 个，不可用。
 */
export function collectThinkingCandidates(
  currentBase: string,
  allValues: readonly unknown[],
): string[] {
  const base = currentBase.trim()
  if (!base) return []
  const seen = new Set<string>()
  const out: string[] = []
  for (const item of allValues) {
    if (typeof item !== 'string') continue
    const parsed = parseModelVariant(item)
    if (parsed.base !== base) continue
    for (const k of Object.keys(parsed.params)) {
      if (!THINKING_SET.has(k)) continue
      const v = parsed.params[k]!.trim()
      if (!v || seen.has(v)) continue
      seen.add(v)
      out.push(v)
    }
  }
  return out
}

/**
 * 保守改写门槛：在 Agent 下发的 model options 列表里找同 base 且除目标 key 外其余 param 全等的 variant。
 * 只返回 listed 原值（原样回传，不手搓）；找不到返回 null，调用方不得发起 set（Agent 会拒收未 listed id）。
 */
export function findListedVariantId(
  allValues: readonly unknown[],
  current: Pick<ModelVariant, 'base' | 'params'>,
  patch: { key: string; value: string },
): string | null {
  const base = current.base.trim()
  const targetKey = patch.key.trim()
  const targetValue = patch.value.trim()
  if (!base || !targetKey || !targetValue) return null
  for (const item of allValues) {
    if (typeof item !== 'string') continue
    const parsed = parseModelVariant(item)
    if (parsed.base !== base) continue
    const listedTarget = parsed.params[targetKey]
    if (listedTarget == null || listedTarget.trim() !== targetValue) continue
    const currentKeys = Object.keys(current.params).filter((k) => k !== targetKey)
    const listedKeys = Object.keys(parsed.params).filter((k) => k !== targetKey)
    if (currentKeys.length !== listedKeys.length) continue
    let equal = true
    for (const k of currentKeys) {
      const a = (current.params[k] ?? '').trim()
      const b = (parsed.params[k] ?? '').trim()
      if (!(k in parsed.params) || a !== b) {
        equal = false
        break
      }
    }
    if (!equal) continue
    return item
  }
  return null
}

/**
 * Agent 下发的 model options listed 原值列表（仅字符串）。
 * 保守策略只认 listed，currentValue 再新也不得作为改写目标依据。
 */
export function listedModelOptionValues(model: AcpConfigOption): string[] {
  return (model.options ?? [])
    .map((o) => o.value)
    .filter((v): v is string => typeof v === 'string')
}

/**
 * 横杠 canonical 目录（`agent models` / `--list-models` 同源）受控尝试：
 * 方括号 variants（如 `grok-4.7[context=256k,reasoning_effort=high,fast=true]`）与
 * 横杠 canonical（如 `grok-4.7-high` / `grok-4.7-high-fast`）是双命名空间，
 * 方括号↔横杠无可靠机械映射（thinking 中缀时有时无），禁止硬编码推导。
 * 本函数只做精确匹配，任一步暧昧即 null（宁缺勿试）；命中仍经同一 setModel
 * 下发，Agent 拒收时由调用方单 toast + 保持旧值兜底。
 */

const DASH_EFFORT_SET = new Set([
  'low',
  'medium',
  'high',
  'xhigh',
  'max',
  'minimal',
  'none',
  'extrahigh',
])

/** effort 词归一化：大小写/连字符/下划线/空格不敏感（`Extra High`≡`extra-high`≡`extrahigh`）。未知词返回 null。 */
function normalizeDashEffortWord(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  const compact = raw.trim().toLowerCase().replace(/[-_\s]+/g, '')
  if (!compact) return null
  return DASH_EFFORT_SET.has(compact) ? compact : null
}

/** fast 目标归一化：`true`/`on`→开，`false`/`off`→关；其余一律 null（暧昧不试）。 */
function normalizeFastTarget(raw: unknown): boolean | null {
  if (typeof raw !== 'string') return null
  const v = raw.trim().toLowerCase()
  if (v === 'true' || v === 'on') return true
  if (v === 'false' || v === 'off') return false
  return null
}

/** 方括号当前值 fast 归一化：缺席返回 null（由调用方按场景解释），不可识别亦 null。 */
function normalizeBracketFast(params: Record<string, string>): boolean | null {
  if (!('fast' in params)) return null
  return normalizeFastTarget(params['fast'])
}

interface ParsedDashCandidate {
  id: string
  effort: string | null
  fast: boolean
}

/**
 * 横杠候选解析：须以 currentBase 开头（含 `base-` 边界，避免 `grok-4.7` 误命中 `grok-4.70-x`）；
 * 含 `[` 的非 canonical 行直接丢弃；尾部 `-fast` 判快慢；剩余段去 `thinking` 中缀后整体
 * 归一化为 effort（`extra-high` 拆 token 后 join 仍可命中 `extrahigh`，多余词则 null）。
 * 前缀不符或形状不可判定返回 null。
 */
function parseDashCandidate(candidate: string, base: string): ParsedDashCandidate | null {
  if (candidate.includes('[')) return null
  let rest: string
  if (candidate === base) {
    rest = ''
  } else if (candidate.startsWith(`${base}-`)) {
    rest = candidate.slice(base.length + 1)
  } else {
    return null
  }
  let fast = false
  if (/^fast$/i.test(rest)) {
    fast = true
    rest = ''
  } else if (/-fast$/i.test(rest)) {
    fast = true
    rest = rest.slice(0, rest.length - '-fast'.length)
  }
  if (!rest) return { id: candidate, effort: null, fast }
  const meaningful = rest
    .split('-')
    .map((t) => t.trim())
    .filter((t) => t.length > 0 && t.toLowerCase() !== 'thinking')
  if (meaningful.length === 0) return { id: candidate, effort: null, fast }
  const effort = normalizeDashEffortWord(meaningful.join(''))
  // 剩余段含非 effort 词（如子型号）时 effort 判 null，由外层按一致性过滤掉
  if (effort == null) return { id: candidate, effort: null, fast }
  return { id: candidate, effort, fast }
}

/**
 * 横杠对应精确匹配：listed 门槛未命中后的最后候补。
 * - `patch.key==='fast'`：effort 须与当前一致（归一化比对），fast 按目标取反
 *  （含 `-fast` 后缀 vs 无）；`value` 接受 `true`/`false`/`on`/`off`。
 * - 思考档（`patch.key` 为思考类 key）：effort 须等于目标值，fast 与当前一致
 *  （当前无 fast 视为关）；目标 effort 未知词即 null。
 * - 多命中取字典序首个；目录缺席/非字符串条目跳过；零命中返回 null。
 */
export function pickDashCounterpart(
  catalog: readonly unknown[],
  currentBracket: string,
  patch: { key: string; value: string },
): string | null {
  const targetKey = patch.key?.trim() ?? ''
  const targetValue = patch.value?.trim() ?? ''
  if (!targetKey || !targetValue) return null
  const parsed = parseModelVariant(currentBracket)
  const base = parsed.base.trim()
  if (!base) return null
  const isFastPatch = targetKey.toLowerCase() === 'fast'
  const isThinkingPatch = !isFastPatch && THINKING_SET.has(targetKey)
  if (!isFastPatch && !isThinkingPatch) return null

  const thinkingKey = findVariantThinkingKey(parsed.params)
  const currentEffort =
    thinkingKey && parsed.params[thinkingKey] != null
      ? normalizeDashEffortWord(parsed.params[thinkingKey])
      : null
  // 当前有思考 key 但值不可归一化（如 Agent 新档位词）→ 暧昧不试
  if (thinkingKey && currentEffort == null && String(parsed.params[thinkingKey] ?? '').trim()) {
    return null
  }

  let wantEffort: string | null = null
  let wantFast: boolean | null = null
  if (isFastPatch) {
    wantFast = normalizeFastTarget(targetValue)
    if (wantFast == null) return null
    wantEffort = currentEffort
  } else {
    wantEffort = normalizeDashEffortWord(targetValue)
    if (wantEffort == null) return null
    const currentFast = normalizeBracketFast(parsed.params)
    // 当前 fast 缺席视为关； present 但不可识别 → 暧昧不试
    if ('fast' in parsed.params && currentFast == null) return null
    wantFast = currentFast ?? false
  }

  const hits: string[] = []
  for (const item of catalog) {
    if (typeof item !== 'string') continue
    const id = item.trim()
    if (!id) continue
    const dash = parseDashCandidate(id, base)
    if (!dash) continue
    if (dash.effort !== wantEffort) continue
    if (dash.fast !== wantFast) continue
    hits.push(id)
  }
  if (hits.length === 0) return null
  hits.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
  return hits[0] ?? null
}
/**
 * 从模型 currentValue 尾缀提取内嵌思考档（`name[k=v,…]` / `name[档]`）。
 * reasoning_effort/effort/reasoning 取值原文；thinking 按开/关折成 on/off；无等号取裸值。
 */
export function extractModelSuffixThinking(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const text = value.trim()
  if (!text) return null
  const m = /\[(.*)\]$/.exec(text)
  if (!m) return null
  const raw = m[1]!.trim()
  if (!raw) return null
  if (!raw.includes('=')) return raw
  for (const part of raw.split(',')) {
    const eq = part.indexOf('=')
    if (eq < 0) continue
    const k = part.slice(0, eq).trim()
    const v = part.slice(eq + 1).trim()
    if (!k) continue
    if (k === 'reasoning_effort' || k === 'effort' || k === 'reasoning') return v || 'on'
    if (k === 'thinking') return v === 'false' ? 'off' : 'on'
  }
  return null
}

/**
 * 只读思考徽标条件：primary 无独立思考档（rank2）时，取模型项尾缀档位；否则返回 null。
 */
export function selectReadonlyModelThinking(primary: AcpConfigOption[]): string | null {
  if (primary.some((o) => rankPrimary(o) === 2)) return null
  const model = primary.find((o) => rankPrimary(o) === 1)
  if (!model) return null
  return extractModelSuffixThinking(model.currentValue)
}

export interface ModelThinkingControl {
  configId: string
  base: string
  key: string
  current: string
  params: Record<string, string>
  candidates: string[]
}

/**
 * 可设思考下拉条件（只读徽标升级版）：无 rank2 且当前模型尾缀含思考类 key，
 * 同 base listed 候选先收集，再过滤到“存在 listed 改写目标”的档位（其余 param 全等），
 * 过滤后≥2 才返回；否则返回 null（保持只读徽标）。
 * current 兜底并入候选首位，保证下拉 value 始终合法。
 */
export function selectModelThinkingControl(
  primary: AcpConfigOption[],
): ModelThinkingControl | null {
  if (primary.some((o) => rankPrimary(o) === 2)) return null
  const model = primary.find((o) => rankPrimary(o) === 1)
  if (!model || typeof model.currentValue !== 'string') return null
  const parsed = parseModelVariant(model.currentValue)
  if (!parsed.base) return null
  const key = findVariantThinkingKey(parsed.params)
  if (!key) return null
  const current = parsed.params[key]!.trim()
  if (!current) return null
  const listedValues = listedModelOptionValues(model)
  let candidates = collectThinkingCandidates(parsed.base, listedValues)
  if (!candidates.includes(current)) candidates = [current, ...candidates]
  // 保守过滤：非当前档必须存在同 base、其余 param 全等的 listed 目标 id，否则不可切
  candidates = candidates.filter(
    (c) =>
      c === current ||
      findListedVariantId(listedValues, { base: parsed.base, params: parsed.params }, { key, value: c }) != null,
  )
  if (candidates.length < 2) return null
  return {
    configId: model.configId,
    base: parsed.base,
    key,
    current,
    params: parsed.params,
    candidates,
  }
}

export interface SuffixFastState {
  configId: string
  base: string
  checked: boolean
  params: Record<string, string>
}

/**
 * 尾缀版 fast 开关状态：模型尾缀含 `fast=true|false` 时返回，否则 null。
 * 有值时优先于 boolean 版 `findFastToggle`（两者互斥，尾缀优先）。
 */
export function selectSuffixFastState(
  primary: AcpConfigOption[],
): SuffixFastState | null {
  const model = primary.find((o) => rankPrimary(o) === 1)
  if (!model || typeof model.currentValue !== 'string') return null
  const parsed = parseModelVariant(model.currentValue)
  if (!parsed.base) return null
  if (!('fast' in parsed.params)) return null
  const raw = parsed.params['fast']!.trim()
  if (raw !== 'true' && raw !== 'false') return null
  return {
    configId: model.configId,
    base: parsed.base,
    checked: raw === 'true',
    params: parsed.params,
  }
}
