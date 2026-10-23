/// <reference types="vite/client" />

import type { AppError, ElectronAPI, Result, TypstExportPayload, TypstExportResult } from '@yitom/contracts'
import type { TerminalAPI } from '../contracts/terminal'
import type { AgentInspectionAPI } from '../contracts/agent-inspection'
import type { HtmlPreviewAPI } from '../contracts/html-preview'
import type { InlineCompletionAPI } from '../contracts/inline-completion'
import type {
  WebDocFetchPayloadWithMarkdown,
  WebDocFetchResultWithMarkdown,
} from '../contracts/web-doc'

/**
 * 上游 contracts 补 `TYPST_EXPORT_HTML` 前，preload 经本仓字面通道透出，
 * 此处同步放宽声明；contracts 补上后删掉该扩展。
 */
export interface MontreeElectronAPI extends ElectronAPI {
  typstExportHtml: (payload: TypstExportPayload) => Promise<Result<TypstExportResult, AppError>>
  fetchWebDocPage: (
    payload: WebDocFetchPayloadWithMarkdown,
  ) => Promise<Result<WebDocFetchResultWithMarkdown, AppError>>
}

declare global {
  interface Window {
    electronAPI?: MontreeElectronAPI
    montreeTerminal?: TerminalAPI
    montreeAgentInspection?: AgentInspectionAPI
    montreeHtmlPreview?: HtmlPreviewAPI
    montreeInlineCompletion?: InlineCompletionAPI
  }
}

export {}
