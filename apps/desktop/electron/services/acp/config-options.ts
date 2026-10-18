/**
 * ACP `SessionConfigOption.options` has two legal shapes:
 * - flat: `{ value, name }[]`
 * - grouped: `{ group, name, options: { value, name }[] }[]`
 *
 * `@yitom/acp-client` 0.1.12 only parses the flat shape, so grouped model
 * choices (DSH) disappear while the flat `reasoning_effort` option survives.
 * Flatten before handing the payload to the SDK parser; the group label is
 * prefixed to keep provider names distinguishable.
 */
export function flattenGroupedConfigOptions(raw: unknown): unknown {
  if (!Array.isArray(raw)) return raw
  return raw.map((item) => {
    if (!item || typeof item !== 'object') return item
    const row = item as Record<string, unknown>
    if (!Array.isArray(row.options)) return item

    const flat: unknown[] = []
    const collect = (entries: unknown[], group?: string): void => {
      for (const entry of entries) {
        if (!entry || typeof entry !== 'object') continue
        const option = entry as Record<string, unknown>
        const hasValue = option.value !== undefined || option.id !== undefined
        if (hasValue) {
          const name = typeof option.name === 'string' ? option.name : undefined
          flat.push(group && name ? { ...option, name: `${group} · ${name}` } : option)
          continue
        }
        if (!Array.isArray(option.options)) continue
        const label =
          typeof option.group === 'string'
            ? option.group
            : typeof option.name === 'string'
              ? option.name
              : group
        collect(option.options, label)
      }
    }
    collect(row.options)
    return flat.length > 0 ? { ...row, options: flat } : item
  })
}
