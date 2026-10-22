import { test, expect } from '@playwright/test'
import { launchBuiltApp } from './helpers/launch-app'

test('行内补全可以单独配置 provider 并恢复跟随 Agent', async () => {
  const app = await launchBuiltApp({ E2E_INLINE_COMPLETION_MOCK: '1' })
  try {
    const window = await app.firstWindow()
    await window.waitForLoadState('domcontentloaded')
    await window.getByRole('button', { name: '更多操作', exact: true }).click()
    await window.getByRole('menuitem', { name: /设置/ }).click()

    const settings = window.getByRole('dialog', { name: '设置' })
    await settings.getByRole('button', { name: '配置', exact: true }).click()

    const dialog = window.getByRole('dialog', { name: '行内补全模型' })
    await expect(dialog).toBeVisible()
    await dialog.locator('select').nth(1).selectOption('ollama')
    await expect(dialog.getByPlaceholder('https://api.openai.com/v1')).toHaveValue('http://localhost:11434/v1')
    await dialog.getByPlaceholder('gpt-4.1-mini').fill('qwen2.5-coder:7b')
    await dialog.getByRole('button', { name: '保存', exact: true }).click()

    await expect(dialog).toHaveCount(0)
    await expect(settings.getByText('单独配置 · qwen2.5-coder:7b')).toBeVisible()

    await settings.getByRole('button', { name: '配置', exact: true }).click()
    await dialog.getByRole('button', { name: '清除补全配置' }).click()
    await expect(dialog).toHaveCount(0)
    await expect(settings.getByText('未配置')).toBeVisible()

    await settings.getByRole('button', { name: '配置', exact: true }).click()
    await dialog.locator('select').first().selectOption('chatgpt')
    await expect(dialog.getByText('尚未登录 ChatGPT')).toBeVisible()
    await expect(dialog.getByRole('button', { name: '登录', exact: true })).toBeVisible()
    await dialog.getByRole('button', { name: '取消' }).click()
  } finally {
    await app.close()
  }
})
