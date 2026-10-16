import { mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { test, expect, type Locator, type Page } from '@playwright/test'
import { launchBuiltApp } from './helpers/launch-app'

async function openPanel(page: Page) {
  const panel = page.locator('aside[aria-label="Agent 聊天"]:visible').first()
  if (!(await panel.count())) await page.getByRole('button', { name: 'AI 伴读', exact: true }).click()
  await expect(panel).toBeVisible()
  return panel
}

/** 只检查消息壳及光环祖先，正文代码块和聊天列表允许保留自己的滚动条。 */
async function expectStableBubble(shell: Locator, panel: Locator, page: Page) {
  for (const theme of ['light', 'dark']) {
    await page.evaluate(dark => document.documentElement.classList.toggle('dark', dark), theme === 'dark')
    for (const width of [320, 320.25, 480, 480.5, 800, 800.75]) {
      await panel.evaluate((element, width) => {
        const style = (element as HTMLElement).style
        style.width = `${width}px`
        style.minWidth = `${width}px`
        style.maxWidth = `${width}px`
      }, width)
      const sample = await shell.evaluate(async element => {
        const ring = element.matches('.agent-beam-ring')
          ? element as HTMLElement
          : element.querySelector<HTMLElement>('.agent-beam-ring')!
        const frame = () => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())))
        await frame()
        const measure = () => {
          const scrollbars: number[] = []
          let ancestor: HTMLElement | null = ring
          while (ancestor) {
            const style = getComputedStyle(ancestor)
            if (style.overflowY === 'auto' || style.overflowY === 'scroll') {
              scrollbars.push(ancestor.offsetWidth - ancestor.clientWidth - parseFloat(style.borderLeftWidth) - parseFloat(style.borderRightWidth))
            }
            if (ancestor === element) break
            ancestor = ancestor.parentElement
          }
          return { width: element.clientWidth, scrollbars }
        }
        const active = measure()
        const animation = getComputedStyle(ring, '::after').animationName
        ring.classList.remove('agent-beam-ring')
        await frame()
        const inactive = measure()
        ring.classList.add('agent-beam-ring')
        await frame()
        return { active, inactive, animation }
      })
      expect(sample.animation, `${theme}/${width}: 光环仍需正常绘制`).toContain('agent-beam-spin')
      for (const scrollbar of sample.active.scrollbars) {
        expect(scrollbar, `${theme}/${width}: 消息壳不应出现内层纵向滚动条`).toBeLessThanOrEqual(1)
      }
      expect(Math.abs(sample.active.width - sample.inactive.width), `${theme}/${width}: 流式光环不应挤压正文宽度`).toBeLessThanOrEqual(1)
    }
  }
}

for (const kind of ['assistant', 'activity'] as const) {
  test(`${kind} 流式气泡无多余内层滚动条，光环不改变宽度`, async ({}, info) => {
    mkdirSync(info.outputDir, { recursive: true })
    const gate = info.outputPath('continue')
    const app = await launchBuiltApp({
      E2E_ACP_WINDOW_TEST: '1',
      E2E_ACP_COMMAND: process.execPath,
      E2E_ACP_FIXTURE: resolve('apps/desktop/e2e/fixtures/mock-window-agent.cjs'),
      ...(kind === 'assistant' ? { E2E_ACP_STREAM_GATE: gate } : { E2E_WORKLOG_GATE: gate }),
    })
    try {
      const window = await app.firstWindow()
      await window.setViewportSize({ width: 1600, height: 900 })
      await expect(window.getByRole('button', { name: '更多操作', exact: true })).toBeVisible()
      const panel = await openPanel(window)
      const connected = await window.evaluate(() => (window as any).electronAPI.acpConnect({ runtimeId: 'mock-window' }))
      expect(connected.ok, JSON.stringify(connected)).toBe(true)
      await panel.locator('textarea').fill(kind === 'assistant' ? 'stream' : 'worklog')
      await panel.getByRole('button', { name: '发送', exact: true }).click()
      const shell = panel.locator(`[data-acp-probe="${kind === 'assistant' ? 'agent' : 'activity'}"]`).last()
      await expect(shell.locator('.agent-beam-ring').or(shell.and(panel.locator('.agent-beam-ring')))).toHaveCount(1)
      if (kind === 'assistant') await expect(shell.getByText('首段中文正文')).toBeVisible()
      else await expect(shell.getByText(/工作中.*0\/2/)).toBeVisible()
      await expectStableBubble(shell, panel, window)
      await panel.evaluate(element => {
        const style = (element as HTMLElement).style
        style.removeProperty('width')
        style.removeProperty('min-width')
        style.removeProperty('max-width')
      })
      writeFileSync(gate, 'continue')
      await expect(shell).not.toHaveClass(/agent-beam-ring/)
      await expect(shell.locator('.agent-beam-ring')).toHaveCount(0)
      await expect(panel.getByTestId('chat-viewport')).toHaveCSS('overflow-y', 'auto')
      await panel.screenshot({ path: info.outputPath(`${kind}-no-inner-scrollbar.png`) })
    } finally { await app.close() }
  })
}
