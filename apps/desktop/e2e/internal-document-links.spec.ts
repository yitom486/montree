import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test, expect, type Page } from '@playwright/test'
import { launchBuiltApp } from './helpers/launch-app'

async function openWorkspace(page: Page) {
  await page.getByRole('button', { name: '更多操作', exact: true }).click()
  await page.getByRole('menuitem', { name: /打开文件夹/ }).click()
}

async function quickOpen(page: Page, name: string) {
  // 点击 HTML 内链后焦点落在 iframe；先把焦点还给宿主窗口，否则 Ctrl+P 不会到应用。
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur())
  await page.keyboard.press('Control+p')
  const dialog = page.getByRole('dialog', { name: '快速打开文件' })
  await dialog.getByPlaceholder('搜索工作区文件或电子书...').fill(name)
  await dialog.getByRole('button').filter({ hasText: name }).first().click()
  await expect(dialog).toBeHidden()
}

test('HTML 侧栏与 Markdown 内链在应用内切换文档，不把应用自身加载进 iframe', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'montree-internal-links-'))
  await writeFile(join(workspace, 'index.html'), '<!doctype html><html><body><a href="index.html#detail">同页详情</a><h1>INDEX-PAGE</h1><div style="height:2000px"></div><h2 id="detail">DETAIL-SECTION</h2></body></html>')
  await writeFile(join(workspace, '01.html'), '<!doctype html><html><body><nav><a href="index.html#detail">总览</a></nav><h1>DETAIL-PAGE</h1></body></html>')
  await writeFile(join(workspace, 'doc.md'), '# Doc\n\n[Other document](other.md)\n')
  await writeFile(join(workspace, 'other.md'), '# Other heading\n\nOTHER-DOCUMENT-CONTENT\n')
  const app = await launchBuiltApp({ E2E_AUTO_OPEN_PATH: workspace })
  try {
    const page = await app.firstWindow()
    await page.waitForLoadState('domcontentloaded')
    await openWorkspace(page)

    await quickOpen(page, '01.html')
    const htmlFrame = page.frameLocator('iframe[title="HTML Preview"]')
    await expect(htmlFrame.getByText('DETAIL-PAGE')).toBeVisible()
    await htmlFrame.getByRole('link', { name: '总览' }).click()
    await expect(htmlFrame.getByText('INDEX-PAGE')).toBeVisible()
    await expect(htmlFrame.getByText('DETAIL-SECTION')).toBeInViewport()
    await htmlFrame.getByRole('link', { name: '同页详情' }).click()
    await expect(htmlFrame.getByText('DETAIL-SECTION')).toBeInViewport()
    await expect(page.getByText(/preload 未成功注入/)).toHaveCount(0)

    await quickOpen(page, 'doc.md')
    await page.getByRole('button', { name: '独立预览', exact: true }).click()
    await page.locator('.markdown-preview').getByRole('link', { name: 'Other document' }).click()
    await expect(page.locator('.cm-content')).toContainText('OTHER-DOCUMENT-CONTENT')
  } finally {
    await app.close()
  }
})
