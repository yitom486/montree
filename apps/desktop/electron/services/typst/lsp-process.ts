import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'

export const MAX_LSP_BYTES = 16 * 1024 * 1024

/** Content-Length counts UTF-8 bytes, not JavaScript UTF-16 code units. */
export class LspFramer {
  private buffer = Buffer.alloc(0)
  push(chunk: Buffer): Record<string, unknown>[] {
    this.buffer = Buffer.concat([this.buffer, chunk])
    const messages: Record<string, unknown>[] = []
    for (;;) {
      const end = this.buffer.indexOf('\r\n\r\n')
      if (end < 0) {
        if (this.buffer.length > 8192) throw new Error('LSP header exceeds limit')
        break
      }
      const header = this.buffer.subarray(0, end).toString('ascii')
      const match = /^Content-Length:\s*(\d+)\s*$/im.exec(header)
      if (!match || end > 8192) throw new Error('Invalid LSP Content-Length')
      const length = Number(match[1])
      if (!Number.isSafeInteger(length) || length > MAX_LSP_BYTES) throw new Error('LSP message exceeds limit')
      if (this.buffer.length < end + 4 + length) break
      const message: unknown = JSON.parse(this.buffer.subarray(end + 4, end + 4 + length).toString('utf8'))
      if (!message || typeof message !== 'object' || Array.isArray(message)) throw new Error('Invalid LSP message')
      messages.push(message as Record<string, unknown>)
      this.buffer = this.buffer.subarray(end + 4 + length)
    }
    return messages
  }
}

export class LspProcess {
  readonly child: ChildProcessWithoutNullStreams
  private nextId = 1
  private dead = false
  private pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void; timer: ReturnType<typeof setTimeout> }>()
  private framer = new LspFramer()
  constructor(executable: string, args: string[], cwd: string,
    private notification: (method: string, params: unknown) => void,
    private exited: (message: string) => void,
    private configuration: () => unknown) {
    this.child = spawn(executable, args, { cwd, windowsHide: true, shell: false, stdio: ['pipe', 'pipe', 'pipe'] })
    this.child.stdout.on('data', (chunk: Buffer) => {
      try { for (const message of this.framer.push(chunk)) this.receive(message) }
      catch (e) { this.fail(e instanceof Error ? e.message : 'Invalid Tinymist protocol'); this.child.kill() }
    })
    // Always drain stderr. Source and project paths are not copied into application logs.
    this.child.stderr.on('data', () => {})
    this.child.stdin.on('error', () => this.fail('Tinymist input closed'))
    this.child.on('error', e => this.fail(e.message))
    this.child.on('exit', (code, signal) => this.fail(`Tinymist exited (${code ?? signal})`))
  }
  private write(message: unknown): void {
    if (this.dead) throw new Error('Tinymist is not running')
    const body = Buffer.from(JSON.stringify(message))
    if (body.length > MAX_LSP_BYTES) throw new Error('LSP message exceeds limit')
    this.child.stdin.write(Buffer.concat([Buffer.from(`Content-Length: ${body.length}\r\n\r\n`), body]))
  }
  notify(method: string, params?: unknown): void { this.write({ jsonrpc: '2.0', method, params }) }
  request(method: string, params?: unknown, timeout = 30000): Promise<unknown> {
    if (this.pending.size >= 64) return Promise.reject(new Error('Too many pending Tinymist requests'))
    const id = this.nextId++
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        try { this.notify('$/cancelRequest', { id }) } catch { /* Process may have exited. */ }
        reject(new Error(`Tinymist request timed out: ${method}`))
      }, timeout)
      this.pending.set(id, { resolve, reject, timer })
      try { this.write({ jsonrpc: '2.0', id, method, params }) }
      catch (e) { clearTimeout(timer); this.pending.delete(id); reject(e) }
    })
  }
  private receive(message: Record<string, unknown>): void {
    if (typeof message.method === 'string') {
      if ('id' in message) {
        let result: unknown = null
        if (message.method === 'workspace/configuration') {
          const items = (message.params as { items?: unknown[] } | undefined)?.items ?? []
          result = items.map(() => this.configuration())
        }
        if (message.method === 'workspace/applyEdit') result = { applied: false, failureReason: 'Montree does not accept unsolicited workspace edits' }
        if (message.method === 'window/showDocument') result = { success: false }
        this.write({ jsonrpc: '2.0', id: message.id, result })
      } else this.notification(message.method, message.params)
    } else if (typeof message.id === 'number') {
      const waiter = this.pending.get(message.id)
      if (!waiter) return
      clearTimeout(waiter.timer); this.pending.delete(message.id)
      if (message.error) waiter.reject(new Error(JSON.stringify(message.error)))
      else waiter.resolve(message.result)
    }
  }
  private fail(message: string): void {
    if (this.dead) return
    this.dead = true
    for (const waiter of this.pending.values()) { clearTimeout(waiter.timer); waiter.reject(new Error(message)) }
    this.pending.clear(); this.exited(message)
  }
  async close(): Promise<void> {
    if (this.dead) return
    try { await this.request('shutdown', null, 1000); this.notify('exit') } catch { /* Force cleanup below. */ }
    this.child.kill()
    this.fail('Tinymist session closed')
  }
  kill(): void { this.child.kill(); this.fail('Tinymist session closed') }
}
