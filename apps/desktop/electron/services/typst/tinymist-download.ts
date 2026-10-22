/**
 * Tinymist 按需下载：安装包不再携带约 74 MB 的 Tinymist，首次使用 Typst 时
 * 从固定版本的上游发布下载归档，校验 SHA-256 后解压到 userData。
 * 失败（网络、校验、解压）不会留下半成品：先在临时目录完成，再整体改名就位。
 */
import { execFile } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { createWriteStream, existsSync } from 'node:fs'
import { chmod, copyFile, mkdir, readdir, readFile, realpath, rename, rm, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { promisify } from 'node:util'
import { getTypstAsset, isSafeArchiveMember, TINYMIST_RELEASE_BASE, TINYMIST_VERSION, type TinymistAsset } from './tinymist-assets'

const execFileAsync = promisify(execFile)

export interface TinymistDownloadProgress { received: number; total: number | null; phase: 'download' | 'verify' | 'extract' | 'done' }
export interface InstallTinymistOptions {
  /** 安装根目录（通常为 userData/typst/runtime）；实际放在 `<root>/<version>-<platform>-<arch>`。 */
  root: string
  /** 随包许可证（resources/typst/LICENSE），复制到安装目录。 */
  licensePath: string
  platform?: string
  arch?: string
  /** 测试注入：归档地址前缀与资产（默认固定上游版本）。 */
  baseUrl?: string
  asset?: TinymistAsset
  fetchImpl?: typeof fetch
  onProgress?: (progress: TinymistDownloadProgress) => void
  signal?: AbortSignal
}
interface Manifest { version: string; platform: string; arch: string; executable: string; sha256: string; size: number; archiveSha256: string; source: 'download' }

export function tinymistInstallDir(root: string, platform: string = process.platform, arch: string = process.arch): string {
  return path.join(root, `${TINYMIST_VERSION}-${platform}-${arch}`)
}

const sha256 = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex')

/** 已安装且清单与可执行文件一致时返回路径，否则 null。 */
export async function installedTinymist(root: string, platform: string = process.platform, arch: string = process.arch, asset = getTypstAsset(platform, arch)): Promise<string | null> {
  const dir = tinymistInstallDir(root, platform, arch)
  const executable = path.join(dir, asset.executable)
  try {
    const manifest = JSON.parse(await readFile(path.join(dir, 'manifest.json'), 'utf8')) as Manifest
    const bytes = await readFile(executable)
    if (manifest.version !== TINYMIST_VERSION || manifest.platform !== platform || manifest.arch !== arch || manifest.executable !== asset.executable ||
      manifest.archiveSha256 !== asset.sha256 || manifest.size !== bytes.length || manifest.sha256 !== sha256(bytes)) return null
    return executable
  } catch { return null }
}

async function findExecutable(dir: string, name: string): Promise<string[]> {
  const found: string[] = []
  const walk = async (current: string, depth: number) => {
    if (depth > 4) return
    for (const entry of await readdir(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name)
      if (entry.isDirectory()) await walk(full, depth + 1)
      else if (entry.isFile() && entry.name === name) found.push(full)
    }
  }
  await walk(dir, 0)
  return found
}

async function listArchive(archive: string): Promise<string[]> {
  const { stdout } = await execFileAsync('tar', ['-tf', archive], { windowsHide: true, maxBuffer: 4 * 1024 * 1024 })
  return stdout.split(/\r?\n/).map((line) => line.trim()).filter(Boolean)
}

let inflight: Promise<string> | null = null

/** 确保 Tinymist 已安装：已装直接返回；否则下载→校验→解压→原子就位。并发调用共享同一次下载。 */
export function ensureTinymist(options: InstallTinymistOptions): Promise<string> {
  inflight ??= installTinymist(options).finally(() => { inflight = null })
  return inflight
}

export async function installTinymist(options: InstallTinymistOptions): Promise<string> {
  const platform = options.platform ?? process.platform
  const arch = options.arch ?? process.arch
  const asset = options.asset ?? getTypstAsset(platform, arch)
  const existing = await installedTinymist(options.root, platform, arch, asset)
  if (existing) return existing

  const fetchImpl = options.fetchImpl ?? fetch
  const report = options.onProgress ?? (() => {})
  await mkdir(options.root, { recursive: true })
  const staging = path.join(options.root, `.staging-${randomUUID()}`)
  await mkdir(path.join(staging, 'x'), { recursive: true })
  try {
    const url = `${options.baseUrl ?? TINYMIST_RELEASE_BASE}/${asset.name}`
    const response = await fetchImpl(url, { signal: options.signal ?? AbortSignal.timeout(10 * 60_000) })
    if (!response.ok || !response.body) throw new Error(`Typst 运行时下载失败（HTTP ${response.status}）`)
    const totalHeader = Number(response.headers.get('content-length'))
    const total = Number.isFinite(totalHeader) && totalHeader > 0 ? totalHeader : null
    const archive = path.join(staging, asset.name)
    const hash = createHash('sha256')
    const out = createWriteStream(archive)
    let received = 0, lastReport = 0
    report({ received, total, phase: 'download' })
    const reader = response.body.getReader()
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      hash.update(value); received += value.length
      if (!out.write(value)) await new Promise<void>((resolve) => out.once("drain", () => resolve()))
      const now = Date.now()
      if (now - lastReport > 150) { lastReport = now; report({ received, total, phase: 'download' }) }
    }
    await new Promise<void>((resolve, reject) => out.end((error?: Error | null) => error ? reject(error) : resolve()))
    report({ received, total, phase: 'verify' })
    if (hash.digest('hex') !== asset.sha256) throw new Error('Typst 运行时下载校验失败（SHA-256 不匹配），已丢弃')

    report({ received, total, phase: 'extract' })
    const members = await listArchive(archive)
    if (!members.length || members.some((name) => !isSafeArchiveMember(name.replace(/\/$/, '') || '.'))) throw new Error('Typst 运行时归档成员无效')
    await execFileAsync('tar', ['-xf', archive, '-C', path.join(staging, 'x')], { windowsHide: true })
    const candidates = await findExecutable(path.join(staging, 'x'), asset.executable)
    if (candidates.length !== 1) throw new Error('归档中缺失或包含重复的 Tinymist 可执行文件')
    const extracted = await realpath(candidates[0])
    if (!extracted.startsWith((await realpath(staging)) + path.sep)) throw new Error('归档可执行文件路径无效')
    const bytes = await readFile(extracted)

    const ready = path.join(staging, 'ready')
    await mkdir(ready)
    await copyFile(extracted, path.join(ready, asset.executable))
    if (platform !== 'win32') await chmod(path.join(ready, asset.executable), 0o755)
    if (existsSync(options.licensePath)) await copyFile(options.licensePath, path.join(ready, 'LICENSE'))
    const manifest: Manifest = { version: TINYMIST_VERSION, platform, arch, executable: asset.executable, sha256: sha256(bytes), size: bytes.length, archiveSha256: asset.sha256, source: 'download' }
    await writeFile(path.join(ready, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n')

    const target = tinymistInstallDir(options.root, platform, arch)
    await rm(target, { recursive: true, force: true })
    await rename(ready, target)
    report({ received, total, phase: 'done' })
    const executable = path.join(target, asset.executable)
    if (!(await stat(executable)).isFile()) throw new Error('Typst 运行时安装失败')
    return executable
  } finally {
    await rm(staging, { recursive: true, force: true }).catch(() => {})
  }
}
