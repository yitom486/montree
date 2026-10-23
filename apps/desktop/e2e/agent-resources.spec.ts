import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { test, expect } from '@playwright/test'
import { launchBuiltApp } from './helpers/launch-app'
import { screenshotWithoutToasts } from './helpers/screenshot'

test('会话菜单展示真实 MCP 发现状态与 Skills 完整说明，搜索和键盘关闭可用', async ({}, info) => {
  const home = await mkdtemp(join(tmpdir(), 'montree-resources-'))
  const skillDir = join(home, '.montree', 'skills', 'resource-test')
  const content = '---\nname: resource-test\ndescription: A skill for inspecting diagrams and documents\n---\n# Resource test\n\n## When to use\nUse this skill to review a diagram.\n\n## Steps\n1. Read the document.\n2. Explain each connection.\n\n```text\nreview diagram\n```\n\nFINAL_INSTRUCTION_SENTINEL\n'
  await mkdir(skillDir, { recursive: true })
  await writeFile(join(skillDir, 'SKILL.md'), content)
  const app = await launchBuiltApp({ USERPROFILE: home, HOME: home, CODEX_HOME: join(home, '.codex'), E2E_ACP_WINDOW_TEST: '1', E2E_ACP_COMMAND: process.execPath, E2E_ACP_FIXTURE: resolve('apps/desktop/e2e/fixtures/mock-window-agent.cjs') })
  try {
    const page = await app.firstWindow()
    await page.waitForLoadState('domcontentloaded')
    await page.waitForTimeout(3000)
    await page.evaluate(() => {
      const suffix = window.electronAPI?.windowScopeId && window.electronAPI.windowScopeId !== 'main' ? ':' + window.electronAPI.windowScopeId : ''
      const state = { panelOpen: true, hudDisplayMode: 'docked', selectedRuntimeId: 'mock-window', activeThreadId: 'resources-test' }
      localStorage.setItem('markdown-editor-ui', JSON.stringify({ version: 0, state: { theme: 'dark' } }))
      localStorage.setItem('montree-acp-ui' + suffix, JSON.stringify({ version: 0, state }))
      localStorage.setItem('montree-acp-metadata/v2' + suffix, JSON.stringify({ state }))
      localStorage.setItem('montree-chat-session/v1' + suffix, JSON.stringify({ version: 1, authorityVersion: 1, snapshot: { threads: [{ id: 'resources-test', hostThreadId: 'resources-test', runtimeId: 'mock-window', title: '资源详情', feed: { messages: [], turnSettled: false } }], activeThreadId: 'resources-test', modelConfig: { runtimeId: 'mock-window' } } }))
      location.reload()
    })
    const panel = page.locator('aside[aria-label="Agent 聊天"]:visible').first()
    const more = panel.getByRole('button', { name: '更多面板操作' })
    const open = async (name: string) => { await more.click(); await page.getByRole('menuitem', { name, exact: true }).click(); return page.getByRole('dialog', { name, exact: true }) }

    // 未建立会话时仍应能查看本地 Skills；不能因 UI sessionId 为 null 误报“会话已切换”。
    const skillsBeforeConnect = await open('Skills 技能详情')
    await expect(skillsBeforeConnect.getByRole('button', { name: /resource-test/ })).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(skillsBeforeConnect).toBeHidden()

    const mcpBeforeConnect = await open('MCP 连接详情')
    await expect(mcpBeforeConnect.getByRole('heading', { name: 'MCP 连接详情' })).toBeVisible()
    await expect(mcpBeforeConnect.getByRole('alert')).toHaveCount(0)
    await page.keyboard.press('Escape')
    await expect(mcpBeforeConnect).toBeHidden()

    const input = panel.locator('textarea')
    await input.fill('tools')
    await panel.getByRole('button', { name: '发送', exact: true }).click()
    await expect(panel.locator('[data-slot="streaming-response"]').last()).toContainText('montree_read')

    const mcp = await open('MCP 连接详情')
    await expect(mcp.getByRole('heading', { name: 'Montree 文档与阅读工具' })).toBeVisible()
    await expect(mcp.getByRole('status')).toContainText(/已发现工具/)
    await expect(mcp.getByText('Agent 自行配置的其他 MCP', { exact: false })).toBeVisible()
    await mcp.locator('summary').filter({ hasText: /^montree_read$/ }).click()
    await expect(mcp.locator('details[open] pre')).toContainText('properties')
    await screenshotWithoutToasts(mcp, info.outputPath('mcp-dark.png'))
    const inspection = await page.evaluate(() => window.montreeAgentInspection!.inspect({ includeSkills: false }))
    expect(inspection.ok).toBe(true)
    if (inspection.ok) { expect(inspection.value.mcps[0].discoveries).toBeGreaterThan(0); expect(inspection.value.mcps[0]).not.toHaveProperty('authToken') }
    await page.keyboard.press('Escape')
    await expect(mcp).toBeHidden()
    await expect(more).toBeFocused()

    const skills = await open('Skills 技能详情')
    await skills.getByRole('textbox', { name: '搜索 Skills' }).fill('resource-test')
    await expect(skills.getByRole('navigation', { name: 'Skills 列表' }).getByRole('button', { name: /resource-test/ })).toBeVisible()
    const detail = skills.getByRole('region', { name: '资源详情' })
    await expect(detail.getByRole('heading', { name: 'resource-test', exact: true })).toBeVisible()
    await expect(detail.getByText('Agent 未上报，无法确认', { exact: true })).toBeVisible()
    await expect(detail.locator('.markdown-preview')).toContainText('FINAL_INSTRUCTION_SENTINEL')
    await detail.getByRole('button', { name: '查看原文' }).click()
    await expect(detail.locator('pre').last()).toHaveText(content)
    await detail.getByRole('button', { name: '阅读模式' }).click()
    await page.evaluate(() => { Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async (text: string) => { document.documentElement.dataset.resourceCopied = text } } }) })
    await detail.getByRole('button', { name: '复制示例' }).click()
    await expect(page.locator('html')).toHaveAttribute('data-resource-copied', /resource-test/)
    await detail.locator('.code-block-copy').click()
    await expect(page.locator('html')).toHaveAttribute('data-resource-copied', 'review diagram\n')
    // 只替换 OS 打开目录边界；技能 ID 查找、读取和主进程 IPC 均走真实路径。
    await app.evaluate(({ shell }) => { shell.showItemInFolder = (path) => { (globalThis as any).__revealedSkill = path } })
    await detail.getByRole('button', { name: '打开文件位置' }).click()
    await expect.poll(() => app.evaluate(() => (globalThis as any).__revealedSkill)).toBe(join(skillDir, 'SKILL.md'))
    await expect(detail.getByRole('button', { name: '打开文件位置' })).toBeEnabled()
    await detail.evaluate((element) => { element.scrollTop = 0 })
    await screenshotWithoutToasts(skills, info.outputPath('skills-dark.png'))
    await skills.getByRole('textbox', { name: '搜索 Skills' }).fill('no-such-skill')
    await expect(skills.getByText('没有匹配的项目')).toBeVisible()
    await skills.getByRole('textbox', { name: '搜索 Skills' }).fill('resource-test')
    await page.evaluate(() => { document.documentElement.classList.remove('dark'); document.documentElement.classList.add('light'); document.documentElement.style.colorScheme = 'light' })
    await screenshotWithoutToasts(skills, info.outputPath('skills-light.png'))
    await app.evaluate(({ BrowserWindow }) => { const window = BrowserWindow.getAllWindows()[0]; window.setMinimumSize(480, 500); window.setSize(600, 760) })
    await expect(skills).toBeInViewport({ ratio: 1 })
    expect(await skills.evaluate((element) => element.scrollWidth <= element.clientWidth + 1)).toBe(true)
    await expect(skills.getByRole('navigation')).toBeInViewport()
    await screenshotWithoutToasts(skills, info.outputPath('skills-narrow.png'))
    await page.keyboard.press('Escape')
    await expect(skills).toBeHidden()
    await expect(more).toBeFocused()
  } finally {
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().forEach((window) => window.destroy())).catch(() => {})
    await app.close()
    // home 是本测试 mkdtemp 返回的完整路径，位于系统临时目录。
    await rm(home, { recursive: true, force: true })
  }
})
