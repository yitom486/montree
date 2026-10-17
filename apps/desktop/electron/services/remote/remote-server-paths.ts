import { existsSync, readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { join } from 'node:path'
import { app } from 'electron'
import {
  err,
  ok,
  WORKSPACE_PROTOCOL_MAJOR,
  type AppError,
  type Result,
  type WorkspaceServerManifest,
} from '@yitom/contracts'

/** 远端服务产物目录：打包后为 resources/remote-server，开发期为仓库资源目录 */
export function resolveRemoteServerDir(): string {
  if (app.isPackaged) return join(process.resourcesPath, 'remote-server')
  return join(process.cwd(), 'apps', 'desktop', 'resources', 'remote-server')
}

export function resolveRemoteServerBundlePath(): string {
  return join(resolveRemoteServerDir(), 'montree-remote-server.cjs')
}

export function resolveRemoteServerManifestPath(): string {
  return join(resolveRemoteServerDir(), 'manifest.json')
}

/**
 * 启动前校验 manifest：产物存在、协议主版本一致、文件 sha256 与尺寸一致。
 * 失败一律拒绝启动，不留下“已安装”假状态。
 */
export function verifyRemoteServerManifest(): Result<WorkspaceServerManifest, AppError> {
  const manifestPath = resolveRemoteServerManifestPath()
  const bundlePath = resolveRemoteServerBundlePath()
  if (!existsSync(manifestPath) || !existsSync(bundlePath)) {
    return err({
      code: 'CONNECTION_ERROR',
      message: '远端服务产物缺失，请先运行 bun run build:remote-server',
    })
  }
  let manifest: WorkspaceServerManifest
  try {
    manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as WorkspaceServerManifest
  } catch {
    return err({ code: 'PROTOCOL_ERROR', message: '远端服务 manifest 解析失败' })
  }
  if (manifest.protocolMajor !== WORKSPACE_PROTOCOL_MAJOR) {
    return err({
      code: 'VERSION_MISMATCH',
      message: `远端服务协议主版本不兼容：产物 ${manifest.protocolMajor}，本机 ${WORKSPACE_PROTOCOL_MAJOR}`,
    })
  }
  const entry = manifest.files.find((file) => file.path === manifest.entry)
  if (!entry) {
    return err({ code: 'PROTOCOL_ERROR', message: '远端服务 manifest 缺少入口校验项' })
  }
  const bytes = readFileSync(bundlePath)
  const sha256 = createHash('sha256').update(bytes).digest('hex')
  if (sha256 !== entry.sha256 || bytes.byteLength !== entry.size) {
    return err({ code: 'CONNECTION_ERROR', message: '远端服务产物校验失败（可能构建过期或被篡改）' })
  }
  return ok(manifest)
}
