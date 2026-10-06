import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { err, ok, type Result } from '@montree/contracts'
import type { AppError } from '@montree/contracts'
import type { WebDocFetchResult } from '@montree/contracts'
import { normalizeWebDocUrl } from './url-policy'

export const E2E_WEB_DOC_FIXTURE_HOST = 'e2e.montree.test'

type FixtureManifest = Record<string, string>

let manifestCache: { dir: string; manifest: FixtureManifest } | null = null

function fixtureError(message: string): Result<never, AppError> {
  return err({ code: 'FILE_READ_ERROR', message })
}

async function loadFixtureManifest(dir: string): Promise<FixtureManifest> {
  if (manifestCache?.dir === dir) {
    return manifestCache.manifest
  }

  const raw = await readFile(join(dir, 'manifest.json'), 'utf-8')
  const manifest = JSON.parse(raw) as FixtureManifest
  manifestCache = { dir, manifest }
  return manifest
}

/** E2E 模式下从本地 fixture 读取 HTML；未启用或 URL 无映射时返回 null */
export async function tryFetchE2eWebDocFixture(
  url: string,
): Promise<Result<WebDocFetchResult, AppError> | null> {
  const dir = process.env.E2E_WEB_DOC_FIXTURE_DIR?.trim()
  if (!dir) return null

  let normalized: string
  try {
    normalized = normalizeWebDocUrl(url)
  } catch {
    return fixtureError('URL 无效')
  }

  const parsed = new URL(normalized)
  if (parsed.hostname !== E2E_WEB_DOC_FIXTURE_HOST) {
    return null
  }

  let manifest: FixtureManifest
  try {
    manifest = await loadFixtureManifest(dir)
  } catch {
    return fixtureError('E2E 在线文档 fixture 清单读取失败')
  }

  const fileName = manifest[normalized]
  if (!fileName) {
    return fixtureError(`E2E fixture 未配置：${normalized}`)
  }

  try {
    const html = await readFile(join(dir, fileName), 'utf-8')
    if (!html.trim()) {
      return fixtureError('E2E fixture 页面为空')
    }
    return ok({ url: normalized, html })
  } catch {
    return fixtureError(`E2E fixture 文件缺失：${fileName}`)
  }
}

/** 单测重置 manifest 缓存 */
export function resetE2eWebDocFixtureCache(): void {
  manifestCache = null
}
