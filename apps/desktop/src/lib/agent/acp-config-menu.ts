import type { AcpConfigOption } from '@montree/contracts'
import type { AcpPreferredConfigMap } from './acp-config-preferences'

/** Agent 会话 configOption 的输入栏分类与排序（AgentPanel 纯逻辑出库，便于单测） */

const SELECT_CATEGORIES = new Set(['model', 'mode', 'thought_level', 'model_config', 'context'])

const FAST_PATTERN = /fast/i

/** 任一 Agent 下发的 fast 类 boolean 配置项：输入栏给可见开关（category 不限，取首个） */
export function findFastToggle(options: AcpConfigOption[]): AcpConfigOption | null {
  for (const o of options) {
    if (o.type !== 'boolean') continue
    if (FAST_PATTERN.test(o.configId) || FAST_PATTERN.test(o.name)) return o
  }
  return null
}

export function isSelectOption(o: AcpConfigOption): boolean {
  if (o.type === 'boolean') return false
  if (!o.options || o.options.length === 0) return false
  if (o.category && SELECT_CATEGORIES.has(o.category)) return true
  return /model|mode|thought|reason|effort|fast|collab|context|ctx/i.test(o.configId + o.name)
}

/**
 * 输入栏只放最常改的四项，对齐 Cursor 原生五个独立维度中的四个下拉：
 * 0=模式（不含 collab）、1=模型、2=思考档（thought/reason/effort）、3=上下文档（context/ctx）；
 * 其余返回 null 归入「更多设置」。Fast 开关另走 findFastToggle（boolean 显示开关 / select 进菜单双形）。
 */
export function rankPrimary(o: AcpConfigOption): number | null {
  const id = `${o.configId} ${o.category ?? ''} ${o.name}`.toLowerCase()
  if (/(^|\s)mode(\s|$)/.test(id) && !/collab|model/.test(id)) return 0
  if (o.category === 'mode' && !/collab/i.test(o.name)) return 0
  if (o.category === 'model' || /(^|\s)model(\s|$)/.test(id)) return 1
  if (/thought|reason|effort/.test(id) || o.category === 'thought_level') return 2
  if (o.category === 'context' || /context|ctx/.test(id)) return 3
  return null
}

/** 命中同一 rank 的第二个起进 secondary，primary 按 0/1/2/3 定序；boolean 开关不进下拉，直接跟进 secondary；fast 命中项单列为 fastToggle，不再进 secondary */
export function splitConfigOptions(options: AcpConfigOption[]): {
  primary: AcpConfigOption[]
  secondary: AcpConfigOption[]
  fastToggle: AcpConfigOption | null
} {
  const selects = options.filter(isSelectOption)
  const fastToggle = findFastToggle(options)
  const fastId = fastToggle?.configId
  const booleans = options.filter((o) => o.type === 'boolean' && o.configId !== fastId)
  const primary: AcpConfigOption[] = []
  const secondary: AcpConfigOption[] = []
  const byRank = new Map<number, AcpConfigOption>()

  for (const opt of selects) {
    const rank = rankPrimary(opt)
    if (rank === null) {
      secondary.push(opt)
      continue
    }
    if (!byRank.has(rank)) byRank.set(rank, opt)
    else secondary.push(opt)
  }

  for (const rank of [0, 1, 2, 3]) {
    const opt = byRank.get(rank)
    if (opt) primary.push(opt)
  }

  // boolean 开关初始值一律跟随 Agent currentValue，渲染时 Boolean(currentValue)，此处不改值
  secondary.push(...booleans)

  return { primary, secondary, fastToggle }
}

/** 紧凑菜单按钮文案：当前选项名，缺省回退选项组名 */
export function currentLabel(opt: AcpConfigOption): string {
  const value = String(opt.currentValue ?? '')
  const match = opt.options?.find((item) => item.value === value)
  return match?.name ?? (value || opt.name)
}

/**
 * fast 默认关一次的纯决策：无该 runtime+configId 存储偏好（沿 rememberPreferredConfig 的
 * trim 口径）且 fast 当前值为 truthy 时，返回需要置 false 的那一项；其余一律返回 null。
 * 调用方负责 setConfigOption(false) + rememberConfigPreference(false) + 刷新列表。
 */
export function selectFastDefaultOffTarget(
  options: AcpConfigOption[],
  preferredByRuntime: AcpPreferredConfigMap,
  runtimeId: string,
): AcpConfigOption | null {
  const fast = findFastToggle(options)
  if (!fast) return null
  const rid = runtimeId.trim()
  const cid = fast.configId.trim()
  if (!rid || !cid) return null
  const stored = preferredByRuntime[rid]?.[cid]
  if (stored != null && stored !== '') return null
  if (!fast.currentValue) return null
  return fast
}
