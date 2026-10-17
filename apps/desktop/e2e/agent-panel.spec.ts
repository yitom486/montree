import { test, expect } from '@playwright/test'
import { launchBuiltApp } from './helpers/launch-app'
import { resolve } from 'node:path'

/**
 * Agent 面板壳冒烟：不依赖真实 codex-acp。
 * 权限按钮浮现 / session resume 的深层路径由 Vitest 单元+集成覆盖。
 */
test.describe('Agent 面板壳', () => {
  test('窄屏参数与发送互不遮挡，聊天选区和输入框右键可用', async ({}, info) => {
    const app = await launchBuiltApp({ E2E_ACP_WINDOW_TEST: '1', E2E_ACP_COMPOSER_TEST: '1', E2E_ACP_COMMAND: process.execPath, E2E_ACP_FIXTURE: resolve('apps/desktop/e2e/fixtures/mock-window-agent.cjs') })
    try {
      const window = await app.firstWindow()
      await window.waitForLoadState('domcontentloaded')
      // 静置：等启动期 persist 节流排空，否则播种会被应用落盘覆盖
      await window.waitForTimeout(3000)
      await window.evaluate(() => {
        const scopeSuffix = (window.electronAPI?.windowScopeId && window.electronAPI.windowScopeId !== 'main' ? ':' + window.electronAPI.windowScopeId : '')
        localStorage.setItem('markdown-editor-ui', JSON.stringify({ version: 0, state: { theme: 'dark' } }))
        localStorage.setItem('montree-acp-ui' + scopeSuffix, JSON.stringify({ version: 0, state: { panelOpen: true, hudDisplayMode: 'docked', selectedRuntimeId: 'mock-window', activeThreadId: 'composer-test' } }))
        localStorage.setItem('montree-acp-metadata/v2' + scopeSuffix, JSON.stringify({ state: { panelOpen: true, hudDisplayMode: 'docked', selectedRuntimeId: 'mock-window', activeThreadId: 'composer-test' } }))
        localStorage.setItem('montree-chat-session/v1' + scopeSuffix, JSON.stringify({ version: 1, authorityVersion: 1, snapshot: {
          threads: [{ id: 'composer-test', hostThreadId: 'composer-test', runtimeId: 'mock-window', title: '输入框回归', feed: { messages: [], turnSettled: false } }],
          activeThreadId: 'composer-test',
          modelConfig: { runtimeId: 'mock-window' },
        } }))
        // 与 reload 同任务提交： persist 节流落盘与 reload 读取之间不留跨任务窗口。
        location.reload()
      })
      const panel = window.locator('aside[aria-label="Agent 聊天"]:visible').first()
      const input = panel.locator('textarea')
      await input.fill('identity')
      await panel.getByRole('button', { name: '发送', exact: true }).click()
      await expect(panel.locator('[data-slot="streaming-response"]').last()).toContainText('IDENTITY:')
      await expect(panel.getByTitle('Reasoning effort')).toBeVisible()
      for (const width of [320, 390, 480]) {
        await panel.evaluate((element, size) => { const host = element.closest('[data-panel]') as HTMLElement; host.style.flex = `0 0 ${size}px` }, width)
        const composer = panel.locator('[data-slot="agent-composer"]')
        const send = composer.getByRole('button', { name: '发送', exact: true })
        await expect(send).toBeInViewport({ ratio: 1 })
        const box = await send.boundingBox()
        expect(box!.width).toBeLessThanOrEqual(33)
        const controls = composer.locator('[data-slot="agent-composer-controls"]')
        expect(await controls.evaluate((element) => element.scrollWidth <= element.clientWidth + 1)).toBe(true)
        for (const control of await controls.locator('button, input').all()) {
          const rect = await control.boundingBox()
          if (rect) expect(rect.x + rect.width).toBeLessThanOrEqual(box!.x)
        }
        await expect(panel.getByTitle('Reasoning effort')).toBeVisible()
        if (width === 320) await composer.screenshot({ path: info.outputPath('composer-320-dark.png') })
      }
      await window.evaluate(() => { Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: (text: string) => { document.documentElement.dataset.chatCopied = text; return Promise.resolve() }, readText: () => Promise.resolve('粘贴内容') } }) })
      const userText = panel.locator('[data-bui-message="user"] .whitespace-pre-wrap').first()
      const select = async () => userText.evaluate((element) => { const range = document.createRange(); range.setStart(element.firstChild!, 0); range.setEnd(element.firstChild!, 3); const selection = window.getSelection()!; selection.removeAllRanges(); selection.addRange(range) })
      await select()
      await userText.click({ button: 'right', position: { x: 3, y: 5 } })
      const chatMenu = window.getByRole('menu', { name: '聊天操作' })
      await expect(chatMenu).toBeVisible()
      await chatMenu.getByRole('menuitem', { name: '复制选中文字', exact: true }).click()
      await expect(window.locator('html')).toHaveAttribute('data-chat-copied', 'ide')
      await select()
      await userText.dispatchEvent('contextmenu')
      await chatMenu.getByRole('menuitem', { name: '引用选中文字', exact: true }).click()
      await expect(input).toHaveValue('> ide\n\n')
      await input.fill('替换这段')
      await input.evaluate((element) => { element.focus(); element.setSelectionRange(0, element.value.length) })
      await input.dispatchEvent('contextmenu')
      const inputMenu = window.getByRole('menu', { name: '输入框操作' })
      await expect(inputMenu).toBeVisible()
      await inputMenu.getByRole('menuitem', { name: '粘贴文本', exact: true }).click()
      await expect(input).toHaveValue('粘贴内容')
      // 粘贴在下一帧恢复光标；等待完成后再建立剪切选区，避免被旧恢复覆盖。
      await expect.poll(() => input.evaluate((element) => [element.selectionStart, element.selectionEnd])).toEqual([4, 4])
      await input.evaluate((element) => { element.focus(); element.setSelectionRange(0, 2) })
      await input.dispatchEvent('contextmenu')
      await inputMenu.getByRole('menuitem', { name: '剪切', exact: true }).click()
      await expect(input).toHaveValue('内容')
      await expect(window.locator('html')).toHaveAttribute('data-chat-copied', '粘贴')
      await panel.locator('[data-acp-probe="message-list"]').dispatchEvent('contextmenu')
      await expect(chatMenu.getByRole('menuitem', { name: '回到底部', exact: true })).toBeVisible()
      await window.keyboard.press('Escape')
      await expect(chatMenu).toBeHidden()
    } finally { await app.close() }
  })

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
