import type { Result, AppError, TypstEvent, TypstOpenPayload, TypstSession, TypstSyncPayload, TypstRequestPayload, TypstExportPayload, TypstExportResult } from '@yitom/contracts'
import type { TypstDiagnostic } from './typst-lsp'

export interface TypstSessionPort {
  open(payload: TypstOpenPayload): Promise<Result<TypstSession, AppError>>
  sync(payload: TypstSyncPayload): Promise<Result<void, AppError>>
  request(payload: TypstRequestPayload): Promise<Result<unknown, AppError>>
  close(sessionId: string): Promise<Result<void, AppError>>
  exportPdf(payload: TypstExportPayload): Promise<Result<TypstExportResult, AppError>>
  exportHtml(payload: TypstExportPayload): Promise<Result<TypstExportResult, AppError>>
  onEvent(callback: (event: TypstEvent) => void): () => void
}
export interface TypstSessionState {
  phase: 'starting' | 'ready' | 'syncing' | 'error'
  session: TypstSession | null
  message: string | null
  diagnostics: TypstDiagnostic[]
  version: number
  compileStatus: 'compiling' | 'compileSuccess' | 'compileError' | null
  diagnosticsUnversioned: boolean
  recoverableExit: boolean
}

/** Owns one document lifetime; all requests wait for its current unsaved buffer. */
export class TypstSessionController {
  private session: TypstSession | null = null
  private content: string
  private version = 1
  private syncedVersion = 0
  private disposed = false
  private failed = false
  private queue: Promise<void> = Promise.resolve()
  private timer?: ReturnType<typeof setTimeout>
  private unsubscribe?: () => void
  private phase: TypstSessionState['phase'] = 'starting'
  private diagnostics: TypstDiagnostic[] = []
  private message: string | null = null
  private compileStatus: TypstSessionState['compileStatus'] = null
  private diagnosticsUnversioned = false
  private recoverableExit = false

  constructor(private readonly port: TypstSessionPort, private readonly payload: Omit<TypstOpenPayload, 'version'>,
    private readonly changed: (state: TypstSessionState) => void) { this.content = payload.content }

  private publish() {
    if (!this.disposed) this.changed({ phase: this.phase, session: this.session, message: this.message, diagnostics: this.diagnostics, version: this.version,
      compileStatus: this.compileStatus, diagnosticsUnversioned: this.diagnosticsUnversioned, recoverableExit: this.recoverableExit })
  }
  private fail(error: unknown, recoverableExit = false) {
    this.failed = true; clearTimeout(this.timer)
    this.recoverableExit = recoverableExit
    this.phase = 'error'; this.message = error instanceof Error ? error.message : String(error); this.publish()
  }
  async start(): Promise<void> {
    const earlyEvents: TypstEvent[] = []
    const handleEvent = (event: TypstEvent) => {
      if (this.disposed || !this.session || event.sessionId !== this.session.sessionId) return
      if (event.type === 'exit') { this.fail(new Error(event.message), true); return }
      if (event.method === 'tinymist/compileStatus') {
        const params = event.params as { status?: unknown }
        if (params.status === 'compiling' || params.status === 'compileSuccess' || params.status === 'compileError') {
          // Native compile notifications carry no revision. Describe only the last reported compile.
          this.compileStatus = params.status; this.publish()
        }
      }
      if (event.method === 'textDocument/publishDiagnostics' &&
        (event.version === this.version || (event.version === null && this.syncedVersion === this.version))) {
        const params = event.params as { uri?: string; diagnostics?: TypstDiagnostic[]; version?: number }
        if (params.uri !== this.session.uri || (params.version !== undefined && params.version !== this.version)) return
        this.diagnosticsUnversioned = event.version === null
        this.diagnostics = Array.isArray(params.diagnostics) ? params.diagnostics : []; this.publish()
      }
    }
    try {
      this.unsubscribe = this.port.onEvent((event) => {
        if (!this.session) { if (earlyEvents.length < 100) earlyEvents.push(event); return }
        handleEvent(event)
      })
      const content = this.content, version = this.version
      const result = await this.port.open({ ...this.payload, content, version })
      if (!result.ok) throw new Error(result.error.message)
      if (this.disposed) { await this.port.close(result.value.sessionId); return }
      this.session = result.value; this.syncedVersion = version; this.phase = 'ready'; this.publish()
      for (const event of earlyEvents) handleEvent(event)
      await this.flush()
    } catch (error) { this.fail(error) }
  }
  updateContent(content: string): void {
    if (content === this.content || this.disposed) return
    this.content = content; this.version++; this.diagnostics = []; this.compileStatus = null; this.diagnosticsUnversioned = false
    if (this.session && this.phase !== 'error') this.phase = 'syncing'
    this.publish()
    clearTimeout(this.timer)
    this.timer = setTimeout(() => { void this.flush().catch((error) => this.fail(error)) }, 120)
  }
  async flush(): Promise<void> {
    clearTimeout(this.timer)
    const sync = async () => {
      if (this.disposed || this.failed || !this.session || this.syncedVersion === this.version) return
      const session = this.session, content = this.content, version = this.version
      const result = await this.port.sync({ sessionId: session.sessionId, content, version })
      if (!result.ok) throw new Error(result.error.message)
      if (this.disposed || this.failed) return
      this.syncedVersion = version
      this.phase = this.version === version ? 'ready' : 'syncing'; this.message = null; this.publish()
    }
    const next = this.queue.then(sync)
    this.queue = next.catch((error) => this.fail(error))
    await next
  }
  async request(method: TypstRequestPayload['method'], params: unknown): Promise<unknown> {
    const version = this.version
    await this.flush()
    if (this.disposed || !this.session || this.phase === 'error' || version !== this.version) return null
    const sessionId = this.session.sessionId
    const result = await this.port.request({ sessionId, method, params, version })
    if (this.disposed || this.failed || version !== this.version || sessionId !== this.session?.sessionId) return null
    if (!result.ok) {
      if (result.error.code === 'CANCELLED') return null
      throw new Error(result.error.message)
    }
    return result.value
  }
  async exportPdf(): Promise<TypstExportResult | null> {
    return this.exportDocument('pdf')
  }
  async exportHtml(): Promise<TypstExportResult | null> {
    return this.exportDocument('html')
  }
  private async exportDocument(kind: 'pdf' | 'html'): Promise<TypstExportResult | null> {
    const version = this.version
    await this.flush()
    if (this.failed) throw new Error(this.message ?? 'Typst 服务已退出，请重启服务')
    if (this.disposed || !this.session || version !== this.version) throw new Error('文档已更新，请重新导出')
    const result = kind === 'pdf'
      ? await this.port.exportPdf({ sessionId: this.session.sessionId, version })
      : await this.port.exportHtml({ sessionId: this.session.sessionId, version })
    if (this.disposed || this.failed) return null
    if (!result.ok) {
      if (result.error.code === 'CANCELLED') return null
      throw new Error(result.error.message)
    }
    return result.value
  }
  dispose(): Promise<void> {
    this.disposed = true; clearTimeout(this.timer); this.unsubscribe?.()
    return this.session ? this.port.close(this.session.sessionId).then(() => {}, () => {}) : Promise.resolve()
  }
}
