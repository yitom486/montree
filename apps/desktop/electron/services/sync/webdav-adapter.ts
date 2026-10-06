import { err, ok, type Result } from '@montree/contracts'
import { toAppError, type AppError } from '@montree/contracts'
import type { ISyncStorageAdapter, StatResult } from './storage-adapter'

export interface WebDavAdapterOptions {
  serverUrl: string
  username: string
  password: string
  ignoreTlsErrors?: boolean
  /** 单次请求超时毫秒，默认 15000（黑洞网络不再无限挂起） */
  timeoutMs?: number
  /** 失败重试次数（不含首次），默认 2；仅重试网络异常与 408/429/5xx */
  maxRetries?: number
  /** 重试基础延迟毫秒（指数退避：base * 2^attempt），默认 500 */
  retryBaseDelayMs?: number
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/** 幂等重试白名单：本适配器所有写操作均为全量覆盖（PUT/MKCOL），可安全重试 */
function isRetryableStatus(status: number): boolean {
  return status === 408 || status === 429 || (status >= 500 && status < 600)
}

function isTimeoutCause(cause: unknown): boolean {
  return cause instanceof Error && (cause.name === 'TimeoutError' || cause.name === 'AbortError')
}

export class WebDavStorageAdapter implements ISyncStorageAdapter {
  readonly id = 'webdav'
  readonly name = 'WebDAV'

  private readonly baseUrl: string
  private readonly authHeader: string
  private readonly ignoreTlsErrors: boolean
  private readonly timeoutMs: number
  private readonly maxRetries: number
  private readonly retryBaseDelayMs: number

  constructor(options: WebDavAdapterOptions) {
    let url = options.serverUrl.trim()
    if (!url.endsWith('/')) {
      url += '/'
    }
    this.baseUrl = url
    this.authHeader = `Basic ${Buffer.from(`${options.username}:${options.password}`).toString('base64')}`
    this.ignoreTlsErrors = Boolean(options.ignoreTlsErrors)
    this.timeoutMs = options.timeoutMs ?? 15000
    this.maxRetries = options.maxRetries ?? 2
    this.retryBaseDelayMs = options.retryBaseDelayMs ?? 500
  }

  private resolveUrl(pathOrUrl: string): string {
    const trimmed = pathOrUrl.trim()
    if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) {
      return trimmed
    }
    const relative = trimmed.replace(/^\/+/, '')
    return new URL(relative, this.baseUrl).toString()
  }

  private async request(
    urlStr: string,
    init: RequestInit,
  ): Promise<Response> {
    const targetUrl = this.resolveUrl(urlStr)
    const headers = new Headers(init.headers)
    headers.set('Authorization', this.authHeader)

    let lastCause: unknown = null
    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      // 若需要忽略自签名证书（逐次恢复，避免污染后续请求）
      const prevTls = process.env.NODE_TLS_REJECT_UNAUTHORIZED
      if (this.ignoreTlsErrors) {
        process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0'
      }

      try {
        const response = await fetch(targetUrl, {
          ...init,
          headers,
          signal: AbortSignal.timeout(this.timeoutMs),
        })
        if (attempt < this.maxRetries && isRetryableStatus(response.status)) {
          lastCause = new Error(`WebDAV 临时失败（HTTP ${response.status}），正在重试`)
          await response.arrayBuffer().catch(() => undefined)
        } else {
          return response
        }
      } catch (cause) {
        lastCause = cause
        if (attempt >= this.maxRetries) break
      } finally {
        if (this.ignoreTlsErrors) {
          process.env.NODE_TLS_REJECT_UNAUTHORIZED = prevTls ?? '1'
        }
      }

      await sleep(this.retryBaseDelayMs * 2 ** attempt)
    }

    if (isTimeoutCause(lastCause)) {
      throw new Error(`WebDAV 请求超时（单次 ${this.timeoutMs}ms，已重试 ${this.maxRetries} 次），请检查网络后重试`)
    }
    throw lastCause
  }

  async testConnection(): Promise<Result<{ latencyMs: number }, AppError>> {
    const start = Date.now()
    try {
      // 对 baseUrl 发送 PROPFIND，Depth: 0
      const res = await this.request(this.baseUrl, {
        method: 'PROPFIND',
        headers: { Depth: '0' },
      })

      if (res.status === 401) {
        return err({ code: 'UNAUTHORIZED', message: 'WebDAV 账号或密码错误（401）' })
      }
      if (res.status === 403) {
        return err({ code: 'FORBIDDEN', message: 'WebDAV 访问被拒绝（403），若使用坚果云请确保使用专用应用密码' })
      }
      if (res.status >= 200 && res.status < 300) {
        return ok({ latencyMs: Date.now() - start })
      }

      return err({
        code: 'NETWORK_ERROR',
        message: `WebDAV 服务器返回异常状态码：${res.status} ${res.statusText}`,
      })
    } catch (cause) {
      return err(toAppError(cause, '连接 WebDAV 服务器失败，请检查网络与地址'))
    }
  }

  async ensureDir(remoteDir: string): Promise<Result<void, AppError>> {
    const normalized = remoteDir.trim().replace(/^\/+|\/+$/g, '')
    if (!normalized) return ok(undefined)

    const segments = normalized.split('/').filter(Boolean)
    let currentPath = ''

    for (const seg of segments) {
      currentPath += `${seg}/`
      const dirUrl = this.resolveUrl(currentPath)

      try {
        const checkRes = await this.request(dirUrl, {
          method: 'PROPFIND',
          headers: { Depth: '0' },
        })

        if (checkRes.status >= 200 && checkRes.status < 300) {
          continue
        }
        if (checkRes.status === 207) {
          continue
        }

        // 404 说明目录不存在，创建该目录
        if (checkRes.status === 404) {
          const mkcolRes = await this.request(dirUrl, {
            method: 'MKCOL',
          })
          if (
            (mkcolRes.status >= 200 && mkcolRes.status < 300) ||
            mkcolRes.status === 405 // 已存在
          ) {
            continue
          }
          return err({
            code: 'FILE_WRITE_ERROR',
            message: `创建远程目录失败 (${seg}): HTTP ${mkcolRes.status}`,
          })
        }
      } catch (cause) {
        return err(toAppError(cause, `检查或创建远程目录失败: ${seg}`))
      }
    }

    return ok(undefined)
  }

  async downloadFile(remotePath: string): Promise<Result<string, AppError>> {
    try {
      const res = await this.request(remotePath, {
        method: 'GET',
      })

      if (res.status === 404) {
        return err({ code: 'FILE_NOT_FOUND', message: '远程文件不存在' })
      }
      if (!res.ok) {
        return err({
          code: 'FILE_READ_ERROR',
          message: `下载远程文件失败：HTTP ${res.status} ${res.statusText}`,
        })
      }

      const text = await res.text()
      return ok(text)
    } catch (cause) {
      return err(toAppError(cause, '下载远程文件异常'))
    }
  }

  async uploadFile(remotePath: string, content: string): Promise<Result<void, AppError>> {
    try {
      const res = await this.request(remotePath, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json; charset=utf-8',
        },
        body: content,
      })

      if (res.status >= 200 && res.status < 300) {
        return ok(undefined)
      }

      return err({
        code: 'FILE_WRITE_ERROR',
        message: `上传文件到远程失败：HTTP ${res.status} ${res.statusText}`,
      })
    } catch (cause) {
      return err(toAppError(cause, '上传文件至 WebDAV 异常'))
    }
  }

  async statFile(remotePath: string): Promise<Result<StatResult, AppError>> {
    try {
      const res = await this.request(remotePath, {
        method: 'PROPFIND',
        headers: { Depth: '0' },
      })

      if (res.status === 404) {
        return ok({ exists: false })
      }

      if (res.status === 200 || res.status === 207) {
        const xml = await res.text()
        const mtimeMatch = /<[a-zA-Z0-9:]*getlastmodified[^>]*>([^<]+)<\//i.exec(xml)
        let mtime: number | undefined
        if (mtimeMatch && mtimeMatch[1]) {
          const parsed = Date.parse(mtimeMatch[1].trim())
          if (!Number.isNaN(parsed)) {
            mtime = parsed
          }
        }
        return ok({
          exists: true,
          mtime,
        })
      }

      return err({
        code: 'FILE_READ_ERROR',
        message: `查询远程文件状态失败：HTTP ${res.status}`,
      })
    } catch (cause) {
      return err(toAppError(cause, '查询 WebDAV 文件状态失败'))
    }
  }
}
