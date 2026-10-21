import { mkdtemp, mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { test, expect } from '@playwright/test'
import { launchBuiltApp } from './helpers/launch-app'
import { connectMockAgent, mockAgentEnv, sendToAgent } from './helpers/mock-agent'

/**
 * 聊天正文链接与窗口导航防护：
 * - http(s) 链接交系统浏览器（shell.openExternal），应用窗口不跳走；
 * - file:// / 自定义协议链接不打开、不导航；
 * - 主框架 location 跳转与 window.open 同样受 will-navigate / setWindowOpenHandler 约束。
 */
const shotDir = process.env.ROUND4_SCREENSHOT_DIR

test('聊天链接走系统浏览器，本地文件/自定义协议与主框架跳转被拦截', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'montree-chat-links-'))
  const app = await launchBuiltApp(mockAgentEnv(workspace))
  try {
    // 记录 openExternal 而不真的拉起浏览器
    await app.evaluate(({ shell }) => {
      const calls: string[] = []
      ;(globalThis as any).__openExternalCalls = calls
      shell.openExternal = async (url: string) => { calls.push(url) }
    })
    const calls = () => app.evaluate(() => (globalThis as any).__openExternalCalls as string[])
    const page = await app.firstWindow()
    await page.waitForLoadState('domcontentloaded')
    const appUrl = page.url()
    await connectMockAgent(page, 'links-thread')
    await sendToAgent(page, 'echo-md:见 [官方文档](https://react.dev/learn)、[本地文件](file:///etc/hosts) 与 [协议](smb://host/share)。')
    const chat = page.getByRole('region', { name: 'Agent 聊天' })
    const web = chat.getByRole('link', { name: '官方文档' })
    await expect(web).toBeVisible({ timeout: 20_000 })
    await web.click()
    await expect.poll(calls).toEqual(['https://react.dev/learn'])

    for (const name of ['本地文件', '协议']) {
      const link = chat.getByRole('link', { name })
      if (await link.count()) await link.click()
      else await expect(chat.getByText(name).first()).toBeVisible()
    }
    await page.waitForTimeout(500)
    expect(page.url()).toBe(appUrl)
    expect(await calls()).toEqual(['https://react.dev/learn'])
    if (shotDir) { await mkdir(shotDir, { recursive: true }); await page.screenshot({ path: join(shotDir, 'chat-links.png') }) }

    // 主框架跳转：http(s) 交系统、file:// 拦截；window.open 一律不开新窗
    await page.evaluate(() => { window.location.href = 'https://example.com/nav' })
    await expect.poll(calls).toContain('https://example.com/nav')
    await page.evaluate(() => { window.location.href = 'file:///etc/hosts' })
    await page.evaluate(() => { window.open('file:///etc/passwd'); window.open('https://example.com/popup') })
    await expect.poll(calls).toContain('https://example.com/popup')
    await page.waitForTimeout(500)
    expect(page.url()).toBe(appUrl)
    expect(app.windows()).toHaveLength(1)
    expect((await calls()).some((url) => url.startsWith('file:'))).toBe(false)
  } finally {
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().forEach((window) => window.removeAllListeners('close')))
    await app.close()
  }
})
