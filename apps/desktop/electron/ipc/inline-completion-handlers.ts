import { ipcMain } from 'electron'
import { INLINE_COMPLETION_IPC, type InlineCompletionRequest } from '../../contracts/inline-completion'
import { createInlineCompletionService } from '../services/ai/inline-completion-service'
import { e2eMockModelSource, providerModelSource } from '../services/ai/inline-completion-model'

function validRequest(raw: unknown): InlineCompletionRequest {
  const value = raw as Partial<InlineCompletionRequest> | null
  if (!value || typeof value.requestId !== 'string' || typeof value.prefix !== 'string' || typeof value.suffix !== 'string' ||
    typeof value.filePath !== 'string' || typeof value.language !== 'string') throw new Error('补全请求格式错误')
  return { requestId: value.requestId.slice(0, 64), filePath: value.filePath, language: value.language.slice(0, 32), prefix: value.prefix.slice(-20_000), suffix: value.suffix.slice(0, 5_000) }
}

export function registerInlineCompletionHandlers(): void {
  const service = createInlineCompletionService(process.env.E2E_INLINE_COMPLETION_MOCK === '1' ? e2eMockModelSource() : providerModelSource())
  // owner = 发起请求的窗口，窗口间互不取消
  ipcMain.handle(INLINE_COMPLETION_IPC.complete, (event, raw: unknown) => service.complete(String(event.sender.id), validRequest(raw)))
  ipcMain.handle(INLINE_COMPLETION_IPC.cancel, (event, requestId: unknown) => { service.cancel(String(event.sender.id), typeof requestId === 'string' ? requestId : undefined) })
  ipcMain.handle(INLINE_COMPLETION_IPC.status, () => service.status())
}
