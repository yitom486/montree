import { mkdtemp, mkdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { test, expect } from '@playwright/test'
import { launchBuiltApp } from './helpers/launch-app'
import { connectMockAgent, mockAgentEnv, sendToAgent } from './helpers/mock-agent'

// 新用例不允许靠重试掩盖抖动（全局 CI retries=1 对本文件关闭）
test.describe.configure({ retries: 0 })

/**
 * Agent 无头终端（ACP terminal/create）审批：拒绝 → 允许一次 → 信任此工作区 → 之后免审；
 * 每次决定写入审计日志。
 */
const shotDir = process.env.ROUND4_SCREENSHOT_DIR

test('Agent 终端命令先审批：拒绝/允许一次/信任此工作区，并写审计日志', async () => {
  test.setTimeout(120_000)
  const workspace = await mkdtemp(join(tmpdir(), 'montree-term-approval-'))
  const app = await launchBuiltApp(mockAgentEnv(workspace))
  try {
    const page = await app.firstWindow()
    await page.waitForLoadState('domcontentloaded')
    await connectMockAgent(page, 'terminal-thread')
    const chat = page.getByRole('region', { name: 'Agent 聊天' })
    const spec = JSON.stringify({ command: process.execPath, args: ['-e', "console.log('HELLO_TERMINAL')"] })
    const run = async (choice: '拒绝' | '允许一次' | '信任此工作区' | null, expected: RegExp, index: number) => {
      const before = await chat.getByText(expected).count()
      await sendToAgent(page, `terminal:${spec}`)
      if (choice) {
        const card = chat.getByText(/运行命令：/).last()
        await expect(card).toBeVisible({ timeout: 20_000 })
        if (index === 0 && shotDir) { await mkdir(shotDir, { recursive: true }); await page.screenshot({ path: join(shotDir, 'terminal-approval-card.png') }) }
        await chat.getByRole('button', { name: choice, exact: true }).last().click()
      }
      await expect.poll(() => chat.getByText(expected).count(), { timeout: 20_000 }).toBeGreaterThan(before)
    }
    await run('拒绝', /TERMINAL:denied\|用户拒绝/, 0)
    await run('允许一次', /TERMINAL:ok\|HELLO_TERMINAL/, 1)
    await run('信任此工作区', /TERMINAL:ok\|HELLO_TERMINAL/, 2)
    // 已信任：不再出审批卡
    const cardsBefore = await chat.getByText(/运行命令：/).count()
    await run(null, /TERMINAL:ok\|HELLO_TERMINAL/, 3)
    expect(await chat.getByText(/运行命令：/).count()).toBe(cardsBefore)

    const userData = await app.evaluate(({ app }) => app.getPath('userData'))
    const audit = (await readFile(join(userData, 'logs', 'agent-terminal-audit.jsonl'), 'utf8')).trim().split('\n').map((line) => JSON.parse(line))
    expect(audit.map((row) => row.decision)).toEqual(['rejected', 'allowed-once', 'trusted-now', 'trusted'])
    expect(audit[0].command).toBe(process.execPath)
    const trust = JSON.parse(await readFile(join(userData, 'agent-terminal-trust.json'), 'utf8'))
    expect(trust.workspaces).toHaveLength(1)
  } finally {
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().forEach((window) => window.removeAllListeners('close')))
    await app.close()
  }
})
