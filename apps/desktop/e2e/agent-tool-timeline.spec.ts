import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { test, expect, type Page, type TestInfo } from '@playwright/test'
import { launchBuiltApp } from './helpers/launch-app'

/**
 * R2 聊天展示层定向回归（mock 数据 + 真实 Electron 渲染，不调用真实模型）：
 * 1. 种子时间线：工作记录收起 / 失败展开 / 富图表卡 / 长内容不撑开面板（浅色+深色截图）。
 * 2. 真实 mock Agent 审批：权限卡唯一可见 → 点 Allow → 卡片消失。
 */

async function seedTimelineScript() {
  const base = Date.now()
  const longPath = `D:/project/js/Electron/inkdown/${'非常长的目录名-'.repeat(12)}a.ts`
  const thread = {
    id: 'thread-r2-seed',
    title: '展示回归',
    createdAt: base,
    updatedAt: base,
    runtimeId: 'codex-acp', workspaceRoot: (await (window as any).electronAPI.getWorkspaceStatus()).value?.rootLabel,
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
    (window.electronAPI?.windowScopeId && window.electronAPI.windowScopeId !== 'main' ? 'montree-acp-ui:' + window.electronAPI.windowScopeId : 'montree-acp-ui'),
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
  const panel = page.locator('aside[aria-label="Agent 聊天"]:visible')
  if ((await panel.count()) === 0) {
    await page.getByRole('button', { name: 'AI 伴读', exact: true }).click()
  }
  await expect(panel.first()).toBeVisible({ timeout: 10_000 })
  return panel.first()
}

async function expectSeededTimeline(
  panel: ReturnType<Page['locator']>,
  info: TestInfo,
  tag: string,
) {
  // 高度基线（U5：默认态过程+结果入口整体高度；改造前后同种子对比）。
  const measureTimeline = () =>
    panel.evaluate((el) => {
      const items = [...el.querySelectorAll('[data-acp-probe="activity"],[data-acp-probe="tool"],[data-acp-probe="result"]')]
      const rows = items.map((node) => ({
        probe: node.getAttribute('data-acp-probe'),
        height: Math.round((node as HTMLElement).getBoundingClientRect().height),
      }))
      return {
        listScrollHeight: (el as HTMLElement).scrollHeight,
        entryHeightSum: rows.reduce((sum, r) => sum + r.height, 0),
        workLogCount: rows.filter((r) => r.probe === 'activity').length,
        toolCount: rows.filter((r) => r.probe === 'tool').length,
        resultCount: rows.filter((r) => r.probe === 'result').length,
        rows,
      }
    })
  // 历史窗口初始只看末尾 N 条：先加载更多，再做完整断言（同时覆盖历史加载回归）。
  // 列表顶部按钮可能被粘性头遮挡命中检测，用 DOM 点击。
  const loadMore = panel.getByTestId('chat-load-more')
  if ((await loadMore.count()) > 0) {
    await loadMore.first().dispatchEvent('click')
  }
  await expect(panel.getByText('这一章的核心观点是什么')).toBeVisible({ timeout: 10_000 })

  // BUI 壳：用户分支走 BuiMessage（思考默认收进工作记录，展开后见 BuiThinking 壳，见下）
  await expect(panel.locator('[data-bui-message="user"]').first()).toBeVisible()

  // 工作记录：工具调用计数可见，不用消息数冒充步骤数；默认收起。
  // 旧文案「工作了 Xs · N 步」必须消失（精确匹配旧格式，避免误伤「步骤」等词）。
  // 注：种子含两个工具调用 2 的组，首组用于下述展开断言。
  const workLog = panel.getByText(/工作记录 · 工具调用 4/).first()
  await expect(workLog).toBeVisible()
  await expect(panel.locator('[data-slot="agent-activity"]').first()).toBeVisible()
  await expect(panel.getByText(/工作记录 · 工具调用 2/)).toHaveCount(0)
  await expect(panel.getByText(/工作了 .* · \d+ 步/)).toHaveCount(0)
  await expect(panel.getByText('第一章第一段正文摘要')).toHaveCount(0)

  // 失败摘要在主时间线可见（无需展开）
  await expect(panel.getByText('失败').first()).toBeVisible()
  await expect(panel.getByText('阅读上下文未就绪')).toBeVisible()

  // 默认态测量（任何展开点击之前）：U5 40% 对比的起点
  const defaultMeasure = await measureTimeline()
  await info.attach('timeline-measure-default', {
    body: JSON.stringify(defaultMeasure, null, 2),
    contentType: 'application/json',
  })
  // eslint-disable-next-line no-console
  console.log(`TIMELINE_DEFAULT=${JSON.stringify(defaultMeasure)}`)

  // 富图表走独立结果入口：紧凑过程行 + 紧凑卡（默认不渲染 Mermaid 画布）
  await expect(panel.getByTestId('diagram-viewer-card')).toBeVisible()
  await expect(panel.getByRole('button', { name: /查看完整图表/ })).toBeVisible()
  await expect(panel.locator('[data-testid="diagram-viewer-card"] .mermaid')).toHaveCount(0)

  // 完整入口可达：展开后见复制入口与知识卡片操作
  await panel.getByRole('button', { name: /查看完整图表/ }).click()
  await expect(panel.getByRole('button', { name: /复制代码/ })).toBeVisible()
  await expect(panel.getByText('存为知识卡片')).toBeVisible()

  // 展开工作记录后见轻量工具行；点击一次直接见详情。
  await workLog.click()
  const readRow = panel.getByRole('button', { name: /读取文档/ }).first()
  await expect(readRow).toBeVisible()
  await readRow.click()
  await expect(panel.getByText('第一章第一段正文摘要')).toBeVisible()

  // BUI：思考默认收进工作记录，展开后走 BuiThinking 壳（data-part-key 透传 thought-<id>）
  await expect(panel.locator('[data-part-key="thought-th-1"]')).toHaveCount(1)

  // BeUI 时间线展示真实工具目标与状态，详情仍由原工具入口展开。
  const activityRows = panel.locator('[data-slot="agent-activity-row"]')
  await expect(activityRows.locator('span[title]').first()).toBeVisible()
  await expect(activityRows.getByText(/已完成/).first()).toBeVisible()

  // 长内容不撑开面板
  const overflow = await panel.evaluate(
    (el) => ({ scrollWidth: el.scrollWidth, clientWidth: el.clientWidth }),
  )
  expect(overflow.scrollWidth, `面板被撑开 ${JSON.stringify(overflow)}`).toBeLessThanOrEqual(
    overflow.clientWidth + 2,
  )

  const path = await info.outputPath(`timeline-${tag}.png`)
  await workLog.scrollIntoViewIfNeeded()
  await panel.screenshot({ path })
  await info.attach(`timeline-${tag}`, { path, contentType: 'image/png' })
  await info.attach(`timeline-measure-${tag}`, {
    body: JSON.stringify(await measureTimeline(), null, 2),
    contentType: 'application/json',
  })
  // eslint-disable-next-line no-console
  console.log(`TIMELINE_MEASURE_${tag}=${JSON.stringify(await measureTimeline())}`)
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
      await window.evaluate(async () => {
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
      await window.evaluate(async () => {
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
      // BUI：权限卡走 BuiApprovalCard 视觉（外层保留 agent-permission-card testid）
      await expect(approval.getByTestId('bui-approval-card')).toBeVisible()
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
      await expect(approval2.getByTestId('bui-approval-card')).toBeVisible()
      await approval2.getByRole('button', { name: 'Reject' }).click()
      await expect(approval2).toBeHidden({ timeout: 15_000 })
      await expect(panel.getByText(/PERMISSION:.*reject/)).toBeVisible({ timeout: 15_000 })
    } finally {
      await app.close()
    }
  })

  test('真实 mock 审批（深色）：卡片可见，Allow 后消失', async ({}, info) => {
    // 深色走启动时主题（localStorage 预置 + reload），审批在深色启动后实时创建，
    // 不经过 reload，不丢失 pending。实时点击切换在 GPU 禁用的 E2E 下 view-transition
    // 回调可能被跳过（见报告），故深色覆盖用启动态而非切换态。
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
      await window.evaluate(async () => {
        const raw = JSON.parse(localStorage.getItem('markdown-editor-ui') ?? '{"state":{}}')
        raw.state = { ...(raw.state ?? {}), theme: 'dark' }
        localStorage.setItem('markdown-editor-ui', JSON.stringify(raw))
      })
      await window.reload()
      await expect(window.getByRole('button', { name: '更多操作', exact: true })).toBeVisible({
        timeout: 15_000,
      })
      await expect(window.locator('html.dark')).toHaveCount(1)
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
      const approval = panel.getByTestId('agent-permission-card')
      await expect(approval).toBeVisible({ timeout: 15_000 })
      await expect(approval.getByTestId('bui-approval-card')).toBeVisible()
      await expect(window.getByText('等待批准').first()).toBeVisible()
      await panel.screenshot({ path: info.outputPath('approval-dark.png') })
      await info.attach('approval-dark', { path: info.outputPath('approval-dark.png'), contentType: 'image/png' })
      await approval.getByRole('button', { name: 'Allow' }).click()
      await expect(approval).toBeHidden({ timeout: 15_000 })
      await expect(panel.getByText(/PERMISSION:/)).toBeVisible({ timeout: 15_000 })
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
      const lastGroup = panel.getByText(/工作记录 · 工具调用 4/).last()
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

  test('收敛基线：10 次普通调用只占一条工作记录，2 个结果仅 2 个入口', async ({}, info) => {
    const app = await launchBuiltApp()
    try {
      const window = await app.firstWindow()
      await window.waitForLoadState('domcontentloaded')
      await expect(window.getByRole('button', { name: '更多操作', exact: true })).toBeVisible({
        timeout: 15_000,
      })
      await window.setViewportSize({ width: 1600, height: 900 })
      await window.evaluate(async () => {
        const base = Date.now()
        const messages: Array<Record<string, unknown>> = [
          { id: 'u-10', role: 'user', text: '批量梳理十节', createdAt: base },
        ]
        for (let i = 0; i < 10; i += 1) {
          messages.push({
            id: `tc-10-${i}`,
            role: 'tool',
            text: `第 ${i + 1} 节摘要正文`,
            createdAt: base + i,
            updatedAt: base + 100 + i,
            streaming: false,
            toolCallId: `tc-10-${i}`,
            toolKind: 'read',
            toolTitle: 'read_text_file',
            toolStatus: 'completed',
            toolContentText: `第 ${i + 1} 节摘要正文`,
          })
        }
        const diagram = JSON.stringify({
          diagramId: 'diag-10',
          diagramType: 'flowchart',
          title: '十节总览',
          summary: '十节流转摘要',
          mermaidCode: 'graph TD; A-->B',
        })
        messages.push({
          id: 'tc-10-diagram',
          role: 'tool',
          text: diagram,
          createdAt: base + 50,
          updatedAt: base + 150,
          streaming: false,
          toolCallId: 'tc-10-diagram',
          toolKind: 'other',
          toolTitle: 'montree_generate_diagram',
          toolStatus: 'completed',
          toolContentText: diagram,
        })
        messages.push({
          id: 'tc-10-artifact',
          role: 'tool',
          text: JSON.stringify({ schemaVersion: 1, kind: 'html-artifact', id: 'present-html-artifact-10', title: '小结页', html: '<p>十节小结</p>' }),
          createdAt: base + 60,
          updatedAt: base + 160,
          streaming: false,
          toolCallId: 'tc-10-artifact',
          toolKind: 'other',
          toolTitle: 'montree_present',
          toolStatus: 'completed',
          toolContentText: JSON.stringify({ schemaVersion: 1, kind: 'html-artifact', id: 'present-html-artifact-10', title: '小结页', html: '<p>十节小结</p>' }),
        })
        messages.push({ id: 'a-10', role: 'agent', text: '十节已梳理完毕。', createdAt: base + 70, updatedAt: base + 170, streaming: false })
        localStorage.setItem(
          (window.electronAPI?.windowScopeId && window.electronAPI.windowScopeId !== 'main' ? 'montree-acp-ui:' + window.electronAPI.windowScopeId : 'montree-acp-ui'),
          JSON.stringify({
            version: 0,
            state: {
              panelOpen: true,
              hudDisplayMode: 'docked',
              selectedRuntimeId: 'codex-acp',
              activeThreadId: 'thread-converge',
              threads: [{ id: 'thread-converge', title: '收敛基线', createdAt: base, updatedAt: base, runtimeId: 'codex-acp', workspaceRoot: (await (window as any).electronAPI.getWorkspaceStatus()).value?.rootLabel, agentSessionIds: {}, messages }],
            },
          }),
        )
      })
      await window.evaluate(async () => {
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

      // 默认态：一条工作记录（10 次调用）+ 2 个结果入口，不多占
      await expect(panel.getByText(/工作记录 · 工具调用 10/)).toBeVisible({ timeout: 10_000 })
      await expect(panel.locator('[data-acp-probe="activity"]')).toHaveCount(1)
      await expect(panel.locator('[data-acp-probe="result"]')).toHaveCount(2)
      await expect(panel.getByTestId('diagram-viewer-card')).toHaveCount(1)
      await expect(panel.getByTestId('html-artifact-card')).toHaveCount(1)
      // 详情默认收起：10 份输出正文都不在 DOM 可见文本里
      await expect(panel.getByText('第 5 节摘要正文')).toHaveCount(0)

      const measured = await panel.evaluate((el) => {
        const items = [...el.querySelectorAll('[data-acp-probe="activity"],[data-acp-probe="tool"],[data-acp-probe="result"]')]
        return {
          listScrollHeight: (el as HTMLElement).scrollHeight,
          entryHeightSum: items.reduce((sum, node) => sum + Math.round((node as HTMLElement).getBoundingClientRect().height), 0),
        }
      })
      await info.attach('converge-measure', { body: JSON.stringify(measured), contentType: 'application/json' })
      // eslint-disable-next-line no-console
      console.log(`CONVERGE_MEASURE=${JSON.stringify(measured)}`)
      await panel.screenshot({ path: info.outputPath('converge.png') })
      await info.attach('converge', { path: info.outputPath('converge.png'), contentType: 'image/png' })
    } finally {
      await app.close()
    }
  })

  test('流式工作记录：最新工具固定展示，完成收起且可查看历史', async ({}, info) => {
    const directory = await mkdtemp(join(tmpdir(), 'montree-worklog-'))
    const gate = join(directory, 'continue')
    const app = await launchBuiltApp({
      E2E_WORKLOG_GATE: gate,
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
      await panel.getByRole('textbox', { name: '输入消息，Enter 发送，Shift+Enter 换行' }).fill('worklog')
      await panel.getByRole('button', { name: '发送', exact: true }).click()
      // 运行中（mock 不主动结束回合，工具保持流式）：一条工作记录，
      // 运行中默认展开，只显示最新工具行（2 个并行，不伪造串行）
      const workLog = panel.getByText(/工作中.*0\/2/).first()
      await expect(workLog).toBeVisible({ timeout: 15_000 })
      await expect(panel.locator('[data-acp-probe="activity"]')).toHaveCount(1)
      // 运行中整卡琥珀光环（落定即卸）；旧底栏扫光条已删除
      await expect(panel.locator('.agent-beam-ring-amber')).toHaveCount(1)
      await expect(panel.locator('.agent-stream-sweep')).toHaveCount(0)
      // 光环伪元素真实上漆且在旋转（非挂名类）
      const beamPaint = await panel.evaluate(() => {
        const el = document.querySelector('.agent-beam-ring-amber')
        if (!el) return null
        const ps = getComputedStyle(el, '::after')
        return { content: ps.content, animation: ps.animationName }
      })
      expect(beamPaint?.content).not.toBe('none')
      expect(beamPaint?.animation).toContain('agent-beam-spin')
      const expanded = await panel
        .locator('[data-acp-probe="activity"] button[aria-expanded]')
        .first()
        .getAttribute('aria-expanded')
      expect(expanded).toBe('true')
      await expect(panel.locator('[data-slot="agent-activity-row"]')).toHaveCount(1)

      // 落定自动收起由 effect 完成；等待真实状态，之后仍可手动查看完整历史。
      await writeFile(gate, 'continue')
      await expect(panel.getByText(/WORKLOG:.*done/)).toBeVisible({ timeout: 15_000 })
      await expect(panel.locator('[data-acp-probe="activity"] button[aria-expanded]').first()).toHaveAttribute('aria-expanded', 'false')
      await panel.locator('[data-acp-probe="activity"] button[aria-expanded]').first().click()
      await expect(panel.locator('[data-slot="agent-activity-row"]')).toHaveCount(2)
      await expect(panel.getByText(/工作记录 · 工具调用 2/)).toBeVisible()
      await expect(panel.locator('.agent-beam-ring-amber')).toHaveCount(0)
      await panel.screenshot({ path: info.outputPath('worklog-stream.png') })
      await info.attach('worklog-stream', { path: info.outputPath('worklog-stream.png'), contentType: 'image/png' })
    } finally {
      await app.close()
      await rm(directory, { recursive: true, force: true })
    }
  })
  test('社区滚动与历史恢复：离底浮现回到底部，重载后窗口与状态恢复', async ({}, info) => {
    const app = await launchBuiltApp()
    try {
      const window = await app.firstWindow()
      await window.waitForLoadState('domcontentloaded')
      await expect(window.getByRole('button', { name: '更多操作', exact: true })).toBeVisible({
        timeout: 15_000,
      })
      await window.setViewportSize({ width: 1600, height: 900 })
      await window.evaluate(async () => {
        const base = Date.now()
        const messages: Array<Record<string, unknown>> = []
        for (let turn = 0; turn < 12; turn += 1) {
          messages.push({ id: 'u-scroll-' + turn, role: 'user', text: '第' + (turn + 1) + '问', createdAt: base + turn * 10 })
          messages.push({
            id: 'tc-scroll-' + turn,
            role: 'tool',
            text: '第' + (turn + 1) + '节摘要',
            createdAt: base + turn * 10 + 1,
            updatedAt: base + turn * 10 + 2,
            streaming: false,
            toolCallId: 'tc-scroll-' + turn,
            toolKind: 'read',
            toolTitle: 'read_text_file',
            toolStatus: 'completed',
            toolContentText: '第' + (turn + 1) + '节摘要',
          })
          messages.push({ id: 'a-scroll-' + turn, role: 'agent', text: '第' + (turn + 1) + '答：已梳理。', createdAt: base + turn * 10 + 3, updatedAt: base + turn * 10 + 4, streaming: false })
        }
        localStorage.setItem(
          (window.electronAPI?.windowScopeId && window.electronAPI.windowScopeId !== 'main' ? 'montree-acp-ui:' + window.electronAPI.windowScopeId : 'montree-acp-ui'),
          JSON.stringify({
            version: 0,
            state: {
              panelOpen: true,
              hudDisplayMode: 'docked',
              selectedRuntimeId: 'codex-acp',
              activeThreadId: 'thread-scroll',
              threads: [{ id: 'thread-scroll', title: '滚动恢复', createdAt: base, updatedAt: base, runtimeId: 'codex-acp', workspaceRoot: (await (window as any).electronAPI.getWorkspaceStatus()).value?.rootLabel, agentSessionIds: {}, messages }],
            },
          }),
        )
      })
      await window.evaluate(async () => {
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
      const loadMore = panel.getByTestId('chat-load-more')
      // 前补到全量（按钮消失）：后续计数完全确定，不受顶部自动补漂移影响
      for (let i = 0; i < 8; i += 1) {
        if ((await loadMore.count()) === 0) break
        await loadMore.first().dispatchEvent('click')
        await window.waitForTimeout(400)
      }
      await expect(loadMore).toHaveCount(0)
      const countBefore = await panel.locator('[data-acp-probe]').count()
      expect(countBefore).toBeGreaterThan(30)

      // 离底：滚轮上滑后回到底部浮现，点击回到贴底
      await panel.hover()
      await window.mouse.wheel(0, -600)
      const toBottom = panel.getByRole('button', { name: '回到底部' })
      await expect(toBottom).toBeVisible({ timeout: 10_000 })
      await toBottom.click()
      await expect(toBottom).toBeHidden({ timeout: 10_000 })

      // 再次离底后重载：离底状态恢复（新加载默认贴底、无按钮；恢复后按钮在）。
      // persist 节流 1500ms：轮询确认离底快照落盘后再重载，不靠固定等待碰运气。
      await panel.hover()
      await window.mouse.wheel(0, -600)
      await expect(panel.getByRole('button', { name: '回到底部' })).toBeVisible({ timeout: 10_000 })
      await expect
        .poll(
          async () =>
            window.evaluate(() => {
              const raw = JSON.parse(localStorage.getItem((window.electronAPI?.windowScopeId && window.electronAPI.windowScopeId !== 'main' ? 'montree-acp-ui:' + window.electronAPI.windowScopeId : 'montree-acp-ui')) ?? '{}')
              return raw?.state?.chatScrollByThread?.['thread-scroll'] ?? null
            }),
          { timeout: 15_000 },
        ).toMatchObject({ pinned: false })
      await window.reload()
      await expect(window.getByRole('button', { name: '更多操作', exact: true })).toBeVisible({
        timeout: 15_000,
      })
      const panel2 = await openPanel(window)
      // 全量窗口恢复：条数与离底前一致（重置则只剩末 5 条）；按钮在（仍离底）
      expect(await panel2.locator('[data-acp-probe]').count()).toBe(countBefore)
      await expect(panel2.getByTestId('chat-load-more')).toHaveCount(0)
      await expect(panel2.getByRole('button', { name: '回到底部' })).toBeVisible({ timeout: 10_000 })
      await panel2.screenshot({ path: info.outputPath('scroll-restore.png') })
      await info.attach('scroll-restore', { path: info.outputPath('scroll-restore.png'), contentType: 'image/png' })
    } finally {
      await app.close()
    }
  })
})
