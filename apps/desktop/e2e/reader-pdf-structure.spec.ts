import { mkdtemp } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { test, expect, type Page } from '@playwright/test'
import { launchBuiltApp } from './helpers/launch-app'
import { writeReaderSmokeWorkspace } from './helpers/ebook-fixture'

/**
 * PDF Agent 正文回归（E2E_PDF_STRUCTURE 门控）：
 * 1. 主进程 inspector 整档解析真实链路（status ready，source inspector）；
 * 2. Agent 当前页正文内容正确（页码头 + fixture 正文）。
 * WASM 静默回退逻辑由单测与代码审查覆盖，此处锁定主链路。
 */

async function openViaQuickOpen(window: Page, fileName: string, query: string): Promise<void> {
  await window.keyboard.press('Control+p')
  const dialog = window.getByRole('dialog', { name: '快速打开文件' })
  await expect(dialog).toBeVisible({ timeout: 10_000 })
  await dialog.getByPlaceholder('搜索工作区文件或电子书...').fill(query)
  await expect(dialog.getByText(fileName).first()).toBeVisible({ timeout: 10_000 })
  await window.keyboard.press('Enter')
  await expect(dialog).toBeHidden({ timeout: 10_000 })
}

test.describe('PDF Agent 正文（主进程 inspector）', () => {
  test('生产包解析整档且 Agent 正文走 inspector 路径', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'montree-e2e-pdf-structure-'))
    const { pdfName } = await writeReaderSmokeWorkspace(workspace)
    const app = await launchBuiltApp({
      E2E_AUTO_OPEN_PATH: workspace,
      E2E_PDF_STRUCTURE: '1',
    })

    try {
      const window = await app.firstWindow()
      await window.waitForLoadState('domcontentloaded')
      await expect(window.getByRole('button',   { name: '更多操作', exact: true })).toBeVisible({
        timeout: 15_000,
      })
      await window.getByRole('button',   { name: '更多操作', exact: true }).click()
      await window.getByRole('menuitem', { name: /打开文件夹/ }).click()
      await expect(window.getByText(pdfName).first()).toBeVisible({ timeout: 15_000 })

      await openViaQuickOpen(window, pdfName, 'smoke-sample.pdf')

      const panel = window.locator('#main')
      await expect(panel.getByText('1 / 1').first()).toBeVisible({ timeout: 20_000 })
      await expect(panel.locator('canvas').first()).toBeVisible({ timeout: 10_000 })

      const result = await window.evaluate(async () => {
        const hook = window.__montreeE2ePdfStructure
        if (!hook) return null
        return {
          read: await hook.readCurrentPage(),
          status: hook.inspectorStatus(),
        }
      })

      expect(result, 'E2E 钩子未挂载（门控未生效？）').not.toBeNull()
      expect(result!.status.status).toBe('ready')
      expect(result!.read.source).toBe('inspector')
      expect(result!.read.prefix).toContain('【PDF 第 1/1 页】')
      expect(result!.read.prefix).toContain('Montree E2E minimal PDF paragraph.')
    } finally {
      await app.close()
    }
  })
})
