import { webDocFixtureDir, welcomeWebDocUrlField } from './helpers/web-doc-fixture'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { test, expect, type Page } from '@playwright/test'
import { launchBuiltApp } from './helpers/launch-app'
import { writeFoliateSectionsWorkspace } from './helpers/ebook-fixture'

/**
 * S2 富结果生产链路（真实 Electron + mock Agent + 本地文档，不调用真实模型）：
 * 1. 章节比较：真实 MCP montree_present 调用 → mock 回放进聊天 → 筛选/证据/定位到 foliate 真实章节。
 * 2. HTML Artifact：真实 MCP 调用 → 回放 → 打开宽预览/离线交互/隔离探针/宿主保存路径。
 * 3. 真实 MCP：发现、调用、复放同 ID、非法/超限拒绝。
 */

const MOCK_ENV = {
  E2E_ACP_WINDOW_TEST: '1',
  E2E_ACP_COMMAND: process.execPath,
  E2E_ACP_FIXTURE: resolve('apps/desktop/e2e/fixtures/mock-window-agent.cjs'),
}

async function openPanel(page: Page) {
  const panel = page.locator('aside[aria-label="Agent 聊天"]:visible')
  if ((await panel.count()) === 0) {
    await page.getByRole('button', { name: 'AI 伴读', exact: true }).click()
  }
  await expect(panel.first()).toBeVisible({ timeout: 10_000 })
  return panel.first()
}

async function connect(page: Page) {
  const connected = await page.evaluate(() =>
    (window as any).electronAPI.acpConnect({ runtimeId: 'mock-window' }),
  )
  expect(connected.ok, JSON.stringify(connected)).toBe(true)
  return connected.value.sessionId as string
}

async function prompt(page: Page, sessionId: string, text: string) {
  await page.evaluate(
    ({ sessionId, text }) => {
      void (window as any).electronAPI.acpPrompt({ sessionId, prompt: [{ type: 'text', text }] })
    },
    { sessionId, text },
  )
}

interface McpEndpoint {
  url: string
  authToken: string
}

async function mcpRpc(
  _page: Page,
  endpoint: McpEndpoint,
  method: string,
  params: Record<string, unknown>,
) {
  // MCP 端点只监听本地回环；渲染进程 fetch 会被 Chromium 拦截，
  // 与既有 text-tools-integration 一致走 Node 侧直调（快照桥仍回渲染端）。
  const response = await fetch(endpoint.url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${endpoint.authToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 7, method, params }),
  })
  const body = await response.text()
  expect(response.ok, `MCP ${method}: HTTP ${response.status}, ${body.slice(0, 500)}`).toBe(true)
  expect(body.length, `MCP ${method}: 返回空正文`).toBeGreaterThan(0)
  return JSON.parse(body)
}

async function mcpCall(
  page: Page,
  endpoint: McpEndpoint,
  name: string,
  args: Record<string, unknown>,
) {
  return mcpRpc(page, endpoint, 'tools/call', { name, arguments: args })
}

test.describe('富结果生产链路 S2', () => {
  test('章节比较：真实工具→卡片→筛选/证据/定位事件（Markdown）', async ({}, info) => {
    test.setTimeout(120_000)
    const workspace = await mkdtemp(join(tmpdir(), 'montree-e2e-present-'))
    await writeFile(join(workspace, 'compare.md'), '# 第一章\n\n甲论点原文在此。\n\n' + '长段落用于验证真实滚动。\n\n'.repeat(70) + '# 第二章\n\n乙论点原文在此。\n' + '尾部段落。\n\n'.repeat(30))
    await writeFile(join(workspace, 'other.md'), '# 另一篇\n\n无关正文。\n')
    const app = await launchBuiltApp({
      E2E_AUTO_OPEN_PATH: workspace,
      E2E_DOCUMENT_TOOLS: '1',
      ...MOCK_ENV,
    })
    try {
      const window = await app.firstWindow()
      await window.waitForLoadState('domcontentloaded')
      await expect(window.getByRole('button', { name: '更多操作', exact: true })).toBeVisible({
        timeout: 15_000,
      })
      await window.getByRole('button', { name: '更多操作', exact: true }).click()
      await window.getByRole('menuitem', { name: /打开文件夹/ }).click()
      await window.keyboard.press('Control+p')
      const dialog = window.getByRole('dialog', { name: '快速打开文件' })
      await dialog.getByPlaceholder('搜索工作区文件或电子书...').fill('compare.md')
      await dialog.getByRole('button').filter({ hasText: 'compare.md' }).click()
      await expect(dialog).toBeHidden()
      await expect(window.locator('.cm-editor')).toBeVisible()

      const panel = await openPanel(window)
      const sessionId = await connect(window)
      const endpoint = (await app.evaluate(
        async () => (globalThis as any).__montreeE2eMcpEndpoint(),
      )) as McpEndpoint

      // 真实 MCP 调用产生结果（章节引用按标题解析，flatIndex 由工具回填）
      const envelope = await mcpCall(window, endpoint, 'montree_present', {
        kind: 'chapter-comparison',
        title: '两章论点比较',
        chapters: [
          { key: 'c1', label: '第一章', title: '第一章' },
          { key: 'c2', label: '第二章', title: '第二章' },
        ],
        items: [
          { dimension: '论点', chapterKey: 'c1', excerpt: '甲论点原文在此。' },
          { dimension: '论点', chapterKey: 'c2', excerpt: '乙论点原文在此。' },
          { dimension: '结构', chapterKey: 'c1', note: '仅评述，无摘录' },
        ],
      })
      expect(envelope.result.isError, JSON.stringify(envelope)).toBeFalsy()
      const result = JSON.parse(envelope.result.content[0].text)
      expect(result.kind).toBe('chapter-comparison')
      expect(result.items.filter((i: any) => i.verified)).toHaveLength(2)
      expect(result.items[0].flatIndex).toBeGreaterThanOrEqual(0)

      // mock 回放进聊天（透传真实结果，不编造）
      await prompt(window, sessionId, `present-echo:${JSON.stringify(result)}`)
      const card = panel.getByTestId('chapter-comparison-card')
      await expect(card).toBeVisible({ timeout: 15_000 })
      await expect(card.getByText('两章论点比较')).toBeVisible()

      // 筛选：取消第二章后剩 c1 两条；甲论点摘录不可见（未展开）
      await card.getByRole('button', { name: '第二章', exact: true }).click()
      expect(await card.getByTestId('comparison-item').count()).toBe(2)
      await expect(card.getByText('甲论点原文在此。')).toHaveCount(0)
      await card.getByRole('button', { name: '第二章', exact: true }).click()
      expect(await card.getByTestId('comparison-item').count()).toBe(3)

      // 证据展开/收起
      const evidence = card.getByRole('button', { name: /查看证据/ }).first()
      await evidence.click()
      await expect(card.getByText('甲论点原文在此。')).toBeVisible()
      await card.getByRole('button', { name: /收起证据/ }).first().click()

      // 未验证条目无定位入口
      const unlocated = card.getByTestId('comparison-item').nth(2)
      await expect(unlocated.getByText('无定位')).toBeVisible()
      await expect(unlocated.getByRole('button', { name: '定位原文' })).toHaveCount(0)

      // Actual editor selection, source ownership and visible position, not just a broadcast.
      await window.evaluate(() => {
        ;(window as any).__anchors = []
        window.addEventListener('montree:anchor-highlight', (event: any) => { (window as any).__anchors.push(event.detail) })
      })
      await card.getByRole('button', { name: '定位原文' }).nth(1).click()
      const selected = await mcpCall(window, endpoint, 'montree_text_read', { documentPath: join(workspace, 'compare.md'), target: 'selection' })
      expect(JSON.parse(selected.result.content[0].text).text).toBe('乙论点原文在此。')
      await expect.poll(() => window.locator('.cm-scroller').evaluate(el => {
        const bounds = el.getBoundingClientRect()
        const line = [...el.querySelectorAll('.cm-line')].find(row => row.textContent?.includes('乙论点原文在此。'))!
        if (!line) return false
        const rect = line.getBoundingClientRect()
        return rect.top >= bounds.top && rect.bottom <= bounds.bottom && el.scrollTop > 0
      })).toBe(true)
      await window.getByRole('button', { name: '独立预览', exact: true }).click()
      const preview = window.locator('.markdown-preview:not(.agent-md)')
      await expect(preview).toBeVisible()
      await card.getByRole('button', { name: '定位原文' }).nth(1).click()
      await expect.poll(() => window.evaluate(() => window.getSelection()?.toString())).toBe('乙论点原文在此。')
      await expect.poll(() => preview.evaluate(el => {
        const block = [...el.querySelectorAll('p')].find(p => p.textContent?.includes('乙论点原文在此。'))
        if (!block) return false
        const rect = block.getBoundingClientRect(), bounds = el.getBoundingClientRect()
        return rect.top >= bounds.top && rect.bottom <= bounds.bottom && el.scrollTop > 0
      })).toBe(true)
      await preview.screenshot({ path: info.outputPath('markdown-locate.png') })

      // 跨文档：切到另一篇后点历史卡定位，被禁止并引导回原文档，不广播高亮
      await window.keyboard.press('Control+p')
      const switchDialog = window.getByRole('dialog', { name: '快速打开文件' })
      await switchDialog.getByPlaceholder('搜索工作区文件或电子书...').fill('other.md')
      await switchDialog.getByRole('button').filter({ hasText: 'other.md' }).click()
      await expect(switchDialog).toBeHidden()
      const anchorCountBefore = (await window.evaluate(() => (window as any).__anchors)).length
      const citations = card.locator('[data-slot="citations"]')
      await expect(citations.getByRole('button', { name: '引用来源 · 2 处' })).toBeVisible()
      await citations.getByRole('button', { name: '引用来源 · 2 处' }).click()
      await expect(citations.locator('li')).toHaveCount(2)
      await expect(citations).not.toContainText('仅评述，无摘录')
      await citations.locator('li button').first().click()
      await expect(window.getByText(/请先打开原文档后再定位/)).toBeVisible({ timeout: 10_000 })
      expect(await window.evaluate(() => (window as any).__anchors)).toHaveLength(anchorCountBefore)

      await citations.scrollIntoViewIfNeeded()
      await panel.screenshot({ path: info.outputPath('compare.png') })
      await info.attach('compare', { path: info.outputPath('compare.png'), contentType: 'image/png' })

      // 新卡三档宽度：容器查询在卡片宽度下生效（非 viewport），窄栏单列、宽栏双列
      const itemsBox = card.getByTestId('comparison-items')
      const dragTo = async (target: number): Promise<number> => {
        const handle = window.locator('[data-slot="resizable-handle"]').last()
        for (let i = 0; i < 6; i += 1) {
          const w = Math.round(await panel.evaluate((el) => el.getBoundingClientRect().width))
          if (Math.abs(w - target) <= 45) return w
          const box = await handle.boundingBox()
          if (!box) throw new Error('分隔线无位置')
          const dx = Math.max(-220, Math.min(220, w - target))
          await window.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
          await window.mouse.down()
          await window.mouse.move(box.x + box.width / 2 + dx, box.y + box.height / 2, { steps: 10 })
          await window.mouse.up()
          await window.waitForTimeout(350)
        }
        return Math.round(await panel.evaluate((el) => el.getBoundingClientRect().width))
      }
      const columnsOf = () =>
        itemsBox.evaluate((el) => getComputedStyle(el).columnCount)
      await dragTo(580)
      // 停靠栏位最大约 449px：先验窄栏无分栏（计算值为 auto），再把卡片放宽到 520 探容器查询机制
      expect(await columnsOf()).toBe('auto')
      await card.evaluate((el) => {
        ;(el as HTMLElement).style.width = '520px'
        ;(el as HTMLElement).style.maxWidth = 'none'
      })
      expect(await columnsOf()).toBe('2')
      await panel.screenshot({ path: info.outputPath('compare-wide.png') })
      await info.attach('compare-wide', { path: info.outputPath('compare-wide.png'), contentType: 'image/png' })
      await card.evaluate((el) => {
        ;(el as HTMLElement).style.width = ''
        ;(el as HTMLElement).style.maxWidth = ''
      })
      // 复位后回到单列窄栏（320 档由 timeline 宽度用例覆盖，此处验复位与包含）
      expect(await columnsOf()).toBe('auto')
      const overflow = await panel.evaluate((el) => ({
        scrollWidth: el.scrollWidth,
        clientWidth: el.clientWidth,
      }))
      expect(overflow.scrollWidth).toBeLessThanOrEqual(overflow.clientWidth + 2)
      await panel.screenshot({ path: info.outputPath('compare-narrow.png') })
      await info.attach('compare-narrow', { path: info.outputPath('compare-narrow.png'), contentType: 'image/png' })

      // 深色：线程持久化后重载，卡片照常渲染
      await window.waitForTimeout(2000)
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
      await expect(darkPanel.getByTestId('chapter-comparison-card')).toBeVisible({ timeout: 15_000 })
      await darkPanel.screenshot({ path: info.outputPath('compare-dark.png') })
      await info.attach('compare-dark', { path: info.outputPath('compare-dark.png'), contentType: 'image/png' })
    } finally {
      await app.close()
      await rm(workspace, { recursive: true, force: true })
    }
  })

  test('HTML Artifact：打开/交互/隔离/宿主保存', async ({}, info) => {
    const app = await launchBuiltApp({ E2E_DOCUMENT_TOOLS: '1', ...MOCK_ENV })
    try {
      const window = await app.firstWindow()
      await window.waitForLoadState('domcontentloaded')
      await expect(window.getByRole('button', { name: '更多操作', exact: true })).toBeVisible({
        timeout: 15_000,
      })
      // Chromium 可能先报告 request 再报告 CSP 拒绝；验证每次尝试均被策略阻止。
      const externalRequests = new Set<import('@playwright/test').Request>()
      const cspBlocked = new Set<import('@playwright/test').Request>()
      const externalResponses: string[] = []
      window.on('request', (request) => {
        if (request.url().includes('example.test')) externalRequests.add(request)
      })
      window.on('requestfailed', (request) => {
        if (request.url().includes('example.test') && request.failure()?.errorText === 'csp') cspBlocked.add(request)
      })
      window.on('response', (response) => {
        if (response.url().includes('example.test')) externalResponses.push(response.url())
      })

      const panel = await openPanel(window)
      const sessionId = await connect(window)
      const endpoint = (await app.evaluate(
        async () => (globalThis as any).__montreeE2eMcpEndpoint(),
      )) as McpEndpoint
      // 真实 MCP 调用产生结果（含交互脚本、外部资源陷阱、前置脚本与自导航陷阱），再回放进聊天
      const envelope = await mcpCall(window, endpoint, 'montree_present', {
        kind: 'html-artifact',
        title: '计数器',
        summary: '离线小应用',
        html: '<script>fetch("https://example.test/early",{mode:"no-cors"})</script><style>p{color:#1a1a1a}</style><p id="c">计数：0</p><button id="b">增加</button><button id="nav">跳转</button><a id="selfnav" href="data:text/html,hacked">自跳</a><img src="https://example.test/pixel.png" alt=""><a href="https://example.test/" target="_blank" rel="noopener">外链</a><script>var n=0;document.getElementById("b").addEventListener("click",function(){n++;document.getElementById("c").textContent="计数："+n});document.getElementById("nav").addEventListener("click",function(){location.href="data:text/html,<p>hacked</p>"});setTimeout(function(){window.name="ordinary-reader";location.href="data:text/html,<p>hacked</p>"},800)</script>',
      })
      expect(envelope.result.isError, JSON.stringify(envelope)).toBeFalsy()
      const artifactId = JSON.parse(envelope.result.content[0].text).id as string
      await prompt(window, sessionId, `present-echo:${envelope.result.content[0].text}`)
      const card = panel.getByTestId('html-artifact-card')
      await expect(card).toBeVisible({ timeout: 15_000 })
      await expect(card.getByText('计数器')).toBeVisible()

      // 源码为纯文本（脚本不执行）
      await card.getByRole('button', { name: /查看源码/ }).click()
      const source = card.getByTestId('artifact-source')
      await expect(source).toBeVisible()
      expect(await source.textContent()).toContain('addEventListener')
      expect(card.locator('iframe')).toHaveCount(0)

      // 打开宽预览：隔离属性与宿主 CSP
      await card.getByRole('button', { name: /打开预览/ }).click()
      const frame = window.locator('iframe[data-testid="artifact-frame"]')
      await expect(frame).toBeVisible({ timeout: 10_000 })
      expect(await frame.getAttribute('sandbox')).toBe('allow-scripts')

      // 离线交互可用（CDP 级点击/读取，不经页面 JS）。
      // 先等宿主 ready（脚本已执行）再点，避免点击落在脚本解析前。
      const dialog = window.locator('[role="dialog"]')
      await expect(dialog.getByText(/加载中/)).toHaveCount(0, { timeout: 15_000 })
      const inner = window.frameLocator('iframe[data-testid="artifact-frame"]')
      await expect(inner.getByText('计数：0')).toBeVisible({ timeout: 10_000 })
      // 真实点击；若一次未生效（输入时序抖动）最多重试两次，仍为 CDP 级真实交互
      let counted = false
      for (let attempt = 0; attempt < 3 && !counted; attempt += 1) {
        await inner.getByRole('button', { name: '增加' }).click({ timeout: 10_000 })
        try {
          await expect(inner.getByText('计数：1')).toBeVisible({ timeout: 4_000 })
          counted = true
        } catch {
          counted = false
        }
      }
      expect(counted, '框内计数器经真实点击后未更新').toBe(true)

      // 隔离探针：父 DOM/electronAPI 不可达，伪造消息被忽略
      const isolation = await window.evaluate(() => {
        const frame = document.querySelector('iframe[data-testid="artifact-frame"]') as HTMLIFrameElement | null
        const win = frame?.contentWindow as any
        const verdict: Record<string, string> = {}
        try {
          void win.localStorage
          verdict.storage = 'ACCESSIBLE'
        } catch {
          verdict.storage = 'BLOCKED'
        }
        try {
          verdict.electronAPI = win.electronAPI === undefined ? 'ABSENT' : 'PRESENT'
        } catch {
          verdict.electronAPI = 'BLOCKED'
        }
        try {
          verdict.opened = win.open('https://example.test/') === null ? 'BLOCKED' : 'OPENED'
        } catch {
          verdict.opened = 'BLOCKED'
        }
        window.dispatchEvent(
          new MessageEvent('message', { source: window, data: { mountId: 'forged', type: 'artifact-height', value: 900 } }),
        )
        verdict.forgedHeight = frame?.style.height || ''
        return verdict
      })
      expect(isolation.storage).toBe('BLOCKED')
      expect(['ABSENT', 'BLOCKED']).toContain(isolation.electronAPI)
      expect(isolation.opened).toBe('BLOCKED')
      expect(isolation.forgedHeight ?? '').not.toBe('900px')

      // CSP 拒绝不是网络失败：每个被报告的资源请求须明确因 csp 失败，且无响应。
      await window.waitForTimeout(2500)
      expect([...externalRequests].filter((request) => !cspBlocked.has(request)).map((request) => request.url())).toEqual([])
      expect(externalResponses).toEqual([])

      // 自导航阻断：脚本 location 与自跳链接均不得替换受控文档。
      // 以全帧 URL 断言（仅 file/about/devtools 允许出现；data:/http: 出现即阻断失效）。
      const frameName = await frame.getAttribute('name')
      expect(frameName).toMatch(/^montree-artifact-/)
      const frameUrls = () => window.frames().map((f) => f.url())
      const rogueFrame = () => frameUrls().find((u) => !(u.startsWith('file:') || u.startsWith('about:') || u.startsWith('devtools:') || u === ''))
      expect(rogueFrame()).toBeUndefined()
      await inner.getByRole('button', { name: '跳转' }).click()
      await window.waitForTimeout(800)
      expect(rogueFrame()).toBeUndefined()
      await expect(inner.getByText('计数：1')).toBeVisible({ timeout: 10_000 })
      const selfnav = inner.locator('#selfnav')
      if ((await selfnav.count()) > 0) {
        await selfnav.click()
        await window.waitForTimeout(800)
        expect(rogueFrame()).toBeUndefined()
        await expect(inner.getByText('计数：1')).toBeVisible({ timeout: 10_000 })
      }

      // 没有自动导出路径时原生框取消，保持静默；真实落盘由下一用例点击卡片验证。
      // 注：radix 模态打开时背景 aria-hidden，点对话框内的导出（同一 handleExport）。
      await dialog.getByRole('button', { name: /导出 HTML/ }).click()
      await window.waitForTimeout(1500)
      const toasts = window.getByRole('status').or(window.locator('[data-sonner-toast]'))
      await expect(toasts.filter({ hasText: /导出失败/ })).toHaveCount(0)
      await expect(panel.getByTestId('html-artifact-card')).toBeVisible()
      await panel.screenshot({ path: info.outputPath('artifact.png') })
      await info.attach('artifact', { path: info.outputPath('artifact.png'), contentType: 'image/png' })
    } finally {
      await app.close()
    }
  })

  test('HTML Artifact：真实工具到点击导出，源码逐字一致并清理临时文件', async ({}, info) => {
    const directory = await mkdtemp(join(tmpdir(), 'montree-artifact-export-'))
    const path = join(directory, 'artifact.html')
    const app = await launchBuiltApp({ E2E_DOCUMENT_TOOLS: '1', E2E_AUTO_EXPORT_PATH: path, ...MOCK_ENV })
    try {
      const window = await app.firstWindow()
      await expect(window.getByRole('button', { name: '更多操作', exact: true })).toBeVisible({ timeout: 15_000 })
      const panel = await openPanel(window)
      const sessionId = await connect(window)
      const endpoint = await app.evaluate(async () => (globalThis as any).__montreeE2eMcpEndpoint()) as McpEndpoint
      const response = await mcpCall(window, endpoint, 'montree_present', {
        kind: 'html-artifact', title: '交互导出',
        html: '<!doctype html><html><body><p id="count">计数：0</p><button id="add">增加</button><script>var n=0;document.getElementById("add").onclick=function(){document.getElementById("count").textContent="计数："+(++n)}</script></body></html>',
      })
      expect(response.result.isError, JSON.stringify(response)).not.toBe(true)
      const result = JSON.parse(response.result.content[0].text)
      await window.evaluate(({ sessionId, text }) => {
        void (window as any).electronAPI.acpPrompt({ sessionId, prompt: [{ type: 'text', text }] })
      }, { sessionId, text: `present-echo:${JSON.stringify(result)}` })
      const card = panel.getByTestId('html-artifact-card')
      await expect(card).toBeVisible()
      await card.getByRole('button', { name: /导出 HTML/ }).click()
      await expect.poll(async () => readFile(path, 'utf8').catch(() => null)).toBe(result.html)
      // 原生用户主题入口：切到深色后打开预览，截图记录实际主题效果。
      const theme = window.locator('button[aria-label="切换主题"]')
      for (let i = 0; i < 3 && !(await window.locator('html').evaluate((el) => el.classList.contains('dark'))); i++) await theme.click()
      await expect(window.locator('html')).toHaveClass(/dark/)
      await card.getByRole('button', { name: '打开预览' }).click()
      const frame = window.getByTestId('artifact-frame')
      await expect(window.getByTestId('artifact-status')).toHaveAttribute('data-ready', 'true')
      const inner = window.frameLocator('[data-testid="artifact-frame"]')
      await expect(inner.getByText('计数：0')).toBeVisible()
      for (let attempt = 0; attempt < 3; attempt++) {
        await inner.getByRole('button', { name: '增加' }).click()
        try {
          await expect(inner.getByText('计数：1')).toBeVisible({ timeout: 1500 })
          break
        } catch {
          await expect(inner.getByText('计数：0')).toBeVisible()
        }
      }
      await expect(inner.getByText('计数：1')).toBeVisible()
      const srcdoc = await frame.getAttribute('srcdoc')
      // 模态打开时标题栏不可交互，受控主题变化只验证同次打开的 iframe 生命周期。
      await window.evaluate(() => document.documentElement.classList.remove('dark'))
      expect(await frame.getAttribute('srcdoc')).toBe(srcdoc)
      await expect(inner.getByText('计数：1')).toBeVisible()
      await window.evaluate(() => document.documentElement.classList.add('dark'))
      await window.screenshot({ path: info.outputPath('artifact-dark.png') })
    } finally {
      await app.close()
      await rm(directory, { recursive: true, force: true })
    }
  })

  test('真实 MCP：发现/调用/复放/拒绝', async ({}, info) => {
    const workspace = await mkdtemp(join(tmpdir(), 'montree-e2e-present-mcp-'))
    await writeFile(join(workspace, 'notes.md'), '# First\n\nsame here\n\n# Second\n\nsame here\n')
    const app = await launchBuiltApp({ E2E_AUTO_OPEN_PATH: workspace, E2E_DOCUMENT_TOOLS: '1', ...MOCK_ENV })
    try {
      const window = await app.firstWindow()
      await window.waitForLoadState('domcontentloaded')
      await expect(window.getByRole('button', { name: '更多操作', exact: true })).toBeVisible({
        timeout: 15_000,
      })
      await window.getByRole('button', { name: '更多操作', exact: true }).click()
      await window.getByRole('menuitem', { name: /打开文件夹/ }).click()
      await window.keyboard.press('Control+p')
      const dialog = window.getByRole('dialog', { name: '快速打开文件' })
      await dialog.getByPlaceholder('搜索工作区文件或电子书...').fill('notes.md')
      await dialog.getByRole('button').filter({ hasText: 'notes.md' }).click()
      await expect(dialog).toBeHidden()
      await expect(window.locator('.cm-editor')).toBeVisible()

      const endpoint = (await app.evaluate(
        async () => (globalThis as any).__montreeE2eMcpEndpoint(),
      )) as McpEndpoint
      const tools = await mcpRpc(window, endpoint, 'tools/list', {})
      expect(tools.result.tools.map((tool: any) => tool.name)).toContain('montree_present')

      const args = {
        kind: 'chapter-comparison',
        title: '复放对比',
        chapters: [
          { key: 'a', label: 'First', title: 'First' },
          { key: 'b', label: 'Second', title: 'Second' },
        ],
        items: [{ dimension: '重复', chapterKey: 'a', excerpt: 'same here' }],
      }
      const first = await mcpCall(window, endpoint, 'montree_present', args)
      expect(first.result.isError, JSON.stringify(first)).toBeFalsy()
      const firstId = JSON.parse(first.result.content[0].text).id
      const second = await mcpCall(window, endpoint, 'montree_present', args)
      expect(JSON.parse(second.result.content[0].text).id).toBe(firstId)

      const badKind = await mcpCall(window, endpoint, 'montree_present', { kind: 'json-render', title: 'x' })
      expect(badKind.result.isError).toBe(true)
      const badChapter = await mcpCall(window, endpoint, 'montree_present', {
        kind: 'chapter-comparison',
        title: 'x',
        chapters: [
          { key: 'a', label: 'First', title: 'First' },
          { key: 'g', label: '鬼章', title: '根本不存在的章节' },
        ],
        items: [],
      })
      expect(badChapter.result.isError).toBe(true)
      const tooBig = await mcpCall(window, endpoint, 'montree_present', {
        kind: 'html-artifact',
        title: 'big',
        html: 'x'.repeat(97 * 1024),
      })
      expect(tooBig.result.isError).toBe(true)
      const art = await mcpCall(window, endpoint, 'montree_present', {
        kind: 'html-artifact',
        title: '小应用',
        html: '<p>hi</p>',
      })
      expect(art.result.isError, JSON.stringify(art)).toBeFalsy()
      await info.attach('present-mcp', {
        body: JSON.stringify({ firstId }),
        contentType: 'application/json',
      })
    } finally {
      await app.close()
      await rm(workspace, { recursive: true, force: true })
    }
  })

  test('EPUB：目录就绪后真实呈现、跨章节定位与可见选区', async ({}, info) => {
    const workspace = await mkdtemp(join(tmpdir(), 'montree-e2e-present-epub-'))
    const { epubName } = await writeFoliateSectionsWorkspace(workspace)
    const app = await launchBuiltApp({
      E2E_AUTO_OPEN_PATH: workspace,
      E2E_FOLIATE_READER: '1',
      E2E_DOCUMENT_TOOLS: '1',
      ...MOCK_ENV,
    })
    try {
      const window = await app.firstWindow()
      await window.waitForLoadState('domcontentloaded')
      await expect(window.getByRole('button', { name: '更多操作', exact: true })).toBeVisible({
        timeout: 15_000,
      })
      await window.getByRole('button', { name: '更多操作', exact: true }).click()
      await window.getByRole('menuitem', { name: /打开文件夹/ }).click()
      await window.keyboard.press('Control+p')
      const dialog = window.getByRole('dialog', { name: '快速打开文件' })
      await dialog.getByPlaceholder('搜索工作区文件或电子书...').fill(epubName)
      await dialog.getByRole('button').filter({ hasText: epubName }).click()
      await expect(dialog).toBeHidden()
      await expect(window.locator('#main').locator('foliate-view').first()).toBeAttached({
        timeout: 20_000,
      })
      const endpoint = (await app.evaluate(
        async () => (globalThis as any).__montreeE2eMcpEndpoint(),
      )) as McpEndpoint
      await expect.poll(async () => {
        const toc = await mcpCall(window, endpoint, 'montree_get_toc', {})
        return JSON.stringify(toc.result)
      }).toContain('Chapter 3')
      const good = await mcpCall(window, endpoint, 'montree_present', {
        kind: 'chapter-comparison',
        title: 'EPUB 章节比较',
        chapters: [
          { key: 'c1', label: 'Chapter 1', title: 'Chapter 1' },
          { key: 'c3', label: 'Chapter 3', title: 'Chapter 3' },
        ],
        items: [{ dimension: '正文', chapterKey: 'c3', excerpt: 'Chapter three body - filler paragraph 1.' }],
      })
      expect(good.result.isError, JSON.stringify(good)).not.toBe(true)
      const result = JSON.parse(String(good.result.content[0].text))
      expect(result.items[0].verified).toBe(true)
      const panel = await openPanel(window)
      const connected = await window.evaluate(() => (window as any).electronAPI.acpConnect({ runtimeId: 'mock-window' }))
      expect(connected.ok, JSON.stringify(connected)).toBe(true)
      await window.evaluate(({ sessionId, text }) => {
        void (window as any).electronAPI.acpPrompt({ sessionId, prompt: [{ type: 'text', text }] })
      }, { sessionId: connected.value.sessionId, text: `present-echo:${JSON.stringify(result)}` })
      const card = panel.getByTestId('chapter-comparison-card')
      await expect(card).toBeVisible()
      await card.getByRole('button', { name: /定位原文/ }).click()
      await expect.poll(() => window.evaluate(() => {
        const view = document.querySelector('#main foliate-view') as any
        const viewport = view?.getBoundingClientRect()
        for (const item of view?.renderer?.getContents() ?? []) {
          const selection = item.doc.defaultView.getSelection()
          if (!selection?.rangeCount || !selection.toString().includes('Chapter three body')) continue
          const range = selection.getRangeAt(0).getBoundingClientRect()
          const frame = item.doc.defaultView.frameElement?.getBoundingClientRect()
          const top = (frame?.top ?? 0) + range.top
          return { index: item.index, selected: selection.toString(), visible: Boolean(viewport && top >= viewport.top - 2 && top < viewport.bottom) }
        }
        return null
      }), { timeout: 15_000 }).toMatchObject({ index: 1, selected: 'Chapter three body - filler paragraph 1.', visible: true })
      await window.screenshot({ path: info.outputPath('epub-locate.png') })
      // 就绪后的无效章节仍明确拒绝，不能因修复成功路径移除错误语义。
      // ACP 连接会重建 MCP 服务并轮换令牌，后续调用读取当前端点。
      const currentEndpoint = await app.evaluate(async () => (globalThis as any).__montreeE2eMcpEndpoint()) as McpEndpoint
      const bad = await mcpCall(window, currentEndpoint, 'montree_present', {
        kind: 'chapter-comparison', title: '不存在的章节', chapters: [{ key: 'a', title: 'Missing Chapter' }, { key: 'b', title: 'Chapter 3' }], items: [],
      })
      expect(bad.result.isError).toBe(true)
      expect(String(bad.result.content[0].text)).toContain('无法对应到目录')
    } finally {
      await app.close()
      await rm(workspace, { recursive: true, force: true })
    }
  })
  test('网页跨章节：统一 MCP 目录与后台读取→原文比较卡，不切换当前文章', async () => {
    const url='https://e2e.montree.test/docs/agent-chapters'
    const app=await launchBuiltApp({...MOCK_ENV,E2E_DOCUMENT_TOOLS:'1',E2E_WEB_DOC_FIXTURE_DIR:webDocFixtureDir()})
    try {
      const window=await app.firstWindow()
      await window.waitForLoadState('domcontentloaded')
      await welcomeWebDocUrlField(window).fill(url)
      await welcomeWebDocUrlField(window).press('Enter')
      const frame=window.frameLocator('.web-doc-viewer-host iframe')
      await expect(frame.getByRole('heading',{name:'Chapter Overview'})).toBeVisible()
      const panel=await openPanel(window)
      const sid=await connect(window)
      const endpoint=await app.evaluate(async()=>(globalThis as any).__montreeE2eMcpEndpoint()) as McpEndpoint
      let toc:any
      await expect.poll(async()=>{
        const response=await mcpCall(window,endpoint,'montree_read',{scope:'toc'})
        if(response.result?.isError) return false
        toc=JSON.parse(response.result.content[0].text)
        return toc.entries?.some((e:any)=>e.href==='https://e2e.montree.test/docs/installation')
      }).toBe(true)
      const first=toc.entries.find((e:any)=>e.href===url)
      const second=toc.entries.find((e:any)=>e.href==='https://e2e.montree.test/docs/installation')
      expect(first).toBeTruthy()
      const read=await mcpCall(window,endpoint,'montree_read',{scope:'chapter',flatIndex:second.index})
      expect(read.result.isError,JSON.stringify(read)).toBeFalsy()
      expect(read.result.content[0].text).toContain('Montree E2E fixture second page content.')
      const comparison=await mcpCall(window,endpoint,'montree_present',{kind:'chapter-comparison',title:'Web chapter comparison',chapters:[
        {key:'overview',label:first.label,flatIndex:first.index},{key:'install',label:second.label,flatIndex:second.index}],items:[
        {dimension:'Evidence',chapterKey:'overview',excerpt:'Original overview evidence for chapter comparison.'},
        {dimension:'Evidence',chapterKey:'install',excerpt:'Montree E2E fixture second page content.'}]})
      expect(comparison.result.isError,JSON.stringify(comparison)).toBeFalsy()
      const result=JSON.parse(comparison.result.content[0].text)
      expect(result.items.filter((item:any)=>item.verified)).toHaveLength(2)
      await prompt(window,sid,'present-echo:'+JSON.stringify(result))
      await expect(panel.getByTestId('chapter-comparison-card')).toBeVisible()
      await expect(frame.getByRole('heading',{name:'Chapter Overview'})).toBeVisible()
      await expect(window.locator('#main input[placeholder="https://"]')).toHaveValue(url)
    } finally {await app.close()}
  })

})

