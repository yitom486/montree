import type { AcpConfigOption } from '@montree/contracts'

/** runtimeId → configId → 偏好值（string / boolean 序列化为 string 存储时可还原） */
export type AcpPreferredConfigMap = Record<string, Record<string, string>>

export function rememberPreferredConfig(
  map: AcpPreferredConfigMap,
  runtimeId: string,
  configId: string,
  value: string | boolean,
): AcpPreferredConfigMap {
  const rid = runtimeId.trim()
  const cid = configId.trim()
  if (!rid || !cid) return map
  const nextValue = typeof value === 'boolean' ? String(value) : value
  const prev = map[rid] ?? {}
  if (prev[cid] === nextValue) return map
  return {
    ...map,
    [rid]: {
      ...prev,
      [cid]: nextValue,
    },
  }
}

export function getPreferredConfigValue(
  map: AcpPreferredConfigMap,
  runtimeId: string,
  configId: string,
): string | undefined {
  return map[runtimeId]?.[configId]
}

/**
 * 对比 Agent 当前 configOptions 与本地偏好，返回需要 setConfigOption 的差分。
 * 仅当偏好值仍在可选列表中时才套用（避免 Agent 升级后旧值失效）。
 */
export function listPreferredConfigPatches(
  options: AcpConfigOption[],
  preferred: Record<string, string> | undefined,
): Array<{ configId: string; value: string }> {
  if (!preferred || Object.keys(preferred).length === 0) return []
  const patches: Array<{ configId: string; value: string }> = []
  for (const opt of options) {
    const want = preferred[opt.configId]
    if (want == null || want === '') continue
    const current =
      opt.currentValue === undefined || opt.currentValue === null
        ? ''
        : String(opt.currentValue)
    if (current === want) continue
    if (opt.options && opt.options.length > 0) {
      const allowed = opt.options.some((o) => o.value === want)
      if (!allowed) continue
    }
    patches.push({ configId: opt.configId, value: want })
  }
  return patches
}
