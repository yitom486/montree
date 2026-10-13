import { test, expect } from '@playwright/test'
import { launchBuiltApp } from './helpers/launch-app'

/**
 * Agent 面板壳冒烟：不依赖真实 codex-acp。
 * 权限按钮浮现 / session resume 的深层路径由 Vitest 单元+集成覆盖。
 */
test.describe('Agent 面板壳', () => {
  test('可打开 Agent 聊天区并看到连接入口', async () => {
    const app = await launchBuiltApp()

    try {
      const window = await app.firstWindow()
      await window.waitForLoadState('domcontentloaded')
      await expect(window.getByRole('button',   { name: '更多操作', exact: true })).toBeVisible({
        timeout: 15_000,
      })

      const agentToggle = window.getByRole('button', { name: 'AI 伴读', exact: true })
      await expect(agentToggle).toBeVisible({ timeout: 10_000 })

      // docked 面板常驻挂载（折叠不断挂），floating 开启时再挂第二个：
      // 全页 role 定位必然撞车，只认当前可见的那个（HUD 双形态设计如此）。
      const panel = window.locator('aside[aria-label="Agent 聊天"]:visible')
      if ((await panel.count()) === 0) {
        await agentToggle.click()
      }
      await expect(panel.first()).toBeVisible({ timeout: 10_000 })
      // 面板头已改为运行时名（旧 "Agent" 字样是阶段 9 前的叫法）：断言运行时切换器
      await expect(panel.getByTitle('点击切换 Agent 运行时')).toBeVisible()

      const connectOrHint = panel
        .getByRole('button', { name: '连接' })
        .or(panel.getByText(/请先打开工作区|开始与 Codex 对话|未连接/))
      await expect(connectOrHint.first()).toBeVisible({ timeout: 10_000 })
    } finally {
      await app.close()
    }
  })
})
