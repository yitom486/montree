import { basename } from '@montree/contracts'
import type { BrowserWindow } from 'electron'
import { APP_TITLE } from '@montree/contracts'

export function formatWindowTitle(
  filePath?: string,
  isDirty = false,
  appTitle = APP_TITLE,
): string {
  const dirtyMark = isDirty ? ' •' : ''
  if (filePath) {
    return `${basename(filePath)}${dirtyMark} — ${appTitle}`
  }
  return appTitle
}

export function applyWindowTitle(
  window: BrowserWindow,
  filePath?: string,
  isDirty = false,
): void {
  window.setTitle(formatWindowTitle(filePath, isDirty))
}
