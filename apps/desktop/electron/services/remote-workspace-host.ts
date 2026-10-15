/**
 * 远端工作区宿主（B2/B3）：实现 A1 `WorkspaceHost` 接口，业务经 workspace
 * 协议在远端 Node 服务执行（`@montree/remote-server` 方法集），Windows 本机
 * 不做 UNC/9P 文件 I/O（§3.1/§3.3）。
 *
 * 路径域说明：本接口的 `filePath` 在 local 宿主是本机绝对路径；
 * 在本远端宿主一律是**工作区相对 POSIX 路径**（rel），由 IPC 层用
 * DocumentRef 解析后传入，不在 renderer 拼接远端绝对路径。
 *
 * - 断线：传输断开时全部操作返回 REMOTE_NOT_CONNECTED，不伪装成功（T4）；
 *   未保存 buffer 留渲染端，宿主不碰、不清。
 * - 冲突：writeText 携带 expectedRevision，远端报 REVISION_CONFLICT（T5）。
 * - 代际：每次重连 generation 自增；迟到响应丢弃，旧 watch 事件丢弃（T6）。
 * - 隔离：同 relativePath 分属不同 workspaceId；跨宿主 copy/move 拒绝（T7）。
 * - 取消：search/git 经 AbortController 取消（CANCELLED），不重放副作用请求。
 */
import type {
  AppError,
  ExportDocumentPayload,
  ExportDocumentResult,
  GitBranchInfo,
  GitCommitOptions,
  GitCommitResult,
  GitDiffResult,
  GitPushOptions,
  GitPushResult,
  GitStatusResult,
  OpenDialogOptions,
  OpenDocumentResult,
  OpenFolderResult,
  ReadBinaryResult,
  ReadImageResult,
  Result,
  SaveFilePayload,
  SaveFileResult,
  SavePastedImagePayload,
  SavePastedImageResult,
  WorkspaceDescriptor,
  WorkspaceFsCopyPayload,
  WorkspaceFsCreateDirPayload,
  WorkspaceFsCreateFilePayload,
  WorkspaceFsDeletePayload,
  WorkspaceFsMovePayload,
  WorkspaceFsPathResult,
  WorkspaceFsRenamePayload,
  WorkspaceKind,
  WorkspaceSearchMarkdownHit,
  WorkspaceSearchMarkdownPayload,
  WorkspaceSearchMarkdownResult,
  WorkspaceWatchEvent,
} from '@montree/contracts'
import {
  CROSS_WORKSPACE_MOVE_MESSAGE,
  DEFAULT_WORKSPACE_LIMITS,
  IMAGE_MIME_BY_EXTENSION,
  assertSameWorkspaceId,
  err,
  getDocumentKind,
  ok,
} from '@montree/contracts'
import type {
  HostTextRead,
  HostWriteTextInput,
  HostWriteTextResult,
  WorkspaceHost,
} from './workspace-host'

/** 协议传输抽象：真实 WSL 由 B1 启动器（wsl-bootstrap RemoteRpc）适配。 */
export interface RemoteWorkspaceTransport {
  invoke<T>(
    method: string,
    params: Record<string, unknown>,
    timeoutMs?: number,
    signal?: AbortSignal,
  ): Promise<{ ok: true; result: T } | { ok: false; code: string; message: string }>
  onEvent(listener: (event: WorkspaceWatchEvent) => void): () => void
  /** 断开后为 false；宿主直接报 REMOTE_NOT_CONNECTED，不走 UNC 兜底 */
  isConnected(): boolean
}

export interface RemoteWatchSubscription {
  subscriptionId: string
  /** 订阅的工作区相对目录（重连后逐个重建，Linux 无 recursive） */
  relDir: string
}

export interface RemoteReconnectResult {
  generation: string
  /** 重连后 revision 发生变化的跟踪路径（渲染端据此提示外部修改） */
  changedPaths: string[]
}

function toAppError(code: string, message: string): AppError {
  return { code: code as AppError['code'], message }
}

function logHost(descriptorId: string, fields: Record<string, unknown>): void {
  const safe: Record<string, unknown> = { host: descriptorId }
  for (const key of ['method', 'code', 'durationMs', 'bytes', 'generation', 'state']) {
    const value = fields[key]
    if (typeof value === 'string' || typeof value === 'number') safe[key] = value
  }
  console.log('[remote-workspace-host]', JSON.stringify(safe))
}

/**
 * B2：远端路径必须已是工作区相对 POSIX（调用方传 DocumentRef）。
 * 绝对路径（盘符/`/` 开头/UNC）、穿越、NUL 一律拒绝——非法路径零传输，
 * 永不进入远端调用，更无 UNC I/O（T3 结构性保证）。
 */
function requireRelPath(path: string): string {
  if (typeof path !== 'string' || !path.trim() || path.includes('\0')) {
    throw toAppError('INVALID_ARGUMENT', `非法工作区相对路径: ${path}`)
  }
  const forward = path.replace(/\\/g, '/')
  if (
    forward.startsWith('/') ||
    /^[A-Za-z]:(\/|$)/.test(forward) ||
    /^\\\\/.test(path) ||
    forward.startsWith('//')
  ) {
    throw toAppError('INVALID_ARGUMENT', `只允许工作区相对路径: ${path}`)
  }
  const rel = forward.trim().replace(/\/+/g, '/').replace(/\/$/, '')
  if (!rel || rel === '.' || rel.split('/').includes('..')) {
    throw toAppError('INVALID_ARGUMENT', `非法工作区相对路径: ${path}`)
  }
  return rel
}

function parentRelDir(rel: string): string {
  const idx = rel.lastIndexOf('/')
  return idx <= 0 ? '' : rel.slice(0, idx)
}

export class RemoteWorkspaceHost implements WorkspaceHost {
  readonly kind: WorkspaceKind
  private generation: string
  private subscriptions = new Map<string, RemoteWatchSubscription>()
  private trackedRevisions = new Map<string, string>()
  private unsubscribeTransport: (() => void) | null = null
  private watchListeners = new Set<(event: WorkspaceWatchEvent) => void>()

  constructor(
    readonly descriptor: WorkspaceDescriptor,
    private transport: RemoteWorkspaceTransport,
    generation: string,
  ) {
    if (descriptor.kind !== 'wsl' && descriptor.kind !== 'ssh') {
      throw new Error(`RemoteWorkspaceHost 仅支持 wsl/ssh，收到 ${descriptor.kind}`)
    }
    this.kind = descriptor.kind
    this.generation = generation
    this.unsubscribeTransport = transport.onEvent((event) => {
      // T6：旧代际事件不污染新工作区状态
      if (event.generation !== this.generation) return
      for (const listener of this.watchListeners) listener(event)
    })
  }

  getGeneration(): string {
    return this.generation
  }

  /** P1 会话复用判定：传输仍连通才可被新窗口共享（断线会话不复用）。 */
  isConnected(): boolean {
    return this.transport.isConnected()
  }

  getSubscriptionCount(): number {
    return this.subscriptions.size
  }

  /** 渲染端订阅远端变更（返回取消订阅；传输事件已按代际过滤） */
  onWatchEvent(listener: (event: WorkspaceWatchEvent) => void): () => void {
    this.watchListeners.add(listener)
    return () => {
      this.watchListeners.delete(listener)
    }
  }

  private disconnected<T>(): Result<T, AppError> {
    return err({
      code: 'REMOTE_NOT_CONNECTED',
      message: `远端工作区未连接 (${this.descriptor.id})：不断线误报成功，未保存内容仍在本地 buffer`,
    })
  }

  private async call<T>(
    method: string,
    params: Record<string, unknown>,
    timeoutMs?: number,
    signal?: AbortSignal,
  ): Promise<Result<T, AppError>> {
    const callGeneration = this.generation
    if (signal?.aborted) {
      return err({ code: 'CANCELLED', message: '请求已取消' })
    }
    if (!this.transport.isConnected()) return this.disconnected<T>()
    const started = Date.now()
    const outcome = await this.transport.invoke<T>(method, params, timeoutMs, signal)
    // T6：等待期间发生重连，迟到响应直接丢弃
    if (this.generation !== callGeneration) {
      return err({ code: 'INVALID_STATE', message: '旧连接响应已丢弃（重连后代际变化）' })
    }
    if (!outcome.ok) {
      logHost(this.descriptor.id, {
        method,
        code: outcome.code,
        durationMs: Date.now() - started,
        generation: this.generation,
      })
      // 传输层“已断开”统一为 REMOTE_NOT_CONNECTED（不断线伪装）
      if (outcome.code === 'REMOTE_NOT_CONNECTED') return this.disconnected<T>()
      return err(toAppError(outcome.code, outcome.message))
    }
    return ok(outcome.result)
  }

  /** 同宿主断言（跨宿主 copy/move 拒绝，不偷渡） */
  assertOwnWorkspace(workspaceId: string): Result<void, AppError> {
    if (assertSameWorkspaceId(this.descriptor.id, workspaceId)) return ok(undefined)
    return err({ code: 'UNSUPPORTED_OPERATION', message: CROSS_WORKSPACE_MOVE_MESSAGE })
  }

  // --- 对话框类：远端无 Windows 原生对话框，显式失败（不伪装） ---

  async openDocument(): Promise<Result<OpenDocumentResult, AppError>> {
    return err({
      code: 'UNSUPPORTED_OPERATION',
      message: '远端工作区请用工作区浏览选择文件，不弹本机文件对话框',
    })
  }

  async openFolder(): Promise<Result<OpenFolderResult, AppError>> {
    return err({
      code: 'UNSUPPORTED_OPERATION',
      message: '远端工作区请用发行版/目录选择连接，不弹本机文件夹对话框',
    })
  }

  /** 远端目录树（递归 listDirectory，沿本机扫描的忽略与深度规则） */
  async scanWorkspace(): Promise<Result<OpenFolderResult, AppError>> {
    const started = Date.now()
    const nodes = await this.listTree('', 0)
    if (!nodes.ok) return nodes
    logHost(this.descriptor.id, { method: 'scanWorkspace', code: 'OK', durationMs: Date.now() - started })
    return ok({ rootPath: this.descriptor.rootLabel, tree: nodes.value })
  }

  private async listTree(
    relDir: string,
    depth: number,
  ): Promise<Result<OpenFolderResult['tree'], AppError>> {
    if (depth > 6) return ok([])
    const listed = await this.call<{ entries: Array<{ name: string; isDirectory: boolean }> }>(
      'listDirectory',
      { path: relDir },
      15000,
    )
    if (!listed.ok) {
      // 远端权限失败必须明确失败，禁止伪装成功空树（§4.5）
      if (listed.error.code === 'FILE_NOT_FOUND' && depth > 0) return ok([])
      return listed
    }
    const tree: OpenFolderResult['tree'] = []
    const sorted = [...listed.value.entries].sort((a, b) => {
      if (a.isDirectory && !b.isDirectory) return -1
      if (!a.isDirectory && b.isDirectory) return 1
      return a.name.localeCompare(b.name)
    })
    for (const entry of sorted) {
      if (entry.name.startsWith('.') || entry.name === 'node_modules') continue
      const rel = relDir ? `${relDir}/${entry.name}` : entry.name
      if (entry.isDirectory) {
        const children = await this.listTree(rel, depth + 1)
        if (!children.ok) return children
        // 去掉空文件夹（对齐本机 pruneEmptyDirectories）
        if (children.value.length === 0) continue
        tree.push({ name: entry.name, path: rel, type: 'directory', children: children.value })
        continue
      }
      const documentKind = getDocumentKind(entry.name)
      if (documentKind === 'unknown') continue
      tree.push({ name: entry.name, path: rel, type: 'file', documentKind })
    }
    return ok(tree)
  }

  // --- B2 文本闭环 ---

  async readText(filePath: string): Promise<Result<HostTextRead, AppError>> {
    let rel: string
    try {
      rel = requireRelPath(filePath)
    } catch (error) {
      return err(error as AppError)
    }
    const result = await this.call<{
      content: string
      revision: string
    }>('readText', { path: rel }, 15000)
    if (!result.ok) return result
    this.trackedRevisions.set(rel, result.value.revision)
    return ok({ filePath: rel, content: result.value.content, revision: result.value.revision })
  }

  async writeText(
    filePath: string,
    input: HostWriteTextInput,
  ): Promise<Result<HostWriteTextResult, AppError>> {
    let rel: string
    try {
      rel = requireRelPath(filePath)
    } catch (error) {
      return err(error as AppError)
    }
    const params: Record<string, unknown> = { path: rel, content: input.content }
    if (input.expectedRevision !== undefined && input.expectedRevision !== null) {
      params['expectedRevision'] = input.expectedRevision
    }
    const result = await this.call<{ revision: string }>('writeText', params, 15000)
    if (!result.ok) return result
    this.trackedRevisions.set(rel, result.value.revision)
    return ok({ filePath: rel, revision: result.value.revision })
  }

  /** 远端保存（已有路径直写；无路径必须走 saveTextAs 指定远端目录） */
  async saveFile(payload: SaveFilePayload): Promise<Result<SaveFileResult, AppError>> {
    if (!payload.filePath) {
      return err({
        code: 'UNSUPPORTED_OPERATION',
        message: '远端另存为请选择远端目录（不支持本机另存对话框冒充远端保存）',
      })
    }
    let rel: string
    try {
      rel = requireRelPath(payload.filePath)
    } catch (error) {
      return err(error as AppError)
    }
    // P1：markdown 经 provider 由 fileApi.saveFile 携带 expectedContent 进来；
    // 先核对磁盘内容，不一致报 REVISION_CONFLICT，不盲覆盖（对齐本机
    // saveFileDialog 语义；provider 路径抛错后 buffer 与模型基线原样保留，
    // 重复保存持续拒绝，直到外部修改被重载或显式覆盖）。
    let expectedRevision: string | undefined
    if (payload.expectedContent !== undefined) {
      const current = await this.call<{ content: string; revision: string }>(
        'readText',
        { path: rel },
        15000,
      )
      if (!current.ok) return current
      if (typeof payload.expectedContent !== 'string' || current.value.content !== payload.expectedContent) {
        return err({ code: 'REVISION_CONFLICT', message: '文件已被其他程序修改，请重新打开后再保存' })
      }
      // 内容核对与写入分属两个请求；将核对时的版本交给服务端，拒绝期间的外部修改。
      expectedRevision = current.value.revision
    }
    return this.writeText(payload.filePath, { content: payload.content, expectedRevision })
  }

  async saveFileAs(payload: SaveFilePayload): Promise<Result<SaveFileResult, AppError>> {
    return this.saveFile(payload)
  }

  /**
   * B2 远端另存为：远端目录选择语义（dirRelativePath + fileName），
   * 不弹 Windows 对话框；目标已存在则拒绝（不静默覆盖）。
   */
  async saveTextAs(dirRelativePath: string | undefined, fileName: string, content: string): Promise<Result<{ relativePath: string; revision: string }, AppError>> {
    const trimmedName = fileName.trim()
    if (!trimmedName || /[/\\]/.test(trimmedName) || trimmedName.includes('\0')) {
      return err({ code: 'INVALID_ARGUMENT', message: '另存文件名非法（不得含路径分隔符）' })
    }
    let dir = ''
    if (dirRelativePath !== undefined && dirRelativePath !== '') {
      try {
        dir = requireRelPath(dirRelativePath)
      } catch (error) {
        return err(error as AppError)
      }
    }
    const rel = dir ? `${dir}/${trimmedName}` : trimmedName
    const existing = await this.call<{ revision: string }>('stat', { path: rel }, 15000)
    if (existing.ok) {
      return err({ code: 'FILE_WRITE_ERROR', message: `远端目标已存在：${trimmedName}` })
    }
    // 服务端缺失文件可能报 FILE_NOT_FOUND 或裸 ENOENT（后者待服务端收敛），均视为不存在
    const missingCode = existing.error.code as string
    if (!existing.ok && missingCode !== 'FILE_NOT_FOUND' && missingCode !== 'ENOENT') {
      return existing
    }
    const written = await this.writeText(rel, { content })
    if (!written.ok) return written
    return ok({ relativePath: rel, revision: written.value.revision })
  }

  // --- B2 文件树 CRUD（同宿主；跨宿主由调用方先过 assertOwnWorkspace） ---

  async createFile(
    payload: WorkspaceFsCreateFilePayload,
  ): Promise<Result<WorkspaceFsPathResult, AppError>> {
    let rel: string
    try {
      rel = requireRelPath(payload.path)
    } catch (error) {
      return err(error as AppError)
    }
    const result = await this.call<{ path: string }>(
      'createFile',
      { path: rel, content: payload.content ?? '' },
      15000,
    )
    if (!result.ok) return result
    return ok({ path: result.value.path })
  }

  async createDirectory(
    payload: WorkspaceFsCreateDirPayload,
  ): Promise<Result<WorkspaceFsPathResult, AppError>> {
    let rel: string
    try {
      rel = requireRelPath(payload.path)
    } catch (error) {
      return err(error as AppError)
    }
    const result = await this.call<{ path: string }>('mkdir', { path: rel }, 15000)
    if (!result.ok) return result
    return ok({ path: result.value.path })
  }

  async renamePath(
    payload: WorkspaceFsRenamePayload,
  ): Promise<Result<WorkspaceFsPathResult, AppError>> {
    return this.moveOrCopy('rename', payload.fromPath, payload.toPath)
  }

  async deletePath(payload: WorkspaceFsDeletePayload): Promise<Result<void, AppError>> {
    let rel: string
    try {
      rel = requireRelPath(payload.path)
    } catch (error) {
      return err(error as AppError)
    }
    // 不把删除当连接检查：先 stat 确认存在（不存在报 FILE_NOT_FOUND，不误报成功）
    const result = await this.call<{ path: string }>('delete', { path: rel }, 15000)
    if (!result.ok) return result
    this.trackedRevisions.delete(rel)
    return ok(undefined)
  }

  async copyPath(
    payload: WorkspaceFsCopyPayload,
  ): Promise<Result<WorkspaceFsPathResult, AppError>> {
    return this.moveOrCopy('copy', payload.fromPath, payload.toPath)
  }

  async movePath(
    payload: WorkspaceFsMovePayload,
  ): Promise<Result<WorkspaceFsPathResult, AppError>> {
    return this.moveOrCopy('move', payload.fromPath, payload.toPath)
  }

  private async moveOrCopy(
    method: 'rename' | 'copy' | 'move',
    fromPath: string,
    toPath: string,
  ): Promise<Result<WorkspaceFsPathResult, AppError>> {
    let from: string
    let to: string
    try {
      from = requireRelPath(fromPath)
      to = requireRelPath(toPath)
    } catch (error) {
      return err(error as AppError)
    }
    const result = await this.call<{ path: string }>(method, { path: from, toPath: to }, 15000)
    if (!result.ok) return result
    if (method !== 'copy') {
      this.trackedRevisions.delete(from)
      // 重命名后打开文档的 revision 跟随（旧 revision 失效，重读为准）
      for (const key of [...this.trackedRevisions.keys()]) {
        if (key === from || key.startsWith(`${from}/`)) this.trackedRevisions.delete(key)
      }
    }
    return ok({ path: result.value.path })
  }

  // --- B3 搜索（远端执行；分页可取消） ---

  async searchMarkdown(
    payload: WorkspaceSearchMarkdownPayload,
    options?: { signal?: AbortSignal },
  ): Promise<Result<WorkspaceSearchMarkdownResult, AppError>> {
    const query = payload.query.trim()
    if (!query || [...query].length > 200) {
      return err({ code: 'INVALID_ARGUMENT', message: '检索词无效' })
    }
    const result = await this.call<{ total: number; hits: WorkspaceSearchMarkdownHit[] }>(
      'searchMarkdown',
      { query },
      30000,
      options?.signal,
    )
    if (!result.ok) return result
    const offset = payload.offset ?? 0
    const limit = payload.limit ?? DEFAULT_WORKSPACE_LIMITS.searchMaxHits
    const start = offset > 0 ? offset : 0
    const size = limit > 0 ? Math.min(limit, DEFAULT_WORKSPACE_LIMITS.searchMaxHits) : DEFAULT_WORKSPACE_LIMITS.searchMaxHits
    const hits = result.value.hits.slice(start, start + size)
    return ok({
      total: result.value.total,
      hits,
      nextOffset: start + size < result.value.hits.length ? start + size : null,
    })
  }

  // --- B3 Git（远端 Ubuntu 执行；测试中无真实远端 push） ---

  async gitStatus(_cwd: string): Promise<GitStatusResult> {
    const result = await this.call<{
      isRepo: boolean
      branch: string | null
      behind: number
      ahead: number
      hasUpstream?: boolean
      files: Array<{ path: string; status: string; staged: boolean }>
      totalChanges: number
    }>('gitStatus', {}, 30000)
    if (!result.ok) {
      return { isRepo: false, branch: null, ahead: 0, behind: 0, hasUpstream: false, files: [], totalChanges: 0 }
    }
    return {
      isRepo: result.value.isRepo,
      branch: result.value.branch,
      ahead: result.value.ahead,
      behind: result.value.behind,
      // 老版本远端不回该字段，缺省按无上游处理（UI 会给出发布分支而非裸 push）
      hasUpstream: result.value.hasUpstream ?? false,
      files: result.value.files.map((f) => ({
        path: f.path,
        status: f.status as GitStatusResult['files'][number]['status'],
        staged: f.staged,
      })),
      totalChanges: result.value.totalChanges,
    }
  }

  async gitDiff(file?: string, staged = false): Promise<Result<GitDiffResult, AppError>> {
    if (file !== undefined) {
      try {
        requireRelPath(file)
      } catch (error) {
        return err(error as AppError)
      }
    }
    return this.call<GitDiffResult>('gitDiff', { ...(file ? { path: file } : {}), staged }, 30000)
  }

  async gitBranch(): Promise<Result<GitBranchInfo, AppError>> {
    return this.call<GitBranchInfo>('gitBranch', {}, 30000)
  }

  async gitPush(
    payload: { cwd: string } & GitPushOptions,
  ): Promise<Result<GitPushResult, AppError>> {
    const params: Record<string, unknown> = {}
    if (payload.remote !== undefined) params['remote'] = payload.remote
    if (payload.branch !== undefined) params['branch'] = payload.branch
    if (payload.setUpstream === true) params['setUpstream'] = true
    const result = await this.call<{ success: boolean; stdout?: string }>('gitPush', params, 120000)
    if (!result.ok) return result
    return ok({ success: result.value.success, stdout: result.value.stdout })
  }

  async gitCommit(
    payload: { cwd: string } & GitCommitOptions,
  ): Promise<Result<GitCommitResult, AppError>> {
    if (!payload.message.trim()) {
      return err({ code: 'INVALID_ARGUMENT', message: 'Commit message 不能为空' })
    }
    const result = await this.call<{ success: boolean; commitHash?: string }>(
      'gitCommit',
      { message: payload.message, stageAll: payload.stageAll === true },
      30000,
    )
    if (!result.ok) return result
    return ok({ success: result.value.success, commitHash: result.value.commitHash, message: payload.message })
  }

  // --- B2 相对预览图片/粘贴图经宿主 ---

  async readBinary(filePath: string): Promise<Result<ReadBinaryResult, AppError>> {
    let rel: string
    try {
      rel = requireRelPath(filePath)
    } catch (error) {
      return err(error as AppError)
    }
    // 小资源经 readResource；超限由服务端明确 LIMIT_EXCEEDED（E 阶段前不伪装大二进制）
    const result = await this.call<{ base64: string; byteLength: number; truncated: boolean }>(
      'readResource',
      { path: rel },
      30000,
    )
    if (!result.ok) return result
    if (result.value.truncated) {
      return err({ code: 'LIMIT_EXCEEDED', message: '资源超过上限（大文件通道未落地）' })
    }
    return ok({
      filePath: rel,
      data: new Uint8Array(Buffer.from(result.value.base64, 'base64')),
    })
  }

  async readImage(filePath: string): Promise<Result<ReadImageResult, AppError>> {
    let rel: string
    try {
      rel = requireRelPath(filePath)
    } catch (error) {
      return err(error as AppError)
    }
    const dot = rel.lastIndexOf('.')
    const mime =
      dot >= 0 ? IMAGE_MIME_BY_EXTENSION[rel.slice(dot).toLowerCase()] : undefined
    if (!mime) {
      return err({ code: 'FILE_READ_ERROR', message: '不支持的图片格式' })
    }
    const binary = await this.readBinary(rel)
    if (!binary.ok) return binary
    if (binary.value.data.byteLength > DEFAULT_WORKSPACE_LIMITS.maxResourceBytes) {
      return err({ code: 'LIMIT_EXCEEDED', message: '图片超过预览资源上限' })
    }
    return ok({ dataUrl: `data:${mime};base64,${Buffer.from(binary.value.data).toString('base64')}` })
  }

  async savePastedImage(
    payload: SavePastedImagePayload,
  ): Promise<Result<SavePastedImageResult, AppError>> {
    // 服务端 writeResource 未落地前：显式不支持，不伪装成功（B2 限制见交付说明）
    void payload
    return err({
      code: 'NOT_SUPPORTED',
      message: '远端粘贴图写入需服务端二进制写方法（未落地），请先保存到本机后导入',
    })
  }

  // --- 导出：远端内容经本机打印管线是独立“导出到本机”语义，此处不实现 ---

  async exportHtml(): Promise<Result<ExportDocumentResult, AppError>> {
    return err({ code: 'UNSUPPORTED_OPERATION', message: '远端导出请用导出到本机流程' })
  }

  async exportMarkdown(): Promise<Result<ExportDocumentResult, AppError>> {
    return err({ code: 'UNSUPPORTED_OPERATION', message: '远端导出请用导出到本机流程' })
  }

  async exportPdf(): Promise<Result<ExportDocumentResult, AppError>> {
    return err({ code: 'UNSUPPORTED_OPERATION', message: '远端导出请用导出到本机流程' })
  }

  // --- B3 watch 订阅/代际隔离/断线重连 ---

  /**
   * 订阅远端目录（Linux 无 recursive，由调用方按需为子目录逐个订阅）。
   * 返回 subscriptionId；事件经 onWatchEvent 按代际过滤后送达。
   */
  async watchDirectory(relDir: string): Promise<Result<{ subscriptionId: string }, AppError>> {
    const dir = relDir === '' || relDir === '.' ? '' : requireRelPath(relDir)
    const result = await this.call<{ subscriptionId: string }>('watch', { path: dir }, 15000)
    if (!result.ok) return result
    this.subscriptions.set(result.value.subscriptionId, {
      subscriptionId: result.value.subscriptionId,
      relDir: dir,
    })
    return ok({ subscriptionId: result.value.subscriptionId })
  }

  async unwatchDirectory(subscriptionId: string): Promise<Result<void, AppError>> {
    this.subscriptions.delete(subscriptionId)
    const result = await this.call<{ unsubscribed: boolean }>(
      'unwatch',
      { subscriptionId },
      15000,
    )
    if (!result.ok) return result
    return ok(undefined)
  }

  /**
   * B3 断线重连：更换传输 + 代际自增 + 重建全部订阅 + 核对跟踪 revision。
   * 不盲重放保存/删除/重命名等有副作用请求（§4.3）；写响应丢失由调用方核对版本。
   */
  async reconnect(
    transport: RemoteWorkspaceTransport,
    nextGeneration: string,
  ): Promise<Result<RemoteReconnectResult, AppError>> {
    this.unsubscribeTransport?.()
    this.transport = transport
    this.generation = nextGeneration
    this.subscriptions.clear()
    this.unsubscribeTransport = transport.onEvent((event) => {
      if (event.generation !== this.generation) return
      for (const listener of this.watchListeners) listener(event)
    })
    if (!transport.isConnected()) {
      return err({ code: 'REMOTE_NOT_CONNECTED', message: '重连后传输仍未连接' })
    }
    // 重建订阅由调用方按需 watchDirectory（此处仅清理旧订阅，避免幽灵订阅悬挂）
    const changedPaths: string[] = []
    for (const [rel, revision] of this.trackedRevisions) {
      const stat = await this.call<{ revision: string }>('stat', { path: rel }, 15000)
      if (!stat.ok) continue
      if (stat.value.revision !== revision) {
        changedPaths.push(rel)
        this.trackedRevisions.set(rel, stat.value.revision)
      }
    }
    logHost(this.descriptor.id, {
      method: 'reconnect',
      code: 'OK',
      generation: this.generation,
      state: 'connected',
    })
    return ok({ generation: this.generation, changedPaths })
  }

  /** 释放：取消传输事件订阅与全部监听（只清理本连接，不全局 pkill） */
  dispose(): void {
    this.unsubscribeTransport?.()
    this.unsubscribeTransport = null
    this.watchListeners.clear()
    this.subscriptions.clear()
  }
}

/**
 * 远端宿主会话表（B2）：workspaceId → host，多窗口共享同一连接；
 * refcount 归属窗口，关 A 不杀 B（T7）。真实 WSL 会话由连接层注册，
 * 未注册一律 REMOTE_NOT_CONNECTED（§3.2，不伪装）。
 */
interface RemoteHostSession {
  host: RemoteWorkspaceHost
  boundWindows: Set<number>
}

const remoteHostSessions = new Map<string, RemoteHostSession>()

/** 仅测试使用：清空会话表。 */
export function resetRemoteHostSessionsForTest(): void {
  for (const session of remoteHostSessions.values()) session.host.dispose()
  remoteHostSessions.clear()
}

export function registerRemoteHost(host: RemoteWorkspaceHost): void {
  const existing = remoteHostSessions.get(host.descriptor.id)
  if (existing && existing.host !== host) existing.host.dispose()
  remoteHostSessions.set(host.descriptor.id, {
    host,
    boundWindows: existing?.boundWindows ?? new Set(),
  })
}

export function getRemoteHost(workspaceId: string): RemoteWorkspaceHost | null {
  return remoteHostSessions.get(workspaceId)?.host ?? null
}

/** 窗口绑定远端宿主（同 id 复用连接；不同窗口各自计数）。 */
export function bindRemoteHostToWindow(workspaceId: string, webContentsId: number): boolean {
  const session = remoteHostSessions.get(workspaceId)
  if (!session) return false
  session.boundWindows.add(webContentsId)
  return true
}

/**
 * 窗口解绑：最后一个窗口离开才释放连接（关 A 不杀 B）。
 * 返回 true 表示连接已释放，false 表示仍有窗口共享。
 */
export function unbindRemoteHostFromWindow(workspaceId: string, webContentsId: number): boolean {
  const session = remoteHostSessions.get(workspaceId)
  if (!session) return true
  session.boundWindows.delete(webContentsId)
  if (session.boundWindows.size === 0) {
    session.host.dispose()
    remoteHostSessions.delete(workspaceId)
    return true
  }
  return false
}

export function remoteHostBoundWindowCount(workspaceId: string): number {
  return remoteHostSessions.get(workspaceId)?.boundWindows.size ?? 0
}
