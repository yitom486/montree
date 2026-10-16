/** Only bounded display fields enter the transcript; tool source, credentials and large payloads stay out. */
export interface ToolInputSummary {
  title?: string
  diagramType?: string
  kind?: string
  preset?: string
  path?: string
  query?: string
}

function record(value: unknown): Record<string, unknown> | undefined {
  if (typeof value === 'string' && value.length <= 131072) {
    try { value = JSON.parse(value) } catch { return undefined }
  }
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown> : undefined
}

function text(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const clean = value.replace(/[\s\u0000-\u001f]+/g, ' ').trim()
  return clean ? clean.slice(0, 200) : undefined
}

export function isGenericToolName(name: string): boolean {
  return /^(?:call[ _-]?mcp[ _-]?tool|mcp[ _-]?tool|tool|工具调用)$/i.test(name.trim())
}

/** ACP name/rawInput, including agy's call_mcp_tool envelope and JSON-string arguments. */
export function parseToolCallMetadata(update: Record<string, unknown>): {
  name?: string
  inputSummary?: ToolInputSummary
} {
  let name = text(update.name)
  let input = record(update.rawInput)
  for (let depth = 0; input && depth < 3; depth++) {
    const nestedName = text(input.tool_name ?? input.toolName ?? input.name)
    const nested = record(input.arguments ?? input.args ?? input.parameters ?? input.tool_arguments)
    if (!nestedName || !nested || (name && !isGenericToolName(name))) break
    name = nestedName
    input = nested
  }
  const summary: ToolInputSummary = {}
  if (input) {
    for (const key of ['title', 'diagramType', 'kind', 'preset', 'query'] as const) {
      const value = text(input[key])
      if (value) summary[key] = value
    }
    const path = text(input.path ?? input.filePath ?? input.file_path ?? input.AbsolutePath)
    if (path) summary.path = path
  }
  return {
    ...(name ? { name } : {}),
    ...(Object.keys(summary).length ? { inputSummary: summary } : {}),
  }
}
