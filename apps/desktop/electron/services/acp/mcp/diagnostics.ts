import { appendFileSync, mkdirSync, renameSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { currentAcpContext } from '../acp-context'

let directory: string | undefined
export function configureAcpDiagnostics(logDirectory: string): void {
  directory = logDirectory
}

/** Metadata only: never pass prompts, results, environment values or credentials. */
export function logAcpDiagnostic(event: string, fields: Record<string, string | number | boolean | undefined> = {}): void {
  if (!directory) return
  try {
    mkdirSync(directory, { recursive: true })
    const file = join(directory, 'acp-mcp.log')
    try { if (statSync(file).size > 5 * 1024 * 1024) renameSync(file, `${file}.previous`) } catch { /* first write */ }
    appendFileSync(file, JSON.stringify({ time: new Date().toISOString(), window: currentAcpContext().id, event, ...fields }) + '\n')
  } catch { /* diagnostics must not interrupt reading */ }
}
