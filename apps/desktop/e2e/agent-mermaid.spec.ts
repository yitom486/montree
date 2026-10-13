import { resolve } from 'node:path'
import { test, expect, type Page } from '@playwright/test'
import { launchBuiltApp } from './helpers/launch-app'

/**
 * Mermaid 双修（真实 Electron + mock 回放，无真实模型）：
 * 主题跟随 App（深色下节点为深底）+ 普通滚轮不再劫持页面滚动（±按钮可用）。
 */
async function openPanel(page: Page) {
  const panel = page.locator('aside[aria-label="Agent 聊天"]:visible')
  if ((await panel.count()) === 0) {
    await page.getByRole('button', { name: 'AI 伴读', exact: true }).click()
  }
  await expect(panel.first()).toBeVisible({ timeout: 10_000 })
  return panel.first()
}

test.describe('Mermaid 主题与滚轮', () => {
  test('深色主题节点深底 + 滚轮不劫持滚动 + 按钮缩放可用', async ({}, info) => {
    const app = await launchBuiltApp({
      E2E_ACP_WINDOW_TEST: '1',
      E2E_ACP_COMMAND: process.execPath,
      E2E_ACP_FIXTURE: resolve('apps/desktop/e2e/fixtures/mock-window-agent.cjs'),
    })
    try {
      const window = await app.firstWindow()
      const consoleErrors: string[] = []
      window.on('console', (msg) => {
        if (msg.type() === 'error' || msg.type() === 'warning') consoleErrors.push(`[${msg.type()}] ${msg.text().slice(0, 300)}`)
      })
      window.on('pageerror', (err) => consoleErrors.push('[pageerror] ' + String(err).slice(0, 300)))
      await window.waitForLoadState('domcontentloaded')
      await expect(window.getByRole('button', { name: '更多操作', exact: true })).toBeVisible({
        timeout: 15_000,
      })
      await window.evaluate(() => {
        const now = Date.now()
        localStorage.setItem('montree-acp-ui', JSON.stringify({ version: 0, state: {
          panelOpen: true, hudDisplayMode: 'docked', selectedRuntimeId: 'mock-window', activeThreadId: 'mermaid-dark',
          threads: [{ id: 'mermaid-dark', runtimeId: 'mock-window', title: '图', createdAt: now, updatedAt: now, messages: [] }],
        } }))
        const raw = JSON.parse(localStorage.getItem('markdown-editor-ui') ?? '{"state":{}}')
        raw.state = { ...(raw.state ?? {}), theme: 'dark' }
        localStorage.setItem('markdown-editor-ui', JSON.stringify(raw))
      })
      await window.reload()
      const panel = await openPanel(window)
      await panel.locator('textarea').fill('stream')
      await panel.getByRole('button', { name: '发送', exact: true }).click()
      // 注：块内还有下载/复制图标 svg，画布必须锚定 pan 容器内的 svg
      const svg = panel.locator('[data-streamdown="mermaid-block"] [role="application"] svg').first()
      await expect(svg).toBeVisible({ timeout: 15_000 })
      // Mermaid 为异步渲染：先等真图（占位 svg 只有一个 path），再断主题
      const settled = await svg.evaluate(async (el) => {
        for (let i = 0; i < 40; i += 1) {
          if (el.querySelectorAll('*').length > 5) return el.outerHTML.slice(0, 200)
          await new Promise((r) => setTimeout(r, 500))
        }
        return 'PLACEHOLDER:' + el.outerHTML.slice(0, 500)
      }).catch((e) => 'EVAL_FAIL:' + String(e).slice(0, 200))
      console.log('MERMAID_SETTLE=' + settled)
      console.log('CONSOLE_ISSUES=' + JSON.stringify(consoleErrors.slice(0, 12)))

      // 主题：深色下流程节点为深底（相对亮度 < 0.45；浅色默认约 > 0.7）
      const lum = await svg.evaluate((el) => {
        const shape = el.querySelector('g.node rect, g.node polygon, g.node path') as SVGElement | null
        if (!shape) return -1
        const m = getComputedStyle(shape).fill.match(/[\d.]+/g)?.map(Number) ?? []
        if (m.length < 3) return -1
        const f = (c: number): number => {
          const s = c / 255
          return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
        }
        return 0.2126 * f(m[0]!) + 0.7152 * f(m[1]!) + 0.0722 * f(m[2]!)
      })
      expect(lum).toBeGreaterThanOrEqual(0)
      expect(lum).toBeLessThan(0.45)
      console.log('MERMAID_LUM_DARK=' + lum)

      // 滚轮门：合成滚轮既不缩放（上已断），也不被 preventDefault
      // （被调即浏览器不滚动 = 用户说的“卡住”；门只 stopPropagation，
      // 默认滚动照常）。dispatchEvent 返回值即是否被 cancel。
      const zoomable = panel.locator('[data-streamdown="mermaid-block"] [role="application"]').first()
      const before = await zoomable.evaluate((el) => (el as HTMLElement).style.transform)
      for (let i = 0; i < 5; i += 1) {
        const canceled: boolean = await svg.evaluate((el) => !el.dispatchEvent(new WheelEvent('wheel', { deltaY: 120, bubbles: true, cancelable: true })))
        expect(canceled).toBe(false)
      }
      await expect.poll(async () => zoomable.evaluate((el) => (el as HTMLElement).style.transform)).toBe(before)

      // 按钮：±缩放可用（门只杀滚轮，不杀按钮）
      await panel.getByRole('button', { name: '放大', exact: true }).first().click()
      await expect.poll(async () => zoomable.evaluate((el) => (el as HTMLElement).style.transform)).not.toBe(before)

      await panel.locator('[data-streamdown="mermaid-block"]').first().scrollIntoViewIfNeeded()
      await panel.screenshot({ path: info.outputPath('mermaid-dark.png') })
      await info.attach('mermaid-dark', { path: info.outputPath('mermaid-dark.png'), contentType: 'image/png' })

      // 主题切换：深→亮，旧图必须重绘为浅底（mermaid 焊色 + 社区不跟 config，
      // 靠 themeKey remount；无此则旧图永远深色，即线上亮色错乱）。
      await window.getByRole('button', { name: '切换主题', exact: true }).click()
      await expect.poll(async () => svg.evaluate((el) => {
        const shape = el.querySelector('g.node rect, g.node polygon, g.node path') as SVGElement | null
        if (!shape) return -1
        const m = getComputedStyle(shape).fill.match(/[\d.]+/g)?.map(Number) ?? []
        if (m.length < 3) return -1
        const f = (c: number): number => {
          const s = c / 255
          return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
        }
        return 0.2126 * f(m[0]!) + 0.7152 * f(m[1]!) + 0.0722 * f(m[2]!)
      }), { timeout: 15_000 }).toBeGreaterThan(0.6)
      const lumLight = await svg.evaluate((el) => {
        const shape = el.querySelector('g.node rect, g.node polygon, g.node path') as SVGElement | null
        const m = getComputedStyle(shape!).fill.match(/[\d.]+/g)?.map(Number) ?? []
        return m.slice(0, 3).join(',')
      })
      console.log('MERMAID_LUM_LIGHT_RGB=' + lumLight)
      await panel.locator('[data-streamdown="mermaid-block"]').first().scrollIntoViewIfNeeded()
      await panel.screenshot({ path: info.outputPath('mermaid-light.png') })
      await info.attach('mermaid-light', { path: info.outputPath('mermaid-light.png'), contentType: 'image/png' })
    } finally {
      await app.close()
    }
  })
})
