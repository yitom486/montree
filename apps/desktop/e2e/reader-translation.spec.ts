import { join, resolve } from 'node:path'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { test, expect } from '@playwright/test'
import { launchBuiltApp } from './helpers/launch-app'
import { seedMockChatThread } from './helpers/seed-chat'
import { webDocFixtureDir, welcomeWebDocUrlField } from './helpers/web-doc-fixture'

const TRANSLATION_URL = 'https://e2e.montree.test/book/primitives.html'

/** 显示为普通 Helvetica，但 T/S 的 ToUnicode 映射故意损坏。 */
function corruptTextPdf(): Buffer {
  const mappings = Array.from({ length: 95 }, (_, index) => {
    const code = index + 32
    const unicode = code === 84 ? 0xfffd : code === 83 ? 0xe001 : code
    return `<${code.toString(16).padStart(2, '0')}> <${unicode.toString(16).padStart(4, '0')}>`
  }).join('\n')
  const cmap = `/CIDInit /ProcSet findresource begin\n12 dict begin\nbegincmap\n/CIDSystemInfo << /Registry (Adobe) /Ordering (UCS) /Supplement 0 >> def\n/CMapName /Broken def\n/CMapType 2 def\n1 begincodespacerange\n<00> <FF>\nendcodespacerange\n95 beginbfchar\n${mappings}\nendbfchar\nendcmap\nCMapName currentdict /CMap defineresource pop\nend\nend`
  const content = 'BT /F1 16 Tf 60 620 Td (This SICP book) Tj 0 -60 Td (Other line) Tj ET'
  const stream = (text: string) => `<< /Length ${Buffer.byteLength(text)} >>\nstream\n${text}\nendstream`
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 600 800] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /ToUnicode 6 0 R >>',
    stream(content), stream(cmap),
  ]
  let pdf = '%PDF-1.4\n'
  const offsets = [0]
  objects.forEach((object, index) => {
    offsets.push(Buffer.byteLength(pdf))
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`
  })
  const xref = Buffer.byteLength(pdf)
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`
  pdf += offsets.slice(1).map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`).join('')
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`
  return Buffer.from(pdf)
}

test('划词翻译：流式卡片、目标语言、复制与关闭', async () => {
  const app = await launchBuiltApp({
    E2E_WEB_DOC_FIXTURE_DIR: webDocFixtureDir(),
    E2E_ACP_WINDOW_TEST: '1',
    E2E_ACP_COMMAND: process.execPath,
    E2E_ACP_FIXTURE: resolve('apps/desktop/e2e/fixtures/mock-window-agent.cjs'),
  })
  try {
    const page = await app.firstWindow()
    await page.waitForLoadState('domcontentloaded')
    await seedMockChatThread(page, { id: 'translate-thread', title: '翻译' })
    await expect(page.getByRole('button', { name: '更多操作', exact: true })).toBeVisible({ timeout: 15_000 })
    const connected = await page.evaluate(() =>
      (window as unknown as { electronAPI: { acpConnect: (payload: { runtimeId: string }) => Promise<{ ok: boolean }> } })
        .electronAPI.acpConnect({ runtimeId: 'mock-window' }),
    )
    expect(connected.ok).toBe(true)

    const field = welcomeWebDocUrlField(page)
    await field.fill(TRANSLATION_URL)
    await field.press('Enter')
    const frame = page.frameLocator('.web-doc-viewer-host iframe')
    const paragraph = frame.getByText('A chapter about primitive types in Rust.', { exact: true })
    await expect(paragraph).toBeVisible()
    await expect(page.locator('iframe[data-web-doc-interactive="true"]')).toHaveCount(1)

    await paragraph.click({ clickCount: 3 })
    const toolbar = page.getByRole('toolbar', { name: '选区操作' })
    await expect(toolbar).toBeVisible()
    await toolbar.getByRole('button', { name: '翻译', exact: true }).click()

    const card = page.getByRole('dialog', { name: '划词翻译' })
    await expect(card).toBeVisible({ timeout: 10_000 })
    await expect(card).toContainText('简体中文')
    await expect(card).toContainText('A chapter about primitive types in Rust.')
    await expect(card).toContainText('MOCK译:A chapter about primitive types in Rust.', {
      timeout: 10_000,
    })
    await card.screenshot({ path: 'test-results/translation-card.png' })

    await card.getByRole('button', { name: '复制' }).click()
    await expect(page.getByText('已复制译文')).toBeVisible()
    await card.getByRole('button', { name: '关闭翻译' }).click()
    await expect(card).toBeHidden()
  } finally {
    await app.close()
  }
})

test('PDF 坏字体选区：识别进度、原选区恢复、自动继续翻译', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'montree-translation-ocr-'))
  await writeFile(join(workspace, 'broken-font.pdf'), corruptTextPdf())
  const app = await launchBuiltApp({
    E2E_AUTO_OPEN_PATH: workspace,
    E2E_ACP_WINDOW_TEST: '1',
    E2E_ACP_COMMAND: process.execPath,
    E2E_ACP_FIXTURE: resolve('apps/desktop/e2e/fixtures/mock-window-agent.cjs'),
  })
  try {
    const page = await app.firstWindow()
    await page.waitForLoadState('domcontentloaded')
    // 仅替换识别引擎：首轮自动识别失败，划词翻译随后重试；PDF 渲染/选区/IPC/ACP 走真实链路。
    await app.evaluate(({ ipcMain }) => {
      let attempts = 0
      ipcMain.removeHandler('ocr:recognize-pdf-page')
      ipcMain.handle('ocr:recognize-pdf-page', async (_event, payload) => {
        attempts += 1
        if (attempts === 1) return { ok: false, error: { code: 'OCR_FAILED', message: 'E2E first OCR fails' } }
        await new Promise((done) => setTimeout(done, 1800))
        const words = (globalThis as unknown as { translationOcrWords: unknown[] }).translationOcrWords
        return { ok: true, value: {
          fileFingerprint: payload.fileFingerprint, page: payload.page,
          pageWidth: 600, pageHeight: 800, ocrScale: 2, createdAt: new Date().toISOString(), words,
        } }
      })
    })
    const failure = page.waitForEvent('console', { predicate: (message) => message.text().includes('E2E first OCR fails') })
    await seedMockChatThread(page, { id: 'pdf-translation', title: 'PDF 翻译' })
    await expect(page.getByRole('button', { name: '更多操作', exact: true })).toBeVisible()
    await page.getByRole('button', { name: '更多操作', exact: true }).click()
    await page.getByRole('menuitem', { name: /打开文件夹/ }).click()
    await expect(page.getByText('broken-font.pdf').first()).toBeVisible()
    await page.keyboard.press('Control+p')
    const quickOpen = page.getByRole('dialog', { name: '快速打开文件' })
    await quickOpen.getByPlaceholder('搜索工作区文件或电子书...').fill('broken-font.pdf')
    await expect(quickOpen.getByText('broken-font.pdf').first()).toBeVisible()
    await page.keyboard.press('Enter')
    await expect(quickOpen).toBeHidden()
    await failure
    const native = page.locator('.pdf-text-layer-host .textLayer span').first()
    await expect(native).toContainText('\uFFFDhis \uE001ICP book')
    const words = await page.locator('.pdf-page-wrapper').evaluate((root) => {
      const pageRect = root.getBoundingClientRect()
      return Array.from(root.querySelectorAll('.textLayer span')).filter((span) => span.textContent?.trim()).map((span, index) => {
        const rect = span.getBoundingClientRect()
        return { text: index === 0 ? 'This SICP book' : 'Other line', bbox: {
          x0: (rect.left - pageRect.left) / pageRect.width, x1: (rect.right - pageRect.left) / pageRect.width,
          y0: (rect.top - pageRect.top) / pageRect.height, y1: (rect.bottom - pageRect.top) / pageRect.height,
        } }
      })
    })
    await app.evaluate((_electron, value) => {
      ;(globalThis as unknown as { translationOcrWords: unknown[] }).translationOcrWords = value
    }, words)
    const connected = await page.evaluate(() => window.electronAPI.acpConnect({ runtimeId: 'mock-window' }))
    expect(connected.ok).toBe(true)
    await native.evaluate((span) => {
      const rect = span.getBoundingClientRect()
      span.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, clientX: rect.left, clientY: rect.top }))
      const range = document.createRange()
      range.selectNodeContents(span)
      window.getSelection()!.removeAllRanges()
      window.getSelection()!.addRange(range)
      span.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, clientX: rect.right, clientY: rect.top }))
    })
    await page.getByRole('toolbar', { name: '选区操作' }).getByRole('button', { name: '翻译', exact: true }).click()
    const card = page.getByRole('dialog', { name: '划词翻译' })
    await expect(card.getByRole('status')).toHaveText('正在识别选中文字…')
    await expect(card.getByRole('button', { name: '重试' })).toBeDisabled()
    await card.screenshot({ path: 'test-results/translation-ocr-pending.png' })
    await expect(card).toContainText('MOCK译:This SICP book', { timeout: 15_000 })
    await expect(card).not.toContainText('Other line')
    await expect(card).not.toContainText('\uFFFD')
    await card.screenshot({ path: 'test-results/translation-ocr-done.png' })
    await page.setViewportSize({ width: 540, height: 760 })
    await expect(card).toBeVisible()
    const box = await card.boundingBox()
    expect(box!.x).toBeGreaterThanOrEqual(0)
    expect(box!.x + box!.width).toBeLessThanOrEqual(540)
    await card.screenshot({ path: 'test-results/translation-ocr-narrow.png' })
    await card.getByRole('button', { name: '关闭翻译' }).click()
    await expect(card).toBeHidden()
  } finally {
    await app.close()
  }
})
