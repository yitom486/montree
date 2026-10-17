/** Native Tinymist is pinned so preview and compiler versions always agree. */
export const TINYMIST_VERSION = '0.15.8'

export interface TypstConfig {
  executablePath: string
  fontPaths: string[]
  systemFonts: boolean
  /** Empty means follow the opened document. Must be inside the project root. */
  entryPath: string
}

export interface TypstRuntimeStatus {
  available: boolean
  executablePath: string
  version: string | null
  message: string
}

export interface TypstOpenPayload {
  filePath: string
  rootPath?: string
  content: string
  version: number
}

export interface TypstSession {
  sessionId: string
  uri: string
  filePath: string
  rootPath: string
  capabilities: Record<string, unknown>
  previewUrl: string | null
  previewError?: string
}

export interface TypstSyncPayload {
  sessionId: string
  content: string
  version: number
}

export type TypstRequestMethod =
  | 'textDocument/completion'
  | 'completionItem/resolve'
  | 'textDocument/hover'
  | 'textDocument/signatureHelp'
  | 'textDocument/definition'
  | 'textDocument/formatting'
  | 'textDocument/documentSymbol'

export interface TypstRequestPayload {
  sessionId: string
  method: TypstRequestMethod
  params: unknown
  /** Reject a response after edits made its positions stale. */
  version?: number
}

export interface TypstExportPayload {
  sessionId: string
  version: number
}

export interface TypstExportResult {
  filePath: string
  version: number
}

export type TypstEvent =
  | { sessionId: string; type: 'notification'; method: string; params: unknown; version: number | null }
  | { sessionId: string; type: 'exit'; message: string }
