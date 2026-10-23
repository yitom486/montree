import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test, expect, type Page } from '@playwright/test'
import { launchBuiltApp } from './helpers/launch-app'

async function openWorkspaceFile(page: Page, name: string) {
  await page.getByRole('button', { name: '更多操作', exact: true }).click()
  await page.getByRole('menuitem', { name: /打开文件夹/ }).click()
  await page.keyboard.press('Control+p')
  const dialog = page.getByRole('dialog', { name: '快速打开文件' })
  await dialog.getByPlaceholder('搜索工作区文件或电子书...').fill(name)
  await dialog.getByRole('button').filter({ hasText: name }).first().click()
  await expect(dialog).toBeHidden()
}

test('HTML 预览在独立源运行：拿不到应用接口，存储与相对资源照常可用，缩放经桥接生效', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'montree-html-isolation-'))
  await mkdir(join(workspace, 'assets'))
  await writeFile(join(workspace, 'assets', 'style.css'), '#title { color: rgb(255, 0, 0); }')
  await writeFile(join(workspace, 'assets', 'app.js'), "document.body.insertAdjacentHTML('beforeend', '<p>EXTERNAL-JS-LOADED</p>')")
  await writeFile(join(workspace, 'probe.html'), `<!doctype html>
<html><head><link rel="stylesheet" href="assets/style.css"></head><body>
  <h1 id="title">ISOLATION-PROBE</h1>
  <p id="parent"></p>
  <p id="storage"></p>
  <script>
    let parentAccess
    try { parentAccess = typeof window.parent.electronAPI + '/' + typeof window.parent.montreeTerminal } catch (error) { parentAccess = 'blocked' }
    document.getElementById('parent').textContent = 'PARENT:' + parentAccess
    localStorage.setItem('probe', 'kept')
    document.getElementById('storage').textContent = 'STORAGE:' + localStorage.getItem('probe')
  </script>
  <script src="assets/app.js"></script>
</body></html>`)
  const app = await launchBuiltApp({ E2E_AUTO_OPEN_PATH: workspace })
  try {
    const page = await app.firstWindow()
    await page.waitForLoadState('domcontentloaded')
    await openWorkspaceFile(page, 'probe.html')

    const frame = page.frameLocator('iframe[title="HTML Preview"]')
    await expect(frame.getByText('ISOLATION-PROBE')).toBeVisible()
    await expect(frame.getByText('PARENT:blocked')).toBeVisible()
    await expect(frame.getByText('STORAGE:kept')).toBeVisible()
    await expect(frame.getByText('EXTERNAL-JS-LOADED')).toBeVisible()
    await expect(frame.locator('#title')).toHaveCSS('color', 'rgb(255, 0, 0)')
    expect(await page.locator('iframe[title="HTML Preview"]').getAttribute('src')).toMatch(/^montree-html:\/\//)

    await page.getByTitle('放大', { exact: true }).click()
    await expect.poll(() => frame.locator('body').evaluate((body) => (body as HTMLElement).style.zoom)).toBe('110%')
  } finally {
    await app.close()
  }
})
