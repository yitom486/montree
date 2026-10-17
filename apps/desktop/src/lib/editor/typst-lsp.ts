import type { Text } from '@codemirror/state'
import type { Diagnostic } from '@codemirror/lint'

export interface TypstPosition { line: number; character: number }
export interface TypstRange { start: TypstPosition; end: TypstPosition }
export interface TypstTextEdit { range: TypstRange; newText: string }
export interface TypstDiagnostic { range: TypstRange; severity?: number; message: string; source?: string }

function normalizedProjectPath(value: string): { value: string; windows: boolean } | null {
  const windows = /^[a-z]:[/\\]/i.test(value)
  if (!windows && (!value.startsWith('/') || value.startsWith('//'))) return null
  const prefix = windows ? `${value.slice(0, 2).toLowerCase()}/` : '/'
  const segments = (windows ? value.slice(3).replace(/\\/g, '/') : value.slice(1)).split('/')
  const normalized: string[] = []
  for (const segment of segments) {
    if (!segment || segment === '.') continue
    if (segment === '..') normalized.pop()
    else normalized.push(windows ? segment.toLowerCase() : segment)
  }
  return { value: prefix + normalized.join('/'), windows }
}

/** Standalone files and Save As outside the workspace use their own parent as the compiler root. */
export function typstProjectRoot(filePath: string, workspaceRoot?: string): string | undefined {
  if (!workspaceRoot) return undefined
  const file = normalizedProjectPath(filePath), root = normalizedProjectPath(workspaceRoot)
  if (!file || !root || file.windows !== root.windows) return undefined
  const prefix = root.value.endsWith('/') ? root.value : `${root.value}/`
  return file.value === root.value || file.value.startsWith(prefix) ? workspaceRoot : undefined
}

/** LSP and CodeMirror both count UTF-16 code units, not Unicode code points. */
export function typstPosition(doc: Text, offset: number): TypstPosition {
  const safeOffset = Math.max(0, Math.min(doc.length, offset))
  const line = doc.lineAt(safeOffset)
  return { line: line.number - 1, character: safeOffset - line.from }
}

export function typstOffset(doc: Text, position: TypstPosition): number | null {
  if (!Number.isInteger(position.line) || !Number.isInteger(position.character) ||
    position.line < 0 || position.line >= doc.lines || position.character < 0) return null
  const line = doc.line(position.line + 1)
  return position.character <= line.length ? line.from + position.character : null
}

export function typstEditChanges(doc: Text, edits: TypstTextEdit[]) {
  const changes = edits.map((edit) => {
    const from = typstOffset(doc, edit.range.start), to = typstOffset(doc, edit.range.end)
    if (from === null || to === null || from > to || typeof edit.newText !== 'string') throw new Error('Typst 返回了无效的文本修改范围')
    return { from, to, insert: edit.newText }
  }).sort((a, b) => a.from - b.from || a.to - b.to)
  for (let i = 1; i < changes.length; i++) {
    if (changes[i].from < changes[i - 1].to || changes[i].from === changes[i - 1].from) throw new Error('Typst 返回了重叠的文本修改')
  }
  return changes
}

export function typstDiagnostics(doc: Text, diagnostics: TypstDiagnostic[]): Diagnostic[] {
  return diagnostics.flatMap((diagnostic) => {
    const from = typstOffset(doc, diagnostic.range.start), to = typstOffset(doc, diagnostic.range.end)
    if (from === null || to === null || to < from) return []
    return [{ from, to, severity: diagnostic.severity === 1 ? 'error' as const : diagnostic.severity === 2 ? 'warning' as const : 'info' as const,
      message: diagnostic.message, source: diagnostic.source ?? 'Typst' }]
  })
}

/** Only embed the native service's loopback HTTP preview, never arbitrary document URLs. */
export function safeTypstPreviewUrl(value: string | null | undefined): string | null {
  if (!value) return null
  try {
    const url = new URL(value)
    if (url.protocol !== 'http:' || !['127.0.0.1', '[::1]', 'localhost'].includes(url.hostname) || !url.port || url.username || url.password) return null
    return url.href
  } catch { return null }
}

/** Documentation is rendered as text, so server-provided Markdown/HTML cannot execute. */
export function typstDocumentation(value: unknown): string {
  if (typeof value === 'string') return value
  if (Array.isArray(value)) return value.map(typstDocumentation).join('\n\n')
  if (value && typeof value === 'object' && 'value' in value && typeof value.value === 'string') return value.value
  return ''
}
