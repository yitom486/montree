export class McpDiscoveryTimeoutError extends Error {}

/** Broker observations only: a discovered catalog is not proof of model-side availability. */
export class McpConnectionHealth {
  private clients = new Set<object>()
  private listeners = new Set<() => void>()
  discoveries = 0
  disconnects = 0
  lastDiscoveredAt: string | null = null
  get activeClients(): number { return this.clients.size }

  discovered(client: object): void {
    this.clients.add(client)
    ++this.discoveries
    this.lastDiscoveredAt = new Date().toISOString()
    for (const listener of this.listeners) listener()
  }

  closed(client: object): void {
    if (this.clients.delete(client)) ++this.disconnects
  }

  needsRecovery(since: number): boolean { return this.disconnects > since }
  get hasDiscoveredClient(): boolean { return this.clients.size > 0 }

  waitForDiscovery(after: number, signal: AbortSignal, timeoutMs = 10_000): Promise<void> {
    return new Promise((resolve, reject) => {
      const cleanup = () => {
        clearTimeout(timer)
        this.listeners.delete(check)
        signal.removeEventListener('abort', abort)
      }
      const abort = () => { cleanup(); reject(new Error('MCP 恢复已取消')) }
      const check = () => {
        if (this.discoveries <= after || this.clients.size === 0) return
        cleanup()
        resolve()
      }
      const timer = setTimeout(() => {
        cleanup()
        reject(new McpDiscoveryTimeoutError('未收到 Agent 重新发现 Montree 工具的请求，请重新连接 Agent'))
      }, timeoutMs)
      this.listeners.add(check)
      signal.addEventListener('abort', abort, { once: true })
      if (signal.aborted) abort()
      else check()
    })
  }
}
