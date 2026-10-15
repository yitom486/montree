import { mkdtemp, writeFile, mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { test, expect } from '@playwright/test'
import { launchBuiltApp } from './helpers/launch-app'

test.describe('全局快速打开', () => {
  test('路径栏：上级菜单定位目录，窄栏保留文件名与未保存标记', async ({}, info) => {
    const workspace = await mkdtemp(join(tmpdir(), 'montree-e2e-breadcrumb-'))
    const parent = join(workspace, 'notes', '研究材料', '长目录名称用于检查路径折叠')
    await mkdir(parent, { recursive: true })
    await writeFile(join(parent, '正文.md'), '# Breadcrumb\n')
    const app = await launchBuiltApp({ E2E_AUTO_OPEN_PATH: workspace })
    try {
      const window = await app.firstWindow()
      await window.getByRole('button', { name: '更多操作', exact: true }).click()
      await window.getByRole('menuitem', { name: /打开文件夹/ }).click()
      await window.keyboard.press('Control+p')
      const dialog = window.getByRole('dialog', { name: '快速打开文件' })
      await dialog.getByPlaceholder('搜索工作区文件或电子书...').fill('正文')
      await expect(dialog.getByText('正文.md', { exact: true })).toBeVisible()
      await window.keyboard.press('Enter')
      const breadcrumb = window.getByRole('navigation', { name: '文件路径' })
      await expect(breadcrumb.locator('[aria-current="page"]')).toContainText('正文.md')
      const fileRow = window.getByRole('button', { name: '正文.md', exact: true })
      await fileRow.click({ button: 'right' })
      const contextMenu = window.getByRole('menu', { name: '文件操作' })
      await expect(contextMenu).toBeVisible()
      await expect(contextMenu.getByRole('menuitem', { name: '粘贴', exact: true })).toHaveAttribute('data-disabled', '')
      await window.keyboard.press('Escape')
      await expect(contextMenu).toBeHidden()
      await fileRow.press('Shift+F10')
      await expect(contextMenu).toBeVisible()
      const bounds = await contextMenu.boundingBox()
      const size = await window.evaluate(() => ({ width: innerWidth, height: innerHeight }))
      expect(bounds!.x).toBeGreaterThanOrEqual(8)
      expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(size.height - 7)
      await contextMenu.screenshot({ path: info.outputPath('file-context-menu.png') })
      // 系统剪贴板依赖桌面焦点；同仓库代码复制测试，在浏览器边界捕获业务参数。
      await window.evaluate(() => {
        Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: (text: string) => { document.documentElement.dataset.copiedPath = text; return Promise.resolve() } } })
      })
      await contextMenu.getByRole('menuitem', { name: '复制完整路径', exact: true }).click()
      await expect(window.locator('html')).toHaveAttribute('data-copied-path', join(parent, '正文.md'))
      await expect(window.getByText('已复制完整路径', { exact: true })).toBeVisible()
      const directory = window.locator('[data-directory-path]').filter({ has: window.getByText('长目录名称用于检查路径折叠', { exact: true }) }).last()
      const toggle = directory.getByRole('button').first()
      await toggle.click()
      await expect(toggle).toHaveAttribute('aria-expanded', 'false')
      await breadcrumb.getByRole('button', { name: '显示上级路径' }).focus()
      await window.keyboard.press('Enter')
      await window.getByRole('menuitem', { name: '长目录名称用于检查路径折叠', exact: true }).click()
      await expect(toggle).toHaveAttribute('aria-expanded', 'true')
      await expect(directory).toHaveClass(/bg-accent/)
      await expect(breadcrumb.locator('[aria-current="page"]')).toContainText('正文.md')
      const editor = window.locator('.cm-content').first()
      await editor.click()
      await window.keyboard.type('modified')
      await expect(breadcrumb.getByLabel('未保存')).toBeVisible()
      await breadcrumb.evaluate((el) => { el.style.width = '210px'; el.style.flex = '0 0 210px' })
      await expect(breadcrumb.getByRole('button', { name: '长目录名称用于检查路径折叠', exact: true })).toBeHidden()
      expect(await breadcrumb.evaluate((el) => el.scrollWidth <= el.clientWidth + 1)).toBe(true)
      await expect(breadcrumb.locator('[aria-current="page"]')).toBeVisible()
      await breadcrumb.locator('..').screenshot({ path: info.outputPath('breadcrumb-narrow.png') })
      await window.keyboard.press('Control+s')
      await expect(breadcrumb.getByLabel('未保存')).toHaveCount(0)
    } finally { await app.close() }
  })

  test('打开文件夹后 Ctrl+P 搜索并打开 Markdown', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'montree-e2e-quickopen-'))
    await mkdir(join(workspace, 'notes'), { recursive: true })
    await writeFile(join(workspace, 'notes', 'vue-guide.md'), '# Vue Guide\n\nhello vue\n')
    await writeFile(join(workspace, 'notes', 'react-guide.md'), '# React Guide\n\nhello react\n')

    const app = await launchBuiltApp({ E2E_AUTO_OPEN_PATH: workspace })

    try {
      const window = await app.firstWindow()
      await window.waitForLoadState('domcontentloaded')
      await expect(window.getByRole('button',   { name: '更多操作', exact: true })).toBeVisible({
        timeout: 15_000,
      })

      // 经真实菜单打开文件夹（原生对话框被 E2E_AUTO_OPEN_PATH 短路）
      await window.getByRole('button',   { name: '更多操作', exact: true }).click()
      await window.getByRole('menuitem', { name: /打开文件夹/ }).click()
      await expect(window.getByText('vue-guide.md').first()).toBeVisible({ timeout: 15_000 })

      // Ctrl+P 呼出并搜索
      await window.keyboard.press('Control+p')
      const dialog = window.getByRole('dialog', { name: '快速打开文件' })
      await expect(dialog).toBeVisible({ timeout: 10_000 })
      await dialog.getByPlaceholder('搜索工作区文件或电子书...').fill('vue')
      await expect(dialog.getByText('vue-guide.md').first()).toBeVisible({ timeout: 10_000 })
      await window.keyboard.press('Enter')

      // 对话框关闭且编辑器打开目标文件
      await expect(dialog).toBeHidden({ timeout: 10_000 })
      await expect(window.getByText('vue-guide.md').first()).toBeVisible({ timeout: 10_000 })
    } finally {
      await app.close()
    }
  })
})
