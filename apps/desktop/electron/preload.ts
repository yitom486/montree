import { contextBridge, ipcRenderer } from 'electron'
import { IPC } from '@inkdown/contracts'
import type { AppError } from '@inkdown/contracts'
import type { Result } from '@inkdown/contracts'
import type { ExportDocumentPayload, ExportMarkdownPayload, OpenDialogOptions, SaveFilePayload, SavePastedImagePayload } from '@inkdown/contracts'
import type { RendererErrorPayload } from '@inkdown/contracts'
import type { WindowInit } from '@inkdown/contracts'
import type { ElectronAPI } from '@inkdown/contracts'
import type { WebDocDiscoverTocPayload, WebDocFetchPayload } from '@inkdown/contracts'
import type { DetectPdfTocPagesPayload, GetPdfOcrTocPayload, GetPdfOcrPagePayload, ListPdfOcrPagesPayload, RecognizePdfPagePayload, RecognizePdfTocPayload, SavePdfOcrTocPayload } from '@inkdown/contracts'
import type { ClassifyPdfDocumentPayload, ExtractPdfBookMarkdownPayload } from '@inkdown/contracts'
import type { RosettaActiveImport, RosettaBodyWatermarkApplyPayload, RosettaBodyWatermarkPreviewPayload, RosettaImportPayload, RosettaImportStatus, RosettaInspectContentPayload, RosettaQuery, RosettaTocRebuildPayload } from '@inkdown/contracts'
import type { QuizSessionRecord } from '@inkdown/contracts'

const windowInit = ipcRenderer.sendSync(IPC.APP_GET_WINDOW_INIT) as WindowInit
const isFreshWindow = windowInit?.isFreshWindow ?? false
const e2eFoliateReader = windowInit?.e2eFoliateReader ?? false
const e2ePdfStructure = windowInit?.e2ePdfStructure ?? false

const electronAPI: ElectronAPI = {
  platform: process.platform,
  isFreshWindow,
  e2eFoliateReader,
  e2ePdfStructure,
  getVersion: () => ipcRenderer.invoke(IPC.APP_GET_VERSION),
  setDirty: (isDirty: boolean) => {
    ipcRenderer.send(IPC.APP_SET_DIRTY, isDirty)
  },
  confirmClose: (decision: 'proceed' | 'cancel') => {
    ipcRenderer.send(IPC.APP_CLOSE_DECISION, decision)
  },
  minimizeWindow: () => {
    ipcRenderer.send(IPC.APP_WINDOW_MINIMIZE)
  },
  toggleMaximizeWindow: () => {
    ipcRenderer.send(IPC.APP_WINDOW_TOGGLE_MAXIMIZE)
  },
  closeWindow: () => {
    ipcRenderer.send(IPC.APP_WINDOW_CLOSE)
  },
  isWindowMaximized: () => ipcRenderer.invoke(IPC.APP_WINDOW_IS_MAXIMIZED),
  onWindowMaximizeChanged: (callback: (isMaximized: boolean) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, isMaximized: boolean): void => callback(isMaximized)
    ipcRenderer.on(IPC.APP_WINDOW_MAXIMIZE_CHANGED, handler)
    return () => {
      ipcRenderer.removeListener(IPC.APP_WINDOW_MAXIMIZE_CHANGED, handler)
    }
  },
  onRequestClose: (callback: () => void) => {
    const handler = (): void => callback()
    ipcRenderer.on(IPC.APP_REQUEST_CLOSE, handler)
    return () => {
      ipcRenderer.removeListener(IPC.APP_REQUEST_CLOSE, handler)
    }
  },
  onGlobalAction: (callback: (action: string) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, action: string): void => callback(action)
    ipcRenderer.on(IPC.APP_GLOBAL_ACTION, handler)
    return () => {
      ipcRenderer.removeListener(IPC.APP_GLOBAL_ACTION, handler)
    }
  },
  openFile: (options?: OpenDialogOptions) => ipcRenderer.invoke(IPC.FILE_OPEN, options),
  openFolder: (options?: OpenDialogOptions) => ipcRenderer.invoke(IPC.FILE_OPEN_FOLDER, options),
  scanWorkspace: (rootPath: string) => ipcRenderer.invoke(IPC.FILE_SCAN_WORKSPACE, rootPath),
  searchWorkspaceMarkdown: (payload) =>
    ipcRenderer.invoke(IPC.WORKSPACE_SEARCH_MARKDOWN, payload),
  watchWorkspace: (rootPath: string) => {
    ipcRenderer.send(IPC.WORKSPACE_WATCH, rootPath)
  },
  unwatchWorkspace: () => {
    ipcRenderer.send(IPC.WORKSPACE_UNWATCH)
  },
  onWorkspaceChanged: (callback: (payload: { rootPath: string }) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, payload: { rootPath: string }) => {
      callback(payload)
    }
    ipcRenderer.on(IPC.WORKSPACE_CHANGED, handler)
    return () => {
      ipcRenderer.removeListener(IPC.WORKSPACE_CHANGED, handler)
    }
  },
  readFile: (filePath: string) => ipcRenderer.invoke(IPC.FILE_READ, filePath),
  readBinaryFile: (filePath: string) => ipcRenderer.invoke(IPC.FILE_READ_BINARY, filePath),
  readImage: (filePath: string) => ipcRenderer.invoke(IPC.FILE_READ_IMAGE, filePath),
  saveFile: (payload: SaveFilePayload) => ipcRenderer.invoke(IPC.FILE_SAVE, payload),
  saveFileAs: (payload: SaveFilePayload) => ipcRenderer.invoke(IPC.FILE_SAVE_AS, payload),
  savePastedImage: (payload: SavePastedImagePayload) =>
    ipcRenderer.invoke(IPC.FILE_SAVE_PASTED_IMAGE, payload),
  createWorkspaceFile: (payload) => ipcRenderer.invoke(IPC.FILE_CREATE, payload),
  createWorkspaceDirectory: (payload) => ipcRenderer.invoke(IPC.FILE_CREATE_DIR, payload),
  renameWorkspacePath: (payload) => ipcRenderer.invoke(IPC.FILE_RENAME, payload),
  deleteWorkspacePath: (payload) => ipcRenderer.invoke(IPC.FILE_DELETE, payload),
  copyWorkspacePath: (payload) => ipcRenderer.invoke(IPC.FILE_COPY, payload),
  moveWorkspacePath: (payload) => ipcRenderer.invoke(IPC.FILE_MOVE, payload),
  exportHtml: (payload: ExportDocumentPayload) =>
    ipcRenderer.invoke(IPC.FILE_EXPORT_HTML, payload),
  exportPdf: (payload: ExportDocumentPayload) => ipcRenderer.invoke(IPC.FILE_EXPORT_PDF, payload),
  exportMarkdown: (payload: ExportMarkdownPayload) =>
    ipcRenderer.invoke(IPC.FILE_EXPORT_MARKDOWN, payload),
  updateTitle: (payload) => {
    ipcRenderer.send(IPC.FILE_UPDATE_TITLE, payload)
  },
  quit: () => {
    ipcRenderer.send(IPC.APP_QUIT)
  },
  newWindow: () => {
    ipcRenderer.send(IPC.APP_NEW_WINDOW)
  },
  takePendingExternalFile: () => ipcRenderer.invoke(IPC.APP_TAKE_PENDING_EXTERNAL_FILE),
  openExternal: (url: string) => ipcRenderer.invoke(IPC.APP_OPEN_EXTERNAL, url),
  importBookToRosetta: (payload: RosettaImportPayload) =>
    ipcRenderer.invoke(IPC.ROSETTA_IMPORT_BOOK, payload),
  cancelRosettaImport: () => {
    ipcRenderer.send(IPC.ROSETTA_CANCEL_IMPORT)
  },
  onRosettaImportStatus: (callback: (status: RosettaImportStatus) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, status: RosettaImportStatus) => {
      callback(status)
    }
    ipcRenderer.on(IPC.ROSETTA_IMPORT_STATUS, handler)
    return () => {
      ipcRenderer.removeListener(IPC.ROSETTA_IMPORT_STATUS, handler)
    }
  },
  getRosettaBookInfo: (fingerprint: string) =>
    ipcRenderer.invoke(IPC.ROSETTA_BOOK_INFO, fingerprint),
  getActiveRosettaImport: (): Promise<Result<RosettaActiveImport | null, AppError>> =>
    ipcRenderer.invoke(IPC.ROSETTA_ACTIVE_IMPORT),
  queryRosettaBook: (query: RosettaQuery) => ipcRenderer.invoke(IPC.ROSETTA_QUERY_BOOK, query),
  rebuildRosettaToc: (payload: RosettaTocRebuildPayload) =>
    ipcRenderer.invoke(IPC.ROSETTA_REBUILD_TOC, payload),
  previewBodyWatermark: (payload: RosettaBodyWatermarkPreviewPayload) =>
    ipcRenderer.invoke(IPC.ROSETTA_PREVIEW_BODY_WATERMARK, payload),
  applyBodyWatermark: (payload: RosettaBodyWatermarkApplyPayload) =>
    ipcRenderer.invoke(IPC.ROSETTA_APPLY_BODY_WATERMARK, payload),
  inspectRosettaContent: (payload: RosettaInspectContentPayload) =>
    ipcRenderer.invoke(IPC.ROSETTA_INSPECT_CONTENT, payload),
  getBunRuntimeStatus: () => ipcRenderer.invoke(IPC.BUN_GET_STATUS),
  installBunRuntime: () => ipcRenderer.invoke(IPC.BUN_INSTALL),
  toggleDevTools: () => {
    ipcRenderer.send(IPC.APP_TOGGLE_DEVTOOLS)
  },
  logRendererError: (payload: RendererErrorPayload) =>
    ipcRenderer.invoke(IPC.APP_LOG_RENDERER_ERROR, payload),
  getErrorLogPath: () => ipcRenderer.invoke(IPC.APP_GET_ERROR_LOG_PATH),
  setVerboseLogs: (enabled: boolean) => {
    ipcRenderer.send(IPC.APP_SET_VERBOSE_LOGS, enabled)
  },
  listReadingMarks: (filePath: string) => ipcRenderer.invoke(IPC.MARKS_LIST, filePath),
  createReadingMark: (payload) => ipcRenderer.invoke(IPC.MARKS_CREATE, payload),
  updateReadingMark: (payload) => ipcRenderer.invoke(IPC.MARKS_UPDATE, payload),
  deleteReadingMark: (id: string) => ipcRenderer.invoke(IPC.MARKS_DELETE, id),
  searchReadingMarks: (payload) => ipcRenderer.invoke(IPC.MARKS_SEARCH, payload),
  listReadingMarksByChapter: (payload) =>
    ipcRenderer.invoke(IPC.MARKS_LIST_BY_CHAPTER, payload),
  listDueFlashcards: (payload) => ipcRenderer.invoke(IPC.FLASHCARDS_LIST_DUE, payload),
  appendFlashcardReview: (payload) =>
    ipcRenderer.invoke(IPC.FLASHCARDS_APPEND_REVIEW, payload),
  listAcpRuntimes: () => ipcRenderer.invoke(IPC.ACP_LIST_RUNTIMES),
  acpAuthPreflight: (payload) => ipcRenderer.invoke(IPC.ACP_AUTH_PREFLIGHT, payload),
  acpConnect: (payload) => ipcRenderer.invoke(IPC.ACP_CONNECT, payload),
  acpAuthenticate: (payload) => ipcRenderer.invoke(IPC.ACP_AUTHENTICATE, payload),
  acpLoadSession: (payload) => ipcRenderer.invoke(IPC.ACP_LOAD_SESSION, payload),
  acpDisconnect: () => ipcRenderer.invoke(IPC.ACP_DISCONNECT),
  acpSessionNew: (payload) => ipcRenderer.invoke(IPC.ACP_SESSION_NEW, payload),
  acpPrompt: (payload) => ipcRenderer.invoke(IPC.ACP_PROMPT, payload),
  acpCancel: (payload) => ipcRenderer.invoke(IPC.ACP_CANCEL, payload),
  acpSetConfigOption: (payload) => ipcRenderer.invoke(IPC.ACP_SET_CONFIG_OPTION, payload),
  getAcpProvider: () => ipcRenderer.invoke(IPC.ACP_PROVIDER_GET),
  saveAcpProvider: (payload) => ipcRenderer.invoke(IPC.ACP_PROVIDER_SAVE, payload),
  clearAcpProvider: () => ipcRenderer.invoke(IPC.ACP_PROVIDER_CLEAR),
  getAcpProxySettings: () => ipcRenderer.invoke(IPC.ACP_PROXY_GET),
  saveAcpProxySettings: (payload) => ipcRenderer.invoke(IPC.ACP_PROXY_SAVE, payload),
  acpRespondPermission: (payload) => {
    ipcRenderer.send(IPC.ACP_PERMISSION_RESPONSE, payload)
  },
  acpRespondSnapshot: (payload) => {
    ipcRenderer.send(IPC.ACP_SNAPSHOT_RESPONSE, payload)
  },
  onAcpSessionUpdate: (callback) => {
    const handler = (_event: Electron.IpcRendererEvent, payload: Parameters<typeof callback>[0]) => {
      callback(payload)
    }
    ipcRenderer.on(IPC.ACP_SESSION_UPDATE, handler)
    return () => {
      ipcRenderer.removeListener(IPC.ACP_SESSION_UPDATE, handler)
    }
  },
  onAcpStatusChanged: (callback) => {
    const handler = (_event: Electron.IpcRendererEvent, payload: Parameters<typeof callback>[0]) => {
      callback(payload)
    }
    ipcRenderer.on(IPC.ACP_STATUS_CHANGED, handler)
    return () => {
      ipcRenderer.removeListener(IPC.ACP_STATUS_CHANGED, handler)
    }
  },
  onAcpPermissionRequest: (callback) => {
    const handler = (_event: Electron.IpcRendererEvent, payload: Parameters<typeof callback>[0]) => {
      callback(payload)
    }
    ipcRenderer.on(IPC.ACP_PERMISSION_REQUEST, handler)
    return () => {
      ipcRenderer.removeListener(IPC.ACP_PERMISSION_REQUEST, handler)
    }
  },
  onAcpSnapshotRequest: (callback) => {
    const handler = (_event: Electron.IpcRendererEvent, payload: Parameters<typeof callback>[0]) => {
      callback(payload)
    }
    ipcRenderer.on(IPC.ACP_SNAPSHOT_REQUEST, handler)
    return () => {
      ipcRenderer.removeListener(IPC.ACP_SNAPSHOT_REQUEST, handler)
    }
  },
  fetchWebDocPage: (payload: WebDocFetchPayload) =>
    ipcRenderer.invoke(IPC.WEB_DOC_FETCH_PAGE, payload),
  discoverWebDocToc: (payload: WebDocDiscoverTocPayload) =>
    ipcRenderer.invoke(IPC.WEB_DOC_DISCOVER_TOC, payload),
  getPdfOcrToc: (payload: GetPdfOcrTocPayload) =>
    ipcRenderer.invoke(IPC.OCR_GET_PDF_TOC, payload),
  recognizePdfOcrToc: (payload: RecognizePdfTocPayload) =>
    ipcRenderer.invoke(IPC.OCR_RECOGNIZE_PDF_TOC, payload),
  detectPdfTocPages: (payload: DetectPdfTocPagesPayload) =>
    ipcRenderer.invoke(IPC.OCR_DETECT_PDF_TOC_PAGES, payload),
  deletePdfOcrToc: (payload: GetPdfOcrTocPayload) =>
    ipcRenderer.invoke(IPC.OCR_DELETE_PDF_TOC, payload),
  getPdfOcrPage: (payload: GetPdfOcrPagePayload) =>
    ipcRenderer.invoke(IPC.OCR_GET_PDF_PAGE, payload),
  recognizePdfOcrPage: (payload: RecognizePdfPagePayload) =>
    ipcRenderer.invoke(IPC.OCR_RECOGNIZE_PDF_PAGE, payload),
  listPdfOcrPages: (payload: ListPdfOcrPagesPayload) =>
    ipcRenderer.invoke(IPC.OCR_LIST_PDF_PAGES, payload),
  clearPdfOcrCache: (payload: GetPdfOcrTocPayload) =>
    ipcRenderer.invoke(IPC.OCR_CLEAR_PDF_CACHE, payload),
  clearAllPdfOcrCache: () => ipcRenderer.invoke(IPC.OCR_CLEAR_ALL_CACHE),
  savePdfOcrToc: (payload: SavePdfOcrTocPayload) =>
    ipcRenderer.invoke(IPC.OCR_SAVE_PDF_TOC, payload),
  getOcrComponentStatus: () => ipcRenderer.invoke(IPC.OCR_GET_COMPONENT_STATUS),
  ensureOcrComponent: () => ipcRenderer.invoke(IPC.OCR_ENSURE_COMPONENT),
  cancelOcrComponentDownload: () => ipcRenderer.invoke(IPC.OCR_CANCEL_COMPONENT_DOWNLOAD),
  classifyPdfDocument: (payload: ClassifyPdfDocumentPayload) =>
    ipcRenderer.invoke(IPC.PDF_INSPECT_CLASSIFY, payload),
  extractPdfBookMarkdown: (payload: ExtractPdfBookMarkdownPayload) =>
    ipcRenderer.invoke(IPC.PDF_INSPECT_BOOK_MARKDOWN, payload),
  onOcrComponentStatus: (callback) => {
    const handler = (_event: Electron.IpcRendererEvent, payload: Parameters<typeof callback>[0]) => {
      callback(payload)
    }
    ipcRenderer.on(IPC.OCR_COMPONENT_STATUS, handler)
    return () => {
      ipcRenderer.removeListener(IPC.OCR_COMPONENT_STATUS, handler)
    }
  },
  checkAppUpdate: () => ipcRenderer.invoke(IPC.APP_UPDATE_CHECK),
  downloadAppUpdate: () => ipcRenderer.invoke(IPC.APP_UPDATE_DOWNLOAD),
  installAppUpdate: () => ipcRenderer.invoke(IPC.APP_UPDATE_INSTALL),
  getAppUpdateStatus: () => ipcRenderer.invoke(IPC.APP_UPDATE_GET_STATUS),
  onAppUpdateStatus: (callback) => {
    const handler = (_event: Electron.IpcRendererEvent, payload: Parameters<typeof callback>[0]) => {
      callback(payload)
    }
    ipcRenderer.on(IPC.APP_UPDATE_STATUS, handler)
    return () => {
      ipcRenderer.removeListener(IPC.APP_UPDATE_STATUS, handler)
    }
  },
  appendQuizSession: (session: QuizSessionRecord) =>
    ipcRenderer.invoke(IPC.QUIZ_APPEND_SESSION, session),
  getAllQuizSessions: () => ipcRenderer.invoke(IPC.QUIZ_GET_ALL_SESSIONS),
  getQuizSessionsByFile: (filePath: string) =>
    ipcRenderer.invoke(IPC.QUIZ_GET_SESSIONS_BY_FILE, filePath),
  getAiSession: (payload) => ipcRenderer.invoke(IPC.AI_SESSIONS_GET, payload),
  putAiSession: (payload) => ipcRenderer.invoke(IPC.AI_SESSIONS_PUT, payload),
  touchAiSession: (payload) => ipcRenderer.invoke(IPC.AI_SESSIONS_TOUCH, payload),
  getSyncConfig: () => ipcRenderer.invoke(IPC.SYNC_GET_CONFIG),
  saveSyncConfig: (config) => ipcRenderer.invoke(IPC.SYNC_SAVE_CONFIG, config),
  testSyncConnection: (config) => ipcRenderer.invoke(IPC.SYNC_TEST_CONNECTION, config),
  runSyncNow: () => ipcRenderer.invoke(IPC.SYNC_RUN_NOW),
  getSyncStatus: () => ipcRenderer.invoke(IPC.SYNC_GET_STATUS),
  onSyncStatusChanged: (callback) => {
    const handler = (_event: Electron.IpcRendererEvent, status: Parameters<typeof callback>[0]) => {
      callback(status)
    }
    ipcRenderer.on(IPC.SYNC_STATUS_CHANGED, handler)
    return () => {
      ipcRenderer.removeListener(IPC.SYNC_STATUS_CHANGED, handler)
    }
  },
  onApplyRemoteProgress: (callback) => {
    const handler = (_event: Electron.IpcRendererEvent, progressJson: string) => {
      callback(progressJson)
    }
    ipcRenderer.on(IPC.SYNC_APPLY_REMOTE_PROGRESS, handler)
    return () => {
      ipcRenderer.removeListener(IPC.SYNC_APPLY_REMOTE_PROGRESS, handler)
    }
  },
  saveLocalProgress: (progressJson: string) =>
    ipcRenderer.invoke(IPC.SYNC_SAVE_LOCAL_PROGRESS, progressJson),
}

contextBridge.exposeInMainWorld('electronAPI', electronAPI)
