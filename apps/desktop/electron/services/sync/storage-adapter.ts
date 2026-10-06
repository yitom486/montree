import type { AppError } from '@montree/contracts'
import type { Result } from '@montree/contracts'

export interface StatResult {
  exists: boolean
  mtime?: number
  etag?: string
  size?: number
}

export interface ISyncStorageAdapter {
  readonly id: string
  readonly name: string

  /** 测试连接与鉴权（返回网络耗时毫秒数） */
  testConnection(): Promise<Result<{ latencyMs: number }, AppError>>

  /** 确保远程目录存在（按层级自动 MKCOL） */
  ensureDir(remoteDir: string): Promise<Result<void, AppError>>

  /** 下载远程文件内容为 UTF-8 文本 */
  downloadFile(remotePath: string): Promise<Result<string, AppError>>

  /** 上传 UTF-8 文本文件内容到远程 */
  uploadFile(remotePath: string, content: string): Promise<Result<void, AppError>>

  /** 获取远程文件状态（是否存在、修改时间戳、大小） */
  statFile(remotePath: string): Promise<Result<StatResult, AppError>>
}
