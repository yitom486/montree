import { resolve } from 'node:path'
import { test, expect, type Page, type TestInfo } from '@playwright/test'
import { launchBuiltApp } from './helpers/launch-app'

/**
 * R2 聊天展示层定向回归（mock 数据 + 真实 Electron 渲染，不调用真实模型）：
 * 1. 种子时间线：工作记录收起 / 失败展开 / 富图表卡 / 长内容不撑开面板（浅色+深色截图）。
 * 2. 真实 mock Agent 审批：权限卡唯一可见 → 点 Allow → 卡片消失。
 */

function seedTimelineScript() {
  const base = Date.now()
  const longPath = `D:/project/js/Electron/inkdown/${'非常长的目录名-'.repeat(12)}a.ts`
  const thread = {
    id: 'thread-r2-seed',
    title: '展示回归',
    createdAt: base,
    updatedAt: base,
    runtimeId: 'codex-acp',
    agentSessionIds: {},
    messages: [
      { id: 'u-1', role: 'user', text: '这一章的核心观点是什么', createdAt: base },
      { id: 'th-1', role: 'thought', text: '先读当前页，再看目录定位', createdAt: base + 100 },
      {
        id: 'tc-read-1',
        role: 'tool',
        text: '第一章第一段正文摘要',
        createdAt: base + 200,
        updatedAt: base + 1400,
        streaming: false,
        toolCallId: 'tc-read-1',
        toolKind: 'read',
        toolTitle: 'mcp.montree.montree_read',
        toolStatus: 'completed',
        toolContentText: '第一章第一段正文摘要',
      },
      {
        id: 'tc-search-1',
        role: 'tool',
        text: '找到 3 处相关段落',
        createdAt: base + 300,
        updatedAt: base + 1500,
        streaming: false,
        toolCallId: 'tc-search-1',
        toolKind: 'search',
        toolTitle: 'search',
        toolStatus: 'completed',
        toolContentText: '找到 3 处相关段落',
      },
      {
        id: 'tc-fail-1',
        role: 'tool',
        text: 'snapshot bridge not ready, 稍后重试',
        createdAt: base + 400,
        updatedAt: base + 1600,
        streaming: false,
        toolCallId: 'tc-fail-1',
        toolKind: 'read',
        toolTitle: 'mcp.montree.montree_read',
        toolStatus: 'failed',
        toolContentText: 'snapshot bridge not ready, 稍后重试',
      },
      {
        id: 'tc-diagram-1',
        role: 'tool',
        text: JSON.stringify({
          diagramId: 'diag-e2e-1',
          diagramType: 'flowchart',
          title: '核心观点推演',
          summary: '三种视角的流转',
          mermaidCode: 'graph TD; A-->B',
        }),
        createdAt: base + 500,
        updatedAt: base + 1700,
        streaming: false,
        toolCallId: 'tc-diagram-1',
        toolKind: 'other',
        toolTitle: 'montree_generate_diagram',
        toolStatus: 'completed',
        toolContentText: JSON.stringify({
          diagramId: 'diag-e2e-1',
          diagramType: 'flowchart',
          title: '核心观点推演',
          mermaidCode: 'graph TD; A-->B',
        }),
      },
      {
        id: 'tc-long-1',
        role: 'tool',
        text: '读取文件',
        createdAt: base + 600,
        updatedAt: base + 1800,
        streaming: false,
        toolCallId: 'tc-long-1',
        toolKind: 'read',
        toolTitle: 'read_text_file',
        toolStatus: 'completed',
        toolLocations: [{ path: longPath, line: 42 }],
      },
      {
        id: 'tc-json-1',
        role: 'tool',
        text: 'fetch_remote',
        createdAt: base + 650,
        updatedAt: base + 1850,
        streaming: false,
        toolCallId: 'tc-json-1',
        toolKind: 'fetch',
        toolTitle: 'fetch_remote',
        toolStatus: 'completed',
        // 120 行取证 JSON：详情 <pre> 应在内部滚动，不能撑开面板
        toolContentText: Array.from(
          { length: 120 },
          (_, i) => `{"id":${i},"evidence":"证据行-${i}-` + '取证文本'.repeat(6) + '"}',
        ).join('\n'),
      },
      {
        id: 'a-1',
        role: 'agent',
        text: '已整理出三条核心观点，失败的那一步可换种问法重试。',
        createdAt: base + 700,
        updatedAt: base + 1900,
        streaming: false,
      },
    ],
  }
  localStorage.setItem(
    'montree-acp-ui',
    JSON.stringify({
      version: 0,
      state: {
        panelOpen: true,
        hudDisplayMode: 'docked',
        selectedRuntimeId: 'codex-acp',
        activeThreadId: thread.id,
        threads: [thread],
      },
    }),
  )
}

async function openPanel(page: Page) {
  const activityBar = page.getByRole('complementary', { name: '活动栏' })
  const panel = page.locator('aside[aria-label="Agent 聊天"]:visible')
  if ((await panel.count()) === 0) {
    await activityBar.getByRole('button', { name: '打开 Agent 面板' }).click()
  }
  await expect(panel.first()).toBeVisible({ timeout: 10_000 })
  return panel.first()
}

async function expectSeededTimeline(
  panel: ReturnType<Page['locator']>,
  info: TestInfo,
  tag: string,
) {
  // 历史窗口初始只看末尾 N 条：先加载更多，再做完整断言（同时覆盖历史加载回归）。
  // 列表顶部按钮可能被粘性头遮挡命中检测，用 DOM 点击。
  const loadMore = panel.getByTestId('chat-load-more')
  if ((await loadMore.count()) > 0) {
    await loadMore.first().dispatchEvent('click')
  }
  await expect(panel.getByText('这一章的核心观点是什么')).toBeVisible({ timeout: 10_000 })

  // 工作记录：工具调用计数可见，不用消息数冒充步骤数；默认收起。
  // 旧文案「工作了 Xs · N 步」必须消失（精确匹配旧格式，避免误伤「步骤」等词）。
  // 注：种子含两个工具调用 2 的组，首组用于下述展开断言。
  const workLog = panel.getByText(/工作记录 · 工具调用 2/).first()
  await expect(workLog).toBeVisible()
  await expect(panel.getByText(/工作了 .* · \d+ 步/)).toHaveCount(0)
  await expect(panel.getByText('第一章第一段正文摘要')).toHaveCount(0)

  // 失败摘要在主时间线可见（无需展开）
  await expect(panel.getByText('失败').first()).toBeVisible()
  await expect(panel.getByText('阅读上下文未就绪')).toBeVisible()

  // 富图表卡直接呈现在主流（含 Mermaid 出图与知识卡片入口）
  await expect(panel.getByRole('button', { name: /图表推演/ })).toBeVisible()
  await expect(panel.getByTestId('diagram-viewer-card')).toBeVisible()

  // 展开工作记录后可见组内工具头；已完成工具本身默认收起，再点其工具头才见详情
  await workLog.click()
  const readTool = panel.getByRole('button', { name: /读取文档/ }).first()
  await expect(readTool).toBeVisible()
  await readTool.click()
  await expect(panel.getByText('第一章第一段正文摘要')).toBeVisible()

  // 长内容不撑开面板
  const overflow = await panel.evaluate(
    (el) => ({ scrollWidth: el.scrollWidth, clientWidth: el.clientWidth }),
  )
  expect(overflow.scrollWidth, `面板被撑开 ${JSON.stringify(overflow)}`).toBeLessThanOrEqual(
    overflow.clientWidth + 2,
  )

  const path = await info.outputPath(`timeline-${tag}.png`)
  await panel.screenshot({ path })
  await info.attach(`timeline-${tag}`, { path, contentType: 'image/png' })
}

test.describe('聊天展示层 R2', () => {
  test('种子时间线：工作记录/失败/富卡片/长内容（浅色+深色）', async ({}, info) => {
    const app = await launchBuiltApp()
    try {
      const window = await app.firstWindow()
      await window.waitForLoadState('domcontentloaded')
      await expect(window.getByRole('button', { name: '更多操作', exact: true })).toBeVisible({
        timeout: 15_000,
      })
      await window.setViewportSize({ width: 1600, height: 900 })
      await window.evaluate(`(${seedTimelineScript.toString()})()`)
      await window.evaluate(() => {
        localStorage.setItem(
          'montree-reader-hud-ui',
          JSON.stringify({ version: 0, state: { dockedAgentWidth: 390 } }),
        )
      })
      await window.reload()
      await expect(window.getByRole('button', { name: '更多操作', exact: true })).toBeVisible({
        timeout: 15_000,
      })

      const panel = await openPanel(window)
      const panelWidth = await panel.evaluate((el) => el.getBoundingClientRect().width)
      await info.attach('panel-width', {
        body: JSON.stringify({ viewport: 1600, panelWidth }),
        contentType: 'application/json',
      })
      // 窄面板验收目标约 390px：过窄时记录实际宽度，不硬断言布局细节
      expect(panelWidth).toBeGreaterThan(200)
      await expectSeededTimeline(panel, info, 'light')

      // 深色
      await window.evaluate(() => {
        const raw = JSON.parse(localStorage.getItem('markdown-editor-ui') ?? '{"state":{}}')
        raw.state = { ...(raw.state ?? {}), theme: 'dark' }
        localStorage.setItem('markdown-editor-ui', JSON.stringify(raw))
      })
      await window.reload()
      await expect(window.getByRole('button', { name: '更多操作', exact: true })).toBeVisible({
        timeout: 15_000,
      })
      const darkPanel = await openPanel(window)
      await expectSeededTimeline(darkPanel, info, 'dark')
    } finally {
      await app.close()
    }
  })

  test('真实 mock 审批：卡片唯一可见，Allow 后消失', async ({}, info) => {
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
      const panel = await openPanel(window)

      const connected = await window.evaluate(() =>
        (window as any).electronAPI.acpConnect({ runtimeId: 'mock-window' }),
      )
      expect(connected.ok, JSON.stringify(connected)).toBe(true)
      const sessionId = connected.value.sessionId as string

      await window.evaluate(
        ({ sessionId }) => {
          void (window as any).electronAPI.acpPrompt({
            sessionId,
            prompt: [{ type: 'text', text: 'permission' }],
          })
        },
        { sessionId },
      )

      // 双形态面板（docked 常驻 + floating）镜像同一 store：每个挂载的时间线内恰好一份，
      // 同一时间线内不重复（内联与兜底不并存）。
      const chatPanels = window.locator('aside[aria-label="Agent 聊天"]:visible')
      const mounted = await chatPanels.count()
      expect(mounted).toBeGreaterThan(0)
      for (let i = 0; i < mounted; i += 1) {
        await expect(chatPanels.nth(i).getByTestId('agent-permission-card')).toHaveCount(1)
      }
      const approval = panel.getByTestId('agent-permission-card')
      await expect(approval).toBeVisible({ timeout: 15_000 })
      await expect(window.getByText('等待批准').first()).toBeVisible()
      await panel.screenshot({ path: info.outputPath('approval.png') })
      await info.attach('approval', { path: info.outputPath('approval.png'), contentType: 'image/png' })

      await approval.getByRole('button', { name: 'Allow' }).click()
      await expect(approval).toBeHidden({ timeout: 15_000 })
      await expect(panel.getByText(/PERMISSION:/)).toBeVisible({ timeout: 15_000 })

      // 第二轮：同一会话再次请求，点拒绝同样只响应一次并消失
      await window.evaluate(
        ({ sessionId }) => {
          void (window as any).electronAPI.acpPrompt({
            sessionId,
            prompt: [{ type: 'text', text: 'permission' }],
          })
        },
        { sessionId },
      )
      const approval2 = panel.getByTestId('agent-permission-card')
      await expect(approval2).toBeVisible({ timeout: 15_000 })
      await expect(approval2).toHaveCount(1)
      await approval2.getByRole('button', { name: 'Reject' }).click()
      await expect(approval2).toBeHidden({ timeout: 15_000 })
      await expect(panel.getByText(/PERMISSION:.*reject/)).toBeVisible({ timeout: 15_000 })
    } finally {
      await app.close()
    }
  })

  test('面板宽度三档：拖动分隔线到约 320/390/480px 并不断言溢出', async ({}, info) => {
    const app = await launchBuiltApp()
    try {
      const window = await app.firstWindow()
      await window.waitForLoadState('domcontentloaded')
      await expect(window.getByRole('button', { name: '更多操作', exact: true })).toBeVisible({
        timeout: 15_000,
      })
      await window.setViewportSize({ width: 2000, height: 900 })
      await window.evaluate(`(${seedTimelineScript.toString()})()`)
      await window.reload()
      await expect(window.getByRole('button', { name: '更多操作', exact: true })).toBeVisible({
        timeout: 15_000,
      })
      const panel = await openPanel(window)
      const loadMore = panel.getByTestId('chat-load-more')
      if ((await loadMore.count()) > 0) {
        await loadMore.first().dispatchEvent('click')
      }
      await expect(panel.getByText('这一章的核心观点是什么')).toBeVisible({ timeout: 10_000 })

      const measure = () =>
        panel.evaluate((el) => Math.round(el.getBoundingClientRect().width))
      const setWidth = async (target: number): Promise<number> => {
        const handle = window.locator('[data-slot="resizable-handle"]').last()
        await expect(handle).toBeVisible({ timeout: 10_000 })
        for (let i = 0; i < 6; i += 1) {
          const w = await measure()
          if (Math.abs(w - target) <= 30) return w
          const box = await handle.boundingBox()
          if (!box) throw new Error('分隔线无位置')
          // 面板在最右：手柄左移放大，右移缩小；鼠标位移与面板宽度约 1:1
          const dx = Math.max(-220, Math.min(220, w - target))
          await window.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
          await window.mouse.down()
          await window.mouse.move(box.x + box.width / 2 + dx, box.y + box.height / 2, { steps: 10 })
          await window.mouse.up()
          await window.waitForTimeout(350)
        }
        return measure()
      }
      const assertContained = async (tag: string) => {
        const overflow = await panel.evaluate((el) => ({
          scrollWidth: el.scrollWidth,
          clientWidth: el.clientWidth,
        }))
        expect(overflow.scrollWidth, `${tag} 面板被撑开`).toBeLessThanOrEqual(
          overflow.clientWidth + 2,
        )
      }

      // 390 主档：失败收起后 headline 仍可读；JSON 详情内部滚动
      const w390 = await setWidth(390)
      expect(Math.abs(w390 - 390)).toBeLessThanOrEqual(35)
      const failedHeader = panel.getByRole('button', { name: /读取文档/ }).last()
      await failedHeader.click()
      await expect(panel.getByText('阅读上下文未就绪')).toBeVisible()
      const lastGroup = panel.getByText(/工作记录 · 工具调用 2/).last()
      await lastGroup.click()
      await panel.getByRole('button', { name: /fetch_remote/ }).click()
      const pre = panel.locator('pre', { hasText: '证据行-0' }).first()
      await expect(pre).toBeVisible()
      const innerScroll = await pre.evaluate(
        (el) => ({ scrollHeight: el.scrollHeight, clientHeight: el.clientHeight }),
      )
      expect(innerScroll.scrollHeight).toBeGreaterThan(innerScroll.clientHeight + 10)
      await assertContained('390')
      await panel.screenshot({ path: info.outputPath('width-390.png') })
      await info.attach('width-390', { path: info.outputPath('width-390.png'), contentType: 'image/png' })

      // 480 宽档与 320 最窄档：布局不断言细节，只验包含与截图
      const w480 = await setWidth(480)
      expect(Math.abs(w480 - 480)).toBeLessThanOrEqual(60)
      await assertContained('480')
      await panel.screenshot({ path: info.outputPath('width-480.png') })
      await info.attach('width-480', { path: info.outputPath('width-480.png'), contentType: 'image/png' })

      const w320 = await setWidth(320)
      expect(Math.abs(w320 - 320)).toBeLessThanOrEqual(60)
      await assertContained('320')
      await panel.screenshot({ path: info.outputPath('width-320.png') })
      await info.attach('width-320', { path: info.outputPath('width-320.png'), contentType: 'image/png' })
      await info.attach('widths', {
        body: JSON.stringify({ w390, w480, w320 }),
        contentType: 'application/json',
      })
    } finally {
      await app.close()
    }
  })
})
