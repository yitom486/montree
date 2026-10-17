/**
 * 远端服务连接管理（main）：连接归属调用窗口（event.sender），代际隔离，
 * 窗口销毁时回收其全部连接；只清理本连接启动的进程，不全局 pkill。
 */
import { randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import { delimiter, join } from 'node:path'
import {
  err,
  ok,
  type AppError,
  type RemoteServerConnectPayload,
  type RemoteServerConnectionInfo,
  type RemoteServerInvokePayload,
  type Result,
  type WorkspaceMethod,
} from '@yitom/contracts'
import { RemoteServerPipeClient } from './remote-server-client'
import {
  resolveRemoteServerBundlePath,
  verifyRemoteServerManifest,
} from './remote-server-paths'

interface ManagedConnection {
  id: string
  ownerSenderId: number
  root: string
  generation: string
  client: RemoteServerPipeClient
}

/** 在 PATH 中定位可用的 Node（远端服务要求 Node 22+，Bun 不可替代运行）。 */
export function resolveNodeExecutable(): Result<string, AppError> {
  const suffix = process.platform === 'win32' ? '.exe' : ''
  const pathEnv = process.env['PATH'] ?? ''
  for (const dir of pathEnv.split(delimiter)) {
    if (!dir) continue
    const candidate = join(dir, `node${suffix}`)
    if (existsSync(candidate)) return ok(candidate)
  }
  return err({
    code: 'CONNECTION_ERROR',
    message: '未找到可用的 Node（要求 Node 22+，参见 nodejs.org 安装说明；不自动 sudo/下载）',
  })
}

class RemoteServerHostManager {
  private readonly connections = new Map<string, ManagedConnection>()

  async connect(ownerSenderId: number, payload: RemoteServerConnectPayload): Promise<Result<RemoteServerConnectionInfo, AppError>> {
    if (!payload || typeof payload.root !== 'string' || !payload.root.trim()) {
      return err({ code: 'INVALID_ARGUMENT', message: '缺少托管根目录' })
    }
    const manifest = verifyRemoteServerManifest()
    if (!manifest.ok) return manifest
    const node = resolveNodeExecutable()
    if (!node.ok) return node
    const session = `sess-${randomUUID()}`
    const generation = `gen-${randomUUID()}`
    const launched = await RemoteServerPipeClient.launch({
      nodePath: node.value,
      serverPath: resolveRemoteServerBundlePath(),
      root: payload.root,
      session,
      generation,
      buildId: manifest.value.buildId,
      expectedPlatform: payload.expectedPlatform,
      timeoutMs: payload.timeoutMs,
      onWatchEvent: () => {
        // A2：watch 事件落盘与转发由 B3 接入渲染订阅；此处仅保持连接存活
      },
    })
    if (!launched.ok) return launched
    const id = `conn-${randomUUID()}`
    this.connections.set(id, {
      id,
      ownerSenderId,
      root: payload.root,
      generation,
      client: launched.value,
    })
    return ok(this.describe(id))
  }

  invoke(ownerSenderId: number, payload: RemoteServerInvokePayload): Promise<Result<unknown, AppError>> {
    const connection = this.connections.get(payload?.connectionId)
    if (!connection || connection.ownerSenderId !== ownerSenderId) {
      return Promise.resolve(err({ code: 'FORBIDDEN', message: '连接不存在或不归属当前窗口' }))
    }
    return connection.client.invoke(payload.method as WorkspaceMethod, payload.params, payload.timeoutMs)
  }

  status(ownerSenderId: number, connectionId: string): Result<RemoteServerConnectionInfo, AppError> {
    const connection = this.connections.get(connectionId)
    if (!connection || connection.ownerSenderId !== ownerSenderId) {
      return err({ code: 'FORBIDDEN', message: '连接不存在或不归属当前窗口' })
    }
    return ok(this.describe(connectionId))
  }

  disconnect(ownerSenderId: number, connectionId: string): Result<void, AppError> {
    const connection = this.connections.get(connectionId)
    if (!connection || connection.ownerSenderId !== ownerSenderId) {
      return err({ code: 'FORBIDDEN', message: '连接不存在或不归属当前窗口' })
    }
    this.connections.delete(connectionId)
    connection.client.close()
    return ok(undefined)
  }

  /** 窗口销毁时回收其全部连接（租约结束即结束会话与监听）。 */
  releaseSender(ownerSenderId: number): void {
    for (const [id, connection] of this.connections) {
      if (connection.ownerSenderId === ownerSenderId) {
        this.connections.delete(id)
        connection.client.close()
      }
    }
  }

  private describe(connectionId: string): RemoteServerConnectionInfo {
    const connection = this.connections.get(connectionId) as ManagedConnection
    return {
      connectionId,
      root: connection.root,
      state: connection.client.connectionState,
      handshake: connection.client.handshake,
      generation: connection.generation,
    }
  }
}

export const remoteServerHosts = new RemoteServerHostManager()
