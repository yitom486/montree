import type {
  ExportDocumentPayload,
  ExportDocumentResult,
  ExportMarkdownPayload,
  OpenDialogOptions,
  OpenDocumentResult,
  OpenFileResult,
  OpenFolderResult,
  ReadBinaryResult,
  ReadImageResult,
  SaveFilePayload,
  SaveFileResult,
  SavePastedImagePayload,
  SavePastedImageResult,
  WorkspaceFsCopyPayload,
  WorkspaceFsCreateDirPayload,
  WorkspaceFsCreateFilePayload,
  WorkspaceFsDeletePayload,
  WorkspaceFsMovePayload,
  WorkspaceFsPathResult,
  WorkspaceFsRenamePayload,
  WorkspaceSearchMarkdownPayload,
  WorkspaceSearchMarkdownResult,
} from '../types/file'
import type { AppError } from '../core/errors'
import type { RendererErrorPayload } from '../types/error-log'
import type { Result } from '../core/result'
import type {
  CreateReadingMarkPayload,
  MarksListByChapterPayload,
  MarksSearchPayload,
  ReadingMark,
  UpdateReadingMarkPayload,
} from '../types/reading-mark'
import type { QuizSessionRecord } from '../types/quiz'
import type {
  AppendFlashcardReviewPayload,
  DueFlashcard,
  ListDueFlashcardsPayload,
} from '../types/flashcard'
import type {
  AiSessionGetPayload,
  AiSessionPutPayload,
  AiSessionRecord,
  AiSessionTouchPayload,
} from '../types/ai-session'
import type {
  AcpAuthPreflightPayload,
  AcpAuthPreflightResult,
  AcpAuthenticatePayload,
  AcpCancelPayload,
  AcpConnectPayload,
  AcpConnectResult,
  AcpLoadSessionPayload,
  AcpPermissionRequestEvent,
  AcpPermissionResponsePayload,
  AcpSnapshotRequestEvent,
  AcpSnapshotResponsePayload,
  AcpPromptPayload,
  AcpPromptResult,
  AcpRuntimeInfo,
  AcpSessionNewPayload,
  AcpSessionNewResult,
  AcpSessionUpdateEvent,
  AcpSetConfigOptionPayload,
  AcpSetConfigOptionResult,
  AcpProviderSavePayload,
  AcpProviderStatus,
  AcpStatusChangedEvent,
  AcpProxySettings,
  AgyCliStatus,
} from '../types/acp'
import type {
  WebDocDiscoverTocPayload,
  WebDocDiscoverTocResult,
  WebDocFetchPayload,
  WebDocFetchResult,
} from '../types/web-doc'
import type {
  DetectPdfTocPagesPayload,
  DetectPdfTocPagesResult,
  GetPdfOcrPagePayload,
  GetPdfOcrTocPayload,
  ListPdfOcrPagesPayload,
  PdfOcrPageCache,
  PdfOcrTocCache,
  OcrComponentStatus,
  RecognizePdfPagePayload,
  RecognizePdfTocPayload,
  SavePdfOcrTocPayload,
} from '../types/ocr'
import type {
  ClassifyPdfDocumentPayload,
  ExtractPdfBookMarkdownPayload,
  InspectorBookMarkdown,
  InspectorPdfClassification,
} from '../types/pdf-inspect'
import type { AppUpdateStatus } from '../types/app-update'
import type { BunRuntimeStatus } from '../types/bun'
import type {
  SyncConfig,
  SyncStatus,
  TestConnectionResult,
  SyncExecuteResult,
} from '../types/sync'
import type {
  TtsConfig,
  TtsSynthesizePayload,
  TtsSynthesizeResult,
  TtsCacheStats,
  TtsTestKeyPayload,
  TtsTestKeyResult,
  TtsRemoteModelItem,
  TtsVoiceInfo,
  TtsBatchCreatePayload,
  TtsBatchJobStatus,
  TtsStreamChunkPayload,
  TtsStreamProgressPayload,
  TtsStreamEndPayload,
  TtsStreamErrorPayload,
} from '../types/tts'
import type {
  RosettaActiveImport,
  RosettaBodyWatermarkApplyPayload,
  RosettaBodyWatermarkApplyResult,
  RosettaBodyWatermarkPreviewPayload,
  RosettaBodyWatermarkPreviewResult,
  RosettaBookInfo,
  RosettaImportPayload,
  RosettaImportStats,
  RosettaImportStatus,
  RosettaInspectContentPayload,
  RosettaInspectContentResult,
  RosettaQuery,
  RosettaQueryResult,
  RosettaTocRebuildPayload,
  RosettaTocRebuildResult,
} from '../types/rosetta'

/**
 * preload `contextBridge` 暴露给渲染进程的 API（`window.electronAPI`）。
 * 有返回值的调用均为 `Result`；用户取消为 `CANCELLED`。`on*` 的返回值是取消订阅函数。
 *
 * 分区顺序（与 channels.ts 的 IPC 分区保持一致）：
 * 应用与窗口 → 文件与工作区 → 罗盘 → Bun/日志 → 阅读书签 → ACP → 在线文档 → OCR → 应用更新 → 测验 → 云同步
 * （interface 内成员顺序无语义，仅作阅读分区；通道字符串见 ../ipc/channels.ts）
 */
export interface ElectronAPI {
  /* ===== 应用与窗口：静态注入 + 窗口生命周期 ===== */
  /** 当前操作系统：`win32` / `darwin` / `linux` */
  platform: string
  /** 通过「新建窗口」打开时为 true，不恢复工作区/上次文件 */
  isFreshWindow: boolean
  /** E2E 门控：foliate 统一阅读器（仅测试进程注入） */
  e2eFoliateReader: boolean
  /** E2E 门控：PDF 结构化解析 WASM 钩子（仅测试进程注入） */
  e2ePdfStructure: boolean
  /** 读取应用版本号 */
  getVersion: () => Promise<Result<string, AppError>>
  /** 同步文档是否未保存（关窗确认用） */
  setDirty: (isDirty: boolean) => void
  /** 回复主进程的关窗请求：继续关闭或取消 */
  confirmClose: (decision: 'proceed' | 'cancel') => void
  /* ===== 应用与窗口：关闭流程 / 快捷动作 ===== */
  /** 最小化窗口 */
  minimizeWindow: () => void
  /** 切换最大化 / 还原窗口 */
  toggleMaximizeWindow: () => void
  /** 关闭窗口（走保存确认） */
  closeWindow: () => void
  /** 获取当前窗口是否最大化 */
  isWindowMaximized: () => Promise<boolean>
  /** 监听窗口最大化状态变更；返回取消订阅 */
  onWindowMaximizeChanged: (callback: (isMaximized: boolean) => void) => () => void
  /** 监听主进程「请关闭窗口」；返回取消订阅 */
  onRequestClose: (callback: () => void) => () => void
  /** 监听主进程全局快捷键动作（quick-open / find / replace 等）；返回取消订阅 */
  onGlobalAction?: (callback: (action: string) => void) => () => void
  /* ===== 文件与工作区：对话框 / 读 / 写 / 导出 / 文件树操作 ===== */
  /** 打开文件对话框（文档） */
  openFile: (options?: OpenDialogOptions) => Promise<Result<OpenDocumentResult, AppError>>
  /** 打开文件夹对话框（工作区根） */
  openFolder: (options?: OpenDialogOptions) => Promise<Result<OpenFolderResult, AppError>>
  /** 扫描已有工作区路径，返回文件树 */
  scanWorkspace: (rootPath: string) => Promise<Result<OpenFolderResult, AppError>>
  /** 工作区 Markdown 字面检索（只读，仅渲染端 inspect 链调用） */
  searchWorkspaceMarkdown: (
    payload: WorkspaceSearchMarkdownPayload,
  ) => Promise<Result<WorkspaceSearchMarkdownResult, AppError>>
  /** 开始监听工作区磁盘变化 */
  watchWorkspace: (rootPath: string) => void
  /** 停止监听工作区 */
  unwatchWorkspace: () => void
  /** 工作区文件变化时回调；返回取消订阅 */
  onWorkspaceChanged: (callback: (payload: { rootPath: string }) => void) => () => void
  /** 按路径读文本文件 */
  readFile: (filePath: string) => Promise<Result<OpenFileResult, AppError>>
  /** 按路径读二进制文件 */
  readBinaryFile: (filePath: string) => Promise<Result<ReadBinaryResult, AppError>>
  /** 读图片并转 data URL */
  readImage: (filePath: string) => Promise<Result<ReadImageResult, AppError>>
  /** 保存到当前路径 */
  saveFile: (payload: SaveFilePayload) => Promise<Result<SaveFileResult, AppError>>
  /** 另存为 */
  saveFileAs: (payload: SaveFilePayload) => Promise<Result<SaveFileResult, AppError>>
  /** 把粘贴的图片写入工作区并返回路径 */
  savePastedImage: (
    payload: SavePastedImagePayload,
  ) => Promise<Result<SavePastedImageResult, AppError>>
  /** 在工作区新建文件 */
  createWorkspaceFile: (
    payload: WorkspaceFsCreateFilePayload,
  ) => Promise<Result<WorkspaceFsPathResult, AppError>>
  /** 在工作区新建目录 */
  createWorkspaceDirectory: (
    payload: WorkspaceFsCreateDirPayload,
  ) => Promise<Result<WorkspaceFsPathResult, AppError>>
  /** 重命名工作区路径 */
  renameWorkspacePath: (
    payload: WorkspaceFsRenamePayload,
  ) => Promise<Result<WorkspaceFsPathResult, AppError>>
  /** 删除工作区路径 */
  deleteWorkspacePath: (payload: WorkspaceFsDeletePayload) => Promise<Result<void, AppError>>
  /** 复制工作区路径 */
  copyWorkspacePath: (
    payload: WorkspaceFsCopyPayload,
  ) => Promise<Result<WorkspaceFsPathResult, AppError>>
  /** 移动工作区路径 */
  moveWorkspacePath: (
    payload: WorkspaceFsMovePayload,
  ) => Promise<Result<WorkspaceFsPathResult, AppError>>
  /** 导出 HTML */
  exportHtml: (payload: ExportDocumentPayload) => Promise<Result<ExportDocumentResult, AppError>>
  /** 导出 PDF */
  exportPdf: (payload: ExportDocumentPayload) => Promise<Result<ExportDocumentResult, AppError>>
  /** 导出 Markdown */
  exportMarkdown: (payload: ExportMarkdownPayload) => Promise<Result<ExportDocumentResult, AppError>>
  /** 根据路径/脏标记更新窗口标题 */
  updateTitle: (payload: { filePath?: string; isDirty: boolean }) => void
  /** 退出应用 */
  quit: () => void
  /** 再开一个主窗口（不恢复工作区） */
  newWindow: () => void
  /** 取走一个待处理的外部打开文件（资源管理器双击/打开方式），无则返回 null */
  takePendingExternalFile: () => Promise<string | null>
  /** 用系统默认浏览器打开外链 */
  openExternal: (url: string) => Promise<Result<void, AppError>>
  /* ===== 罗盘：扫描书索引库（导入/查询/水印清洗） ===== */
  /** 扫描书一键导入罗盘索引（长任务，进度另走推送） */
  importBookToRosetta: (payload: RosettaImportPayload) => Promise<Result<RosettaImportStats, AppError>>
  /** 取消正在进行的罗盘导入 */
  cancelRosettaImport: () => void
  /** 罗盘导入进度推送；返回取消订阅 */
  onRosettaImportStatus: (callback: (status: RosettaImportStatus) => void) => () => void
  /** 查询某书罗盘索引信息，未导入返回 null */
  getRosettaBookInfo: (fingerprint: string) => Promise<Result<RosettaBookInfo | null, AppError>>
  /** 查询当前导入快照（窗口重载后恢复进度显示），无则返回 null */
  getActiveRosettaImport: () => Promise<Result<RosettaActiveImport | null, AppError>>
  /** 罗盘统一读查询（页/章/目录/搜索/上下文/目录项） */
  queryRosettaBook: (query: RosettaQuery) => Promise<Result<RosettaQueryResult, AppError>>
  /** 纯本地重建罗盘目录索引（只写库，不调 OCR） */
  rebuildRosettaToc: (
    payload: RosettaTocRebuildPayload,
  ) => Promise<Result<RosettaTocRebuildResult, AppError>>
  /** 只读预览正文水印清洗（不写库，最多 20 条样例） */
  previewBodyWatermark: (
    payload: RosettaBodyWatermarkPreviewPayload,
  ) => Promise<Result<RosettaBodyWatermarkPreviewResult, AppError>>
  /** 备份并应用正文水印清洗（须用户二次确认后调用；空计划返回 noop） */
  applyBodyWatermark: (
    payload: RosettaBodyWatermarkApplyPayload,
  ) => Promise<Result<RosettaBodyWatermarkApplyResult, AppError>>
  /** 已入库内容只读取证（指纹由渲染端绑定当前文档，调用方不得自带） */
  inspectRosettaContent: (
    payload: RosettaInspectContentPayload,
  ) => Promise<Result<RosettaInspectContentResult, AppError>>
  /* ===== Bun / 开发者工具 / 日志 ===== */
  /** 探测本机 Bun 运行时是否可用 */
  getBunRuntimeStatus: () => Promise<Result<BunRuntimeStatus, AppError>>
  /** 安装 / 确保 Bun 运行时 */
  installBunRuntime: () => Promise<Result<void, AppError>>
  /** 切换开发者工具 */
  toggleDevTools: () => void
  /** 把渲染进程错误写入日志；成功时返回日志路径 */
  logRendererError: (payload: RendererErrorPayload) => Promise<Result<string, AppError>>
  /** 返回错误日志文件路径 */
  getErrorLogPath: () => Promise<Result<string, AppError>>
  /** 开关主进程详细日志 */
  setVerboseLogs: (enabled: boolean) => void
  /* ===== 阅读书签/批注 ===== */
  /** 列出某文件的阅读书签/批注 */
  listReadingMarks: (filePath: string) => Promise<Result<ReadingMark[], AppError>>
  /** 新建阅读书签/批注 */
  createReadingMark: (payload: CreateReadingMarkPayload) => Promise<Result<ReadingMark, AppError>>
  /** 更新阅读书签/批注 */
  updateReadingMark: (payload: UpdateReadingMarkPayload) => Promise<Result<ReadingMark, AppError>>
  /** 删除阅读书签/批注 */
  deleteReadingMark: (id: string) => Promise<Result<void, AppError>>
  /** 本书内卡片全文搜（标题/摘录/批注/AI 洞见，走 marks_fts） */
  searchReadingMarks: (payload: MarksSearchPayload) => Promise<Result<ReadingMark[], AppError>>
  /** 按章查卡（走 chapter_key 索引，另捎带未固化卡由调用方窄化） */
  listReadingMarksByChapter: (
    payload: MarksListByChapterPayload,
  ) => Promise<Result<ReadingMark[], AppError>>
  /* ===== 记忆卡片复习态 ===== */
  /** 本书待复习列表（未复习优先、其次最久未复习） */
  listDueFlashcards: (
    payload: ListDueFlashcardsPayload,
  ) => Promise<Result<DueFlashcard[], AppError>>
  /**
   * 记一次复习评分；true=已落盘，false=未落盘（未知卡片/file 回滚后端；
   * 调用方本地评分态照常推进，不打断复习流）。
   */
  appendFlashcardReview: (
    payload: AppendFlashcardReviewPayload,
  ) => Promise<Result<boolean, AppError>>
  /* ===== AI 会话指针（一书一会话） ===== */
  /** 取某书会话行（无则 null） */
  getAiSession: (payload: AiSessionGetPayload) => Promise<Result<AiSessionRecord | null, AppError>>
  /** upsert 会话行 */
  putAiSession: (payload: AiSessionPutPayload) => Promise<Result<void, AppError>>
  /** prompt 成功后计数 + 保活 */
  touchAiSession: (payload: AiSessionTouchPayload) => Promise<Result<void, AppError>>
  /* ===== ACP Agent：运行时/认证/session/prompt/权限/快照/推送 ===== */
  /** 列出可用 ACP Agent 运行时 */
  listAcpRuntimes: () => Promise<Result<AcpRuntimeInfo[], AppError>>
  /** 连接前探测 Codex/ACP 认证是否已就绪；非 codex-acp 运行时返回中性结果 */
  acpAuthPreflight: (
    payload?: AcpAuthPreflightPayload,
  ) => Promise<Result<AcpAuthPreflightResult, AppError>>
  /** 拉起 ACP 传输并连接 */
  acpConnect: (payload: AcpConnectPayload) => Promise<Result<AcpConnectResult, AppError>>
  /** 走 ACP authMethods 完成认证 */
  acpAuthenticate: (
    payload: AcpAuthenticatePayload,
  ) => Promise<Result<Extract<AcpConnectResult, { phase: 'ready' }>, AppError>>
  /** 加载已有 ACP session（恢复历史） */
  acpLoadSession: (
    payload: AcpLoadSessionPayload,
  ) => Promise<Result<AcpSessionNewResult, AppError>>
  /** 断开 ACP 并清理子进程 */
  acpDisconnect: () => Promise<Result<void, AppError>>
  /** 新建 ACP session */
  acpSessionNew: (payload: AcpSessionNewPayload) => Promise<Result<AcpSessionNewResult, AppError>>
  /** 向当前 session 发送 prompt */
  acpPrompt: (payload: AcpPromptPayload) => Promise<Result<AcpPromptResult, AppError>>
  /** 取消正在进行的 prompt */
  acpCancel: (payload: AcpCancelPayload) => Promise<Result<void, AppError>>
  /** 设置 ACP 会话配置项（模型等） */
  acpSetConfigOption: (
    payload: AcpSetConfigOptionPayload,
  ) => Promise<Result<AcpSetConfigOptionResult, AppError>>
  /** 读取自定义模型供应商配置（API Key 永不回传，只给 hasApiKey） */
  getAcpProvider: () => Promise<Result<AcpProviderStatus, AppError>>
  /** 保存自定义模型供应商配置（base URL + API Key + 模型），下次连接生效 */
  saveAcpProvider: (payload: AcpProviderSavePayload) => Promise<Result<AcpProviderStatus, AppError>>
  /** 清除自定义供应商配置，回到本机 ~/.codex 订阅登录 */
  clearAcpProvider: () => Promise<Result<void, AppError>>
  /** 读取 ACP 子进程代理设置 */
  getAcpProxySettings: () => Promise<Result<AcpProxySettings, AppError>>
  /** 保存 ACP 子进程代理设置（重新连接后生效） */
  saveAcpProxySettings: (payload: AcpProxySettings) => Promise<Result<AcpProxySettings, AppError>>
  /** 回复 Agent 的权限询问 */
  acpRespondPermission: (payload: AcpPermissionResponsePayload) => void
  /** 回传编辑器/阅读器快照给 Agent */
  acpRespondSnapshot: (payload: AcpSnapshotResponsePayload) => void
  /** ACP session/update 流式事件；返回取消订阅 */
  onAcpSessionUpdate: (callback: (event: AcpSessionUpdateEvent) => void) => () => void
  /** ACP 连接/会话状态变化；返回取消订阅 */
  onAcpStatusChanged: (callback: (event: AcpStatusChangedEvent) => void) => () => void
  /** Agent 请求工具权限；返回取消订阅 */
  onAcpPermissionRequest: (
    callback: (event: AcpPermissionRequestEvent & { summary?: string }) => void,
  ) => () => void
  /** Agent 请求当前文档快照；返回取消订阅 */
  onAcpSnapshotRequest: (callback: (event: AcpSnapshotRequestEvent) => void) => () => void
  /** 探测本机 Antigravity CLI (agy) 状态与路径 */
  probeAgyCli: () => Promise<Result<AgyCliStatus, AppError>>
  /** 一键安装 Antigravity CLI (agy) 并配置环境变量 */
  installAgyCli: () => Promise<Result<AgyCliStatus, AppError>>
  /* ===== 在线文档 ===== */
  /** 抓取在线文档一页 HTML */
  fetchWebDocPage: (payload: WebDocFetchPayload) => Promise<Result<WebDocFetchResult, AppError>>
  /** 发现在线文档目录（TOC） */
  discoverWebDocToc: (
    payload: WebDocDiscoverTocPayload,
  ) => Promise<Result<WebDocDiscoverTocResult, AppError>>
  /* ===== PDF OCR：目录/页缓存 + OCR 组件管理 ===== */
  /** 读取 PDF OCR 目录缓存 */
  getPdfOcrToc: (
    payload: GetPdfOcrTocPayload,
  ) => Promise<Result<PdfOcrTocCache, AppError>>
  /** 对 PDF 目录页做 OCR 并缓存 */
  recognizePdfOcrToc: (
    payload: RecognizePdfTocPayload,
  ) => Promise<Result<PdfOcrTocCache, AppError>>
  /** 探测 PDF 目录页范围（只建议范围，不识别不缓存） */
  detectPdfTocPages: (
    payload: DetectPdfTocPagesPayload,
  ) => Promise<Result<DetectPdfTocPagesResult, AppError>>
  /** 删除某 PDF 的目录 OCR 缓存 */
  deletePdfOcrToc: (payload: GetPdfOcrTocPayload) => Promise<Result<void, AppError>>
  /** 读取某页 PDF OCR 缓存 */
  getPdfOcrPage: (
    payload: GetPdfOcrPagePayload,
  ) => Promise<Result<PdfOcrPageCache, AppError>>
  /** 对指定 PDF 页 OCR 并缓存 */
  recognizePdfOcrPage: (
    payload: RecognizePdfPagePayload,
  ) => Promise<Result<PdfOcrPageCache, AppError>>
  /** 列出已缓存 OCR 的 PDF 页码 */
  listPdfOcrPages: (payload: ListPdfOcrPagesPayload) => Promise<Result<number[], AppError>>
  /** 清除单个 PDF 的 OCR 缓存 */
  clearPdfOcrCache: (payload: GetPdfOcrTocPayload) => Promise<Result<void, AppError>>
  /** 清除全部 PDF OCR 缓存 */
  clearAllPdfOcrCache: () => Promise<Result<void, AppError>>
  /** 手动保存 PDF 目录 OCR 结果 */
  savePdfOcrToc: (payload: SavePdfOcrTocPayload) => Promise<Result<void, AppError>>
  /** OCR 组件（语言包/引擎）是否就绪 */
  getOcrComponentStatus: () => Promise<Result<OcrComponentStatus, AppError>>
  /** 下载并确保 OCR 组件可用 */
  ensureOcrComponent: () => Promise<Result<void, AppError>>
  /** 取消 OCR 组件下载 */
  cancelOcrComponentDownload: () => Promise<Result<OcrComponentStatus, AppError>>
  /* ===== PDF 解析（pdf-inspector） ===== */
  /** pdf-inspector 分类（类型/页数/待 OCR 页） */
  classifyPdfDocument: (
    payload: ClassifyPdfDocumentPayload,
  ) => Promise<Result<InspectorPdfClassification, AppError>>
  /** pdf-inspector 整档 Markdown（原生文字层） */
  extractPdfBookMarkdown: (
    payload: ExtractPdfBookMarkdownPayload,
  ) => Promise<Result<InspectorBookMarkdown, AppError>>
  /** OCR 组件下载/就绪状态；返回取消订阅 */
  onOcrComponentStatus: (callback: (status: OcrComponentStatus) => void) => () => void
  /* ===== 应用更新 ===== */
  /** 检查应用更新 */
  checkAppUpdate: () => Promise<AppUpdateStatus>
  /** 下载已发现的更新 */
  downloadAppUpdate: () => Promise<AppUpdateStatus>
  /** 安装更新并重启 */
  installAppUpdate: () => Promise<Result<void, AppError>>
  /** 读取当前更新状态快照 */
  getAppUpdateStatus: () => Promise<Result<AppUpdateStatus, AppError>>
  /** 更新状态推送；返回取消订阅 */
  onAppUpdateStatus: (callback: (status: AppUpdateStatus) => void) => () => void
  /* ===== AI 测验 ===== */
  /** 追加保存 AI 测验记录到 JSONL */
  appendQuizSession: (session: QuizSessionRecord) => Promise<Result<void, AppError>>
  /** 读取全部测验历史记录 */
  getAllQuizSessions: () => Promise<Result<QuizSessionRecord[], AppError>>
  /** 按书籍路径读取测验历史 */
  getQuizSessionsByFile: (filePath: string) => Promise<Result<QuizSessionRecord[], AppError>>
  /* ===== 云同步：WebDAV 配置/状态/阅读进度 ===== */
  /** 获取云同步配置 */
  getSyncConfig: () => Promise<Result<SyncConfig, AppError>>
  /** 保存云同步配置 */
  saveSyncConfig: (config: SyncConfig) => Promise<Result<void, AppError>>
  /** 测试云端连接与目录权限 */
  testSyncConnection: (config?: SyncConfig) => Promise<Result<TestConnectionResult, AppError>>
  /** 立即执行一次双向同步 */
  runSyncNow: () => Promise<Result<SyncExecuteResult, AppError>>
  /** 获取当前同步状态 */
  getSyncStatus: () => Promise<Result<SyncStatus, AppError>>
  /** 监听同步状态变化推送；返回取消订阅函数 */
  onSyncStatusChanged: (callback: (status: SyncStatus) => void) => () => void
  /** 监听主进程下发的远端阅读进度合并数据；返回取消订阅函数 */
  onApplyRemoteProgress: (callback: (progressJson: string) => void) => () => void
  /** 保存渲染端阅读进度快照到本地主进程文件 */
  saveLocalProgress: (progressJson: string) => Promise<Result<void, AppError>>
  /* ===== 语音朗读（TTS / Gemini TTS） ===== */
  /** 获取 TTS 配置 */
  getTtsConfig: () => Promise<Result<TtsConfig, AppError>>
  /** 保存 TTS 配置 */
  saveTtsConfig: (config: TtsConfig) => Promise<Result<void, AppError>>
  /** 语音合成（带本地磁盘缓存与双 Key 容灾） */
  synthesizeTts: (
    payload: TtsSynthesizePayload,
  ) => Promise<Result<TtsSynthesizeResult, AppError>>
  /** 启动分段语音合成，验证完成的音频段边播边拼装 */
  synthesizeTtsStream: (
    payload: TtsSynthesizePayload & { streamId: string },
  ) => Promise<Result<{ started: boolean; fromCache?: boolean; cachedResult?: TtsSynthesizeResult }, AppError>>
  /** 取消当前流式语音合成 */
  cancelTtsStream: (streamId: string) => Promise<Result<void, AppError>>
  /** 订阅 TTS 流式音频分片 */
  onTtsStreamChunk: (callback: (payload: TtsStreamChunkPayload) => void) => () => void
  onTtsStreamProgress: (callback: (payload: TtsStreamProgressPayload) => void) => () => void
  /** 订阅 TTS 流式合成完成 */
  onTtsStreamEnd: (callback: (payload: TtsStreamEndPayload) => void) => () => void
  /** 订阅 TTS 流式合成出错 */
  onTtsStreamError: (callback: (payload: TtsStreamErrorPayload) => void) => () => void
  /** 测试指定 API Key 有效性 */
  testTtsKey: (payload: TtsTestKeyPayload) => Promise<Result<TtsTestKeyResult, AppError>>
  /** 获取本地音频缓存统计 */
  getTtsCacheStats: () => Promise<Result<TtsCacheStats, AppError>>
  /** 清空本地音频缓存 */
  clearTtsCache: () => Promise<Result<void, AppError>>
  /** 拉取云端实际可用的语音模型列表 */
  listTtsModels: (apiKey?: string) => Promise<Result<TtsRemoteModelItem[], AppError>>
  /** 拉取云端/厂商可用的音色列表 */
  listTtsVoices: (
    provider?: string,
    apiKey?: string,
    region?: string,
  ) => Promise<Result<TtsVoiceInfo[], AppError>>
  /** 创建异步批量语音合成任务 (Batch API，半价折扣) */
  createTtsBatchJob: (payload: TtsBatchCreatePayload) => Promise<Result<TtsBatchJobStatus, AppError>>
  /** 查询异步批量任务状态与结果 */
  getTtsBatchJob: (name: string, apiKey?: string) => Promise<Result<TtsBatchJobStatus, AppError>>
  /** 取消异步批量任务 */
  cancelTtsBatchJob: (
    name: string,
    apiKey?: string,
  ) => Promise<Result<{ name: string; cancelled: boolean }, AppError>>
}
