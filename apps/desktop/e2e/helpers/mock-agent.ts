import { resolve } from 'node:path'
import { expect, type Page } from '@playwright/test'
import { seedMockChatThread } from './seed-chat'

/** mock ACP Agent（fixtures/mock-window-agent.cjs）所需环境变量。 */
export function mockAgentEnv(workspace: string, extra: Record<string, string> = {}): Record<string, string> {
  return {
    E2E_AUTO_OPEN_PATH: workspace,
    E2E_ACP_WINDOW_TEST: '1',
    E2E_ACP_COMMAND: process.execPath,
    E2E_ACP_FIXTURE: resolve('apps/desktop/e2e/fixtures/mock-window-agent.cjs'),
    ...extra,
  }
}

/** 播种聊天线程、打开面板并连接 mock Agent。 */
export async function connectMockAgent(page: Page, threadId = 'mock-thread'): Promise<void> {
  await seedMockChatThread(page, { id: threadId, title: 'mock' })
  await expect(page.getByRole('button', { name: '更多操作', exact: true })).toBeVisible({ timeout: 15_000 })
  const connected = await page.evaluate(() => (window as any).electronAPI.acpConnect({ runtimeId: 'mock-window' }))
  expect(connected.ok, JSON.stringify(connected)).toBe(true)
}

/** 经聊天输入框发一条消息给 mock Agent。 */
export async function sendToAgent(page: Page, text: string): Promise<void> {
  const chat = page.getByRole('region', { name: 'Agent 聊天' })
  await chat.locator('textarea').first().fill(text)
  await chat.getByRole('button', { name: '发送', exact: true }).click()
}
