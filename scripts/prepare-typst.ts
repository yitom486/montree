import { createHash } from 'node:crypto'
import { chmod, copyFile, mkdir, mkdtemp, readFile, readdir, realpath, rename, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, dirname, join, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'
import { unzipSync } from 'fflate'
import { getTypstAsset, isSafeArchiveMember, TINYMIST_LICENSE_SHA256, TINYMIST_VERSION } from './typst-runtime-assets'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const resourceDir = join(root, 'apps/desktop/resources/typst')
const sha256 = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex')
const asset = getTypstAsset(process.platform, process.arch)
const target = join(resourceDir, asset.executable)

async function download(url: string): Promise<Uint8Array> {
  const response = await fetch(url, { signal: AbortSignal.timeout(180_000) })
  if (!response.ok) throw new Error(`下载失败 HTTP ${response.status}: ${url}`)
  return new Uint8Array(await response.arrayBuffer())
}

async function prepared(): Promise<boolean> {
  try {
    const manifest = JSON.parse(await readFile(join(resourceDir, 'manifest.json'), 'utf8'))
    return manifest.version === TINYMIST_VERSION && manifest.platform === process.platform && manifest.arch === process.arch &&
      manifest.archiveSha256 === asset.sha256 && manifest.executable === asset.executable &&
      manifest.sha256 === sha256(await readFile(target)) && manifest.size === (await stat(target)).size &&
      sha256(await readFile(join(resourceDir, 'LICENSE'))) === TINYMIST_LICENSE_SHA256
  } catch { return false }
}

if (await prepared()) {
  console.log(`Tinymist ${TINYMIST_VERSION} ${process.platform}/${process.arch} 资源校验通过`)
} else {
  await mkdir(resourceDir, { recursive: true })
  const staging = await mkdtemp(join(tmpdir(), 'montree-typst-'))
  try {
    const cachedArchive = process.env.MONTREE_TYPST_ARCHIVE
    const archive = cachedArchive ? new Uint8Array(await readFile(resolve(cachedArchive))) :
      await download(`https://github.com/Myriad-Dreamin/tinymist/releases/download/v${TINYMIST_VERSION}/${asset.name}`)
    if (sha256(archive) !== asset.sha256) throw new Error('Tinymist 发布归档 SHA-256 不匹配')
    let executableBytes: Uint8Array
    if (asset.name.endsWith('.zip')) {
      const files = unzipSync(archive, { filter: file => isSafeArchiveMember(file.name) && basename(file.name) === asset.executable })
      const members = Object.keys(files)
      if (members.length !== 1) throw new Error('归档中缺失或包含重复的 Tinymist 可执行文件')
      executableBytes = files[members[0]]
    } else {
      const archivePath = join(staging, 'runtime.tar.gz')
      await writeFile(archivePath, archive)
      const members = execFileSync('tar', ['-tzf', archivePath], { encoding: 'utf8' }).trim().split(/\r?\n/)
      const candidates = members.filter(name => isSafeArchiveMember(name) && basename(name) === asset.executable)
      if (candidates.length !== 1 || members.some(name => !isSafeArchiveMember(name))) throw new Error('Tinymist 归档成员无效')
      execFileSync('tar', ['-xzf', archivePath, '-C', staging, '--', candidates[0]])
      const extracted = await realpath(join(staging, candidates[0]))
      if (!extracted.startsWith((await realpath(staging)) + sep) || !(await stat(extracted)).isFile()) throw new Error('归档可执行文件路径无效')
      executableBytes = await readFile(extracted)
    }
    const license = await readFile(join(root, 'LICENSES/Tinymist.txt'))
    if (sha256(license) !== TINYMIST_LICENSE_SHA256) throw new Error('Tinymist 许可证 SHA-256 不匹配')
    const manifest = {
      version: TINYMIST_VERSION, platform: process.platform, arch: process.arch,
      executable: asset.executable, sha256: sha256(executableBytes), size: executableBytes.length,
      archiveSha256: asset.sha256,
    }
    // Only replace the previous verified files after the entire download validates.
    await writeFile(join(staging, asset.executable), executableBytes)
    await writeFile(join(staging, 'LICENSE'), license)
    if (process.platform !== 'win32') await chmod(join(staging, asset.executable), 0o755)
    for (const name of [asset.executable, 'LICENSE']) await copyFile(join(staging, name), join(resourceDir, name))
    if (process.platform !== 'win32') await chmod(target, 0o755)
    await writeFile(join(resourceDir, 'manifest.json.tmp'), JSON.stringify(manifest, null, 2) + '\n')
    await rename(join(resourceDir, 'manifest.json.tmp'), join(resourceDir, 'manifest.json'))
    const otherExecutable = asset.executable === 'tinymist.exe' ? 'tinymist' : 'tinymist.exe'
    if ((await readdir(resourceDir)).includes(otherExecutable)) await rm(join(resourceDir, otherExecutable))
    console.log(`已准备 Tinymist ${TINYMIST_VERSION} ${process.platform}/${process.arch}（${(executableBytes.length / 1024 / 1024).toFixed(1)} MiB）`)
  } finally {
    const resolvedTemp = resolve(staging)
    if (resolvedTemp.startsWith(resolve(tmpdir()) + sep) && basename(resolvedTemp).startsWith('montree-typst-')) {
      await rm(resolvedTemp, { recursive: true, force: true })
    }
  }
}
