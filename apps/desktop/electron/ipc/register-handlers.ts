import { registerTypstHandlers } from './typst-handlers'
import { registerAcpWindowHandlers, withAcpWindow } from './acp-window-handlers'
import { compileReactArtifact } from '../services/react-artifact-service'
import { app, BrowserWindow, ipcMain, shell } from 'electron'
import { IPC, ok, err } from '@yitom/contracts'
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
} from '@yitom/contracts'
import type { RendererErrorPayload } from '@yitom/contracts'
import type { AppError, Result } from '@yitom/contracts'
import type { WorkspaceWatchEvent } from '@yitom/contracts'
import type { WindowWorkspaceStatus, WorkspaceConnectPayload } from '@yitom/contracts'
import type {
  WorkspaceHostReadRequest,
  WorkspaceHostSaveAsRequest,
  WorkspaceHostTextRef,
  WorkspaceHostWriteRequest,
} from '@yitom/contracts'
import { makeLocalWorkspaceDescriptor, makeWslWorkspaceDescriptor } from '@yitom/contracts'
import type {
  AppendFlashcardReviewPayload,
  CreateReadingMarkPayload,
  ListDueFlashcardsPayload,
  MarksListByChapterPayload,
  MarksSearchPayload,
  UpdateReadingMarkPayload,
} from '@yitom/contracts'
import type {
  AcpAuthPreflightPayload,
  AcpProviderSavePayload,
  AcpProxySettings,
} from '@yitom/contracts'
import type { WebDocDiscoverTocPayload, WebDocFetchPayload } from '@yitom/contracts'
import { saveBinaryDocument } from '../services/binary-document-service'
import type { SaveBinaryDocumentPayload } from '@yitom/contracts'
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
} from '@yitom/contracts'
import type {
  ClassifyPdfDocumentPayload,
  ExtractPdfBookMarkdownPayload,
} from '@yitom/contracts'
import {
  classifyPdfDocument,
  extractPdfBookMarkdown,
} from '../services/pdf-inspector-service'
import type { SyncConfig } from '@yitom/contracts'
import type {
  RemoteWslConnectPayload,
  RemoteWslStatPayload,
} from '@yitom/contracts'
import type {
  RemoteOpenWslWorkspacePayload,
  RemoteOpenWslWorkspaceResult,
} from '@yitom/contracts'
import type { GitCommitOptions, GitPushOptions } from '@yitom/contracts'
import type {
  RemoteServerConnectPayload,
  RemoteServerInvokePayload,
} from '@yitom/contracts'
import {
  listWslDistros,
  getWslHome,
  listSshConfigHosts,
} from '../services/remote/remote-service'
import { remoteServerHosts } from '../services/remote/remote-server-host'
import {
  disposeWslHostForWindow,
  getWslHostForWindow,
  peekWslHostForWindow,
  takeWslHostForWindow,
  type WslWorkspaceHost,
} from '../services/remote/wsl-workspace-host'
import { getGitDiff, listGitBranches } from '../services/git/git-service'
import {
  bindRemoteHostToWindow,
  getRemoteHost,
  registerRemoteHost,
  unbindRemoteHostFromWindow,
  RemoteWorkspaceHost,
} from '../services/remote-workspace-host'
import { syncManager } from '../services/sync/sync-manager'
import { readSyncConfig, writeSyncConfig } from '../services/sync/sync-config-service'
import { writeLocalProgress } from '../services/sync/reading-progress-sync'
import type {
  TtsConfig,
  TtsSynthesizePayload,
  TtsTestKeyPayload,
  TtsBatchCreatePayload,
} from '@yitom/contracts'
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
import { getAppVersion } from '../services/app-service'
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
} from '@yitom/contracts'
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
} from '@yitom/contracts'
import type { QuizSessionRecord } from '@yitom/contracts'
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
import { setWorkspaceWatch, stopWorkspaceWatch, WORKSPACE_WATCH_MAX_DIRS } from '../services/workspace-watcher'
import { getWorkspaceHostForWindow, setRemoteHostResolver } from '../services/workspace-host'
import {
  bindWindowWorkspace,
  ensureWindowWorkspace,
  getWindowWorkspaceDescriptor,
  getWindowWorkspaceStatus,
  setWindowWorkspaceState,
  unbindWindowWorkspace,
} from '../services/workspace-bindings'
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

/** 推送工作区连接状态（main→renderer；调用方保证 sender 可信）。 */
function pushWorkspaceStatus(sender: Electron.WebContents, status: WindowWorkspaceStatus): void {
  if (!sender.isDestroyed()) {
    sender.send(IPC.WORKSPACE_STATUS_CHANGED, status)
  }
}

/**
 * 打开/扫描/监听成功后绑定可信窗口工作区并推送状态。
 * root 不变时复用既有绑定（generation 不抖，watch 订阅不误判过期）。
 */
function trackWindowWorkspaceRoot(sender: Electron.WebContents, rootPath: string): void {
  const status = ensureWindowWorkspace(sender, makeLocalWorkspaceDescriptor(rootPath))
  pushWorkspaceStatus(sender, status)
}

/**
 * B2/B3 宿主文本目标解析（可信 sender 归属）：
 * 远端语义优先（防本机路径冒充远端）；已绑定窗口传不一致 id 直接拒绝，
 * 不信任 renderer 跨窗口访问（§3.5）；远端会话缺席返回明确未连接错误。
 */
function resolveHostTextTarget(
  event: Electron.IpcMainInvokeEvent,
  payload: WorkspaceHostTextRef,
):
  | { kind: 'local'; filePath: string }
  | { kind: 'remote'; host: RemoteWorkspaceHost; relativePath: string }
  | { error: { code: 'INVALID_ARGUMENT' | 'INVALID_STATE' | 'REMOTE_NOT_CONNECTED'; message: string } } {
  const workspaceId =
    typeof payload?.workspaceId === 'string' ? payload.workspaceId.trim() : ''
  const relativePath =
    typeof payload?.relativePath === 'string' ? payload.relativePath.trim() : ''
  if (workspaceId && relativePath) {
    const bound = getWindowWorkspaceDescriptor(event.sender.id)
    if (!bound || bound.kind === 'local' || bound.id !== workspaceId) {
      return {
        error: { code: 'INVALID_STATE', message: '工作区归属与窗口绑定不一致（不可跨窗口访问）' },
      }
    }
    const host = getRemoteHost(workspaceId)
    if (!host) {
      return {
        error: {
          code: 'REMOTE_NOT_CONNECTED',
          message: `远端工作区未连接 (${workspaceId})：不断线误报成功，未保存内容仍在本地`,
        },
      }
    }
    autoBindRemoteSender(event.sender, workspaceId)
    return { kind: 'remote', host, relativePath }
  }
  const filePath = typeof payload?.filePath === 'string' ? payload.filePath : ''
  if (filePath) return { kind: 'local', filePath }
  return { error: { code: 'INVALID_ARGUMENT', message: '缺少 filePath 或 workspaceId/relativePath' } }
}

/** 远端会话的窗口级引用（sender 销毁时释放；关 A 不杀 B 由 refcount 保证）。 */
const remoteSenderBindings = new Map<number, Set<string>>()

/**
 * P1/P2 会话拥有的 WSL 传输宿主（workspaceId → 已转移所有权的 WSL 宿主）。
 * 所有权在打开远端工作区时从窗口注册表转移到会话；会话释放（最后一个
 * 窗口离开）时关闭传输，只清理本会话进程，不全局 pkill。
 */
const sessionWslHosts = new Map<string, WslWorkspaceHost>()

/** P4 远端监听转发（webContentsId → 订阅取消函数；事件按窗口代际过滤后推送）。 */
const remoteWatchForwards = new Map<number, { workspaceId: string; unsubscribe: () => void }>()

/** P4 已在远端建立根订阅的会话（workspaceId；会话释放时清除标记）。 */
const remoteRootSubscriptions = new Set<string>()

/** P2 窗口注册表销毁清理已登记的窗口（防重复登记）。 */
const wslRegistryCleanupRegistered = new Set<number>()

function closeWslSessionTransport(workspaceId: string): void {
  const host = sessionWslHosts.get(workspaceId)
  if (!host) return
  sessionWslHosts.delete(workspaceId)
  try {
    host.disconnect()
  } catch {
    // 清理永不抛异常
  }
}

function dropRemoteWatchForward(webContentsId: number): void {
  const forward = remoteWatchForwards.get(webContentsId)
  if (!forward) return
  remoteWatchForwards.delete(webContentsId)
  try {
    forward.unsubscribe()
  } catch {
    // 清理永不抛异常
  }
}

/**
 * P2 释放窗口的远端会话绑定（切换/断开/销毁时用）：最后一个窗口离开
 * 才关闭会话传输（关 A 不杀 B）；仅解绑，不动窗口的描述符绑定，
 * 描述符解绑由调用方另行处理。
 */
function releaseWindowRemoteBinding(webContentsId: number): void {
  const bound = getWindowWorkspaceDescriptor(webContentsId)
  if (!bound || bound.kind === 'local') return
  const released = unbindRemoteHostFromWindow(bound.id, webContentsId)
  if (released) {
    closeWslSessionTransport(bound.id)
    remoteRootSubscriptions.delete(bound.id)
  }
}

/** P2 窗口注册表销毁清理（只动本窗口的浏览连接，会话传输归会话表）。 */
function ensureWslRegistryCleanup(sender: Electron.WebContents): void {
  if (wslRegistryCleanupRegistered.has(sender.id)) return
  wslRegistryCleanupRegistered.add(sender.id)
  sender.once('destroyed', () => {
    wslRegistryCleanupRegistered.delete(sender.id)
    dropRemoteWatchForward(sender.id)
    disposeWslHostForWindow(sender.id)
  })
}

function autoBindRemoteSender(sender: Electron.WebContents, workspaceId: string): void {
  if (!bindRemoteHostToWindow(workspaceId, sender.id)) return
  let bound = remoteSenderBindings.get(sender.id)
  if (!bound) {
    bound = new Set()
    remoteSenderBindings.set(sender.id, bound)
    sender.once('destroyed', () => {
      const ids = remoteSenderBindings.get(sender.id)
      remoteSenderBindings.delete(sender.id)
      for (const id of ids ?? []) {
        // P2：最后一个窗口离开才关闭会话传输（关 A 不杀 B）
        if (unbindRemoteHostFromWindow(id, sender.id)) {
          closeWslSessionTransport(id)
          remoteRootSubscriptions.delete(id)
        }
      }
      dropRemoteWatchForward(sender.id)
    })
  }
  bound.add(workspaceId)
}

/**
 * B3 Git 后端：窗口绑定远端且会话存在时走远端 Ubuntu 执行；
 * 绑定远端但无会话时明确失败（不回落本机 git 误读 Windows 路径）。
 */
function getRemoteGitHost(
  senderId: number,
): { host: RemoteWorkspaceHost } | { host: null; remoteBound: boolean } {
  const descriptor = getWindowWorkspaceDescriptor(senderId)
  if (!descriptor || descriptor.kind === 'local') return { host: null, remoteBound: false }
  const host = getRemoteHost(descriptor.id)
  if (!host) return { host: null, remoteBound: true }
  return { host }
}

/**
 * P4 远端监听：窗口已绑定远端描述符时，经远端宿主订阅工作区根，
 * 事件按窗口代际过滤后以 workspace:changed 推送（载荷与本机同形，
 * 渲染端代际守卫与按目录刷新逻辑复用）。无会话时只不启动本机
 * 监听，不伪装成功；后续读/扫会报明确未连接错误。
 */
async function watchRemoteWorkspace(
  sender: Electron.WebContents,
  descriptor: { id: string; rootLabel: string },
): Promise<void> {
  if (sender.isDestroyed()) return
  stopWorkspaceWatch(sender.id)
  const host = getRemoteHost(descriptor.id)
  if (!host || !host.isConnected()) return
  if (!remoteRootSubscriptions.has(descriptor.id)) {
    try {
      const sub = await host.watchDirectory('')
      if (!sub.ok) return
    } catch {
      return
    }
    remoteRootSubscriptions.add(descriptor.id)
  }
  dropRemoteWatchForward(sender.id)
  const windowGeneration = getWindowWorkspaceStatus(sender.id).generation
  const unsubscribe = host.onWatchEvent((event: WorkspaceWatchEvent) => {
    if (sender.isDestroyed()) return
    const dirs = new Set<string>()
    let truncated = false
    for (const change of event.changes ?? []) {
      const rel = (change.path || '').replace(/\\/g, '/')
      if (!rel) continue
      const idx = rel.lastIndexOf('/')
      dirs.add(idx <= 0 ? '.' : rel.slice(0, idx))
      if (dirs.size >= WORKSPACE_WATCH_MAX_DIRS) {
        truncated = true
        break
      }
    }
    sender.send(IPC.WORKSPACE_CHANGED, {
      rootPath: descriptor.rootLabel,
      workspaceId: descriptor.id,
      generation: windowGeneration,
      ...(dirs.size > 0 ? { dirs: [...dirs].sort() } : {}),
      ...(truncated ? { truncatedDirs: true } : {}),
    })
  })
  remoteWatchForwards.set(sender.id, { workspaceId: descriptor.id, unsubscribe })
}

/**
 * P1 打开远端工作区（生产接线）：连接选中根 → 创建并注册远端宿主 →
 * 以可信 sender 绑定窗口 → 推送状态 → 返回初始树。同一远端根多窗口
 * 共享同一会话（refcount，关 A 不杀 B）；切换工作区先释放旧绑定。
 */
async function openWslWorkspaceForWindow(
  sender: Electron.WebContents,
  distro: string,
  linuxPath: string,
): Promise<Result<RemoteOpenWslWorkspaceResult, AppError>> {
  const normalizedRoot = linuxPath.trim().replace(/\\/g, '/').replace(/\/+$/, '') || '/'
  // 切换前先释放旧远端绑定（最后一个离开才关传输）并停掉旧监听
  releaseWindowRemoteBinding(sender.id)
  stopWorkspaceWatch(sender.id)
  dropRemoteWatchForward(sender.id)

  const descriptor = makeWslWorkspaceDescriptor(distro, normalizedRoot)
  const live = getRemoteHost(descriptor.id)
  if (live?.isConnected()) {
    // P2 会话复用：本窗口的浏览连接如有则清理，不另起远端进程
    disposeWslHostForWindow(sender.id)
    autoBindRemoteSender(sender, descriptor.id)
    const bound = bindWindowWorkspace(sender, descriptor, 'connected')
    pushWorkspaceStatus(sender, bound)
    const tree = await live.scanWorkspace()
    if (!tree.ok) return err(tree.error)
    return ok({
      descriptor,
      generation: bound.generation,
      status: bound,
      folder: { rootPath: tree.value.rootPath, tree: tree.value.tree },
    })
  }

  const host = getWslHostForWindow(sender.id)
  ensureWslRegistryCleanup(sender)
  if (host.connectedRoot() !== descriptor.rootLabel || !host.isConnectedTo(distro)) {
    const connected = await host.connect(distro, descriptor.rootLabel)
    if (!connected.ok) {
      bindWindowWorkspace(sender, descriptor, 'connecting')
      const errored = setWindowWorkspaceState(sender.id, 'error', connected.error)
      pushWorkspaceStatus(sender, errored)
      return err(connected.error)
    }
  }
  const transport = host.getTransport()
  const sessionGeneration = host.getSessionGeneration()
  if (!transport || !sessionGeneration) {
    return err({ code: 'REMOTE_NOT_CONNECTED', message: '远端服务传输不可用（不回落、不伪装成功）' })
  }
  // 旧断线会话同 id 残留时先清传输，再注册新宿主并转移连接所有权
  closeWslSessionTransport(descriptor.id)
  sessionWslHosts.set(descriptor.id, takeWslHostForWindow(sender.id) ?? host)
  const remoteHost = new RemoteWorkspaceHost(descriptor, transport, sessionGeneration)
  registerRemoteHost(remoteHost)
  autoBindRemoteSender(sender, descriptor.id)
  const bound = bindWindowWorkspace(sender, descriptor, 'connected')
  pushWorkspaceStatus(sender, bound)
  const tree = await remoteHost.scanWorkspace()
  if (!tree.ok) return err(tree.error)
  return ok({
    descriptor,
    generation: bound.generation,
    status: bound,
    folder: { rootPath: tree.value.rootPath, tree: tree.value.tree },
  })
}

/** 集中注册 IPC；文件/书签等耗时操作均为 async，不阻塞主进程事件循环 */
export function registerIpcHandlers(): void {
  ipcMain.handle(IPC.COMPILE_REACT_ARTIFACT, async (event, payload: unknown) => {
    if (!BrowserWindow.fromWebContents(event.sender) || event.senderFrame !== event.sender.mainFrame) return err({ code: 'INVALID_ARGUMENT', message: '编译请求来源非法' })
    try { return ok(await compileReactArtifact(payload)) }
    catch (error) { return err({ code: 'INVALID_ARGUMENT', message: error instanceof Error ? error.message : 'React 编译失败' }) }
  })
  // P1：wsl/ssh 描述符分发到远端会话表；无会话时显式 unavailable（不回落）
  setRemoteHostResolver((workspaceId: string) => getRemoteHost(workspaceId))
  registerAcpWindowHandlers()
  registerTypstHandlers()
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

  // --- 文件 / 工作区：打开、读写、树操作、导出、监听（经 WorkspaceHost 分发） ---
  ipcMain.handle(IPC.FILE_OPEN, (event, options?: OpenDialogOptions) =>
    getWorkspaceHostForWindow(event.sender.id).openDocument(options),
  )
  ipcMain.handle(IPC.FILE_OPEN_FOLDER, async (event, options?: OpenDialogOptions) => {
    const result = await getWorkspaceHostForWindow(event.sender.id).openFolder(options)
    // P1：远端绑定窗口的扫描结果不得改绑为本机描述符
    const bound = getWindowWorkspaceDescriptor(event.sender.id)
    if (result.ok && (!bound || bound.kind === 'local')) trackWindowWorkspaceRoot(event.sender, result.value.rootPath)
    return result
  })
  ipcMain.handle(IPC.FILE_SCAN_WORKSPACE, async (event, rootPath: string) => {
    const result = await getWorkspaceHostForWindow(event.sender.id).scanWorkspace(rootPath)
    // P1：远端绑定窗口的扫描结果不得改绑为本机描述符
    const bound = getWindowWorkspaceDescriptor(event.sender.id)
    if (result.ok && (!bound || bound.kind === 'local')) trackWindowWorkspaceRoot(event.sender, result.value.rootPath)
    return result
  })
  // P2.2 工作区 Markdown 字面检索：只读，不暴露给模型（无 MCP 接线）。
  // root 由渲染端文件树状态给出；query 长度 double-check（渲染端已先拒短词）。
  ipcMain.handle(IPC.WORKSPACE_SEARCH_MARKDOWN, async (event, payload: WorkspaceSearchMarkdownPayload) => {
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
      return await getWorkspaceHostForWindow(event.sender.id).searchMarkdown({
        workspaceRoot,
        query: query.trim(),
        excludePath: typeof payload?.excludePath === 'string' ? payload.excludePath : undefined,
        // B3 分页：offset/limit 透传，宿主返回 nextOffset（缺席视为无更多）
        ...(typeof payload?.offset === 'number' ? { offset: payload.offset } : {}),
        ...(typeof payload?.limit === 'number' ? { limit: payload.limit } : {}),
      })
    } catch (cause) {
      return err({
        code: 'UNKNOWN',
        message: cause instanceof Error ? cause.message : '工作区检索失败',
      })
    }
  })

  ipcMain.on(IPC.WORKSPACE_WATCH, (event, rootPath: string) => {
    if (typeof rootPath !== 'string' || rootPath.length === 0) return
    // P4：窗口已绑定远端时经远端宿主订阅，禁止改绑为本机监听
    const bound = getWindowWorkspaceDescriptor(event.sender.id)
    if (bound && bound.kind !== 'local') {
      void watchRemoteWorkspace(event.sender, bound)
      return
    }
    const status = ensureWindowWorkspace(event.sender, makeLocalWorkspaceDescriptor(rootPath))
    // 渲染端按代际过滤 watch 事件，必须先同步这次本机绑定的代际。
    pushWorkspaceStatus(event.sender, status)
    setWorkspaceWatch(event.sender, rootPath, {
      workspaceId: status.workspaceId,
      generation: status.generation,
    })
  })

  ipcMain.on(IPC.WORKSPACE_UNWATCH, (event) => {
    dropRemoteWatchForward(event.sender.id)
    stopWorkspaceWatch(event.sender.id)
  })

  // --- 本机工作区宿主绑定（workspace:*，A1）：可信 sender 归属 + 代际 ---
  ipcMain.handle(IPC.WORKSPACE_CONNECT, (event, payload: WorkspaceConnectPayload) => {
    const rootPath = typeof payload?.rootPath === 'string' ? payload.rootPath.trim() : ''
    if (!rootPath) {
      return err({ code: 'INVALID_ARGUMENT', message: '缺少本机工作区根目录' })
    }
    pushWorkspaceStatus(
      event.sender,
      bindWindowWorkspace(event.sender, makeLocalWorkspaceDescriptor(rootPath), 'connecting'),
    )
    const connected = setWindowWorkspaceState(event.sender.id, 'connected')
    pushWorkspaceStatus(event.sender, connected)
    const descriptor = getWindowWorkspaceDescriptor(event.sender.id)
    if (!descriptor) {
      return err({ code: 'WORKSPACE_ERROR', message: '工作区绑定失败' })
    }
    return ok({ descriptor, generation: connected.generation, status: connected })
  })

  ipcMain.handle(IPC.WORKSPACE_DISCONNECT, (event) => {
    // P2/P4：先释放远端会话绑定（最后一个离开才关传输）与远端转发，
    // 再停本机监听、清窗口浏览连接并解绑推送
    releaseWindowRemoteBinding(event.sender.id)
    dropRemoteWatchForward(event.sender.id)
    stopWorkspaceWatch(event.sender.id)
    disposeWslHostForWindow(event.sender.id)
    pushWorkspaceStatus(event.sender, unbindWindowWorkspace(event.sender.id))
    return ok(undefined)
  })

  ipcMain.handle(IPC.WORKSPACE_GET_STATUS, (event) =>
    ok(getWindowWorkspaceStatus(event.sender.id)),
  )
  ipcMain.handle(IPC.FILE_READ, async (event, filePath: string) => {
    const result = await getWorkspaceHostForWindow(event.sender.id).readText(filePath)
    if (!result.ok) return result
    return ok({ filePath: result.value.filePath, content: result.value.content })
  })
  ipcMain.handle(IPC.FILE_READ_BINARY, (event, filePath: string) =>
    getWorkspaceHostForWindow(event.sender.id).readBinary(filePath),
  )
  ipcMain.handle(IPC.FILE_READ_IMAGE, (event, filePath: string) =>
    getWorkspaceHostForWindow(event.sender.id).readImage(filePath),
  )
  ipcMain.handle(IPC.FILE_SAVE, (event, payload: SaveFilePayload) =>
    getWorkspaceHostForWindow(event.sender.id).saveFile(payload),
  )
  ipcMain.handle(IPC.FILE_SAVE_BINARY_DOCUMENT, (_event, payload: SaveBinaryDocumentPayload) => saveBinaryDocument(payload))
  ipcMain.handle(IPC.FILE_SAVE_AS, (event, payload: SaveFilePayload) =>
    getWorkspaceHostForWindow(event.sender.id).saveFileAs(payload),
  )
  // --- B2/B3 宿主相对读写（workspace:*）：local 经窗口 host，远端经会话表 ---
  ipcMain.handle(IPC.WORKSPACE_READ_TEXT, async (event, payload: WorkspaceHostReadRequest) => {
    const target = resolveHostTextTarget(event, payload ?? {})
    if ('error' in target) return err(target.error)
    if (target.kind === 'remote') return target.host.readText(target.relativePath)
    const result = await getWorkspaceHostForWindow(event.sender.id).readText(target.filePath)
    if (!result.ok) return result
    return ok({
      filePath: result.value.filePath,
      content: result.value.content,
      revision: result.value.revision,
    })
  })
  ipcMain.handle(IPC.WORKSPACE_WRITE_TEXT, async (event, payload: WorkspaceHostWriteRequest) => {
    if (typeof payload?.content !== 'string') {
      return err({ code: 'INVALID_ARGUMENT', message: '缺少正文内容' })
    }
    const target = resolveHostTextTarget(event, payload)
    if ('error' in target) return err(target.error)
    if (target.kind === 'remote') {
      return target.host.writeText(target.relativePath, {
        content: payload.content,
        expectedRevision: payload.expectedRevision,
      })
    }
    const result = await getWorkspaceHostForWindow(event.sender.id).writeText(target.filePath, {
      content: payload.content,
      expectedRevision: payload.expectedRevision,
    })
    if (!result.ok) return result
    return ok({ filePath: result.value.filePath, revision: result.value.revision })
  })
  ipcMain.handle(IPC.WORKSPACE_SAVE_TEXT_AS, async (event, payload: WorkspaceHostSaveAsRequest) => {
    if (typeof payload?.content !== 'string') {
      return err({ code: 'INVALID_ARGUMENT', message: '缺少正文内容' })
    }
    const workspaceId =
      typeof payload?.workspaceId === 'string' ? payload.workspaceId.trim() : ''
    // B2 远端另存为：远端目录选择语义，不弹 Windows 对话框冒充远端保存
    if (workspaceId && typeof payload?.fileName === 'string') {
      const bound = getWindowWorkspaceDescriptor(event.sender.id)
      if (!bound || bound.kind === 'local' || bound.id !== workspaceId) {
        return err({ code: 'INVALID_STATE', message: '工作区归属与窗口绑定不一致（不可跨窗口访问）' })
      }
      const host = getRemoteHost(workspaceId)
      if (!host) {
        return err({
          code: 'REMOTE_NOT_CONNECTED',
          message: `远端工作区未连接 (${workspaceId})：不断线误报成功`,
        })
      }
      autoBindRemoteSender(event.sender, workspaceId)
      const saved = await host.saveTextAs(payload.dirRelativePath, payload.fileName, payload.content)
      if (!saved.ok) return saved
      return ok({ filePath: saved.value.relativePath, revision: saved.value.revision })
    }
    // 本机：沿用对话框流程（与 FILE_SAVE_AS 同语义）
    return getWorkspaceHostForWindow(event.sender.id).saveFileAs({ content: payload.content })
  })
  ipcMain.handle(IPC.WORKSPACE_READ_IMAGE, async (event, payload: WorkspaceHostTextRef) => {
    const target = resolveHostTextTarget(event, payload ?? {})
    if ('error' in target) return err(target.error)
    if (target.kind === 'remote') return target.host.readImage(target.relativePath)
    return getWorkspaceHostForWindow(event.sender.id).readImage(target.filePath)
  })
  ipcMain.handle(IPC.FILE_SAVE_PASTED_IMAGE, (event, payload: SavePastedImagePayload) =>
    getWorkspaceHostForWindow(event.sender.id).savePastedImage(payload),
  )
  ipcMain.handle(IPC.FILE_CREATE, (event, payload: WorkspaceFsCreateFilePayload) =>
    getWorkspaceHostForWindow(event.sender.id).createFile(payload),
  )
  ipcMain.handle(IPC.FILE_CREATE_DIR, (event, payload: WorkspaceFsCreateDirPayload) =>
    getWorkspaceHostForWindow(event.sender.id).createDirectory(payload),
  )
  ipcMain.handle(IPC.FILE_RENAME, (event, payload: WorkspaceFsRenamePayload) =>
    getWorkspaceHostForWindow(event.sender.id).renamePath(payload),
  )
  ipcMain.handle(IPC.FILE_DELETE, (event, payload: WorkspaceFsDeletePayload) =>
    getWorkspaceHostForWindow(event.sender.id).deletePath(payload),
  )
  ipcMain.handle(IPC.FILE_COPY, (event, payload: WorkspaceFsCopyPayload) =>
    getWorkspaceHostForWindow(event.sender.id).copyPath(payload),
  )
  ipcMain.handle(IPC.FILE_MOVE, (event, payload: WorkspaceFsMovePayload) =>
    getWorkspaceHostForWindow(event.sender.id).movePath(payload),
  )
  ipcMain.handle(IPC.FILE_EXPORT_HTML, (event, payload: ExportDocumentPayload) =>
    getWorkspaceHostForWindow(event.sender.id).exportHtml(payload),
  )
  ipcMain.handle(IPC.FILE_EXPORT_PDF, (event, payload: ExportDocumentPayload) =>
    getWorkspaceHostForWindow(event.sender.id).exportPdf(payload),
  )
  ipcMain.handle(IPC.FILE_EXPORT_MARKDOWN, (event, payload: ExportMarkdownPayload) =>
    getWorkspaceHostForWindow(event.sender.id).exportMarkdown(payload),
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
    const urlResult = parseWebDocUrlInput(payload?.url, true)
    if (!urlResult.ok) return urlResult
    return fetchWebDocPage({ url: urlResult.value })
  })

  ipcMain.handle(IPC.WEB_DOC_DISCOVER_TOC, async (_event, payload: WebDocDiscoverTocPayload) => {
    const urlResult = parseWebDocUrlInput(payload?.url, true)
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

  /* ----------------------------------------------------------------
   * Git 版本控制（git:*）
   * ---------------------------------------------------------------- */
  ipcMain.handle(IPC.GIT_STATUS, async (event, cwd: string) => {
    try {
      const res = await getWorkspaceHostForWindow(event.sender.id).gitStatus(cwd)
      return ok(res)
    } catch (e) {
      return err({ code: 'GIT_ERROR', message: e instanceof Error ? e.message : String(e) })
    }
  })
  ipcMain.handle(IPC.GIT_PUSH, async (event, payload: { cwd: string } & GitPushOptions) => {
    try {
      return await getWorkspaceHostForWindow(event.sender.id).gitPush(payload)
    } catch (e) {
      return err({ code: 'GIT_PUSH_FAILED', message: e instanceof Error ? e.message : String(e) })
    }
  })
  ipcMain.handle(IPC.GIT_COMMIT, async (event, payload: { cwd: string } & GitCommitOptions) => {
    try {
      return await getWorkspaceHostForWindow(event.sender.id).gitCommit(payload)
    } catch (e) {
      return err({ code: 'GIT_COMMIT_FAILED', message: e instanceof Error ? e.message : String(e) })
    }
  })
  // B3：diff/branch（远端绑定时经 Ubuntu 执行，无会话则明确失败不回落）
  ipcMain.handle(
    IPC.GIT_DIFF,
    async (event, payload: { cwd: string; file?: string; staged?: boolean }) => {
      try {
        const remote = getRemoteGitHost(event.sender.id)
        if (remote.host) return remote.host.gitDiff(payload?.file, payload?.staged === true)
        if (remote.remoteBound) {
          return err({
            code: 'REMOTE_NOT_CONNECTED',
            message: '远端工作区未连接：Git 在远端执行，不回落本机',
          })
        }
        if (!payload || typeof payload.cwd !== 'string' || !payload.cwd) {
          return err({ code: 'INVALID_ARGUMENT', message: '缺少工作区目录' })
        }
        return getGitDiff(payload.cwd, payload.file, payload.staged === true)
      } catch (e) {
        return err({ code: 'GIT_ERROR', message: e instanceof Error ? e.message : String(e) })
      }
    },
  )
  ipcMain.handle(IPC.GIT_BRANCHES, async (event, cwd: string) => {
    try {
      const remote = getRemoteGitHost(event.sender.id)
      if (remote.host) return remote.host.gitBranch()
      if (remote.remoteBound) {
        return err({
          code: 'REMOTE_NOT_CONNECTED',
          message: '远端工作区未连接：Git 在远端执行，不回落本机',
        })
      }
      if (typeof cwd !== 'string' || !cwd) {
        return err({ code: 'INVALID_ARGUMENT', message: '缺少工作区目录' })
      }
      return listGitBranches(cwd)
    } catch (e) {
      return err({ code: 'GIT_ERROR', message: e instanceof Error ? e.message : String(e) })
    }
  })

  /* ----------------------------------------------------------------
   * 远程与 WSL 环境（remote:*）
   * ---------------------------------------------------------------- */
  ipcMain.handle(IPC.REMOTE_LIST_WSL_DISTROS, async () => listWslDistros())
  ipcMain.handle(IPC.REMOTE_GET_WSL_HOME, async (_event, distro: string) => getWslHome(distro))
  ipcMain.handle(
    IPC.REMOTE_BROWSE_WSL,
    async (event, payload: { distro: string; dirPath?: string }) => {
      // P2：浏览走调用窗口自己的连接；未建连明确报错，不碰全局单例
      const distro = typeof payload?.distro === 'string' ? payload.distro.trim() : ''
      if (!distro) {
        return err({ code: 'INVALID_ARGUMENT', message: '缺少 WSL 发行版' })
      }
      const host = peekWslHostForWindow(event.sender.id)
      if (!host || !host.isConnectedTo(distro)) {
        return err({
          code: 'REMOTE_NOT_CONNECTED',
          message: `WSL 远端未连接 (${distro})：请先连接后再浏览（不回落本机文件系统）`,
        })
      }
      return host.browseDirectory(payload?.dirPath)
    },
  )
  ipcMain.handle(IPC.REMOTE_WSL_CONNECT, async (event, payload: RemoteWslConnectPayload) => {
    if (!payload || typeof payload.distro !== 'string' || !payload.distro.trim()) {
      return err({ code: 'INVALID_ARGUMENT', message: '缺少 WSL 发行版' })
    }
    // P2：连接归属调用窗口；同窗口重连由宿主代际守卫取代旧连接
    const host = getWslHostForWindow(event.sender.id)
    ensureWslRegistryCleanup(event.sender)
    return host.connect(payload.distro.trim(), payload.linuxRoot)
  })
  ipcMain.handle(IPC.REMOTE_WSL_DISCONNECT, async (event) => {
    // P2：只释放本窗口（会话 refcount 决定传输是否关闭，不杀他人连接）
    releaseWindowRemoteBinding(event.sender.id)
    dropRemoteWatchForward(event.sender.id)
    stopWorkspaceWatch(event.sender.id)
    disposeWslHostForWindow(event.sender.id)
    pushWorkspaceStatus(event.sender, unbindWindowWorkspace(event.sender.id))
    return ok(undefined)
  })
  ipcMain.handle(IPC.REMOTE_WSL_STATUS, async (event) => ok(peekWslHostForWindow(event.sender.id)?.status() ?? null))
  ipcMain.handle(IPC.REMOTE_WSL_STAT, async (event, payload: RemoteWslStatPayload) => {
    if (!payload || typeof payload.filePath !== 'string' || !payload.filePath.trim()) {
      return err({ code: 'INVALID_ARGUMENT', message: '缺少远端路径' })
    }
    // P2：stat 走调用窗口自己的连接；须先建连
    const host = peekWslHostForWindow(event.sender.id)
    if (!host) {
      return err({ code: 'REMOTE_NOT_CONNECTED', message: 'WSL 远端未连接：请先连接后再查询' })
    }
    return host.statPath(payload.filePath)
  })
  ipcMain.handle(
    IPC.REMOTE_WSL_OPEN_WORKSPACE,
    async (event, payload: RemoteOpenWslWorkspacePayload) => {
      // P1：连接选中根→注册远端宿主→绑定调用窗口→返回初始树
      const distro = typeof payload?.distro === 'string' ? payload.distro.trim() : ''
      const linuxPath = typeof payload?.linuxPath === 'string' ? payload.linuxPath.trim() : ''
      if (!distro) {
        return err({ code: 'INVALID_ARGUMENT', message: '缺少 WSL 发行版' })
      }
      if (!linuxPath || !linuxPath.replace(/\\/g, '/').startsWith('/')) {
        return err({ code: 'INVALID_ARGUMENT', message: '远端路径须为 Ubuntu 内绝对路径' })
      }
      return openWslWorkspaceForWindow(event.sender, distro, linuxPath)
    },
  )
  ipcMain.handle(IPC.REMOTE_LIST_SSH_CONFIG_HOSTS, async () => listSshConfigHosts())

  /* ----------------------------------------------------------------
   * 远端工作区服务本地管道（remote-server:*，A2）
   * 连接归属 event.sender 窗口；sender 销毁时回收其全部连接。
   * ---------------------------------------------------------------- */
  ipcMain.handle(IPC.REMOTE_SERVER_CONNECT, (event, payload: RemoteServerConnectPayload) => {
    const sender = event.sender
    sender.once('destroyed', () => remoteServerHosts.releaseSender(sender.id))
    return remoteServerHosts.connect(sender.id, payload)
  })
  ipcMain.handle(IPC.REMOTE_SERVER_INVOKE, (event, payload: RemoteServerInvokePayload) =>
    remoteServerHosts.invoke(event.sender.id, payload),
  )
  ipcMain.handle(IPC.REMOTE_SERVER_DISCONNECT, (event, connectionId: string) =>
    remoteServerHosts.disconnect(event.sender.id, connectionId),
  )
  ipcMain.handle(IPC.REMOTE_SERVER_STATUS, (event, connectionId: string) =>
    remoteServerHosts.status(event.sender.id, connectionId),
  )
}
