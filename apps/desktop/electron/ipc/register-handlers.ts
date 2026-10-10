import { registerAcpWindowHandlers, withAcpWindow } from './acp-window-handlers'
import { app, BrowserWindow, ipcMain, shell } from 'electron'
import { IPC } from '@montree/contracts'
import type {
  ExportDocumentPayload,
  ExportMarkdownPayload,
  OpenDialogOptions,
  SaveFilePayload,
  SavePastedImagePayload,
  WorkspaceFsCopyPayload,
  WorkspaceFsCreateDirPayload,
  WorkspaceFsCreateFilePayload,
  WorkspaceFsDeletePayload,
  WorkspaceFsMovePayload,
  WorkspaceFsRenamePayload,
  WorkspaceSearchMarkdownPayload,
} from '@montree/contracts'
import type { RendererErrorPayload } from '@montree/contracts'
import type {
  AppendFlashcardReviewPayload,
  CreateReadingMarkPayload,
  ListDueFlashcardsPayload,
  MarksListByChapterPayload,
  MarksSearchPayload,
  UpdateReadingMarkPayload,
} from '@montree/contracts'
import type {
  AcpAuthPreflightPayload,
  AcpProviderSavePayload,
  AcpProxySettings,
} from '@montree/contracts'
import type { WebDocDiscoverTocPayload, WebDocFetchPayload } from '@montree/contracts'
import { saveBinaryDocument } from '../services/binary-document-service'
import type { SaveBinaryDocumentPayload } from '@montree/contracts'
import { handleSnapshotRequest } from '../services/acp/acp-bridges'
import { callReaderVisualTool } from '../services/acp/mcp/reader-visual-tools'
import { callDocumentTool } from '../services/acp/mcp/document-tools'
import { startMontreeMcpServer } from '../services/acp/mcp/montree-mcp-server'
import type {
  DetectPdfTocPagesPayload,
  GetPdfOcrTocPayload,
  GetPdfOcrPagePayload,
  ListPdfOcrPagesPayload,
  RecognizePdfPagePayload,
  RecognizePdfTocPayload,
  SavePdfOcrTocPayload,
} from '@montree/contracts'
import type {
  ClassifyPdfDocumentPayload,
  ExtractPdfBookMarkdownPayload,
} from '@montree/contracts'
import {
  classifyPdfDocument,
  extractPdfBookMarkdown,
} from '../services/pdf-inspector-service'
import { ok, err } from '@montree/contracts'
import type { SyncConfig } from '@montree/contracts'
import { syncManager } from '../services/sync/sync-manager'
import { readSyncConfig, writeSyncConfig } from '../services/sync/sync-config-service'
import { writeLocalProgress } from '../services/sync/reading-progress-sync'
import type {
  TtsConfig,
  TtsSynthesizePayload,
  TtsTestKeyPayload,
  TtsBatchCreatePayload,
} from '@montree/contracts'
import {
  readTtsConfig,
  writeTtsConfig,
  synthesizeTts,
  synthesizeTtsStream,
  cancelTtsStream,
  testTtsKey,
  getTtsCacheStats,
  clearTtsCache,
  listTtsModels,
  listTtsVoices,
  createTtsBatchJob,
  getTtsBatchJob,
  cancelTtsBatchJob,
} from '../services/tts/tts-service'
import {
  exportHtmlDocument,
  exportPdfDocument,
  exportMarkdownDocument,
  openDocumentDialog,
  openFolderDialog,
  scanWorkspaceFolder,
  readBinaryFileByPath,
  readFileByPath,
  readImageAsDataUrl,
  saveFileDialog,
  savePastedImage,
} from '../services/file-service'
import {
  workspaceCopy,
  workspaceCreateDirectory,
  workspaceCreateFile,
  workspaceDelete,
  workspaceMove,
  workspaceRename,
} from '../services/workspace-fs'
import { getAppVersion } from '../services/app-service'
import { searchWorkspaceMarkdown } from '../services/workspace-md-search'
import { installBunRuntime, probeBunRuntime } from '../services/bun-runtime'
import {
  checkAppUpdate,
  downloadAppUpdate,
  getAppUpdateStatus,
  installAppUpdate,
} from '../services/app-updater'
import { appendRendererErrorLog, getErrorLogFilePath } from '../services/error-log-service'
import { createWindow, getWindowInitByWebContents } from '../window/create-window'
import { pendingExternalFiles } from '../window/external-file'
import {
  cancelRosettaImport,
  formatRosettaImportDoneMessage,
  getActiveRosettaImport,
  importScannedBookToDb,
} from '../services/book-db/import-service'
import { getRosettaBookInfo, queryRosettaBook } from '../services/book-db/query-service'
import { inspectIndexedContentFile } from '../services/book-db/content-audit'
import { getBookRecord } from '../services/book-db/queries'
import { openBookDb } from '../services/book-db/open-book-db'
import { previewBodyWatermarkFile } from '../services/book-db/body-watermark-preview'
import { applyBodyWatermarkFile } from '../services/book-db/body-watermark-apply'
import { rebuildTocIndex } from '../services/book-db/toc-rebuild'
import type {
  RosettaBodyWatermarkApplyPayload,
  RosettaBodyWatermarkPreviewPayload,
  RosettaImportPayload,
  RosettaImportStatus,
  RosettaInspectContentPayload,
  RosettaQuery,
  RosettaTocRebuildPayload,
} from '@montree/contracts'
import { applyWindowTitle } from '../window/window-title'
import { setVerboseRendererLogs } from '../services/runtime-state'
import {
  appendFlashcardReview,
  createReadingMark,
  deleteReadingMark,
  listDueFlashcards,
  listReadingMarks,
  listReadingMarksByChapter,
  searchReadingMarks,
  updateReadingMark,
} from '../services/reading-marks-service'
import {
  appendQuizSession,
  readAllQuizSessions,
  readQuizSessionsByFile,
} from '../services/quiz-service'
import {
  getAiSession,
  putAiSession,
  touchAiSession,
} from '../services/ai-session-service'
import type {
  AiSessionGetPayload,
  AiSessionPutPayload,
  AiSessionTouchPayload,
} from '@montree/contracts'
import type { QuizSessionRecord } from '@montree/contracts'
import {
  discoverWebDocToc,
  fetchWebDocPage,
  parseWebDocUrlInput,
} from '../services/web-doc-service'
import { readPdfOcrTocCache, deletePdfOcrTocCache, clearAllPdfOcrCaches, writePdfOcrTocCache } from '../services/ocr/ocr-toc-cache'
import {
  deleteAllPdfOcrPageCaches,
  listPdfOcrPageCachePages,
  readPdfOcrPageCache,
} from '../services/ocr/ocr-page-cache'
import { recognizePdfPage } from '../services/ocr/pdf-page-ocr-service'
import { recognizePdfToc } from '../services/ocr/pdf-ocr-toc-service'
import { detectPdfTocPages } from '../services/ocr/pdf-toc-detect-service'
import {
  cancelOcrComponentDownload,
  ensureOcrComponent,
  inspectOcrComponentStatus,
} from '../services/ocr/ocr-component-manager'
import { getWindowSessionByWebContents } from '../window/window-session'
import { setWorkspaceWatch, stopWorkspaceWatch } from '../services/workspace-watcher'
import { listAcpRuntimes } from "@yitom/acp-client"
import {
  emptyAcpAuthPreflight,
  isCodexPreflightRuntime,
  probeCodexAuth,
} from '../services/acp/codex-auth-preflight'
import { installAgyCli, probeAgyCli } from '../services/acp/runtimes/agy'
import {
  clearAcpProvider,
  getAcpProviderStatus,
  saveAcpProvider,
} from '../services/acp/provider-config-service'
import {
  readAcpProxySettings,
  saveAcpProxySettings,
} from '../services/acp/acp-proxy-service'

/** 测试入口明确选测试窗口；生产路径始终使用 IPC sender。 */
function withTestWindow<T>(callback: () => T): T {
  const window = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0]
  if (!window) throw new Error('测试窗口未就绪')
  return withAcpWindow(window.webContents, callback)
}

/** 制卡会话指针按可信窗口分区；文档/书籍的数据本身仍可共享。 */
function withAiSessionWindow<T extends { purpose?: string }>(sender: Electron.WebContents, payload: T): T {
  const scope = getWindowInitByWebContents(sender).windowScopeId
  return scope === 'main' ? payload : { ...payload, purpose: `${payload.purpose?.trim() || 'card-studio'}:${scope}` }
}

/** 集中注册 IPC；文件/书签等耗时操作均为 async，不阻塞主进程事件循环 */
export function registerIpcHandlers(): void {
  registerAcpWindowHandlers()
  if (process.env.E2E_READER_VISUAL === '1') {
    Object.assign(globalThis, {
      __montreeE2eVisualTools: (name: string, args?: Record<string, unknown>) =>
        withTestWindow(() => callReaderVisualTool(name, { readSnapshot: handleSnapshotRequest }, args)),
    })
  }
  if (process.env.E2E_DOCUMENT_TOOLS === '1') {
    Object.assign(globalThis, { __montreeE2eDocumentTools: (name: string, args?: Record<string, unknown>) =>
      withTestWindow(() => callDocumentTool(name, { readSnapshot: handleSnapshotRequest }, args)),
      __montreeE2eDocumentSnapshot: (resource: Parameters<typeof handleSnapshotRequest>[0], args?: Parameters<typeof handleSnapshotRequest>[1]) => withTestWindow(() => handleSnapshotRequest(resource, args)),
      __montreeE2eMcpEndpoint: () => withTestWindow(async () => { const server = await startMontreeMcpServer({ readSnapshot: handleSnapshotRequest }); return { url: server.url, authToken: server.authToken } }),
    })
  }


  ipcMain.handle(IPC.ACP_LIST_RUNTIMES, () => ok(listAcpRuntimes()))
  ipcMain.handle(IPC.ACP_AUTH_PREFLIGHT, (_event, payload?: AcpAuthPreflightPayload) => {
    return ok(isCodexPreflightRuntime(payload?.runtimeId) ? probeCodexAuth() : emptyAcpAuthPreflight())
  })
  // --- ACP：自定义模型供应商（base URL + API Key） ---
  ipcMain.handle(IPC.ACP_PROVIDER_GET, async () => ok(await getAcpProviderStatus()))
  ipcMain.handle(IPC.ACP_PROVIDER_SAVE, (_event, payload: AcpProviderSavePayload) =>
    saveAcpProvider(payload),
  )
  ipcMain.handle(IPC.ACP_PROVIDER_CLEAR, () => clearAcpProvider())
  // --- ACP：子进程代理设置 ---
  ipcMain.handle(IPC.ACP_PROXY_GET, async () => ok(await readAcpProxySettings()))
  ipcMain.handle(IPC.ACP_PROXY_SAVE, (_event, payload: AcpProxySettings) =>
    saveAcpProxySettings(payload),
  )
  // --- ACP：Antigravity CLI (agy) 探针与一键安装 ---
  ipcMain.handle(IPC.ACP_PROBE_AGY_CLI, async () => ok(await probeAgyCli()))
  ipcMain.handle(IPC.ACP_INSTALL_AGY_CLI, async () => installAgyCli())

  // --- 应用：版本与自动更新 ---
  ipcMain.handle(IPC.APP_GET_VERSION, () => getAppVersion())
  ipcMain.handle(IPC.APP_TAKE_PENDING_EXTERNAL_FILE, () => pendingExternalFiles.take())
  ipcMain.handle(IPC.APP_UPDATE_CHECK, () => checkAppUpdate())
  ipcMain.handle(IPC.APP_UPDATE_DOWNLOAD, () => downloadAppUpdate())
  ipcMain.handle(IPC.APP_UPDATE_INSTALL, () => {
    installAppUpdate()
    return ok(undefined)
  })
  ipcMain.handle(IPC.APP_UPDATE_GET_STATUS, () => ok(getAppUpdateStatus()))

  // --- 窗口：脏标记与关窗确认 ---
  ipcMain.on(IPC.APP_SET_DIRTY, (event, isDirty: boolean) => {
    const session = getWindowSessionByWebContents(event.sender)
    if (session) session.documentDirty = isDirty
  })

  ipcMain.on(IPC.APP_CLOSE_DECISION, (event, decision: 'proceed' | 'cancel') => {
    getWindowSessionByWebContents(event.sender)?.closeController.handleRendererCloseDecision(
      decision,
    )
  })

  // --- 文件 / 工作区：打开、读写、树操作、导出、监听 ---
  ipcMain.handle(IPC.FILE_OPEN, (_event, options?: OpenDialogOptions) =>
    openDocumentDialog(options),
  )
  ipcMain.handle(IPC.FILE_OPEN_FOLDER, (_event, options?: OpenDialogOptions) =>
    openFolderDialog(options),
  )
  ipcMain.handle(IPC.FILE_SCAN_WORKSPACE, (_event, rootPath: string) =>
    scanWorkspaceFolder(rootPath),
  )
  // P2.2 工作区 Markdown 字面检索：只读，不暴露给模型（无 MCP 接线）。
  // root 由渲染端文件树状态给出；query 长度 double-check（渲染端已先拒短词）。
  ipcMain.handle(IPC.WORKSPACE_SEARCH_MARKDOWN, (_event, payload: WorkspaceSearchMarkdownPayload) => {
    try {
      const workspaceRoot =
        typeof payload?.workspaceRoot === 'string' ? payload.workspaceRoot.trim() : ''
      const query = typeof payload?.query === 'string' ? payload.query : ''
      if (!workspaceRoot) {
        return err({ code: 'INVALID_ARGUMENT', message: '缺少工作区根目录' })
      }
      if (!query.trim() || [...query.trim()].length > 200) {
        return err({ code: 'INVALID_ARGUMENT', message: '检索词无效' })
      }
      return ok(
        searchWorkspaceMarkdown({
          root: workspaceRoot,
          query: query.trim(),
          excludePath: typeof payload?.excludePath === 'string' ? payload.excludePath : null,
        }),
      )
    } catch (cause) {
      return err({
        code: 'UNKNOWN',
        message: cause instanceof Error ? cause.message : '工作区检索失败',
      })
    }
  })

  ipcMain.on(IPC.WORKSPACE_WATCH, (event, rootPath: string) => {
    if (typeof rootPath !== 'string' || rootPath.length === 0) return
    setWorkspaceWatch(event.sender, rootPath)
  })

  ipcMain.on(IPC.WORKSPACE_UNWATCH, (event) => {
    stopWorkspaceWatch(event.sender.id)
  })
  ipcMain.handle(IPC.FILE_READ, (_event, filePath: string) => readFileByPath(filePath))
  ipcMain.handle(IPC.FILE_READ_BINARY, (_event, filePath: string) =>
    readBinaryFileByPath(filePath),
  )
  ipcMain.handle(IPC.FILE_READ_IMAGE, (_event, filePath: string) => readImageAsDataUrl(filePath))
  ipcMain.handle(IPC.FILE_SAVE, (_event, payload: SaveFilePayload) => saveFileDialog(payload))
  ipcMain.handle(IPC.FILE_SAVE_BINARY_DOCUMENT, (_event, payload: SaveBinaryDocumentPayload) => saveBinaryDocument(payload))
  ipcMain.handle(IPC.FILE_SAVE_AS, (_event, payload: SaveFilePayload) =>
    saveFileDialog({ ...payload, filePath: undefined }),
  )
  ipcMain.handle(IPC.FILE_SAVE_PASTED_IMAGE, (_event, payload: SavePastedImagePayload) =>
    savePastedImage(payload),
  )
  ipcMain.handle(IPC.FILE_CREATE, (_event, payload: WorkspaceFsCreateFilePayload) =>
    workspaceCreateFile(payload),
  )
  ipcMain.handle(IPC.FILE_CREATE_DIR, (_event, payload: WorkspaceFsCreateDirPayload) =>
    workspaceCreateDirectory(payload),
  )
  ipcMain.handle(IPC.FILE_RENAME, (_event, payload: WorkspaceFsRenamePayload) =>
    workspaceRename(payload),
  )
  ipcMain.handle(IPC.FILE_DELETE, (_event, payload: WorkspaceFsDeletePayload) =>
    workspaceDelete(payload),
  )
  ipcMain.handle(IPC.FILE_COPY, (_event, payload: WorkspaceFsCopyPayload) =>
    workspaceCopy(payload),
  )
  ipcMain.handle(IPC.FILE_MOVE, (_event, payload: WorkspaceFsMovePayload) =>
    workspaceMove(payload),
  )
  ipcMain.handle(IPC.FILE_EXPORT_HTML, (_event, payload: ExportDocumentPayload) =>
    exportHtmlDocument(payload),
  )
  ipcMain.handle(IPC.FILE_EXPORT_PDF, (_event, payload: ExportDocumentPayload) =>
    exportPdfDocument(payload),
  )
  ipcMain.handle(IPC.FILE_EXPORT_MARKDOWN, (_event, payload: ExportMarkdownPayload) =>
    exportMarkdownDocument(payload),
  )

  // --- 窗口 / 应用壳：标题、退出、新建窗、外链 ---
  ipcMain.on(IPC.FILE_UPDATE_TITLE, (event, payload: { filePath?: string; isDirty: boolean }) => {
    const targetWindow = BrowserWindow.fromWebContents(event.sender)
    if (targetWindow && !targetWindow.isDestroyed()) {
      applyWindowTitle(targetWindow, payload.filePath, payload.isDirty)
    }
  })

  ipcMain.on(IPC.APP_QUIT, () => {
    app.quit()
  })

  ipcMain.on(IPC.APP_WINDOW_MINIMIZE, (event) => {
    const targetWindow = BrowserWindow.fromWebContents(event.sender)
    if (targetWindow && !targetWindow.isDestroyed()) {
      targetWindow.minimize()
    }
  })

  ipcMain.on(IPC.APP_WINDOW_TOGGLE_MAXIMIZE, (event) => {
    const targetWindow = BrowserWindow.fromWebContents(event.sender)
    if (targetWindow && !targetWindow.isDestroyed()) {
      if (targetWindow.isMaximized()) {
        targetWindow.unmaximize()
      } else {
        targetWindow.maximize()
      }
    }
  })

  ipcMain.on(IPC.APP_WINDOW_CLOSE, (event) => {
    const targetWindow = BrowserWindow.fromWebContents(event.sender)
    if (targetWindow && !targetWindow.isDestroyed()) {
      targetWindow.close()
    }
  })

  ipcMain.handle(IPC.APP_WINDOW_IS_MAXIMIZED, (event) => {
    const targetWindow = BrowserWindow.fromWebContents(event.sender)
    return Boolean(targetWindow && !targetWindow.isDestroyed() && targetWindow.isMaximized())
  })

  ipcMain.on(IPC.APP_NEW_WINDOW, () => {
    createWindow({ fresh: true })
  })

  ipcMain.handle(IPC.APP_OPEN_EXTERNAL, async (_event, rawUrl: unknown) => {
    const urlResult = parseWebDocUrlInput(rawUrl)
    if (!urlResult.ok) return urlResult
    try {
      await shell.openExternal(urlResult.value)
      return ok(undefined)
    } catch (cause) {
      return err({
        code: 'UNKNOWN',
        message: cause instanceof Error ? cause.message : '无法打开外部链接',
      })
    }
  })

  // --- Bun 运行时（ACP 等子进程依赖） ---
  ipcMain.handle(IPC.BUN_GET_STATUS, async () => ok(await probeBunRuntime()))

  ipcMain.handle(IPC.BUN_INSTALL, async () => installBunRuntime())

  // --- 窗口初始化、DevTools、渲染进程错误日志 ---
  /** preload 启动时同步读取，仅访问内存中的 session 映射 */
  ipcMain.on(IPC.APP_GET_WINDOW_INIT, (event) => {
    event.returnValue = getWindowInitByWebContents(event.sender)
  })

  ipcMain.on(IPC.APP_TOGGLE_DEVTOOLS, (event) => {
    BrowserWindow.fromWebContents(event.sender)?.webContents.toggleDevTools()
  })

  ipcMain.on(IPC.APP_SET_VERBOSE_LOGS, (_event, enabled: boolean) => {
    setVerboseRendererLogs(enabled)
  })

  ipcMain.handle(IPC.APP_LOG_RENDERER_ERROR, async (_event, payload: RendererErrorPayload) => {
    try {
      const logPath = await appendRendererErrorLog(payload)
      console.error('[renderer-error-log]', payload.source, payload.message)
      return ok(logPath)
    } catch (error) {
      console.error('[renderer-error-log] 写入失败', error)
      return ok(getErrorLogFilePath())
    }
  })

  ipcMain.handle(IPC.APP_GET_ERROR_LOG_PATH, () => ok(getErrorLogFilePath()))

  // --- 阅读书签 / 批注 ---
  ipcMain.handle(IPC.MARKS_LIST, (_event, filePath: string) => listReadingMarks(filePath))
  ipcMain.handle(IPC.MARKS_CREATE, (_event, payload: CreateReadingMarkPayload) =>
    createReadingMark(payload),
  )
  ipcMain.handle(IPC.MARKS_UPDATE, (_event, payload: UpdateReadingMarkPayload) =>
    updateReadingMark(payload),
  )
  ipcMain.handle(IPC.MARKS_DELETE, (_event, id: string) => deleteReadingMark(id))
  ipcMain.handle(IPC.MARKS_SEARCH, (_event, payload: MarksSearchPayload) =>
    searchReadingMarks(payload),
  )
  ipcMain.handle(IPC.MARKS_LIST_BY_CHAPTER, (_event, payload: MarksListByChapterPayload) =>
    listReadingMarksByChapter(payload),
  )

  // --- 记忆卡片复习态 ---
  ipcMain.handle(IPC.FLASHCARDS_LIST_DUE, (_event, payload: ListDueFlashcardsPayload) =>
    listDueFlashcards(payload),
  )
  ipcMain.handle(
    IPC.FLASHCARDS_APPEND_REVIEW,
    (_event, payload: AppendFlashcardReviewPayload) => appendFlashcardReview(payload),
  )

  // --- AI 测验与答题打分记录 (JSONL) ---
  ipcMain.handle(IPC.QUIZ_APPEND_SESSION, (_event, session: QuizSessionRecord) =>
    appendQuizSession(session),
  )
  ipcMain.handle(IPC.QUIZ_GET_ALL_SESSIONS, () => readAllQuizSessions())
  ipcMain.handle(IPC.QUIZ_GET_SESSIONS_BY_FILE, (_event, filePath: string) =>
    readQuizSessionsByFile(filePath),
  )

  // --- AI 会话指针（一书一会话） ---
  ipcMain.handle(IPC.AI_SESSIONS_GET, (_event, payload: AiSessionGetPayload) =>
    getAiSession(withAiSessionWindow(_event.sender, payload)),
  )
  ipcMain.handle(IPC.AI_SESSIONS_PUT, (_event, payload: AiSessionPutPayload) =>
    putAiSession(withAiSessionWindow(_event.sender, payload)),
  )
  ipcMain.handle(IPC.AI_SESSIONS_TOUCH, (_event, payload: AiSessionTouchPayload) =>
    touchAiSession(withAiSessionWindow(_event.sender, payload)),
  )

  // --- 在线文档 ---
  ipcMain.handle(IPC.WEB_DOC_FETCH_PAGE, async (_event, payload: WebDocFetchPayload) => {
    const urlResult = parseWebDocUrlInput(payload?.url)
    if (!urlResult.ok) return urlResult
    return fetchWebDocPage({ url: urlResult.value })
  })

  ipcMain.handle(IPC.WEB_DOC_DISCOVER_TOC, async (_event, payload: WebDocDiscoverTocPayload) => {
    const urlResult = parseWebDocUrlInput(payload?.url)
    if (!urlResult.ok) return urlResult
    return discoverWebDocToc({ url: urlResult.value })
  })

  // --- PDF OCR：缓存、识别、组件下载 ---
  ipcMain.handle(IPC.OCR_GET_PDF_TOC, async (_event, payload: GetPdfOcrTocPayload) => {
    const cache = await readPdfOcrTocCache(payload.fileFingerprint)
    return cache ? ok(cache) : err({ code: 'FILE_NOT_FOUND', message: '无 OCR 目录缓存' })
  })

  ipcMain.handle(IPC.OCR_RECOGNIZE_PDF_TOC, async (_event, payload: RecognizePdfTocPayload) =>
    recognizePdfToc(payload),
  )

  ipcMain.handle(
    IPC.OCR_DETECT_PDF_TOC_PAGES,
    async (_event, payload: DetectPdfTocPagesPayload) => detectPdfTocPages(payload),
  )

  ipcMain.handle(IPC.OCR_DELETE_PDF_TOC, async (_event, payload: GetPdfOcrTocPayload) => {
    await deletePdfOcrTocCache(payload.fileFingerprint)
    return ok(undefined)
  })

  ipcMain.handle(IPC.OCR_GET_PDF_PAGE, async (_event, payload: GetPdfOcrPagePayload) => {
    const cache = await readPdfOcrPageCache(payload.fileFingerprint, payload.page)
    return cache ? ok(cache) : err({ code: 'FILE_NOT_FOUND', message: '本页尚无 OCR 缓存' })
  })

  ipcMain.handle(IPC.OCR_RECOGNIZE_PDF_PAGE, async (_event, payload: RecognizePdfPagePayload) =>
    recognizePdfPage(payload),
  )

  ipcMain.handle(IPC.OCR_LIST_PDF_PAGES, async (_event, payload: ListPdfOcrPagesPayload) =>
    ok(await listPdfOcrPageCachePages(payload.fileFingerprint)),
  )

  ipcMain.handle(IPC.OCR_CLEAR_PDF_CACHE, async (_event, payload: GetPdfOcrTocPayload) => {
    await Promise.all([
      deleteAllPdfOcrPageCaches(payload.fileFingerprint),
      deletePdfOcrTocCache(payload.fileFingerprint),
    ])
    return ok(undefined)
  })

  ipcMain.handle(IPC.OCR_CLEAR_ALL_CACHE, async () => {
    await clearAllPdfOcrCaches()
    return ok(undefined)
  })

  ipcMain.handle(IPC.OCR_SAVE_PDF_TOC, async (_event, payload: SavePdfOcrTocPayload) => {
    if (!payload?.cache?.fileFingerprint) {
      return err({ code: 'INVALID_ARGUMENT', message: '目录缓存无效' })
    }
    await writePdfOcrTocCache(payload.cache)
    return ok(undefined)
  })

  ipcMain.handle(IPC.OCR_GET_COMPONENT_STATUS, async () => ok(await inspectOcrComponentStatus()))

  ipcMain.handle(IPC.OCR_ENSURE_COMPONENT, async () => ensureOcrComponent())

  ipcMain.handle(IPC.OCR_CANCEL_COMPONENT_DOWNLOAD, async () =>
    ok(await cancelOcrComponentDownload()),
  )

  // --- PDF 解析（pdf-inspector 主进程分类/抽取）---
  ipcMain.handle(
    IPC.PDF_INSPECT_CLASSIFY,
    async (_event, payload: ClassifyPdfDocumentPayload) =>
      classifyPdfDocument(payload.filePath),
  )

  ipcMain.handle(
    IPC.PDF_INSPECT_BOOK_MARKDOWN,
    async (_event, payload: ExtractPdfBookMarkdownPayload) =>
      extractPdfBookMarkdown(payload.filePath),
  )

  // --- 罗盘索引（扫描书一键导入 + 读库）---
  ipcMain.handle(IPC.ROSETTA_IMPORT_BOOK, (event, payload: RosettaImportPayload) => {
    const sender = event.sender
    const fingerprint =
      typeof payload?.fileFingerprint === 'string' ? payload.fileFingerprint.trim() : ''
    const push = (status: RosettaImportStatus): void => {
      if (!sender.isDestroyed()) sender.send(IPC.ROSETTA_IMPORT_STATUS, status)
    }
    push({ fingerprint, state: 'running', donePages: 0, totalPages: 0, phase: 'preparing' })
    // 长任务：invoke 挂到导入结束，进度另走推送（窗口重载也不丢状态）
    return importScannedBookToDb(app.getPath('userData'), payload, {
      onProgress: (donePages, totalPages, phase) =>
        push({ fingerprint, state: 'running', donePages, totalPages, phase }),
    }).then((result) => {
      if (result.ok) {
        const stats = result.value
        push({
          fingerprint,
          state: 'done',
          donePages: stats.pages,
          totalPages: stats.pages,
          message: formatRosettaImportDoneMessage(stats),
        })
      } else {
        push({
          fingerprint,
          state: result.error.code === 'CANCELLED' ? 'cancelled' : 'error',
          donePages: 0,
          totalPages: 0,
          message: result.error.message,
        })
      }
      return result
    })
  })
  ipcMain.on(IPC.ROSETTA_CANCEL_IMPORT, () => {
    cancelRosettaImport()
  })
  ipcMain.handle(IPC.ROSETTA_ACTIVE_IMPORT, () => ok(getActiveRosettaImport()))
  ipcMain.handle(IPC.ROSETTA_BOOK_INFO, (_event, fingerprint: string) => {
    try {
      return getRosettaBookInfo(app.getPath('userData'), fingerprint ?? '')
    } catch (cause) {
      return err({
        code: 'UNKNOWN',
        message: cause instanceof Error ? cause.message : '读取罗盘信息失败',
      })
    }
  })
  ipcMain.handle(IPC.ROSETTA_QUERY_BOOK, (_event, query: RosettaQuery) => {
    try {
      return queryRosettaBook(app.getPath('userData'), query)
    } catch (cause) {
      return err({
        code: 'UNKNOWN',
        message: cause instanceof Error ? cause.message : '罗盘查询失败',
      })
    }
  })
  ipcMain.handle(IPC.ROSETTA_REBUILD_TOC, (_event, payload: RosettaTocRebuildPayload) => {
    try {
      const fingerprint =
        typeof payload?.fingerprint === 'string' ? payload.fingerprint.trim() : ''
      if (!fingerprint) {
        return err({ code: 'INVALID_ARGUMENT', message: '缺少文件指纹' })
      }
      if (!Array.isArray(payload?.toc)) {
        return err({ code: 'INVALID_ARGUMENT', message: '缺少已确认目录' })
      }
      const db = openBookDb(app.getPath('userData'), fingerprint)
      const record = getBookRecord(db, fingerprint)
      if (!record) {
        return err({ code: 'INVALID_STATE', message: '本书尚未导入罗盘索引' })
      }
      const result = rebuildTocIndex(db, record.bookId, payload.toc)
      return ok({
        bookId: result.bookId,
        tocEntries: result.tocEntries,
        chapters: result.chapters,
        blocks: result.blocks,
        completedPages: result.completedPages,
        tocSignature: result.tocSignature,
      })
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : '罗盘目录重建失败'
      if (message.includes('有效目录')) {
        return err({ code: 'INVALID_ARGUMENT', message })
      }
      return err({
        code: 'UNKNOWN',
        message,
      })
    }
  })

  ipcMain.handle(
    IPC.ROSETTA_PREVIEW_BODY_WATERMARK,
    (_event, payload: RosettaBodyWatermarkPreviewPayload) => {
      try {
        const fingerprint =
          typeof payload?.fingerprint === 'string' ? payload.fingerprint.trim() : ''
        if (!fingerprint) {
          return err({ code: 'INVALID_ARGUMENT', message: '缺少文件指纹' })
        }
        // 只读预览：文件入口内部先判存在、不建库，以 readOnly + query_only 打开；
        // samplePage 原样透传，非法值由预览服务返回 INVALID_ARGUMENT
        return previewBodyWatermarkFile(app.getPath('userData'), fingerprint, payload?.samplePage, payload?.customToken)
      } catch (cause) {
        return err({
          code: 'UNKNOWN',
          message: cause instanceof Error ? cause.message : '正文水印预览失败',
        })
      }
    },
  )

  ipcMain.handle(
    IPC.ROSETTA_APPLY_BODY_WATERMARK,
    (_event, payload: RosettaBodyWatermarkApplyPayload) => {
      try {
        const fingerprint =
          typeof payload?.fingerprint === 'string' ? payload.fingerprint.trim() : ''
        if (!fingerprint) {
          return err({ code: 'INVALID_ARGUMENT', message: '缺少文件指纹' })
        }
        // 备份并应用：须用户在 UI 二次确认后调用；签名/统计由服务在同一连接重算比对
        return applyBodyWatermarkFile(app.getPath('userData'), fingerprint, {
          fingerprint,
          planSignature: payload?.planSignature,
          deleteCount: payload?.deleteCount,
          updateCount: payload?.updateCount,
        })
      } catch (cause) {
        return err({
          code: 'UNKNOWN',
          message: cause instanceof Error ? cause.message : '正文水印应用失败',
        })
      }
    },
  )

  ipcMain.handle(
    IPC.ROSETTA_INSPECT_CONTENT,
    (_event, payload: RosettaInspectContentPayload) => {
      try {
        const fingerprint =
          typeof payload?.fingerprint === 'string' ? payload.fingerprint.trim() : ''
        if (!fingerprint) {
          return err({ code: 'INVALID_ARGUMENT', message: '缺少文件指纹' })
        }
        // 只读取证：指纹由渲染端绑定当前打开文档；服务内判存在、不建库、
        // readOnly + query_only 打开，不调 OCR/导入/迁移/清洗/写缓存
        return inspectIndexedContentFile(
          app.getPath('userData'),
          fingerprint,
          payload?.query,
          payload?.limit,
        )
      } catch (cause) {
        return err({
          code: 'UNKNOWN',
          message: cause instanceof Error ? cause.message : '内容审计失败',
        })
      }
    },
  )

  // --- 云端同步 (WebDAV) ---
  ipcMain.handle(IPC.SYNC_GET_CONFIG, async () => readSyncConfig())
  ipcMain.handle(IPC.SYNC_SAVE_CONFIG, async (_event, config: SyncConfig) =>
    writeSyncConfig(config),
  )
  ipcMain.handle(IPC.SYNC_TEST_CONNECTION, async (_event, config?: SyncConfig) =>
    syncManager.testConnection(config),
  )
  ipcMain.handle(IPC.SYNC_RUN_NOW, async () => syncManager.runSyncNow())
  ipcMain.handle(IPC.SYNC_GET_STATUS, async () => ok(syncManager.getStatus()))
  ipcMain.handle(IPC.SYNC_SAVE_LOCAL_PROGRESS, async (_event, progressJson: string) => {
    try {
      const parsed = JSON.parse(progressJson)
      await writeLocalProgress(parsed)
      return ok(undefined)
    } catch {
      return ok(undefined)
    }
  })

  // --- 语音朗读 (TTS / Gemini TTS) ---
  ipcMain.handle(IPC.TTS_GET_CONFIG, async () => readTtsConfig())
  ipcMain.handle(IPC.TTS_SAVE_CONFIG, async (_event, config: TtsConfig) =>
    writeTtsConfig(config),
  )
  ipcMain.handle(IPC.TTS_SYNTHESIZE, async (_event, payload: TtsSynthesizePayload) =>
    synthesizeTts(payload),
  )
  ipcMain.handle(
    IPC.TTS_SYNTHESIZE_STREAM,
    async (event, payload: TtsSynthesizePayload & { streamId: string }) =>
      synthesizeTtsStream(event.sender, payload),
  )
  ipcMain.handle(IPC.TTS_CANCEL_STREAM, async (_event, streamId: string) =>
    cancelTtsStream(streamId),
  )
  ipcMain.handle(IPC.TTS_TEST_KEY, async (_event, payload: TtsTestKeyPayload) =>
    testTtsKey(payload),
  )
  ipcMain.handle(IPC.TTS_GET_CACHE_STATS, async () => getTtsCacheStats())
  ipcMain.handle(IPC.TTS_CLEAR_CACHE, async () => clearTtsCache())
  ipcMain.handle(IPC.TTS_LIST_MODELS, async (_event, apiKey?: string) =>
    listTtsModels(apiKey),
  )
  ipcMain.handle(
    IPC.TTS_LIST_VOICES,
    async (_event, provider?: string, apiKey?: string, region?: string) =>
      listTtsVoices(provider, apiKey, region),
  )
  ipcMain.handle(
    IPC.TTS_CREATE_BATCH_JOB,
    async (_event, payload: TtsBatchCreatePayload) =>
      createTtsBatchJob(payload),
  )
  ipcMain.handle(IPC.TTS_GET_BATCH_JOB, async (_event, name: string, apiKey?: string) =>
    getTtsBatchJob(name, apiKey),
  )
  ipcMain.handle(
    IPC.TTS_CANCEL_BATCH_JOB,
    async (_event, name: string, apiKey?: string) =>
      cancelTtsBatchJob(name, apiKey),
  )
}
