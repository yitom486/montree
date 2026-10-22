import { ipcMain, shell } from 'electron'
import {
  INLINE_COMPLETION_IPC,
  type InlineCompletionBlock,
  type InlineCompletionHints,
  type InlineCompletionRequest,
} from '../../contracts/inline-completion'
import {
  INLINE_COMPLETION_CHATGPT_IPC,
  INLINE_COMPLETION_MODEL_IPC,
  INLINE_COMPLETION_PROVIDER_IPC,
  type InlineCompletionModelListPayload,
  type InlineCompletionProviderSavePayload,
} from '../../contracts/inline-completion-provider'
import { err, ok } from '@yitom/contracts'
import {
  getChatGptAuthStatus,
  loginChatGpt,
  logoutChatGpt,
} from '../services/ai/chatgpt-auth'
import { listInlineCompletionModels } from '../services/ai/inline-completion-models'
import { createInlineCompletionService } from '../services/ai/inline-completion-service'
import { e2eMockModelSource, providerModelSource } from '../services/ai/inline-completion-model'
import {
  clearInlineCompletionProvider,
  getInlineCompletionProviderStatus,
  saveInlineCompletionProvider,
} from '../services/ai/inline-completion-provider'

const BLOCKS: readonly InlineCompletionBlock[] = [
  'paragraph',
  'heading',
  'list item',
  'blockquote',
  'table cell',
  'code block',
]

function validHints(raw: unknown): InlineCompletionHints | undefined {
  if (!raw || typeof raw !== 'object') return undefined
  const value = raw as Record<string, unknown>
  const hints: InlineCompletionHints = {}
  if (typeof value.title === 'string' && value.title.trim()) {
    hints.title = value.title.trim().slice(0, 200)
  }
  if (Array.isArray(value.section)) {
    const section = value.section
      .filter((item): item is string => typeof item === 'string' && Boolean(item.trim()))
      .slice(-4)
      .map((item) => item.trim().slice(0, 200))
    if (section.length) hints.section = section
  }
  if (typeof value.block === 'string' && (BLOCKS as readonly string[]).includes(value.block)) {
    hints.block = value.block as InlineCompletionBlock
  }
  return Object.keys(hints).length ? hints : undefined
}

function validRequest(raw: unknown): InlineCompletionRequest {
  const value = raw as Partial<InlineCompletionRequest> | null
  if (!value || typeof value.requestId !== 'string' || typeof value.prefix !== 'string' || typeof value.suffix !== 'string' ||
    typeof value.filePath !== 'string' || typeof value.language !== 'string') throw new Error('补全请求格式错误')
  return {
    requestId: value.requestId.slice(0, 64),
    filePath: value.filePath,
    language: value.language.slice(0, 32),
    prefix: value.prefix.slice(-20_000),
    suffix: value.suffix.slice(0, 5_000),
    hints: validHints(value.hints),
  }
}

function validModelListPayload(raw: unknown): InlineCompletionModelListPayload {
  const value = raw as Partial<InlineCompletionModelListPayload> | null
  if (!value || typeof value.baseUrl !== 'string') {
    throw new Error('模型列表请求格式错误')
  }
  return {
    baseUrl: value.baseUrl,
    apiKey: typeof value.apiKey === 'string' ? value.apiKey : undefined,
  }
}

function validProviderPayload(raw: unknown): InlineCompletionProviderSavePayload {
  const value = raw as Partial<InlineCompletionProviderSavePayload> | null
  const authMode = value?.authMode === 'chatgpt' ? 'chatgpt' : 'api-key'
  if (!value) throw new Error('补全 provider 配置格式错误')
  if (authMode === 'api-key' && (
    typeof value.baseUrl !== 'string' ||
    typeof value.model !== 'string' ||
    typeof value.apiKey !== 'string'
  )) {
    throw new Error('补全 provider 配置格式错误')
  }
  return {
    authMode,
    name: typeof value.name === 'string' ? value.name : undefined,
    baseUrl: typeof value.baseUrl === 'string' ? value.baseUrl : '',
    model: typeof value.model === 'string' ? value.model : '',
    apiKey: typeof value.apiKey === 'string' ? value.apiKey : '',
  }
}

export function registerInlineCompletionHandlers(): void {
  const service = createInlineCompletionService(process.env.E2E_INLINE_COMPLETION_MOCK === '1' ? e2eMockModelSource() : providerModelSource())
  // owner = 发起请求的窗口，窗口间互不取消
  ipcMain.handle(INLINE_COMPLETION_IPC.complete, (event, raw: unknown) => service.complete(String(event.sender.id), validRequest(raw)))
  ipcMain.handle(INLINE_COMPLETION_IPC.cancel, (event, requestId: unknown) => { service.cancel(String(event.sender.id), typeof requestId === 'string' ? requestId : undefined) })
  ipcMain.handle(INLINE_COMPLETION_IPC.status, () => service.status())
  ipcMain.handle(INLINE_COMPLETION_PROVIDER_IPC.get, () => getInlineCompletionProviderStatus())
  ipcMain.handle(INLINE_COMPLETION_PROVIDER_IPC.save, (_event, raw: unknown) => {
    try {
      return saveInlineCompletionProvider(validProviderPayload(raw))
    } catch (cause) {
      return err({
        code: 'INVALID_ARGUMENT',
        message: cause instanceof Error ? cause.message : String(cause),
      })
    }
  })
  ipcMain.handle(INLINE_COMPLETION_PROVIDER_IPC.clear, () => clearInlineCompletionProvider())
  ipcMain.handle(INLINE_COMPLETION_MODEL_IPC.list, (_event, raw: unknown) => {
    try {
      return listInlineCompletionModels(validModelListPayload(raw))
    } catch (cause) {
      return err({
        code: 'INVALID_ARGUMENT',
        message: cause instanceof Error ? cause.message : String(cause),
      })
    }
  })
  ipcMain.handle(INLINE_COMPLETION_CHATGPT_IPC.status, () => getChatGptAuthStatus())
  ipcMain.handle(INLINE_COMPLETION_CHATGPT_IPC.login, async () => {
    try {
      await loginChatGpt((url) => shell.openExternal(url))
      return ok(await getChatGptAuthStatus())
    } catch (cause) {
      return err({
        code: 'NETWORK_ERROR',
        message: cause instanceof Error ? cause.message : String(cause),
      })
    }
  })
  ipcMain.handle(INLINE_COMPLETION_CHATGPT_IPC.logout, async () => ok(await logoutChatGpt()))
}
