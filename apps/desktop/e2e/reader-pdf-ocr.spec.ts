import { copyFile, mkdtemp } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { tmpdir } from 'node:os'
import { test, expect, type Page } from '@playwright/test'
import { launchBuiltApp } from './helpers/launch-app'

/**
 * 扫描版 PDF 单页 OCR 回归：
 * 1. 无文字层当前页打开即自动识别（不点按钮）：自动失败时把 [pdf-auto-ocr] 诊断直接作为失败原因；
 * 2. 工具栏出现「已识别」且文字层含识别文本（几何链路不断）。
 * 引擎走主进程 pdf-inspector（失败回退 tesseract，不影响断言）。
 * 本地如设 PDFIUM_LIB_PATH / ORT_DYLIB_PATH / PDF_INSPECTOR_MODEL_CACHE
 * 则复用本地运行时免下载，CI 走在线下载链路。
 */

const INSPECTOR_ENV_KEYS = [
  'PDFIUM_LIB_PATH',
  'ORT_DYLIB_PATH',
  'PDF_INSPECTOR_MODEL_CACHE',
] as const

const __dirname = dirname(fileURLToPath(import.meta.url))

async function openViaQuickOpen(window: Page, fileName: string, query: string): Promise<void> {
  await window.keyboard.press('Control+p')
  const dialog = window.getByRole('dialog', { name: '快速打开文件' })
  await expect(dialog).toBeVisible({ timeout: 10_000 })
  await dialog.getByPlaceholder('搜索工作区文件或电子书...').fill(query)
  await expect(dialog.getByText(fileName).first()).toBeVisible({ timeout: 10_000 })
  await window.keyboard.press('Enter')
  await expect(dialog).toBeHidden({ timeout: 10_000 })
}

test.describe('扫描版 PDF 单页 OCR', () => {
  test('识别本页落缓存且文字层可读', async () => {
    test.setTimeout(300_000)
    const workspace = await mkdtemp(join(tmpdir(), 'montree-e2e-pdf-ocr-'))
    await copyFile(
      join(__dirname, 'fixtures', 'ocr', 'scanned-hello.pdf'),
      join(workspace, 'scanned-hello.pdf'),
    )
    const extraEnv: Record<string, string> = { E2E_AUTO_OPEN_PATH: workspace }
    for (const key of INSPECTOR_ENV_KEYS) {
      const value = process.env[key]
      if (value) extraEnv[key] = value
    }
    const app = await launchBuiltApp(extraEnv)

    try {
      const window = await app.firstWindow()
      const autoOcrFailures: string[] = []
      window.on('console', (msg) => {
        if (msg.text().includes('[pdf-auto-ocr]')) autoOcrFailures.push(msg.text())
      })
      await window.waitForLoadState('domcontentloaded')
      await expect(window.getByRole('button',   { name: '更多操作', exact: true })).toBeVisible({
        timeout: 15_000,
      })
      await window.getByRole('button',   { name: '更多操作', exact: true }).click()
      await window.getByRole('menuitem', { name: /打开文件夹/ }).click()
      await expect(window.getByText('scanned-hello.pdf').first()).toBeVisible({
        timeout: 15_000,
      })

      await openViaQuickOpen(window, 'scanned-hello.pdf', 'scanned-hello.pdf')

      const panel = window.locator('#main')
      await expect(panel.getByText('1 / 1').first()).toBeVisible({ timeout: 20_000 })
      await expect(panel.locator('canvas').first()).toBeVisible({ timeout: 10_000 })

      const more = panel.getByRole('button', { name: '更多工具' })
      await expect(more).toBeVisible({ timeout: 20_000 })

      // 自动 OCR 链路：不点「识别本页」，必须自行出文字层；失败诊断来自渲染进程 console 与错误 toast
      const done = panel.getByText(/已识别 \d+\/\d+/)
      const errorToast = window.locator('[data-sonner-toast][data-type="error"]').filter({ hasText: /OCR|识别/ })
      const deadline = Date.now() + 240_000
      while (!(await done.isVisible())) {
        if (autoOcrFailures.length) throw new Error(`自动 OCR 失败：${autoOcrFailures.join(' | ')}`)
        if (await errorToast.count()) throw new Error(`OCR 错误提示：${await errorToast.first().textContent()}`)
        if (Date.now() > deadline) throw new Error('自动 OCR 240s 内未出结果（无失败诊断）')
        await window.waitForTimeout(500)
      }
      await expect(panel.locator('.pdf-text-layer-host')).toContainText('Hello', {
        timeout: 10_000,
      })
    } finally {
      await app.close()
    }
  })
})
