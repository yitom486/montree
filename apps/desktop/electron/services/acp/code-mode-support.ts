/**
 * ACP has no standard field for how an agent presents tools. The harness
 * declares the available presentations in initialize:
 *
 *   agentCapabilities._meta.toolsMode.values = ['native', 'ptc']
 *
 * Only an explicit `ptc` declaration enables session-level code mode; do not
 * infer it from a runtime id (an undeclared agent would silently stay native).
 */
export function supportsCodeModeCaps(caps: Record<string, unknown> | null | undefined): boolean {
  const meta = caps?._meta
  if (!meta || typeof meta !== 'object') return false
  const toolsMode = (meta as Record<string, unknown>).toolsMode
  if (!toolsMode || typeof toolsMode !== 'object') return false
  const values = (toolsMode as { values?: unknown }).values
  return Array.isArray(values) && values.includes('ptc')
}
