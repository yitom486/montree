export interface AcpPlanEntry {
  content: string
  priority?: string
  status?: string
}

/** 解析 ACP v1 `plan` / v2 `plan_update` 中的 entries */
export function parseAcpPlanEntries(update: Record<string, unknown>): AcpPlanEntry[] {
  let raw: unknown = update.entries

  if (!Array.isArray(raw) && update.plan && typeof update.plan === 'object') {
    const plan = update.plan as Record<string, unknown>
    raw = plan.entries
  }

  if (!Array.isArray(raw)) return []

  const entries: AcpPlanEntry[] = []
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue
    const row = item as Record<string, unknown>
    if (typeof row.content !== 'string' || !row.content.trim()) continue
    entries.push({
      content: row.content.trim(),
      priority: typeof row.priority === 'string' ? row.priority : undefined,
      status: typeof row.status === 'string' ? row.status : 'pending',
    })
  }
  return entries
}

export function summarizePlanProgress(entries: AcpPlanEntry[]): {
  total: number
  completed: number
  inProgress: number
  active: boolean
} {
  const total = entries.length
  const completed = entries.filter((e) => e.status === 'completed').length
  const inProgress = entries.filter((e) => e.status === 'in_progress').length
  const active = entries.some((e) => e.status === 'pending' || e.status === 'in_progress')
  return { total, completed, inProgress, active }
}
