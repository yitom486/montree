import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test, expect } from '@playwright/test'
import { launchBuiltApp } from './helpers/launch-app'
import { connectMockAgent, mockAgentEnv, sendToAgent } from './helpers/mock-agent'

// 新用例不允许靠重试掩盖抖动（全局 CI retries=1 对本文件关闭）
test.describe.configure({ retries: 0 })

test('Agent 进程在回合中被杀：随后写 stdin（取消/新消息）触发 EPIPE 不崩主进程，可重连继续对话', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'montree-epipe-'))
  const app = await launchBuiltApp(mockAgentEnv(workspace))
  try {
    // 回归哨兵：任何未捕获异常/错误框都记下来（修复前 EPIPE 会弹阻塞错误框）
    await app.evaluate(({ dialog }) => {
      const g = globalThis as any
      g.__epipeProbe = { uncaught: [] as string[], errorBoxes: [] as string[] }
      process.on('uncaughtException', (error) => g.__epipeProbe.uncaught.push(String(error)))
      dialog.showErrorBox = (title: string, content: string) => { g.__epipeProbe.errorBoxes.push(`${title}: ${content}`) }
    })
    const page = await app.firstWindow()
    await page.waitForLoadState('domcontentloaded')
    await connectMockAgent(page, 'epipe-thread')
    const chat = page.getByRole('region', { name: 'Agent 聊天' })
    await sendToAgent(page, 'pid')
    const pidText = await chat.getByText(/PID:\d+/).last().textContent({ timeout: 30_000 })
    const pid = Number(/PID:(\d+)/.exec(pidText ?? '')![1])
    expect(pid).toBeGreaterThan(0)

    // 回合进行中直接杀进程，并立即向已死的 stdin 连续写入
    process.kill(pid, 'SIGKILL')
    await Promise.allSettled(Array.from({ length: 5 }, () => page.evaluate(() => (window as any).electronAPI.acpCancel({}))))
    await expect.poll(() => { try { process.kill(pid, 0); return 'alive' } catch { return 'dead' } }).toBe('dead')
    await page.waitForTimeout(1000)

    // 主进程与窗口仍可用，没有未捕获异常或错误框
    expect(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length)).toBeGreaterThan(0)
    const probe = await app.evaluate(() => (globalThis as any).__epipeProbe)
    expect(probe).toEqual({ uncaught: [], errorBoxes: [] })
    expect(await page.evaluate(() => document.readyState)).toBe('complete')

    // 重连后继续对话
    const reconnected = await page.evaluate(() => (window as any).electronAPI.acpConnect({ runtimeId: 'mock-window' }))
    expect(reconnected.ok, JSON.stringify(reconnected)).toBe(true)
    await sendToAgent(page, 'echo-md:重连后仍可对话')
    await expect(chat.getByText('重连后仍可对话').last()).toBeVisible({ timeout: 30_000 })
    expect(await app.evaluate(() => (globalThis as any).__epipeProbe)).toEqual({ uncaught: [], errorBoxes: [] })
  } finally {
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().forEach((window) => window.removeAllListeners('close')))
    await app.close()
  }
})
