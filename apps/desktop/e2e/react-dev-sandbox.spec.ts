import { resolve } from 'node:path'
import { createServer } from 'vite'
import { expect, test } from '@playwright/test'
import { launchBuiltApp } from './helpers/launch-app'

test('React 开发模式：沙盒 iframe 属性不会卡死点击、输入与后续渲染', async () => {
  // 生产构建不包含 React 的开发版性能日志，必须通过真正的 Vite 开发服务回归。
  const server = await createServer({
    configFile: false,
    root: resolve('.'),
    cacheDir: resolve('.cache/react-dev-sandbox-vite'),
    server: { host: '127.0.0.1', port: 0 },
    optimizeDeps: {
      entries: ['apps/desktop/e2e/fixtures/react-dev-sandbox.html'],
      include: ['react', 'react-dom/client'],
    },
  })
  await server.listen()
  const app = await launchBuiltApp().catch(async (error) => {
    await server.close()
    throw error
  })
  try {
    await app.firstWindow()
    const pageReady = app.waitForEvent('window')
    const url = `${server.resolvedUrls!.local[0]}apps/desktop/e2e/fixtures/react-dev-sandbox.html`
    await app.evaluate(async ({ BrowserWindow }, fixtureUrl) => {
      const window = new BrowserWindow({ show: false, webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false } })
      await window.loadURL(fixtureUrl)
    }, url)
    const page = await pageReady
    const errors: string[] = []
    page.on('pageerror', (error) => errors.push(error.message))
    // 重新加载，让监听覆盖开发版的初次挂载。
    await page.reload()
    await expect(page.getByText('Preview ready', { exact: true })).toBeVisible()
    await page.getByRole('button', { name: 'Count: 0', exact: true }).click()
    await expect(page.getByRole('button', { name: 'Count: 1', exact: true })).toBeVisible({ timeout: 3000 })
    await page.getByRole('button', { name: 'Switch preview' }).click()
    await expect(page.getByText('Selected: 1', { exact: true })).toBeVisible()
    await page.getByRole('button', { name: 'Switch preview' }).click()
    await expect(page.getByText('Selected: 0', { exact: true })).toBeVisible()
    await page.getByPlaceholder('Type here').fill('页面保持响应')
    await expect(page.getByPlaceholder('Type here')).toHaveValue('页面保持响应')
    await expect(page.getByText('Typed: 页面保持响应', { exact: true })).toBeVisible()
    await page.getByRole('button', { name: 'Count: 1', exact: true }).click()
    await expect(page.getByRole('button', { name: 'Count: 2', exact: true })).toBeVisible()
    expect(errors).toEqual([])
  } finally {
    try {
      await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().forEach((window) => window.removeAllListeners('close')))
      await app.close()
    } finally {
      await server.close()
    }
  }
})
