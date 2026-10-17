import type { TypstConfig, TypstEvent, TypstExportPayload, TypstOpenPayload, TypstRequestPayload, TypstSyncPayload } from '@montree/contracts'

function api() {
  if (!window.electronAPI) throw new Error('electronAPI 不可用')
  return window.electronAPI
}

export const typstApi = {
  getConfig: (filePath?: string) => api().typstGetConfig(filePath),
  saveConfig: (config: TypstConfig, filePath?: string) => api().typstSaveConfig(config, filePath),
  status: () => api().typstStatus(),
  open: (payload: TypstOpenPayload) => api().typstOpen(payload),
  sync: (payload: TypstSyncPayload) => api().typstSync(payload),
  request: (payload: TypstRequestPayload) => api().typstRequest(payload),
  close: (sessionId: string) => api().typstClose(sessionId),
  exportPdf: (payload: TypstExportPayload) => api().typstExportPdf(payload),
  onEvent: (callback: (event: TypstEvent) => void) => api().onTypstEvent(callback),
}
