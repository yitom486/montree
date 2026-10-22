import { createHash } from 'node:crypto'
import { createServer } from 'node:http'
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, copyFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { test, expect } from '@playwright/test'
import { launchBuiltApp } from './helpers/launch-app'
import { getTypstAsset, TINYMIST_RELEASE_BASE } from '../electron/services/typst/tinymist-assets'

test.describe.configure({ retries: 0 })

/** 上游固定归档：优先用 MONTREE_TYPST_ARCHIVE，否则下载一次缓存到临时目录。 */
async function upstreamArchive(): Promise<Buffer> {
  const asset = getTypstAsset(process.platform, process.arch)
  if (process.env.MONTREE_TYPST_ARCHIVE) return readFile(process.env.MONTREE_TYPST_ARCHIVE)
  const cache = join(tmpdir(), `montree-e2e-${asset.sha256.slice(0, 12)}-${asset.name}`)
  if (existsSync(cache)) return readFile(cache)
  const response = await fetch(`${TINYMIST_RELEASE_BASE}/${asset.name}`, { signal: AbortSignal.timeout(180_000) })
  if (!response.ok) throw new Error(`下载上游归档失败 HTTP ${response.status}`)
  const bytes = Buffer.from(await response.arrayBuffer())
  await writeFile(cache, bytes)
  return bytes
}

test('安装包不带 Tinymist：首次打开 Typst 文件时显示下载进度，校验后启动并排版；重开不再下载', async () => {
  test.setTimeout(240_000)
  const asset = getTypstAsset(process.platform, process.arch)
  const archive = await upstreamArchive()
  expect(createHash('sha256').update(archive).digest('hex')).toBe(asset.sha256)
  let hits = 0
  // 限速分块发送，保证进度可见
  const server = createServer(async (req, res) => {
    if (!req.url?.endsWith(asset.name)) { res.writeHead(404).end(); return }
    hits++
    res.writeHead(200, { 'Content-Length': archive.length, 'Content-Type': 'application/octet-stream' })
    const chunk = Math.ceil(archive.length / 40)
    for (let offset = 0; offset < archive.length; offset += chunk) {
      res.write(archive.subarray(offset, offset + chunk))
      await new Promise((r) => setTimeout(r, 50))
    }
    res.end()
  })
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
  const baseUrl = `http://127.0.0.1:${(server.address() as { port: number }).port}`
  const root = await mkdtemp(join(tmpdir(), 'montree-typst-lazy-e2e-'))
  const resources = join(root, 'resources'); await mkdir(resources)
  await copyFile(resolve('LICENSES/Tinymist.txt'), join(resources, 'LICENSE'))
  const runtimeDir = join(root, 'runtime')
  const workspace = join(root, 'ws'); await mkdir(workspace)
  await writeFile(join(workspace, 'lazy.typ'), '#set page(width: 10cm, height: 6cm)\n= Lazy runtime\nLazyMarker\n')
  const env = { E2E_AUTO_OPEN_PATH: workspace, E2E_TYPST_RESOURCES_DIR: resources, MONTREE_TINYMIST_DIR: runtimeDir, MONTREE_TINYMIST_BASE_URL: baseUrl }
  const openTyp = async (app: Awaited<ReturnType<typeof launchBuiltApp>>) => {
    const page = await app.firstWindow(); await page.waitForLoadState('domcontentloaded')
    await page.getByRole('button', { name: '更多操作', exact: true }).click()
    await page.getByRole('menuitem', { name: /打开文件夹/ }).click()
    await page.keyboard.press('Control+p')
    const dialog = page.getByRole('dialog', { name: '快速打开文件' })
    await dialog.getByPlaceholder('搜索工作区文件或电子书...').fill('lazy.typ')
    await dialog.getByRole('button').filter({ hasText: 'lazy.typ' }).click()
    return page
  }
  try {
    let app = await launchBuiltApp(env)
    try {
      const page = await openTyp(app)
      const status = page.getByRole('status').filter({ hasText: /正在下载 Typst 运行时 [\d.]+ \/ [\d.]+ MB/ })
      await expect(status).toBeVisible({ timeout: 30_000 })
      const dir = process.env.ROUND4_SCREENSHOT_DIR
      if (dir) await page.screenshot({ path: join(dir, 'typst-runtime-download.png') })
      const ok = page.getByText('Typst 运行时已下载并通过校验'), failed = page.getByText(/Typst 运行时下载失败[:：].*/)
      await expect(ok.or(failed)).toBeVisible({ timeout: 120_000 })
      if (await failed.isVisible()) throw new Error(String(await failed.textContent()))
      await expect(page.getByRole('status').filter({ hasText: /最近一次排版已完成|Typst 编辑服务已连接/ })).toBeVisible({ timeout: 60_000 })
      const manifest = JSON.parse(await readFile(join(runtimeDir, `0.15.8-${process.platform}-${process.arch}`, 'manifest.json'), 'utf8'))
      expect(manifest).toMatchObject({ version: '0.15.8', archiveSha256: asset.sha256, source: 'download' })
    } finally {
      await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().forEach((w) => w.removeAllListeners('close')))
      await app.close()
    }
    expect(hits).toBe(1)
    app = await launchBuiltApp(env)
    try {
      const page = await openTyp(app)
      await expect(page.getByRole('status').filter({ hasText: /最近一次排版已完成|Typst 编辑服务已连接/ })).toBeVisible({ timeout: 60_000 })
      expect(hits).toBe(1)
    } finally {
      await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().forEach((w) => w.removeAllListeners('close')))
      await app.close()
    }
  } finally { server.close() }
})
