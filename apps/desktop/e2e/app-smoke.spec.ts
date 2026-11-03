import { test, expect } from '@playwright/test'
import { launchBuiltApp } from './helpers/launch-app'
import { mockAgentEnv } from './helpers/mock-agent'

test.describe('应用启动', () => {
  test('未绑定窗口不能凭 renderer workspaceId 读写远端会话', async () => {
    const app = await launchBuiltApp()
    try {
      const window = await app.firstWindow()
      await window.waitForLoadState('domcontentloaded')
      const results = await window.evaluate(async () => {
        const api = window.electronAPI
        const workspaceId = 'wsl:Ubuntu:/another-window'
        return [
          await api.workspaceReadText({ workspaceId, relativePath: 'secret.md' }),
          await api.workspaceSaveTextAs({ workspaceId, fileName: 'new.md', content: 'denied' }),
        ]
      })
      for (const result of results) {
        expect(result.ok).toBe(false)
        if (!result.ok) expect(result.error.code).toBe('INVALID_STATE')
      }
    } finally {
      await app.close()
    }
  })

  test('主窗口加载并显示欢迎页与资源管理器菜单', async () => {
    // 设置会独立读取翻译模型目录；冒烟不依赖 CI 上未安装、未登录的真实 Agent。
    const app = await launchBuiltApp(mockAgentEnv(''))

    try {
      const window = await app.firstWindow()
      await window.waitForLoadState('domcontentloaded')
      await window.evaluate(() => {
        const settings = JSON.parse(localStorage.getItem('markdown-editor-settings') ?? '{"state":{}}')
        settings.state.translationRuntimeId = 'mock-window'
        localStorage.setItem('markdown-editor-settings', JSON.stringify(settings))
      })
      await window.reload()
      await expect(window.getByRole('button', { name: '更多操作', exact: true })).toBeVisible({
        timeout: 15_000,
      })
      await expect(window.getByRole('heading', { name: 'Montree' })).toBeVisible()

      // 设置入口已迁入资源管理器 ⋯ 菜单（顶栏 TitleBar 已删除）
      await window.getByRole('button', { name: '更多操作', exact: true }).click()
      await window.getByRole('menuitem', { name: /设置/ }).click()
      await expect(window.getByRole('dialog', { name: '设置' })).toBeVisible({ timeout: 10_000 })
      await expect(window.getByRole('status').filter({ hasText: '正在读取翻译模型配置' })).toHaveCount(0)
      await window.keyboard.press('Escape')
      await expect(window.getByRole('dialog', { name: '设置' })).toBeHidden()
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
