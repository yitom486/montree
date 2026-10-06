import { test, expect } from '@playwright/test'
import { launchBuiltApp } from './helpers/launch-app'

test.describe('应用启动', () => {
  test('主窗口加载并显示欢迎页与资源管理器菜单', async () => {
    const app = await launchBuiltApp()

    try {
      const window = await app.firstWindow()
      await window.waitForLoadState('domcontentloaded')
      await expect(window.getByRole('button', { name: '更多操作', exact: true })).toBeVisible({
        timeout: 15_000,
      })
      await expect(window.getByRole('heading', { name: 'Montree' })).toBeVisible()

      // 设置入口已迁入资源管理器 ⋯ 菜单（顶栏 TitleBar 已删除）
      await window.getByRole('button', { name: '更多操作', exact: true }).click()
      await window.getByRole('menuitem', { name: /设置/ }).click()
      await expect(window.getByRole('dialog', { name: '设置' })).toBeVisible({ timeout: 10_000 })
    } finally {
      await app.close()
    }
  })

  test('Ctrl+Shift+N 新建窗口', async () => {
    const app = await launchBuiltApp()

    try {
      const window = await app.firstWindow()
      await window.waitForLoadState('domcontentloaded')
      await expect(window.getByRole('button', { name: '更多操作', exact: true })).toBeVisible({
        timeout: 15_000,
      })

      await window.keyboard.press('Control+Shift+N')
      await expect
        .poll(() => app.windows().length, { timeout: 15_000, message: '等待新窗口打开' })
        .toBe(2)

      // ⋯ 菜单新建窗口同样可用
      await window.getByRole('button', { name: '更多操作', exact: true }).click()
      await window.getByRole('menuitem', { name: '新建窗口' }).click()
      await expect
        .poll(() => app.windows().length, { timeout: 15_000, message: '等待菜单新窗口打开' })
        .toBe(3)
    } finally {
      await app.close()
    }
  })
})
