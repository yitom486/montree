import { createHash } from 'node:crypto'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import {
  access,
  mkdir,
  readdir,
  readFile,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises'
import { join } from 'node:path'
import { app } from 'electron'
import { err, ok, type Result } from '@montree/contracts'
import type { AppError } from '@montree/contracts'
import {
  INSPECTOR_MODELS,
  INSPECTOR_OCR_REVISION,
  INSPECTOR_ORT,
  INSPECTOR_PDFIUM,
  resolveInspectorPlatform,
  type InspectorNativeLib,
} from '@montree/ocr-core'

/**
 * pdf-inspector OCR 外部运行时分发（PDFium + ONNX Runtime + PP-OCRv6 Small）。
 * 按平台按需下载、SHA256 验签、离线模式直连（model_directory + offline）。
 * 与 tesseract 两套运行时并存一个版本，下个版本删 tesseract 后合流。
 */

const execFileAsync = promisify(execFile)

export interface InspectorOcrPaths {
  pdfiumLib: string
  ortLib: string
  modelDir: string
}

function runtimeRoot(): string {
  return join(app.getPath('userData'), 'inspector-ocr', INSPECTOR_OCR_REVISION)
}

function manifestPath(): string {
  return join(runtimeRoot(), 'manifest.json')
}

async function pathExists(target: string): Promise<boolean> {
  try {
    await access(target)
    return true
  } catch {
    return false
  }
}

async function findFileRecursive(dir: string, fileName: string): Promise<string | null> {
  let entries: Array<{ name: string; isDirectory: () => boolean }>
  try {
    entries = (await readdir(dir, { withFileTypes: true })) as Array<{
      name: string
      isDirectory: () => boolean
    }>
  } catch {
    return null
  }
  for (const entry of entries) {
    const full = join(dir, entry.name)
    if (!entry.isDirectory()) {
      if (entry.name.toLowerCase() === fileName.toLowerCase()) return full
    } else {
      const found = await findFileRecursive(full, fileName)
      if (found) return found
    }
  }
  return null
}

async function downloadToFile(
  url: string,
  dest: string,
  expectedSha256: string,
  expectedSize?: number,
  timeoutMs = 180000,
  signal?: AbortSignal,
  resourceName?: string,
): Promise<void> {
  return downloadResourceToFile({
    url,
    dest,
    expectedSha256,
    expectedSize,
    timeoutMs,
    signal,
    resourceName,
  })
}

/** 验签确定性失败：字节已收齐（size 相符或无 size 约束）但哈希不对，重试纯浪费 */
export class HashMismatchError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'HashMismatchError'
  }
}

function shortHash(hash: string): string {
  return hash.slice(0, 12)
}

function urlHostPath(url: string): string {
  try {
    const parsed = new URL(url)
    return `${parsed.host}${parsed.pathname}`
  } catch {
    return url
  }
}

export interface DownloadResourceInput {
  url: string
  dest: string
  expectedSha256: string
  expectedSize?: number
  timeoutMs?: number
  signal?: AbortSignal
  /** 资源名（pdfium.dll / onnxruntime.dll / 模型文件名）：报错定位用 */
  resourceName?: string
}

/**
 * 带验签的下载：写盘只发生在哈希通过之后（失败=未安装、未写入）。
 * 哈希失败（size 相符或无 size 约束）直接抛 HashMismatchError，不按网络抖动重试；
 * HTTP 5xx、断流、size 不符仍重试（1s/2s，最多 3 次）。
 * 导出仅供单测（见 inspector-ocr-runtime.test.ts），生产经 downloadToFile 调用。
 */
export async function downloadResourceToFile(input: DownloadResourceInput): Promise<void> {
  const {
    url,
    dest,
    expectedSha256,
    expectedSize,
    timeoutMs = 180000,
    signal,
    resourceName,
  } = input
  const label = resourceName ?? urlHostPath(url)
  const where = urlHostPath(url)
  const maxAttempts = 3
  let lastCause: unknown = null
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    if (signal?.aborted) {
      throw new Error('已取消下载')
    }
    try {
      const timeout = AbortSignal.timeout(timeoutMs)
      const combined = signal ? AbortSignal.any([timeout, signal]) : timeout
      const response = await fetch(url, { signal: combined })
      if (!response.ok) {
        if (response.status >= 400 && response.status < 500) {
          throw new Error(`[${label}] 资源不存在（HTTP ${response.status}）：${where}`)
        }
        throw new Error(`[${label}] 下载临时失败（HTTP ${response.status}）：${where}`)
      }
      const buffer = Buffer.from(await response.arrayBuffer())
      if (expectedSize !== undefined && buffer.length !== expectedSize) {
        throw new Error(
          `[${label}] 文件大小不符（期望 ${expectedSize}，实际 ${buffer.length}）：${where}`,
        )
      }
      const actual = createHash('sha256').update(buffer).digest('hex')
      if (actual !== expectedSha256.toLowerCase()) {
        throw new HashMismatchError(
          `[${label}] SHA256 校验失败（期望 ${shortHash(expectedSha256)}…，实际 ${shortHash(actual)}…，${buffer.length} 字节，${where}），已拒绝安装、未写入任何文件`,
        )
      }
      await writeFile(dest, buffer)
      return
    } catch (cause) {
      // 验签确定性失败：重试无意义，直接失败（不计"已重试 N 次"）
      if (cause instanceof HashMismatchError) throw cause
      lastCause = cause
      // 用户取消不重试，直接失败
      if (signal?.aborted) {
        throw new Error('已取消下载')
      }
      if (attempt < maxAttempts) {
        await new Promise((resolve) => setTimeout(resolve, 1000 * 2 ** (attempt - 1)))
      }
    }
  }
  throw new Error(
    `[${label}] 下载失败（已重试 ${maxAttempts - 1} 次）：${lastCause instanceof Error ? lastCause.message : '网络异常'}`,
  )
}

async function installNativeLib(
  lib: InspectorNativeLib,
  destDir: string,
  onProgress?: (message: string, progress: number) => void,
  signal?: AbortSignal,
): Promise<string> {
  const tempDir = join(app.getPath('temp'), 'montree-inspector-ocr')
  await mkdir(tempDir, { recursive: true })
  const archiveExt = lib.url.endsWith('.zip') ? '.zip' : '.tgz'
  const archivePath = join(tempDir, `lib${archiveExt}`)
  onProgress?.(`正在下载识别引擎组件…`, 5)
  await downloadToFile(lib.url, archivePath, lib.sha256, undefined, 180000, signal, lib.libFile)
  const staging = join(tempDir, 'staging')
  await rm(staging, { recursive: true, force: true })
  await mkdir(staging, { recursive: true })
  // Windows tar.exe 同时处理 tgz 与 zip
  await execFileAsync('tar', ['-xf', archivePath, '-C', staging])
  const found = await findFileRecursive(staging, lib.libFile)
  if (!found) {
    throw new Error(`压缩包内找不到 ${lib.libFile}`)
  }
  await mkdir(destDir, { recursive: true })
  const dest = join(destDir, lib.libFile)
  await rm(dest, { force: true })
  const content = await readFile(found)
  await writeFile(dest, content)
  await rm(staging, { recursive: true, force: true })
  await rm(archivePath, { force: true })
  return dest
}

export async function isInspectorOcrRuntimeInstalled(): Promise<boolean> {
  const platform = resolveInspectorPlatform(process.platform, process.arch)
  if (!platform) return false
  const root = runtimeRoot()
  if (!(await pathExists(manifestPath()))) return false
  if (!(await pathExists(join(root, 'pdfium', INSPECTOR_PDFIUM[platform].libFile)))) return false
  const ortFile = await findFileRecursive(join(root, 'ort'), INSPECTOR_ORT[platform].libFile)
  if (!ortFile) return false
  for (const model of INSPECTOR_MODELS) {
    const target = join(root, 'models', model.file)
    if (!(await pathExists(target))) return false
    const size = (await stat(target)).size
    if (size !== model.size) return false
  }
  return true
}

function applyRuntimeEnv(paths: InspectorOcrPaths): void {
  // oar 按环境变量定位外部库与模型目录（见上游 docs/ocr-runtime.md）
  process.env.PDFIUM_LIB_PATH = paths.pdfiumLib
  process.env.ORT_DYLIB_PATH = paths.ortLib
  process.env.PDF_INSPECTOR_MODEL_CACHE = paths.modelDir
}

async function resolveInstalledPaths(): Promise<InspectorOcrPaths | null> {
  const platform = resolveInspectorPlatform(process.platform, process.arch)
  if (!platform) return null
  const root = runtimeRoot()
  const pdfiumLib = join(root, 'pdfium', INSPECTOR_PDFIUM[platform].libFile)
  const ortLib = await findFileRecursive(join(root, 'ort'), INSPECTOR_ORT[platform].libFile)
  const modelDir = join(root, 'models')
  if (!(await pathExists(pdfiumLib)) || !ortLib) return null
  return { pdfiumLib, ortLib, modelDir }
}

let ensurePromise: Promise<Result<InspectorOcrPaths, AppError>> | null = null

/**
 * 确保 OCR 运行时可用（开发环境可用同名环境变量直接指向本地库）。
 * 成功后进程环境变量已就绪，调用方直接调 napi OCR 接口。
 */
export async function ensureInspectorOcrRuntime(
  onProgress?: (message: string, progress: number) => void,
  signal?: AbortSignal,
): Promise<Result<InspectorOcrPaths, AppError>> {
  const overridePdfium = process.env.PDFIUM_LIB_PATH
  const overrideOrt = process.env.ORT_DYLIB_PATH
  const overrideModels = process.env.PDF_INSPECTOR_MODEL_CACHE
  if (overridePdfium && overrideOrt && overrideModels) {
    // 开发/测试直连：校验模型目录形状（oar 要求三个文件平铺），配错直接报错不静默
    for (const file of INSPECTOR_MODELS.map((model) => model.file)) {
      if (!(await pathExists(join(overrideModels, file)))) {
        return err({
          code: 'INVALID_ARGUMENT',
          message: `PDF_INSPECTOR_MODEL_CACHE 下缺少 ${file}（应为模型文件平铺目录）`,
        })
      }
    }
    return ok({ pdfiumLib: overridePdfium, ortLib: overrideOrt, modelDir: overrideModels })
  }

  const platform = resolveInspectorPlatform(process.platform, process.arch)
  if (!platform) {
    return err({
      code: 'UNSUPPORTED_FORMAT',
      message: `当前平台暂不支持本地 OCR（${process.platform}/${process.arch}）`,
    })
  }

  if (ensurePromise) return ensurePromise
  ensurePromise = (async (): Promise<Result<InspectorOcrPaths, AppError>> => {
    try {
      if (await isInspectorOcrRuntimeInstalled()) {
        const paths = await resolveInstalledPaths()
        if (paths) {
          applyRuntimeEnv(paths)
          return ok(paths)
        }
      }

      const root = runtimeRoot()
      await mkdir(root, { recursive: true })
      onProgress?.('正在下载识别引擎（约 110MB，一次性）…', 5)
      const pdfiumLib = await installNativeLib(
        INSPECTOR_PDFIUM[platform],
        join(root, 'pdfium'),
        onProgress,
        signal,
      )
      // ORT 目录整体保留（同目录 providers*.dll 按需加载）
      const ortStaging = join(root, 'ort')
      await mkdir(ortStaging, { recursive: true })
      const tempDir = join(app.getPath('temp'), 'montree-inspector-ocr')
      const ortEntry = INSPECTOR_ORT[platform]
      const ortArchive = join(tempDir, `ort${ortEntry.url.endsWith('.zip') ? '.zip' : '.tgz'}`)
      onProgress?.('正在下载推理库…', 30)
      await downloadToFile(
        ortEntry.url,
        ortArchive,
        ortEntry.sha256,
        undefined,
        180000,
        signal,
        ortEntry.libFile,
      )
      const ortExtract = join(tempDir, 'ort-staging')
      await rm(ortExtract, { recursive: true, force: true })
      await mkdir(ortExtract, { recursive: true })
      await execFileAsync('tar', ['-xf', ortArchive, '-C', ortExtract])
      const ortLib = await findFileRecursive(ortExtract, ortEntry.libFile)
      if (!ortLib) {
        throw new Error(`压缩包内找不到 ${ortEntry.libFile}`)
      }
      await rm(join(ortStaging, ortEntry.libFile), { force: true })
      const ortContent = await readFile(ortLib)
      const ortDest = join(ortStaging, ortEntry.libFile)
      await writeFile(ortDest, ortContent)
      await rm(ortExtract, { recursive: true, force: true })
      await rm(ortArchive, { force: true })

      const modelDir = join(root, 'models')
      await mkdir(modelDir, { recursive: true })
      let done = 0
      for (const model of INSPECTOR_MODELS) {
        done += 1
        onProgress?.(
          `正在下载识别模型（${done}/${INSPECTOR_MODELS.length}）…`,
          50 + Math.round((done / (INSPECTOR_MODELS.length + 1)) * 45),
        )
        await downloadToFile(
          model.url,
          join(modelDir, model.file),
          model.sha256,
          model.size,
          180000,
          signal,
          model.file,
        )
      }

      await writeFile(
        manifestPath(),
        JSON.stringify(
          {
            revision: 'oar-ocr-v0.7.0',
            platform,
            installedAt: new Date().toISOString(),
          },
          null,
          2,
        ),
        'utf8',
      )

      const paths: InspectorOcrPaths = { pdfiumLib, ortLib: ortDest, modelDir }
      applyRuntimeEnv(paths)
      onProgress?.('识别引擎已就绪', 100)
      return ok(paths)
    } catch (cause) {
      if (signal?.aborted) {
        return err({ code: 'CANCELLED', message: '已取消下载' })
      }
      return err({
        code: 'OCR_FAILED',
        message: cause instanceof Error ? cause.message : '识别引擎安装失败',
      })
    } finally {
      ensurePromise = null
    }
  })()
  return ensurePromise
}
