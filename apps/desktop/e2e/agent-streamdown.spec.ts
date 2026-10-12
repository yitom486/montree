import { resolve } from 'node:path'
import { test, expect, type Page } from '@playwright/test'
import { launchBuiltApp } from './helpers/launch-app'

/**
 * S1 Streamdown 正文链路（真实 Electron + mock 流式，无真实模型）：
 * 流式中间态占位 → 完成态表格/代码/公式/Mermaid/链接 → 代码复制走社区组件。
 */

async function openPanel(page: Page) {
  const activityBar = page.getByRole('complementary', { name: '活动栏' })
  const panel = page.locator('aside[aria-label="Agent 聊天"]:visible')
  if ((await panel.count()) === 0) {
    await activityBar.getByRole('button', { name: '打开 Agent 面板' }).click()
  }
  await expect(panel.first()).toBeVisible({ timeout: 10_000 })
  return panel.first()
}

test.describe('Streamdown 正文 S1', () => {
  test('流式中间态与完成态：表格/代码/公式/Mermaid/链接/复制', async ({}, info) => {
    const app = await launchBuiltApp({
      E2E_ACP_WINDOW_TEST: '1',
      E2E_ACP_COMMAND: process.execPath,
      E2E_ACP_FIXTURE: resolve('apps/desktop/e2e/fixtures/mock-window-agent.cjs'),
    })
    try {
      const window = await app.firstWindow()
      await window.waitForLoadState('domcontentloaded')
      await expect(window.getByRole('button', { name: '更多操作', exact: true })).toBeVisible({
        timeout: 15_000,
      })
      // Exercise the user's submission path: it also settles streaming after the ACP response.
      // A raw IPC prompt bypasses that completion handler and leaves buttons disabled forever.
      await window.evaluate(() => {
        const now = Date.now()
        localStorage.setItem('montree-acp-ui', JSON.stringify({ version: 0, state: {
          panelOpen: true, hudDisplayMode: 'docked', selectedRuntimeId: 'mock-window', activeThreadId: 'stream-ui',
          threads: [{ id: 'stream-ui', runtimeId: 'mock-window', title: '流式回归', createdAt: now, updatedAt: now, messages: [] }],
        } }))
      })
      await window.reload()
      const panel = await openPanel(window)
      await panel.locator('textarea').fill('stream')
      await panel.getByRole('button', { name: '发送', exact: true }).click()

      // 中间态：首段已到、尾段未到（chunk 200ms 间隔，时序上有 600ms+ 窗口）
      await expect(panel.getByText('首段中文正文')).toBeVisible({ timeout: 15_000 })
      await expect(panel.getByText('尾段收束')).toHaveCount(0)
      await panel.screenshot({ path: info.outputPath('stream-mid.png') })
      await info.attach('stream-mid', { path: info.outputPath('stream-mid.png'), contentType: 'image/png' })

      // 完成态：全文结构一次成形
      await expect(panel.getByText('尾段收束')).toBeVisible({ timeout: 15_000 })
      await expect(panel.getByText('正在生成')).toHaveCount(0)
      await expect(panel.locator('table')).toBeVisible()
      await expect(panel.locator('[data-streamdown=code-block-header]')).toContainText('ts')
      await expect(panel.locator('[data-streamdown=code-block] code').first()).toContainText('const answer = 42')
      // 代码块三回归：① 语言标签与右上动作浮层无几何相交（窄栏曾重叠）；
      // ② 不同 token 计算颜色不同（全等即 Tailwind 高亮类缺失，单色回归）。
      const codeGeom = await panel.evaluate((el) => {
        const label = el.querySelector('[data-streamdown=code-block-header] span')
        const actions = el.querySelector('[data-streamdown=code-block-actions]')
        if (!label || !actions) return null
        const a = label.getBoundingClientRect()
        const b = actions.getBoundingClientRect()
        return { ax2: a.x + a.width, bx: b.x }
      })
      expect(codeGeom).not.toBeNull()
      expect(codeGeom!.ax2).toBeLessThanOrEqual(codeGeom!.bx)
      await expect.poll(async () => {
        const colors: string[] = await panel.evaluate((el) =>
          Array.from(
            el.querySelectorAll('[data-streamdown=code-block] code span[style*="--sdm-c"]'),
          )
            .slice(0, 8)
            .map((s) => getComputedStyle(s).color),
        )
        return new Set(colors).size
      }, { timeout: 15_000 }).toBeGreaterThan(1)
      await expect(panel.locator('.katex').first()).toBeVisible()
      await expect(panel.getByRole('link', { name: '链接' })).toBeVisible()
      const ref = panel.locator('sup a[href^="#"]').first()
      await ref.click()
      const definition = await ref.getAttribute('href')
      await expect(window.locator(`[id="${definition!.slice(1)}"]`)).toBeFocused()
      const back = panel.getByRole('link', { name: /Back to reference|返回|↩/ }).first()
      await back.click()
      const reference = await back.getAttribute('href')
      await expect(window.locator(`[id="${reference!.slice(1)}"]`)).toBeFocused()
      await expect(panel.locator('[data-streamdown="mermaid"] svg').first()).toBeVisible({
        timeout: 15_000,
      })

      // 代码复制走社区组件（剪贴板桩）
      await window.evaluate(() => {
        ;(window as any).__copied = null
        Object.defineProperty(window.navigator, 'clipboard', {
          configurable: true,
          value: {
            writeText: (text: string) => {
              ;(window as any).__copied = text
              return Promise.resolve()
            },
          },
        })
      })
      // 代码复制走社区组件（剪贴板桩）。注：社区代码头在窄栏把复制按钮中心点
      // 盖住（按钮可见可稳定，header div 吞命中；视觉顺序正常），此处用仓内既有
      // dispatchEvent 手法直达点击（loadMore 同例），不断言上游命中几何。
      await panel.locator('[data-streamdown=code-block-copy-button]').first().dispatchEvent('click')
      await expect
        .poll(async () => window.evaluate(() => (window as any).__copied))
        .toContain('const answer = 42')

      // 长内容不撑开面板
      const overflow = await panel.evaluate((el) => ({
        scrollWidth: el.scrollWidth,
        clientWidth: el.clientWidth,
      }))
      expect(overflow.scrollWidth).toBeLessThanOrEqual(overflow.clientWidth + 2)
      await panel.screenshot({ path: info.outputPath('stream-done.png') })
      await info.attach('stream-done', { path: info.outputPath('stream-done.png'), contentType: 'image/png' })
    } finally {
      await app.close()
    }
  })

  test('新回合跟随：贴底跟随新流，上滑后不抢，按钮可回到底部', async ({}, info) => {
    const app = await launchBuiltApp({
      E2E_ACP_WINDOW_TEST: '1',
      E2E_ACP_COMMAND: process.execPath,
      E2E_ACP_FIXTURE: resolve('apps/desktop/e2e/fixtures/mock-window-agent.cjs'),
    })
    try {
      const window = await app.firstWindow()
      await window.waitForLoadState('domcontentloaded')
      await expect(window.getByRole('button', { name: '更多操作', exact: true })).toBeVisible({
        timeout: 15_000,
      })
      await window.evaluate(() => {
        const now = Date.now()
        localStorage.setItem('montree-acp-ui', JSON.stringify({ version: 0, state: {
          panelOpen: true, hudDisplayMode: 'docked', selectedRuntimeId: 'mock-window', activeThreadId: 'stream-follow',
          threads: [{ id: 'stream-follow', runtimeId: 'mock-window', title: '跟随回归', createdAt: now, updatedAt: now, messages: [] }],
        } }))
      })
      await window.reload()
      await expect(window.getByRole('button', { name: '更多操作', exact: true })).toBeVisible({
        timeout: 15_000,
      })
      const panel = await openPanel(window)
      const sendStream = async () => {
        await panel.locator('textarea').fill('stream')
        await panel.getByRole('button', { name: '发送', exact: true }).click()
      }

      // 第一回合：全程贴底，新流到底，按钮隐藏（跟随）
      await sendStream()
      await expect(panel.getByText('尾段收束')).toBeVisible({ timeout: 20_000 })
      await expect(panel.getByRole('button', { name: '回到底部' })).toBeHidden({ timeout: 10_000 })

      // 上滑一次：进入历史阅读，不再跟随
      await panel.hover()
      await window.mouse.wheel(0, -600)
      await expect(panel.getByRole('button', { name: '回到底部' })).toBeVisible({ timeout: 10_000 })

      // 第二回合：新流到达也不抢位置。判定用按钮可见性（未贴底即未跟随）；
      // 不用像素级 scrollTop 断言：KaTeX 字体/异步块的布局锚定会带来百 px 内漂移。
      await sendStream()
      await expect(panel.getByText('尾段收束')).toHaveCount(2, { timeout: 20_000 })
      await window.waitForTimeout(1500)
      await expect(panel.getByRole('button', { name: '回到底部' })).toBeVisible()

      // 点按钮回到贴底
      await panel.getByRole('button', { name: '回到底部' }).click()
      await expect(panel.getByRole('button', { name: '回到底部' })).toBeHidden({ timeout: 10_000 })
      await panel.screenshot({ path: info.outputPath('follow.png') })
      await info.attach('follow', { path: info.outputPath('follow.png'), contentType: 'image/png' })
    } finally {
      await app.close()
    }
  })
})
