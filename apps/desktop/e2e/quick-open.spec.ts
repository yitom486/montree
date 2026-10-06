import { mkdtemp, writeFile, mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { test, expect } from '@playwright/test'
import { launchBuiltApp } from './helpers/launch-app'

test.describe('全局快速打开', () => {
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
