import { execFile } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import { mkdir, readFile, realpath, rm, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { promisify } from 'node:util'
import { TINYMIST_VERSION, type TypstConfig, type TypstEvent, type TypstOpenPayload, type TypstRequestPayload, type TypstRuntimeStatus, type TypstSession, type TypstSyncPayload } from '@yitom/contracts'
import { LspProcess } from './lsp-process'

const execFileAsync = promisify(execFile)
const MAX_CONTENT = 4 * 1024 * 1024
const METHODS = new Set(['textDocument/completion', 'completionItem/resolve', 'textDocument/hover', 'textDocument/signatureHelp', 'textDocument/definition', 'textDocument/formatting', 'textDocument/documentSymbol'])
const DEFAULT_CONFIG: TypstConfig = { executablePath: '', fontPaths: [], systemFonts: true, entryPath: '' }
interface StoredConfig { global: TypstConfig; entries: Record<string, string> }
interface DocumentState { public: TypstSession; content: string; version: number; project: Project }
interface Project { owner: number; root: string; process: LspProcess; documents: Map<string, DocumentState>; capabilities: Record<string, unknown>; dead: boolean; config: TypstConfig; exportDir: string }
export interface TypstServiceOptions {
  userData: string
  bundledExecutable: string
  emit: (owner: number, event: TypstEvent) => void
}

function invalid(message: string, code = 'INVALID_ARGUMENT'): never { throw Object.assign(new Error(message), { code }) }
export function localAbsolute(value: unknown): string {
  if (typeof value !== 'string' || !value || !path.isAbsolute(value) || /^[/\\]{2}/.test(value) || value.includes('\0')) invalid('Typst 仅支持本机绝对路径，远端及 UNC 路径尚未支持')
  return path.resolve(value)
}
export function inside(root: string, target: string): boolean {
  const relative = path.relative(root, target)
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative))
}
function contentValid(content: unknown, version: unknown): asserts content is string {
  if (typeof content !== 'string' || Buffer.byteLength(content) > MAX_CONTENT) invalid('Typst 文档超过 4 MiB 限制', 'LIMIT_EXCEEDED')
  if (typeof version !== 'number' || !Number.isSafeInteger(version) || version < 0) invalid('Typst 文档版本无效')
}
function configValid(config: TypstConfig): TypstConfig {
  if (!config || typeof config !== 'object' || typeof config.systemFonts !== 'boolean' || !Array.isArray(config.fontPaths) || config.fontPaths.length > 32) invalid('Typst 配置无效')
  return {
    executablePath: config.executablePath ? localAbsolute(config.executablePath) : '',
    fontPaths: config.fontPaths.map(localAbsolute), systemFonts: config.systemFonts,
    entryPath: config.entryPath ? localAbsolute(config.entryPath) : '',
  }
}

export class TypstService {
  private projects = new Map<string, Promise<Project>>()
  private documents = new Map<string, DocumentState>()
  private config: StoredConfig | null = null
  private configurationGeneration = 0
  private ownerGeneration = new Map<number, number>()
  constructor(private options: TypstServiceOptions) {}
  private async stored(): Promise<StoredConfig> {
    if (this.config) return this.config
    let stored: StoredConfig = { global: { ...DEFAULT_CONFIG }, entries: {} }
    try {
      const data = JSON.parse(await readFile(path.join(this.options.userData, 'typst', 'config.json'), 'utf8')) as StoredConfig
      stored = { global: configValid(data.global), entries: data.entries && typeof data.entries === 'object' ? data.entries : {} }
    } catch { /* Missing or invalid configuration uses safe defaults. */ }
    this.config = stored
    return stored
  }
  async getConfig(filePath?: string): Promise<TypstConfig> {
    const stored = await this.stored()
    return { ...stored.global, fontPaths: [...stored.global.fontPaths], entryPath: filePath ? stored.entries[localAbsolute(filePath)] ?? '' : '' }
  }
  async saveConfig(value: TypstConfig, filePath?: string): Promise<TypstConfig> {
    const config = configValid(value)
    const stored = await this.stored()
    const globalChanged = JSON.stringify(stored.global) !== JSON.stringify({ ...config, entryPath: '' })
    const updated = { global: { ...config, entryPath: '' }, entries: { ...stored.entries } }
    if (filePath) updated.entries[localAbsolute(filePath)] = config.entryPath
    await mkdir(path.join(this.options.userData, 'typst'), { recursive: true })
    await writeFile(path.join(this.options.userData, 'typst', 'config.json'), JSON.stringify(updated, null, 2))
    this.config = updated
    this.configurationGeneration++
    if (globalChanged) this.disposeAll()
    else if (filePath) {
      const absolute = localAbsolute(filePath)
      for (const doc of this.documents.values()) if (doc.public.filePath === absolute) this.disposeOwner(doc.project.owner)
    }
    return this.getConfig(filePath)
  }
  private async executable(): Promise<string> {
    const config = await this.getConfig()
    return config.executablePath || this.options.bundledExecutable
  }
  async status(): Promise<TypstRuntimeStatus> {
    const executablePath = await this.executable()
    if (!existsSync(executablePath)) return { available: false, executablePath, version: null, message: 'Typst 运行时尚未准备，请配置 Tinymist 0.15.8 路径或准备随包资源' }
    try {
      if (!(await this.getConfig()).executablePath) {
        const manifest = JSON.parse(await readFile(path.join(path.dirname(executablePath), 'manifest.json'), 'utf8')) as { version: string; platform: string; arch: string; sha256: string; size: number; executable: string }
        const bytes = await readFile(executablePath)
        if (manifest.version !== TINYMIST_VERSION || manifest.platform !== process.platform || manifest.arch !== process.arch || manifest.executable !== path.basename(executablePath) || bytes.length !== manifest.size || createHash('sha256').update(bytes).digest('hex') !== manifest.sha256) invalid('Typst 随包运行时校验失败', 'VERSION_MISMATCH')
      }
      const { stdout } = await execFileAsync(executablePath, ['--version'], { windowsHide: true, timeout: 5000, maxBuffer: 65536 })
      const version = /(?:tinymist\s+|Build Git Describe:\s*v)(\d+\.\d+\.\d+)/i.exec(stdout)?.[1] ?? null
      return { available: version === TINYMIST_VERSION, executablePath, version, message: version === TINYMIST_VERSION ? 'Typst 运行时已就绪' : `需要 Tinymist ${TINYMIST_VERSION}，当前版本 ${version ?? '未知'}` }
    } catch (error) { return { available: false, executablePath, version: null, message: error instanceof Error ? error.message : '运行时无法启动' } }
  }
  private projectKey(owner: number, root: string): string { return `${owner}:${root}` }
  private emit(project: Project, method: string, params: unknown): void {
    for (const doc of project.documents.values()) {
      if (method === 'textDocument/publishDiagnostics' && (params as { uri?: string } | null)?.uri !== doc.public.uri) continue
      const nativeVersion = method === 'textDocument/publishDiagnostics' ? (params as { version?: unknown } | null)?.version : null
      if (typeof nativeVersion === 'number' && nativeVersion !== doc.version) continue
      // Compile status has no document revision. Never relabel it as the latest buffer.
      this.options.emit(project.owner, { sessionId: doc.public.sessionId, type: 'notification', method, params, version: typeof nativeVersion === 'number' ? nativeVersion : null })
    }
  }
  private lspConfig(project: Pick<Project, 'root' | 'config' | 'exportDir'>): Record<string, unknown> {
    return { rootPath: project.root, fontPaths: project.config.fontPaths, systemFonts: project.config.systemFonts,
      exportPdf: 'never', outputPath: path.join(project.exportDir, '$name'), formatterMode: 'typstyle', compileStatus: 'enable',
      typstExtraArgs: ['--package-path', path.join(this.options.userData, 'typst', 'packages'), '--package-cache-path', path.join(this.options.userData, 'typst', 'package-cache')],
      preview: { background: { enabled: false }, browsing: { enabled: false } } }
  }
  private async createProject(owner: number, root: string, config: TypstConfig): Promise<Project> {
    const generation = this.ownerGeneration.get(owner) ?? 0
    const status = await this.status()
    if (!status.available) invalid(status.message, status.version ? 'VERSION_MISMATCH' : 'FILE_NOT_FOUND')
    const cache = path.join(this.options.userData, 'typst')
    const exportDir = path.join(cache, 'exports', randomUUID())
    await Promise.all([mkdir(exportDir, { recursive: true }), mkdir(path.join(cache, 'packages'), { recursive: true }), mkdir(path.join(cache, 'package-cache'), { recursive: true })])
    const project = { owner, root, config, exportDir, documents: new Map(), capabilities: {}, dead: false } as Project
    project.process = new LspProcess(status.executablePath, ['lsp'], root,
      (method, params) => this.emit(project, method, params),
      message => {
        project.dead = true
        for (const doc of project.documents.values()) this.options.emit(owner, { sessionId: doc.public.sessionId, type: 'exit', message })
      }, () => this.lspConfig(project))
    try {
      const initialized = await project.process.request('initialize', {
        processId: process.pid, rootUri: pathToFileURL(root).href, workspaceFolders: [{ uri: pathToFileURL(root).href, name: path.basename(root) }],
        capabilities: { general: { positionEncodings: ['utf-16'] }, textDocument: { publishDiagnostics: { versionSupport: true }, completion: { completionItem: { snippetSupport: true, insertReplaceSupport: true } } }, workspace: { configuration: true } },
        initializationOptions: this.lspConfig(project), clientInfo: { name: 'Montree', version: '1' },
      }) as { capabilities?: Record<string, unknown> }
      project.capabilities = initialized.capabilities ?? {}
      if (project.capabilities.positionEncoding && project.capabilities.positionEncoding !== 'utf-16') invalid('Tinymist 未协商 UTF-16 位置编码', 'PROTOCOL_ERROR')
      project.process.notify('initialized', {})
      if ((this.ownerGeneration.get(owner) ?? 0) !== generation) invalid('窗口已关闭', 'CANCELLED')
      return project
    } catch (error) { project.process.kill(); throw error }
  }
  async open(owner: number, payload: TypstOpenPayload): Promise<TypstSession> {
    const generation = this.ownerGeneration.get(owner) ?? 0
    const configGeneration = this.configurationGeneration
    const assertActive = () => { if ((this.ownerGeneration.get(owner) ?? 0) !== generation || this.configurationGeneration !== configGeneration) invalid('窗口或 Typst 会话配置已变化', 'CANCELLED') }
    if (!payload) invalid('缺少 Typst 文档参数')
    contentValid(payload.content, payload.version)
    const filePath = localAbsolute(await realpath(localAbsolute(payload.filePath)))
    if (path.extname(filePath).toLowerCase() !== '.typ' || !(await stat(filePath)).isFile()) invalid('请先保存为本机 .typ 文件')
    const root = localAbsolute(await realpath(localAbsolute(payload.rootPath || path.dirname(filePath))))
    if (!inside(root, filePath)) invalid('Typst 文件不在项目根目录中', 'FORBIDDEN')
    const config = await this.getConfig(filePath)
    const entryPath = config.entryPath ? localAbsolute(await realpath(config.entryPath)) : filePath
    if (!inside(root, entryPath) || path.extname(entryPath).toLowerCase() !== '.typ') invalid('Typst 入口必须是项目内 .typ 文件', 'FORBIDDEN')
    assertActive()
    const key = this.projectKey(owner, root)
    let pending = this.projects.get(key)
    if (pending && (await pending).dead) { this.projects.delete(key); pending = undefined }
    if (!pending) {
      pending = this.createProject(owner, root, config)
      this.projects.set(key, pending)
      void pending.catch(() => { if (this.projects.get(key) === pending) this.projects.delete(key) })
    }
    const project = await pending
    assertActive()
    const uri = pathToFileURL(filePath).href
    for (const existing of project.documents.values()) if (existing.public.uri === uri) invalid('此 Typst 文档已有打开的会话', 'INVALID_STATE')
    const sessionId = randomUUID()
    const session: TypstSession = { sessionId, uri, filePath, rootPath: root, capabilities: project.capabilities, previewUrl: null }
    const doc: DocumentState = { public: session, content: payload.content, version: payload.version, project }
    project.documents.set(sessionId, doc); this.documents.set(sessionId, doc)
    try {
      project.process.notify('textDocument/didOpen', { textDocument: { uri, languageId: 'typst', version: payload.version, text: payload.content } })
      const preview = await project.process.request('workspace/executeCommand', { command: 'tinymist.doStartPreview', arguments: [[entryPath, '--task-id', sessionId, '--data-plane-host=127.0.0.1:0', '--control-plane-host=127.0.0.1:0', '--no-open', ...(project.documents.size > 1 ? ['--not-primary'] : [])]] }) as { staticServerPort?: number }
      if (Number.isInteger(preview.staticServerPort) && preview.staticServerPort! > 0 && preview.staticServerPort! < 65536) session.previewUrl = `http://127.0.0.1:${preview.staticServerPort}`
      else session.previewError = 'Tinymist 未返回有效预览端口'
    } catch (error) { session.previewError = error instanceof Error ? error.message : '预览启动失败' }
    assertActive()
    return { ...session }
  }
  private owned(owner: number, sessionId: string): DocumentState {
    const doc = this.documents.get(sessionId)
    if (!doc || doc.project.owner !== owner) invalid('Typst 会话不属于当前窗口或已关闭', 'FORBIDDEN')
    if (doc.project.dead) invalid('Typst 运行时已退出，请重新连接', 'CONNECTION_ERROR')
    return doc
  }
  async sync(owner: number, payload: TypstSyncPayload): Promise<void> {
    contentValid(payload?.content, payload?.version)
    const doc = this.owned(owner, payload.sessionId)
    if (payload.version <= doc.version) invalid('拒绝过期的 Typst 文档版本', 'REVISION_CONFLICT')
    doc.project.process.notify('textDocument/didChange', { textDocument: { uri: doc.public.uri, version: payload.version }, contentChanges: [{ text: payload.content }] })
    doc.version = payload.version; doc.content = payload.content
  }
  async request(owner: number, payload: TypstRequestPayload): Promise<unknown> {
    const doc = this.owned(owner, payload?.sessionId)
    if (!METHODS.has(payload.method)) invalid('不允许调用此 Typst 方法', 'FORBIDDEN')
    if (JSON.stringify(payload.params)?.length > 256 * 1024) invalid('语言请求过大', 'LIMIT_EXCEEDED')
    const params = payload.params as { textDocument?: { uri?: string } } | null
    if (payload.method !== 'completionItem/resolve' && params?.textDocument?.uri !== doc.public.uri) invalid('语言请求必须绑定当前文档 URI', 'FORBIDDEN')
    if (payload.version !== undefined && payload.version !== doc.version) invalid('Typst 请求版本已过期', 'REVISION_CONFLICT')
    const version = doc.version
    const response = await doc.project.process.request(payload.method, payload.params)
    if (doc.version !== version) invalid('Typst 响应版本已过期', 'REVISION_CONFLICT')
    return response
  }
  async pdf(owner: number, sessionId: string, version: number): Promise<Buffer> {
    const doc = this.owned(owner, sessionId)
    if (doc.version !== version) invalid('文档已变化，请重新导出', 'REVISION_CONFLICT')
    const revisions = new Map([...doc.project.documents].map(([id, state]) => [id, state.version]))
    const entry = (await this.getConfig(doc.public.filePath)).entryPath || doc.public.filePath
    const response = await doc.project.process.request('workspace/executeCommand', { command: 'tinymist.exportPdf', arguments: [entry, {}, { write: false, open: false }] })
    if (doc.project.dead || revisions.size !== doc.project.documents.size || [...revisions].some(([id, revision]) => doc.project.documents.get(id)?.version !== revision)) invalid('导出期间项目文档已变化，请重新导出', 'REVISION_CONFLICT')
    // Tinymist 0.15.8 returns base64 data when write=false.
    if (response && typeof response === 'object' && typeof (response as { data?: unknown }).data === 'string') {
      const bytes = Buffer.from((response as { data: string }).data, 'base64')
      if (bytes.subarray(0, 5).toString() === '%PDF-') return bytes
    }
    invalid('Tinymist 未返回有效 PDF，文档可能包含编译错误', 'PROTOCOL_ERROR')
  }
  async close(owner: number, sessionId: string): Promise<void> {
    const doc = this.documents.get(sessionId)
    if (!doc) return
    if (doc.project.owner !== owner) invalid('Typst 会话不属于当前窗口', 'FORBIDDEN')
    this.documents.delete(sessionId); doc.project.documents.delete(sessionId)
    if (!doc.project.dead) {
      doc.project.process.notify('textDocument/didClose', { textDocument: { uri: doc.public.uri } })
      await doc.project.process.request('workspace/executeCommand', { command: 'tinymist.doKillPreview', arguments: [sessionId] }).catch(() => {})
    }
    if (!doc.project.documents.size) {
      const key = this.projectKey(owner, doc.project.root)
      const pending = this.projects.get(key)
      if (pending && await pending === doc.project && !doc.project.documents.size) {
        this.projects.delete(key)
        await doc.project.process.close()
        await rm(doc.project.exportDir, { recursive: true, force: true }).catch(() => {})
      }
    }
  }
  disposeOwner(owner: number): void {
    this.ownerGeneration.set(owner, (this.ownerGeneration.get(owner) ?? 0) + 1)
    for (const [key, pending] of this.projects) if (key.startsWith(`${owner}:`)) {
      this.projects.delete(key)
      void pending.then(project => { project.process.kill(); void rm(project.exportDir, { recursive: true, force: true }).catch(() => {}) }).catch(() => {})
    }
    for (const [id, doc] of this.documents) if (doc.project.owner === owner) this.documents.delete(id)
  }
  disposeAll(): void {
    const owners = new Set([...this.documents.values()].map(doc => doc.project.owner))
    for (const key of this.projects.keys()) owners.add(Number(key.slice(0, key.indexOf(':'))))
    for (const owner of owners) this.disposeOwner(owner)
  }
}
