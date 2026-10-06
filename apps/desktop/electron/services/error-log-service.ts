import { appendFile, mkdir } from 'fs/promises'
import { join } from 'path'
import { app } from 'electron'
import type { RendererErrorPayload } from '@montree/contracts'

function getLogDirectory(): string {
  return join(app.getPath('userData'), 'logs')
}

export function getErrorLogFilePath(): string {
  return join(getLogDirectory(), 'renderer-errors.log')
}

export async function appendRendererErrorLog(entry: RendererErrorPayload): Promise<string> {
  const logPath = getErrorLogFilePath()
  await mkdir(getLogDirectory(), { recursive: true })
  await appendFile(logPath, `${JSON.stringify(entry)}\n`, 'utf-8')
  return logPath
}
