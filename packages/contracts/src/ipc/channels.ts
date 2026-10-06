/**
 * 主进程 ↔ 渲染进程 IPC 通道名（字符串才是线上协议）。
 * 属性上的 JSDoc 会在 IDE 悬停 `IPC.XXX` 时显示。
 *
 * 分区顺序（与 electron-api.types.ts 的 ElectronAPI 分区保持一致）：
 * 应用与窗口 → 应用更新 → Bun → 文件与工作区 → 阅读书签 → ACP → 在线文档 → OCR → PDF 解析 → 罗盘 → 测验 → 云同步
 */
export const IPC = {
  /* ================================================================
   * 应用与窗口（app:*）
   * ================================================================ */
  /** invoke：读取应用版本号 */
  APP_GET_VERSION: 'app:get-version',
  /** send：请求退出应用 */
  APP_QUIT: 'app:quit',
  /** send：同步当前文档是否未保存（关窗确认用） */
  APP_SET_DIRTY: 'app:set-dirty',
  /** main→renderer：主进程请求关闭窗口，渲染进程可拦截未保存 */
  APP_REQUEST_CLOSE: 'app:request-close',
  /** send：渲染进程回复是否允许关闭（proceed / cancel） */
  APP_CLOSE_DECISION: 'app:close-decision',
  /** send：切换开发者工具 */
  APP_TOGGLE_DEVTOOLS: 'app:toggle-devtools',
  /** invoke：把渲染进程错误写入日志文件 */
  APP_LOG_RENDERER_ERROR: 'app:log-renderer-error',
  /** invoke：返回错误日志文件路径 */
  APP_GET_ERROR_LOG_PATH: 'app:get-error-log-path',
  /** send：开关主进程详细日志 */
  APP_SET_VERBOSE_LOGS: 'app:set-verbose-logs',
  /** send：再开一个主窗口（不恢复工作区） */
  APP_NEW_WINDOW: 'app:new-window',
  /** invoke：取走一个待处理的外部打开文件（资源管理器双击/打开方式），无则返回 null */
  APP_TAKE_PENDING_EXTERNAL_FILE: 'app:take-pending-external-file',
  /** main→renderer：触发全局快捷动作（quick-open / find / replace 等） */
  APP_GLOBAL_ACTION: 'app:global-action',
  /** sendSync（preload）：取窗口启动参数，如 isFreshWindow */
  APP_GET_WINDOW_INIT: 'app:get-window-init',
  /** invoke：用系统默认浏览器打开外链 */
  APP_OPEN_EXTERNAL: 'app:open-external',

  /* ================================================================
   * 应用更新（app:update-*）
   * ================================================================ */
  /** invoke：检查应用更新 */
  APP_UPDATE_CHECK: 'app:update-check',
  /** invoke：下载已发现的更新 */
  APP_UPDATE_DOWNLOAD: 'app:update-download',
  /** invoke：安装更新并重启 */
  APP_UPDATE_INSTALL: 'app:update-install',
  /** invoke：读取当前更新状态快照 */
  APP_UPDATE_GET_STATUS: 'app:update-get-status',
  /** main→renderer：更新状态推送（检查/下载进度等） */
  APP_UPDATE_STATUS: 'app:update-status',

  /* ================================================================
   * Bun 运行时（bun:*）
   * ================================================================ */
  /** invoke：探测本机 Bun 运行时是否可用 */
  BUN_GET_STATUS: 'bun:get-status',
  /** invoke：安装 / 确保 Bun 运行时 */
  BUN_INSTALL: 'bun:install',

  /* ================================================================
   * 文件与工作区（file:* / workspace:*）
   * ================================================================ */
  /** invoke：打开文件对话框（文档） */
  FILE_OPEN: 'file:open',
  /** invoke：打开文件夹对话框（工作区根） */
  FILE_OPEN_FOLDER: 'file:open-folder',
  /** invoke：扫描已有工作区路径，返回文件树 */
  FILE_SCAN_WORKSPACE: 'file:scan-workspace',
  /** invoke：按路径读文本文件 */
  FILE_READ: 'file:read',
  /** invoke：按路径读二进制文件 */
  FILE_READ_BINARY: 'file:read-binary',
  /** invoke：保存到当前路径（可弹对话框） */
  FILE_SAVE: 'file:save',
  /** invoke：另存为 */
  FILE_SAVE_AS: 'file:save-as',
  /** invoke：读图片并转 data URL（预览/粘贴用） */
  FILE_READ_IMAGE: 'file:read-image',
  /** invoke：把粘贴的图片写入工作区并返回路径 */
  FILE_SAVE_PASTED_IMAGE: 'file:save-pasted-image',
  /** invoke：导出 HTML */
  FILE_EXPORT_HTML: 'file:export-html',
  /** invoke：导出 PDF */
  FILE_EXPORT_PDF: 'file:export-pdf',
  /** invoke：导出 Markdown */
  FILE_EXPORT_MARKDOWN: 'file:export-markdown',
  /** send：根据路径/脏标记更新窗口标题 */
  FILE_UPDATE_TITLE: 'file:update-title',
  /** invoke：在工作区新建文件 */
  FILE_CREATE: 'file:create',
  /** invoke：在工作区新建目录 */
  FILE_CREATE_DIR: 'file:create-dir',
  /** invoke：重命名工作区路径 */
  FILE_RENAME: 'file:rename',
  /** invoke：删除工作区路径 */
  FILE_DELETE: 'file:delete',
  /** invoke：复制工作区路径 */
  FILE_COPY: 'file:copy',
  /** invoke：移动工作区路径 */
  FILE_MOVE: 'file:move',
  /** invoke：工作区 Markdown 字面检索（只读，仅渲染端 inspect 链调用，不暴露给模型） */
  WORKSPACE_SEARCH_MARKDOWN: 'workspace:search-markdown',
  /** send：开始监听工作区文件变化 */
  WORKSPACE_WATCH: 'workspace:watch',
  /** send：停止监听工作区 */
  WORKSPACE_UNWATCH: 'workspace:unwatch',
  /** main→renderer：工作区磁盘变化，渲染进程应刷新树 */
  WORKSPACE_CHANGED: 'workspace:changed',

  /* ================================================================
   * 阅读书签/批注（marks:*）
   * ================================================================ */
  /** invoke：列出某文件的阅读书签/批注 */
  MARKS_LIST: 'marks:list',
  /** invoke：新建阅读书签/批注 */
  MARKS_CREATE: 'marks:create',
  /** invoke：更新阅读书签/批注 */
  MARKS_UPDATE: 'marks:update',
  /** invoke：删除阅读书签/批注 */
  MARKS_DELETE: 'marks:delete',
  /** invoke：本书内卡片全文搜（标题/摘录/批注/AI 洞见，走 marks_fts） */
  MARKS_SEARCH: 'marks:search',
  /** invoke：按章查卡（走 chapter_key 索引，另捎带未固化卡由调用方窄化） */
  MARKS_LIST_BY_CHAPTER: 'marks:list-by-chapter',

  /* ================================================================
   * 记忆卡片复习态（flashcards:*，本书库 flashcards + review_log）
   * ================================================================ */
  /** invoke：本书待复习列表（未复习优先、其次最久未复习） */
  FLASHCARDS_LIST_DUE: 'flashcards:list-due',
  /** invoke：记一次复习评分 */
  FLASHCARDS_APPEND_REVIEW: 'flashcards:append-review',

  /* ================================================================
   * AI 会话指针（一书一会话，inkdown.db ai_sessions，只记指针与计数）
   * ================================================================ */
  /** invoke：取某书会话行（无则 null，调用方建新会话后 put） */
  AI_SESSIONS_GET: 'ai-sessions:get',
  /** invoke：upsert 会话行 */
  AI_SESSIONS_PUT: 'ai-sessions:put',
  /** invoke：prompt 成功后计数 + 保活 */
  AI_SESSIONS_TOUCH: 'ai-sessions:touch',

  /* ================================================================
   * ACP Agent（acp:*）：协议见 @yitom/acp-client，默认运行时 codex-acp
   * ================================================================ */
  /** invoke：列出可用 ACP Agent 运行时（如 codex-acp） */
  ACP_LIST_RUNTIMES: 'acp:list-runtimes',
  /** invoke：连接前探测 Codex/ACP 认证是否已就绪 */
  ACP_AUTH_PREFLIGHT: 'acp:auth-preflight',
  /** invoke：走 ACP authMethods 完成认证 */
  ACP_AUTHENTICATE: 'acp:authenticate',
  /** invoke：拉起 ACP 传输并连接 */
  ACP_CONNECT: 'acp:connect',
  /** invoke：断开 ACP 并清理子进程 */
  ACP_DISCONNECT: 'acp:disconnect',
  /** invoke：加载已有 ACP session（恢复历史） */
  ACP_LOAD_SESSION: 'acp:load-session',
  /** invoke：ACP session/new */
  ACP_SESSION_NEW: 'acp:session-new',
  /** invoke：向当前 session 发送 prompt */
  ACP_PROMPT: 'acp:prompt',
  /** invoke：取消正在进行的 prompt */
  ACP_CANCEL: 'acp:cancel',
  /** invoke：设置 ACP 会话配置项（模型等） */
  ACP_SET_CONFIG_OPTION: 'acp:set-config-option',
  /** invoke：读取自定义模型供应商配置（Key 不回传，只给 hasApiKey） */
  ACP_PROVIDER_GET: 'acp:provider-get',
  /** invoke：保存自定义模型供应商配置（base URL + API Key + 模型） */
  ACP_PROVIDER_SAVE: 'acp:provider-save',
  /** invoke：清除自定义供应商配置，回到本机 ~/.codex 订阅登录 */
  ACP_PROVIDER_CLEAR: 'acp:provider-clear',
  /** invoke：读取 ACP 子进程代理设置 */
  ACP_PROXY_GET: 'acp:proxy-get',
  /** invoke：保存 ACP 子进程代理设置（重新连接后生效） */
  ACP_PROXY_SAVE: 'acp:proxy-save',
  /** send：渲染进程回复 Agent 的权限询问 */
  ACP_PERMISSION_RESPONSE: 'acp:permission-response',
  /** send：渲染进程回传快照内容 */
  ACP_SNAPSHOT_RESPONSE: 'acp:snapshot-response',
  /** main→renderer：ACP session/update 流式事件 */
  ACP_SESSION_UPDATE: 'acp:session-update',
  /** main→renderer：ACP 连接/会话状态变化 */
  ACP_STATUS_CHANGED: 'acp:status-changed',
  /** main→renderer：Agent 请求工具权限，需 UI 确认 */
  ACP_PERMISSION_REQUEST: 'acp:permission-request',
  /** main→renderer：Agent 要当前编辑器/阅读器快照 */
  ACP_SNAPSHOT_REQUEST: 'acp:snapshot-request',

  /* ================================================================
   * 在线文档（web-doc:*）
   * ================================================================ */
  /** invoke：抓取在线文档一页 HTML */
  WEB_DOC_FETCH_PAGE: 'web-doc:fetch-page',
  /** invoke：发现在线文档目录（TOC） */
  WEB_DOC_DISCOVER_TOC: 'web-doc:discover-toc',

  /* ================================================================
   * PDF OCR（ocr:*）
   * ================================================================ */
  /** invoke：读取 PDF OCR 目录缓存 */
  OCR_GET_PDF_TOC: 'ocr:get-pdf-toc',
  /** invoke：对 PDF 目录页做 OCR 并缓存 */
  OCR_RECOGNIZE_PDF_TOC: 'ocr:recognize-pdf-toc',
  /** invoke：探测 PDF 目录页范围（只建议范围，不识别不缓存） */
  OCR_DETECT_PDF_TOC_PAGES: 'ocr:detect-pdf-toc-pages',
  /** invoke：删除某 PDF 的目录 OCR 缓存 */
  OCR_DELETE_PDF_TOC: 'ocr:delete-pdf-toc',
  /** invoke：读取某页 PDF OCR 缓存 */
  OCR_GET_PDF_PAGE: 'ocr:get-pdf-page',
  /** invoke：对指定 PDF 页 OCR 并缓存 */
  OCR_RECOGNIZE_PDF_PAGE: 'ocr:recognize-pdf-page',
  /** invoke：列出已缓存 OCR 的 PDF 页码 */
  OCR_LIST_PDF_PAGES: 'ocr:list-pdf-pages',
  /** invoke：清除单个 PDF 的 OCR 缓存 */
  OCR_CLEAR_PDF_CACHE: 'ocr:clear-pdf-cache',
  /** invoke：清除全部 PDF OCR 缓存 */
  OCR_CLEAR_ALL_CACHE: 'ocr:clear-all-cache',
  /** invoke：手动保存 PDF 目录 OCR 结果 */
  OCR_SAVE_PDF_TOC: 'ocr:save-pdf-toc',
  /** invoke：OCR 组件（语言包/引擎）是否就绪 */
  OCR_GET_COMPONENT_STATUS: 'ocr:get-component-status',
  /** invoke：下载并确保 OCR 组件可用 */
  OCR_ENSURE_COMPONENT: 'ocr:ensure-component',
  /** invoke：取消 OCR 组件下载 */
  OCR_CANCEL_COMPONENT_DOWNLOAD: 'ocr:cancel-component-download',
  /** main→renderer：OCR 组件下载/就绪状态推送 */
  OCR_COMPONENT_STATUS: 'ocr:component-status',

  /* ================================================================
   * PDF 解析（pdf-inspect:*）
   * ================================================================ */
  /** invoke：pdf-inspector 分类（类型/页数/待 OCR 页） */
  PDF_INSPECT_CLASSIFY: 'pdf-inspect:classify',
  /** invoke：pdf-inspector 整档 Markdown（原生文字层） */
  PDF_INSPECT_BOOK_MARKDOWN: 'pdf-inspect:book-markdown',

  /* ================================================================
   * 罗盘（rosetta:*）：扫描书索引库
   * ================================================================ */
  /** invoke：扫描书一键导入罗盘索引（长任务，进度另走推送） */
  ROSETTA_IMPORT_BOOK: 'rosetta:import-book',
  /** send：取消正在进行的罗盘导入 */
  ROSETTA_CANCEL_IMPORT: 'rosetta:cancel-import',
  /** invoke：查询当前导入快照（窗口重载后恢复进度显示），无则返回 null */
  ROSETTA_ACTIVE_IMPORT: 'rosetta:active-import',
  /** main→renderer：罗盘导入进度推送 */
  ROSETTA_IMPORT_STATUS: 'rosetta:import-status',
  /** invoke：查询某书罗盘索引信息，未导入返回 null */
  ROSETTA_BOOK_INFO: 'rosetta:book-info',
  /** invoke：罗盘统一读查询（页/章/目录/搜索/上下文/目录项） */
  ROSETTA_QUERY_BOOK: 'rosetta:query-book',
  /** invoke：纯本地重建罗盘目录索引（只写 toc_entries/chapters/块归属，不调 OCR） */
  ROSETTA_REBUILD_TOC: 'rosetta:rebuild-toc',
  /** invoke：只读预览正文水印清洗（readOnly + query_only，不写库，最多 20 条样例） */
  ROSETTA_PREVIEW_BODY_WATERMARK: 'rosetta:preview-body-watermark',
  /** invoke：备份并应用正文水印清洗（先备份校验，再单事务条件写，需二次确认后调用） */
  ROSETTA_APPLY_BODY_WATERMARK: 'rosetta:apply-body-watermark',
  /** invoke：已入库内容只读取证（readOnly + query_only，不写库；指纹由渲染端绑定当前文档） */
  ROSETTA_INSPECT_CONTENT: 'rosetta:inspect-content',

  /* ================================================================
   * AI 测验（quiz:*）
   * ================================================================ */
  /** invoke：追加保存测验记录到 JSONL */
  QUIZ_APPEND_SESSION: 'quiz:append-session',
  /** invoke：读取所有历史测验记录 */
  QUIZ_GET_ALL_SESSIONS: 'quiz:get-all-sessions',
  /** invoke：按书籍路径读取测验历史 */
  QUIZ_GET_SESSIONS_BY_FILE: 'quiz:get-sessions-by-file',

  /* ================================================================
   * 云同步（sync:*）：WebDAV 双向同步
   * ================================================================ */
  /** invoke：读取同步配置 */
  SYNC_GET_CONFIG: 'sync:get-config',
  /** invoke：保存同步配置 */
  SYNC_SAVE_CONFIG: 'sync:save-config',
  /** invoke：测试 WebDAV 连通性与权限 */
  SYNC_TEST_CONNECTION: 'sync:test-connection',
  /** invoke：立即执行一次双向同步 */
  SYNC_RUN_NOW: 'sync:run-now',
  /** invoke：获取当前同步状态 */
  SYNC_GET_STATUS: 'sync:get-status',
  /** main→renderer：同步状态更新推送 */
  SYNC_STATUS_CHANGED: 'sync:status-changed',
  /** main→renderer：推送远端最新阅读进度给渲染端 Store */
  SYNC_APPLY_REMOTE_PROGRESS: 'sync:apply-remote-progress',
  /** invoke：渲染端把最新阅读进度快照推送到主进程持久化保存 */
  SYNC_SAVE_LOCAL_PROGRESS: 'sync:save-local-progress',
} as const

/** `IPC` 全部通道字符串的联合类型，用于约束 handle/on/invoke 的 channel 参数 */
export type IpcChannel = (typeof IPC)[keyof typeof IPC]
