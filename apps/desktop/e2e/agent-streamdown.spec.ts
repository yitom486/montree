import { resolve } from 'node:path'
import { mkdirSync, writeFileSync } from 'node:fs'
import { test, expect, type Page } from '@playwright/test'
import { launchBuiltApp } from './helpers/launch-app'
import { seedMockChatThread } from './helpers/seed-chat'

/**
 * S1 Streamdown 正文链路（真实 Electron + mock 流式，无真实模型）：
 * 流式中间态占位 → 完成态表格/代码/公式/Mermaid/链接 → 代码复制走社区组件。
 */

async function openPanel(page: Page) {
  const panel = page.locator('aside[aria-label="Agent 聊天"]:visible')
  // reload 后面板异步挂载：先等它自己出现，避免误点「AI 伴读」把已打开的面板切走
  await panel.first().waitFor({ state: 'visible', timeout: 5_000 }).catch(() => {})
  if ((await panel.count()) === 0) {
    await page.getByRole('button', { name: 'AI 伴读', exact: true }).click()
  }
  await expect(panel.first()).toBeVisible({ timeout: 10_000 })
  return panel.first()
}

test.describe('Streamdown 正文 S1', () => {
  test('agy 思考→具体绘图状态→组织回答→结束，真实 IPC 保留工具参数摘要', async ({}, info) => {
    const gate = info.outputPath('agy-status')
    const app = await launchBuiltApp({ E2E_ACP_WINDOW_TEST: '1', E2E_ACP_COMMAND: process.execPath,
      E2E_ACP_FIXTURE: resolve('apps/desktop/e2e/fixtures/mock-window-agent.cjs'), E2E_ACP_STREAM_GATE: gate })
    try {
      const window = await app.firstWindow()
      await window.setViewportSize({ width: 1600, height: 900 })
      await window.waitForLoadState('domcontentloaded')
      await expect(window.getByRole('button', { name: '更多操作', exact: true })).toBeVisible()
      await seedMockChatThread(window, { id: 'agy-status', title: 'agy 状态回归' })
      const panel = await openPanel(window)
      await panel.locator('textarea').fill('agy-status-flow')
      await panel.getByRole('button', { name: '发送', exact: true }).click()
      const thought = panel.locator('[data-part-key^="thought-"]').first()
      await expect(thought).toContainText('先梳理登录步骤。')
      await expect(thought).toContainText('思考中')
      await expect(panel.getByTestId('agent-loading-state')).toHaveCount(0)
      writeFileSync(gate + '-thought', 'continue')
      const progress = panel.getByTestId('agent-loading-state')
      await expect(progress).toContainText('正在绘制时序图：登录过程')
      await expect(thought).toContainText('已思考')
      const activity = panel.locator('[data-slot="agent-activity"]')
      await expect(activity).toContainText('绘制时序图')
      await expect(activity).toContainText('登录过程')
      await expect(activity).not.toContainText('Call Mcp Tool')
      await panel.screenshot({ path: info.outputPath('agy-tool-running.png') })
      writeFileSync(gate + '-tool', 'continue')
      await expect(progress).toContainText('正在组织回答')
      await expect(activity).toContainText('已完成')
      await expect(activity).toContainText('登录过程')
      writeFileSync(gate + '-complete', 'continue')
      await expect(panel.locator('[data-slot="streaming-response"]').last()).toContainText('AGY_STATUS_DONE')
      await expect(progress).toHaveCount(0)
    } finally { await app.close() }
  })

  test('等待计时与动效、真实思考展开、BeUI 输出完成动作', async ({}, info) => {
    const app = await launchBuiltApp({ E2E_ACP_WINDOW_TEST: '1', E2E_ACP_COMMAND: process.execPath, E2E_ACP_FIXTURE: resolve('apps/desktop/e2e/fixtures/mock-window-agent.cjs') })
    try {
      const window = await app.firstWindow()
      await window.setViewportSize({ width: 1600, height: 900 })
      await window.waitForLoadState('domcontentloaded')
      await expect(window.getByRole('button', { name: '更多操作', exact: true })).toBeVisible()
      await seedMockChatThread(window, { id: 'status-ui', title: '状态回归' }, { theme: 'dark' })
      const panel = await openPanel(window)
      await panel.locator('textarea').fill('status-flow')
      await panel.getByRole('button', { name: '发送', exact: true }).click()
      const waiting = panel.getByTestId('agent-loading-state').first()
      await expect(waiting).toContainText('正在思考')
      await expect(waiting.locator('.agent-pixel-loader > span')).toHaveCount(9)
      await window.emulateMedia({ reducedMotion: 'reduce' })
      expect(await waiting.locator('.agent-pixel-loader > span').first().evaluate(el => getComputedStyle(el).animationName)).toBe('none')
      await window.emulateMedia({ reducedMotion: 'no-preference' })
      expect(await waiting.locator('.agent-pixel-loader > span').first().evaluate(el => getComputedStyle(el).animationName)).toBe('agent-pixel-pulse')
      await panel.screenshot({ path: info.outputPath('waiting-response.png') })
      await expect(waiting.locator('[aria-label^="已等待"]')).not.toHaveText('0s')
      const thought = panel.locator('[data-part-key^="thought-"]').first()
      await expect(thought).toContainText('先检查当前文档证据。')
      await expect(thought.getByRole('button')).toHaveAttribute('aria-expanded', 'true')
      await expect(panel.getByTestId('agent-loading-state')).toHaveCount(0)
      await panel.screenshot({ path: info.outputPath('thinking-live.png') })
      const response = panel.locator('[data-slot="streaming-response"]').last()
      await expect(response).toContainText('已完成证据核对。')
      await expect(response).toHaveAttribute('data-state', 'complete')
      await expect(response.getByRole('button', { name: '复制回答原文' })).toBeVisible()
      const activity = panel.locator('[data-slot="agent-activity"]')
      await expect(activity.locator(':scope > button')).toHaveAttribute('aria-expanded', 'false')
      await activity.locator(':scope > button').click()
      await expect(thought.getByRole('button')).toHaveAttribute('aria-expanded', 'false')
      await panel.screenshot({ path: info.outputPath('beui-response.png') })
    } finally { await app.close() }
  })

  test('流式中间态与完成态：表格/代码/公式/Mermaid/链接/复制', async ({}, info) => {
    mkdirSync(info.outputDir, { recursive: true })
    const streamGate = info.outputPath('stream-continue')
    const app = await launchBuiltApp({
      E2E_ACP_WINDOW_TEST: '1',
      E2E_ACP_COMMAND: process.execPath,
      E2E_ACP_FIXTURE: resolve('apps/desktop/e2e/fixtures/mock-window-agent.cjs'),
      E2E_ACP_STREAM_GATE: streamGate,
    })
    try {
      const window = await app.firstWindow()
      await window.waitForLoadState('domcontentloaded')
      await expect(window.getByRole('button', { name: '更多操作', exact: true })).toBeVisible({
        timeout: 15_000,
      })
      // Exercise the user's submission path: it also settles streaming after the ACP response.
      // A raw IPC prompt bypasses that completion handler and leaves buttons disabled forever.
      await seedMockChatThread(window, { id: 'stream-ui', title: '流式回归' })
      const panel = await openPanel(window)
      await window.evaluate(() => {
        const probe = { samples: [] as number[], names: [] as string[] }
        ;(window as unknown as { nativeStreamProbe: typeof probe }).nativeStreamProbe = probe
        document.addEventListener('animationstart', event => {
          const target = event.target
          if (!(target instanceof HTMLElement) || !target.matches('.agent-md [data-sd-animate]') || probe.samples.length >= 64) return
          probe.names.push(event.animationName)
          probe.samples.push(Number(getComputedStyle(target).opacity))
          requestAnimationFrame(() => {
            if (target.isConnected) probe.samples.push(Number(getComputedStyle(target).opacity))
          })
        })
      })
      await panel.locator('textarea').fill('stream')
      await panel.getByRole('button', { name: '发送', exact: true }).click()

      // 中间态：首段已到、尾段未到；确认后放行，独立于 CI 懒加载速度。
      await expect(panel.getByText('首段中文正文')).toBeVisible({ timeout: 15_000 })
      await expect(panel.getByText('尾段收束')).toHaveCount(0)
      // 空行/新块到达不应把已显示正文从尾渲染器搬到头渲染器。
      const firstParagraph = await panel.locator('.agent-md p').filter({ hasText: '首段中文正文' }).elementHandle()
      await expect(panel.locator('.agent-md [data-sd-animate]').first()).toBeAttached()
      const nativeAnimation = await window.evaluate(() => (window as unknown as {
        nativeStreamProbe: { samples: number[]; names: string[] }
      }).nativeStreamProbe)
      expect(nativeAnimation.names).toContain('sd-fadeIn')
      expect(nativeAnimation.samples.some(opacity => opacity > 0 && opacity < 1)).toBe(true)
      await expect(panel.locator('.agent-block-in')).toHaveCount(0)
      await window.emulateMedia({ reducedMotion: 'reduce' })
      const reduced = await panel.locator('.agent-md [data-sd-animate]').first().evaluate(el => ({
        duration: getComputedStyle(el).animationDuration, delay: getComputedStyle(el).animationDelay,
      }))
      expect(reduced).toEqual({ duration: '0s', delay: '0s' })
      await window.emulateMedia({ reducedMotion: 'no-preference' })
      // 流式气泡挂翡翠光环（落定即卸）；旧顶栏扫光条已删除
      await expect(panel.locator('.agent-beam-ring-emerald').first()).toBeVisible()
      await expect(panel.locator('.agent-stream-sweep')).toHaveCount(0)
      // 宽度稳定：流式增长中消息列宽度不应抖动（滚动条出现/消失吃宽度是主因，阈值 3px）
      const widthSamples: number[] = []
      const messageList = panel.locator('[data-acp-probe="message-list"]')
      for (let i = 0; i < 10; i += 1) {
        widthSamples.push(
          await messageList.evaluate((el) => el.getBoundingClientRect().width),
        )
        await window.waitForTimeout(150)
      }
      const widthRange = Math.max(...widthSamples) - Math.min(...widthSamples)
      expect(widthRange).toBeLessThanOrEqual(3)
      // 视口必须预留滚动槽：流式增高/工作记录收起导致高度上下穿越阈值时，
      // 滚动条出现消失不再吃掉内容宽度（根治流式宽度抖动）
      const gutter = await panel
        .getByTestId('chat-viewport')
        .evaluate((el) => getComputedStyle(el).scrollbarGutter)
      expect(gutter).toContain('stable')
      await panel.screenshot({ path: info.outputPath('stream-mid.png') })
      await info.attach('stream-mid', { path: info.outputPath('stream-mid.png'), contentType: 'image/png' })
      writeFileSync(streamGate, 'continue')

      // 完成态：全文结构一次成形
      await expect(panel.getByText('尾段收束')).toBeVisible({ timeout: 15_000 })
      expect(await firstParagraph!.evaluate(el => el.isConnected)).toBe(true)
      await expect(panel.locator('.agent-md p').filter({ hasText: '首段中文正文' })).toHaveCount(1)
      await expect(panel.getByText('正在生成')).toHaveCount(0)
      await expect(panel.locator('.agent-md [data-sd-animate]')).toHaveCount(0)
      await expect(panel.locator('.agent-beam-ring-emerald')).toHaveCount(0)
      // BUI：用户分支走 BuiMessage，用户动作（复制正文/编辑后继续）保留
      await expect(panel.locator('[data-bui-message="user"]').first()).toBeVisible()
      await expect(panel.getByRole('button', { name: '复制正文', exact: true }).first()).toBeVisible()
      await expect(panel.getByRole('button', { name: '编辑后继续', exact: true }).first()).toBeVisible()
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
      // Mermaid 系社区可见性门渲染（IntersectionObserver + rootMargin 300px + idle 回调）：
      // 脚注往返后面板停在底部时图表可能在视口外而永不渲染，先滚入视口再断言
      //（同仓 agent-mermaid.spec.ts:95 既有做法，非放宽断言）。
      await panel.locator('[data-streamdown="mermaid-block"]').first().scrollIntoViewIfNeeded()
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
      await seedMockChatThread(window, { id: 'stream-follow', title: '跟随回归' })
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
