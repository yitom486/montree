import { mkdtemp, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { zipSync, strToU8 } from 'fflate'
import { test, expect, type ElectronApplication, type Page } from '@playwright/test'
import { launchBuiltApp } from './helpers/launch-app'
import { webDocFixtureDir, welcomeWebDocUrlField } from './helpers/web-doc-fixture'

async function visualTool(app: ElectronApplication, name: string, args?: Record<string, unknown>) {
  return app.evaluate(async (_, payload) => {
    const hook = (globalThis as unknown as { __montreeE2eVisualTools: (name: string, args?: Record<string, unknown>) => Promise<{ content: Array<{ type: string; text?: string; data?: string; mimeType?: string }> }> }).__montreeE2eVisualTools
    return hook(payload.name, payload.args)
  }, { name, args })
}

async function expectScreenshot(app: ElectronApplication, page: Page) {
  const rect = await page.locator('[data-reader-viewport]').first().evaluate((element) => ({ width: element.clientWidth, height: element.clientHeight }))
  const result = await visualTool(app, 'montree_capture_viewport')
  const image = result.content.find((block) => block.type === 'image')!
  expect(image.mimeType).toBe('image/png')
  expect(Buffer.from(image.data!, 'base64').subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a')
  const metadata = JSON.parse(result.content[0].text!)
  expect(metadata.width).toBeGreaterThan(0)
  expect(metadata.height).toBeGreaterThan(0)
  expect(metadata.scope).toBe('visible-reading-viewport')
  // 确认图片来自阅读区而不是包含侧栏/聊天栏的整扇窗口。
  const viewport = page.viewportSize()
  if (viewport) expect(rect.width).toBeLessThan(viewport.width)
}

async function openFile(page: Page, name: string) {
  await page.keyboard.press('Control+p')
  const dialog = page.getByRole('dialog', { name: '快速打开文件' })
  await dialog.getByPlaceholder('搜索工作区文件或电子书...').fill(name)
  await expect(dialog.getByText(name).first()).toBeVisible()
  await page.keyboard.press('Enter')
  await expect(dialog).toBeHidden()
}

function rasterPdf(): Buffer {
  const content = 'BT /F1 18 Tf 70 650 Td (Visual PDF fixture) Tj ET\nq 100 0 0 100 80 500 cm BI /W 1 /H 1 /CS /RGB /BPC 8 /F /AHx ID FF0000> EI Q'
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
  ]
  let pdf = '%PDF-1.4\n'
  const offsets = [0]
  objects.forEach((object, index) => { offsets.push(pdf.length); pdf += `${index + 1} 0 obj\n${object}\nendobj\n` })
  const xref = pdf.length
  pdf += `xref\n0 6\n0000000000 65535 f \n${offsets.slice(1).map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`
  return Buffer.from(pdf)
}

test('网页图片列表包含真实SVG地址、图注，并可获取阅读区PNG', async () => {
  const app = await launchBuiltApp({ E2E_WEB_DOC_FIXTURE_DIR: webDocFixtureDir(), E2E_READER_VISUAL: '1' })
  try {
    const page = await app.firstWindow()
    await page.route('**/academic/architecture.svg', (route) => route.fulfill({ contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="476" height="291"><rect width="476" height="291" fill="white"/></svg>' }))
    await welcomeWebDocUrlField(page).fill('https://e2e.montree.test/docs/academic')
    await welcomeWebDocUrlField(page).press('Enter')
    await expect(page.frameLocator('.web-doc-viewer-host iframe').locator('img')).toBeVisible()
    const result = await visualTool(app, 'montree_list_images', { scope: 'current' })
    const context = JSON.parse(result.content[0].text!)
    expect(context.total).toBe(1)
    expect(context.images[0]).toMatchObject({ src: 'https://e2e.montree.test/docs/academic/architecture.svg', caption: 'Figure 1: Sandbox architecture.' })
    await expectScreenshot(app, page)
  } finally { await app.close() }
})

test('Markdown、EPUB与PDF都能发现图片，切换文档后截图定位同步更新', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'montree-visual-'))
  await writeFile(join(workspace, 'visual.md'), '# Visual Markdown\n\n![Local diagram](./plot.png)')
  await writeFile(join(workspace, 'plot.png'), Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a3b0AAAAASUVORK5CYII=', 'base64'))
  await writeFile(join(workspace, 'visual.pdf'), rasterPdf())
  const epub = zipSync({
    mimetype: strToU8('application/epub+zip'),
    'META-INF/container.xml': strToU8('<container xmlns="urn:oasis:names:tc:opendocument:xmlns:container" version="1.0"><rootfiles><rootfile full-path="OEBPS/book.opf" media-type="application/oebps-package+xml"/></rootfiles></container>'),
    'OEBPS/book.opf': strToU8('<package xmlns="http://www.idpf.org/2007/opf" version="2.0" unique-identifier="id"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>Visual book</dc:title><dc:identifier id="id">visual</dc:identifier><dc:language>en</dc:language></metadata><manifest><item id="ch" href="chapter.xhtml" media-type="application/xhtml+xml"/><item id="fig" href="figure.svg" media-type="image/svg+xml"/></manifest><spine><itemref idref="ch"/></spine></package>'),
    'OEBPS/chapter.xhtml': strToU8('<html xmlns="http://www.w3.org/1999/xhtml"><head><title>Visual chapter</title></head><body><h1>Visual chapter</h1><figure><img src="figure.svg" alt="EPUB diagram" width="200" height="100"/><figcaption>EPUB figure caption</figcaption></figure></body></html>'),
    'OEBPS/figure.svg': strToU8('<svg xmlns="http://www.w3.org/2000/svg" width="200" height="100"><rect width="200" height="100" fill="blue"/></svg>'),
  })
  await writeFile(join(workspace, 'visual.epub'), epub)
  const app = await launchBuiltApp({ E2E_AUTO_OPEN_PATH: workspace, E2E_READER_VISUAL: '1' })
  try {
    const page = await app.firstWindow()
    await page.getByRole('button', { name: '更多操作', exact: true }).click()
    await page.getByRole('menuitem', { name: /打开文件夹/ }).click()
    await expect(page.getByText('visual.md').first()).toBeVisible()
    for (const name of ['visual.md', 'visual.epub', 'visual.pdf']) {
      await openFile(page, name)
      if (name.endsWith('.pdf')) await expect(page.locator('#main canvas').first()).toBeVisible()
      else if (name.endsWith('.epub')) await expect(page.locator('foliate-view')).toBeAttached()
      await expect.poll(async () => {
        const result = await visualTool(app, 'montree_list_images')
        const context = JSON.parse(result.content[0].text!)
        return context.documentPath.endsWith(name) ? context.total : 0
      }).toBeGreaterThan(0)
      const result = await visualTool(app, 'montree_list_images')
      const context = JSON.parse(result.content[0].text!)
      if (name.endsWith('.md')) expect(context.images[0].src).toMatch(/file:\/\/\/.*plot\.png$/)
      if (name.endsWith('.epub')) expect(context.images[0]).toMatchObject({ alt: 'EPUB diagram', caption: 'EPUB figure caption' })
      if (name.endsWith('.pdf')) expect(context.images[0]).toMatchObject({ kind: 'pdf-image', page: 1 })
      await expectScreenshot(app, page)
    }
  } finally { await app.close() }
})
