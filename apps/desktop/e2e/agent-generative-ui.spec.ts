import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { test, expect, type Page } from '@playwright/test'
import { launchBuiltApp } from './helpers/launch-app'

/**
 * G4 生成式 UI 生产链路（真实 Electron + mock ACP/MCP，不调用真实模型）：
 * 0. React artifact 内联：真实工具→聊天内直接 iframe 可交互；错误降级/隔离边界/宽度高度。
 * 1. 全流程：真实 MCP montree_present(component-ui) → 回放进聊天 → 用户选择维度
 *    → 点提交 → 原 ACP session 收到后续输入并继续回答（含 evidence 定位）。
 * 2. 线程隔离：新对话无旧卡；切回旧线程卡仍在；旧卡提交不串新线程。
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

/**
 * 框内点击前静置：聊天跟滚（smooth）在内容位移时 arriving 的 mouseup 会落空，
 * 表现为点击无响应且无报错。等包围盒稳定后再操作（产品跟滚行为保持不动）。
 */
async function settleFrame(page: Page, frame: ReturnType<Page['locator']>) {
  await frame.scrollIntoViewIfNeeded()
  await expect.poll(async () => {
    const a = await frame.boundingBox()
    await page.waitForTimeout(400)
    const b = await frame.boundingBox()
    return a && b ? Math.abs(a.y - b.y) < 2 && Math.abs(a.x - b.x) < 2 : false
  }, { timeout: 15_000 }).toBe(true)
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

async function mcpCall(page: Page, endpoint: McpEndpoint, name: string, args: Record<string, unknown>) {
  const response = await fetch(endpoint.url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${endpoint.authToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 7, method: 'tools/call', params: { name, arguments: args } }),
  })
  const body = await response.text()
  expect(response.ok, `MCP ${name}: HTTP ${response.status}, ${body.slice(0, 500)}`).toBe(true)
  return JSON.parse(body)
}

function componentUiArgs() {
  return {
    kind: 'component-ui',
    title: '两章论证对比',
    summary: '选维度后继续分析',
    chapters: [
      { key: 'c1', label: '第一章', title: '第一章' },
      { key: 'c2', label: '第二章', title: '第二章' },
    ],
    ui: {
      root: {
        component: 'Column',
        children: [
          { component: 'Text', props: { text: '请选择要深入的对比维度', variant: 'title' } },
          {
            component: 'Select',
            props: {
              id: 'dim',
              label: '对比维度',
              options: [
                { value: 'method', label: '论证方法' },
                { value: 'evidence', label: '证据运用' },
              ],
            },
          },
          {
            component: 'Row',
            children: [
              { component: 'Evidence', props: { excerpt: '甲论点原文在此。', chapterKey: 'c1' } },
              { component: 'Evidence', props: { excerpt: '乙论点原文在此。', chapterKey: 'c2' } },
            ],
          },
          { component: 'Button', props: { label: '继续分析', action: 'submit-selection' } },
        ],
      },
    },
  }
}

test.describe('生成式 UI 生产链路 G4', () => {
  test('历史图表恢复：原工具补正文、内联交互、重载保留且不重复', async ({}, info) => {
    test.setTimeout(90_000)
    const directory = await mkdtemp(join(tmpdir(), 'montree-recovery-'))
    const recoveryFile = join(directory, 'outputs.json')
    const app = await launchBuiltApp({...MOCK_ENV, E2E_DOCUMENT_TOOLS: '1', E2E_ACP_TOOL_RECOVERY_FILE: recoveryFile})
    try {
      const window = await app.firstWindow()
      await window.waitForLoadState('domcontentloaded')
      await window.evaluate(()=>localStorage.setItem('montree-acp-ui',JSON.stringify({version:0,state:{panelOpen:true,hudDisplayMode:'docked',selectedRuntimeId:'mock-window'}})))
      await window.reload()
      const panel = await openPanel(window)
      const floating = window.getByTestId('floating-ai-hud')
      if (await floating.isVisible()) await floating.getByTitle('停靠到侧栏').click()
      await expect(panel).toContainText('mock-window')
      await panel.evaluate(el => { const host=el.closest('[data-panel]') as HTMLElement; host.style.flex='none'; host.style.width='480px' })
      await panel.getByRole('button',{name:'连接',exact:true}).click()
      await expect(panel.getByRole('button',{name:'断开',exact:true})).toBeVisible()
      const endpoint = await app.evaluate(async () => (globalThis as any).__montreeE2eMcpEndpoint()) as McpEndpoint
      const response = await mcpCall(window, endpoint, 'montree_present', {kind:'preset',preset:'diagram',diagramType:'flowchart',title:'恢复的历史流程图',nodes:[{id:'start',label:'开始',kind:'start',layer:0,details:'恢复后仍可交互'},{id:'end',label:'结束',kind:'end',layer:1}],edges:[{from:'start',to:'end'}]})
      expect(response.result.isError).not.toBe(true)
      const text = response.result.content[0].text
      await writeFile(recoveryFile, JSON.stringify([{toolCallId:'agy-t1-s17',text}]))
      await panel.getByRole('textbox',{name:'输入消息，Enter 发送，Shift+Enter 换行'}).fill('recover-empty-tool')
      await panel.getByRole('button',{name:'发送',exact:true}).click()
      await expect(panel).toContainText('EMPTY_TOOL_SAVED')
      await expect(panel.getByTestId('html-artifact-card')).toHaveCount(0)
      await panel.getByRole('button',{name:'断开',exact:true}).click()
      await panel.getByRole('button',{name:'连接',exact:true}).click()
      const card = panel.getByTestId('html-artifact-card')
      await expect(card).toHaveCount(1)
      await expect(card).toBeVisible()
      const frame = card.frameLocator('[data-testid="svg-diagram-frame"]')
      await expect(frame.getByRole('img',{name:'恢复的历史流程图'})).toBeVisible()
      await frame.getByRole('button',{name:'开始',exact:true}).focus()
      await window.keyboard.press('Enter')
      await expect(frame.getByRole('status',{name:'节点详情'})).toContainText('恢复后仍可交互')
      await expect.poll(()=>window.evaluate(()=>Object.keys(localStorage).filter(k=>k.startsWith('montree-acp-ui')).some(k=>JSON.parse(localStorage.getItem(k)!).state?.threads?.some((t:any)=>t.messages.some((m:any)=>m.toolCallId==='agy-t1-s17' && m.presentResult))))).toBe(true)
      await card.screenshot({path:info.outputPath('recovered-chart.png')})
      await window.reload()
      await expect(window.getByTestId('html-artifact-card')).toHaveCount(1)
      await expect(window.getByTestId('html-artifact-card').frameLocator('[data-testid="svg-diagram-frame"]').getByRole('img',{name:'恢复的历史流程图'})).toBeVisible()
    } finally { await app.close(); await rm(directory,{recursive:true,force:true}) }
  })

  test('SVG 图解：模拟模型纯参数→真实 MCP→固定区与浮窗交互', async ({}, info) => {
    test.setTimeout(120_000)
    const app = await launchBuiltApp({ ...MOCK_ENV, E2E_DOCUMENT_TOOLS: '1' })
    try {
      const window = await app.firstWindow()
      await window.waitForLoadState('domcontentloaded')
      await window.evaluate(() => {
        const now = Date.now()
        localStorage.setItem('montree-acp-ui', JSON.stringify({ version: 0, state: { panelOpen: true, hudDisplayMode: 'docked', selectedRuntimeId: 'mock-window', activeThreadId: 'diagram-test', threads: [{ id: 'diagram-test', runtimeId: 'mock-window', title: '图解回归', createdAt: now, updatedAt: now, messages: [] }] } }))
      })
      await window.reload()
      const panel = await openPanel(window)
      const initialFloating = window.getByTestId('floating-ai-hud')
      if (await initialFloating.isVisible()) await initialFloating.getByTitle('停靠到侧栏').click()
      await panel.evaluate((el) => { const host = el.closest('[data-panel]') as HTMLElement; host.style.flex = 'none'; host.style.width = '480px' })
      await connect(window)
      const endpoint = await app.evaluate(async () => (globalThis as any).__montreeE2eMcpEndpoint()) as McpEndpoint
      const markdownGuide = await mcpCall(window, endpoint, 'montree_markdown_guide', {})
      expect(markdownGuide.result.content[0].text).toContain('montree-ui')
      expect(markdownGuide.result.content[0].text).toContain('本地')
      const rejected = await mcpCall(window, endpoint, 'montree_present', { kind: 'preset', preset: 'diagram', diagramType: 'flowchart', title: '错误端点', nodes: [{ id: 'a', label: '甲' }, { id: 'b', label: '乙' }], edges: [{ from: 'a', to: 'unknown' }] })
      expect(rejected.result.isError).toBe(true)
      for (const type of ['flowchart', 'sequence', 'mindmap', 'swimlane', 'timeline', 'fishbone', 'cycle', 'er', 'architecture']) {
        await panel.getByRole('textbox', { name: '输入消息，Enter 发送，Shift+Enter 换行' }).fill(`diagram:${type}`)
        await panel.getByRole('button', { name: '发送', exact: true }).click()
        await expect(panel.locator('[data-slot="streaming-response"]').last(), await panel.innerText()).toContainText(`|${type}`)
        const card = panel.getByTestId('html-artifact-card').filter({ hasText: `内置${type}` })
        await expect(card, await panel.innerText()).toBeVisible()
        const frame = card.frameLocator('[data-testid="svg-diagram-frame"]')
        await expect(frame.getByRole('img', { name: `内置${type}` })).toBeVisible()
        if (type === 'mindmap') await expect(frame.locator('.node')).toHaveCount(5)
        if (type === 'swimlane') await expect(frame.locator('.lane')).toHaveCount(2)
        if (type === 'er') {
          await expect(frame.locator('.entity')).toHaveCount(3)
          await expect(frame.locator('svg')).toContainText('PK')
          await expect(frame.locator('svg')).toContainText('FK')
          await expect(frame.locator('svg')).toContainText('0..*')
        }
        await expect(card.getByRole('button', { name: '打开预览' })).toHaveCount(0)
        await settleFrame(window, card.locator('[data-testid="svg-diagram-frame"]'))
        await frame.getByRole('button', { name: '放大', exact: true }).click()
        await expect(frame.locator('#zoom')).toHaveText('125%')
        const nodeName = type === 'flowchart' ? '内容已准备好？' : '读者'
        await frame.getByRole('button', { name: nodeName, exact: true }).focus()
        await window.keyboard.press('Enter')
        await expect(frame.getByRole('status', { name: '节点详情' })).toContainText(type === 'flowchart' ? '检查文档与工具是否就绪' : '</script><script>window.injected=1</script>')
        if (type === 'er') await expect(frame.getByRole('status', { name: '节点详情' })).toContainText('实体唯一标识')
        expect(await frame.locator('body').evaluate(() => typeof (window as any).injected)).toBe('undefined')
        expect(await frame.locator('body').evaluate(() => typeof (window as any).electronAPI)).toBe('undefined')
        expect(await frame.locator('body').evaluate(() => { try { void parent.document; return false } catch { return true } })).toBe(true)
        await frame.getByRole('button', { name: '适应宽度' }).click()
        await card.screenshot({ path: info.outputPath(`svg-${type}.png`) })
        if (['mindmap', 'swimlane', 'timeline', 'fishbone', 'cycle', 'er'].includes(type)) {
          await card.getByRole('button', { name: `放大查看：内置${type}` }).click()
          const dialog = window.getByRole('dialog', { name: `内置${type}`, exact: true })
          await expect(dialog).toBeVisible()
          await settleFrame(window, dialog.locator('iframe'))
          await expect(dialog.frameLocator('iframe').getByRole('status', { name: '节点详情' })).toContainText('window.injected=1')
          await dialog.frameLocator('iframe').getByRole('button', { name: '适应宽度' }).click()
          await dialog.screenshot({ path: info.outputPath(`svg-${type}-enlarged.png`) })
          await dialog.getByRole('button', { name: 'Close', exact: true }).click()
          await expect(dialog).toHaveCount(0)
        }
        await expect(panel.getByRole('button', { name: '发送', exact: true })).toBeVisible()
      }
      // 已完成工具会随历史工作记录收起，主题/稳定性检查针对当前最新图表。
      const flow = panel.getByTestId('html-artifact-card').filter({ hasText: '内置architecture' })
      const iframe = flow.locator('[data-testid="svg-diagram-frame"]')
      await iframe.evaluate((el) => { (window as any).__svgFrame = el })
      await window.evaluate(() => { (window as any).__themeAcks = 0; window.addEventListener('message', (event) => { if (event.data?.type === 'artifact-theme-applied') (window as any).__themeAcks++ }) })
      for (let i = 0; i < 3 && !(await window.locator('html').getAttribute('class'))?.split(' ').includes('dark'); i++) {
        const before = await window.locator('html').getAttribute('class')
        const theme = before?.split(' ').includes('light') ? 'sepia' : before?.split(' ').includes('sepia') ? 'dark' : 'light'
        await window.getByRole('button', { name: '切换主题', exact: true }).click()
        // theme-transitioning is added before the actual theme class changes.
        await expect(window.locator('html')).toHaveClass(new RegExp(`(?:^|\\s)${theme}(?:\\s|$)`))
        await expect(flow.frameLocator('iframe').locator('html')).toHaveAttribute('data-theme', theme)
        if (theme === 'sepia') await expect.poll(() => flow.frameLocator('iframe').locator('body').evaluate((el) => getComputedStyle(el).backgroundColor)).toBe('rgb(244, 236, 216)')
      }
      await expect.poll(() => window.evaluate(() => (window as any).__themeAcks)).toBeGreaterThan(0)
      await expect(flow.frameLocator('iframe').locator('html')).toHaveAttribute('data-theme', 'dark')
      await expect.poll(() => flow.frameLocator('iframe').locator('body').evaluate((el) => getComputedStyle(el).backgroundColor)).toBe('rgb(32, 35, 34)')
      expect(await iframe.evaluate((el) => el === (window as any).__svgFrame)).toBe(true)
      await flow.getByRole('button', { name: '放大查看：内置architecture' }).click()
      const enlargedDiagram = window.getByRole('dialog', { name: '内置architecture', exact: true })
      await expect(enlargedDiagram).toBeVisible()
      expect(await enlargedDiagram.locator('iframe').evaluate((el) => el === (window as any).__svgFrame)).toBe(true)
      await settleFrame(window, enlargedDiagram.locator('iframe'))
      await enlargedDiagram.frameLocator('iframe').getByRole('button', { name: '适应宽度' }).click()
      const diagramLayout = await enlargedDiagram.frameLocator('iframe').locator('body').evaluate((el) => {
        const details = el.querySelector('#details')!.getBoundingClientRect()
        const viewport = el.querySelector('#viewport')!.getBoundingClientRect()
        return { detailsHeight: details.height, bottomGap: el.clientHeight - details.bottom, viewportHeight: viewport.height, height: el.clientHeight }
      })
      expect(diagramLayout.detailsHeight).toBeLessThanOrEqual(80)
      expect(diagramLayout.bottomGap).toBeLessThanOrEqual(16)
      expect(diagramLayout.viewportHeight).toBeGreaterThan(diagramLayout.height * 0.6)
      await enlargedDiagram.screenshot({ path: info.outputPath('svg-enlarged.png') })
      await enlargedDiagram.getByRole('button', { name: 'Close', exact: true }).click()
      await expect(enlargedDiagram).toHaveCount(0)
      expect(await iframe.evaluate((el) => el === (window as any).__svgFrame)).toBe(true)
      for (const width of [320, 390, 480]) {
        await panel.evaluate((el, width) => { const host = el.closest('[data-panel]') as HTMLElement; host.style.flex = 'none'; host.style.width = `${width}px` }, width)
        expect(await panel.evaluate((el) => el.scrollWidth <= el.clientWidth + 2)).toBe(true)
      }
      await flow.scrollIntoViewIfNeeded()
      await flow.screenshot({ path: info.outputPath('svg-architecture-dark.png') })
      await panel.getByRole('button', { name: '更多面板操作' }).click()
      await window.getByRole('menuitem', { name: '切换为悬浮伴读小窗' }).click()
      const floatingCard = window.getByTestId('floating-ai-hud').getByTestId('html-artifact-card').filter({ hasText: '内置architecture' })
      const floatingFrame = floatingCard.frameLocator('[data-testid="svg-diagram-frame"]')
      await expect(floatingFrame.getByRole('img', { name: '内置architecture' })).toBeVisible()
      await settleFrame(window, floatingCard.locator('[data-testid="svg-diagram-frame"]'))
      await floatingFrame.getByRole('button', { name: '适应宽度' }).click()
      await settleFrame(window, floatingCard.locator('[data-testid="svg-diagram-frame"]'))
      await floatingFrame.getByRole('button', { name: '读者', exact: true }).click()
      await expect(floatingFrame.getByRole('status', { name: '节点详情' })).toContainText('</script><script>window.injected=1</script>')
      await expect(floatingCard.locator('iframe')).toHaveCount(1)
      await expect(window.getByText('呈现结果无法解析')).toHaveCount(0)
      await floatingCard.screenshot({ path: info.outputPath('svg-floating.png') })
    } finally { await app.close() }
  })

  test('R3：页面提议经宿主确认回到原 session，错误修复同链提交', async ({}, info) => {
    const app = await launchBuiltApp({ ...MOCK_ENV, E2E_DOCUMENT_TOOLS: '1' })
    try {
      const window = await app.firstWindow()
      await window.waitForLoadState('domcontentloaded')
      await expect(window.getByRole('button', { name: '更多操作', exact: true })).toBeVisible()
      const panel = await openPanel(window)
      const sessionId = await connect(window)
      const endpoint = await app.evaluate(async () => (globalThis as any).__montreeE2eMcpEndpoint()) as McpEndpoint
      const args = { kind: 'react-artifact', title: '分析请求', source: 'import {useState} from "react"; export default function App(){const [text,setText]=useState("论证方法");return <main><input aria-label="请求内容" value={text} onChange={e=>setText(e.target.value)}/><button onClick={()=>window.montreeArtifact.requestAnalysis(text)}>请求继续分析</button></main>}' }
      const envelope = await mcpCall(window, endpoint, 'montree_present', args)
      expect(envelope.result.isError ?? false).toBe(false)
      await prompt(window, sessionId, `present-echo:${envelope.result.content[0].text}`)
      const card = panel.getByTestId('react-artifact-card').filter({ hasText: '分析请求' })
      await expect(panel.getByText(`ECHO:${sessionId}|${JSON.parse(envelope.result.content[0].text).id}`, { exact: true })).toBeVisible()
      await expect(card).toHaveAttribute('data-build-status', 'ready')
      const frame = card.frameLocator('[data-testid="react-inline-frame"]')
      await expect(frame.getByRole('button', { name: '请求继续分析' })).toBeVisible()
      const node = await card.locator('iframe').elementHandle()
      await settleFrame(window, card.locator('iframe'))
      await frame.getByRole('button', { name: '请求继续分析' }).click()
      await expect(card.getByTestId('artifact-request-confirmation')).toContainText('论证方法')
      const replies = panel.locator('[data-slot="streaming-response"]').filter({ hasText: `ARTIFACT_REPLY:${sessionId}` })
      await expect(replies).toHaveCount(0)
      await card.getByTestId('artifact-request-confirmation').screenshot({ path: info.outputPath('react-request-confirm.png') })
      await card.getByRole('button', { name: '确认发送给 Agent' }).click()
      await expect(replies).toHaveCount(1)
      await expect(replies.first()).toContainText('react-artifact-submit')
      await expect(replies.first()).toContainText('论证方法')
      expect(await node!.evaluate(el => el.isConnected)).toBe(true)
      await expect(frame.getByRole('textbox', { name: '请求内容' })).toHaveValue('论证方法')

      const broken = await mcpCall(window, endpoint, 'montree_present', { kind: 'react-artifact', title: '修复请求', source: 'export default function App(){throw new Error("R3-boom")}' })
      await prompt(window, sessionId, `present-echo:${broken.result.content[0].text}`)
      const failedCard = panel.getByTestId('react-artifact-card').filter({ hasText: '修复请求' })
      await expect(failedCard.getByText(/运行失败/)).toBeVisible()
      await failedCard.getByRole('button', { name: '请求 Agent 修复' }).click()
      await expect(failedCard.getByTestId('artifact-request-confirmation')).toContainText('R3-boom')
      await expect(replies).toHaveCount(1)
      await failedCard.getByRole('button', { name: '确认发送给 Agent' }).click()
      await expect(replies).toHaveCount(2)
      await expect(replies.last()).toContainText('react-artifact-repair')
      await expect(replies.last()).toContainText('R3-boom')
    } finally { await app.close() }
  })
  test('React artifact：真实工具→聊天内联 iframe，直接可交互', async ({}, info) => {
    const app = await launchBuiltApp({ ...MOCK_ENV, E2E_DOCUMENT_TOOLS: '1' })
    try {
      const window = await app.firstWindow()
      await window.waitForLoadState('domcontentloaded')
      await expect(window.getByRole('button', { name: '更多操作', exact: true })).toBeVisible()
      const panel = await openPanel(window)
      // 默认为浮窗；先停靠验证固定区，再经菜单切回浮窗验证第二个实例。
      const initialFloating = window.getByTestId('floating-ai-hud')
      if (await initialFloating.isVisible()) await initialFloating.getByTitle('停靠到侧栏').click()
      await expect(panel).toBeVisible()
      const sessionId = await connect(window)
      const endpoint = await app.evaluate(async () => (globalThis as any).__montreeE2eMcpEndpoint()) as McpEndpoint
      const bad = await mcpCall(window, endpoint, 'montree_present', { kind: 'react-artifact', title: '非法', source: 'export default function(' })
      expect(bad.result.isError).toBe(true)
      // 模拟模型给出空源码、越界 CSS 或未预置依赖：经真实 MCP 拒绝。
      for (const invalid of [
        { source: '' },
        { source: 'import fs from "node:fs"; export default ()=>fs.readFileSync("x")' },
        { source: 'export default ()=>null', css: 'x'.repeat(16 * 1024 + 1) },
      ]) {
        const rejected = await mcpCall(window, endpoint, 'montree_present', { kind: 'react-artifact', title: '非法模型输出', ...invalid })
        expect(rejected.result.isError, JSON.stringify(rejected)).toBe(true)
      }
      const args = { kind: 'react-artifact', title: '交互计数器', source: 'import {useState} from "react"; export default function App(){const [n,setN]=useState(0);const [t,setT]=useState("");return <main><h1>计数 {n}</h1><button onClick={()=>setN(n+1)}>加一</button><input aria-label="备注" value={t} onChange={e=>setT(e.target.value)}/><p>{typeof window.electronAPI}</p></main>}', css: 'button{padding:12px;border-radius:8px}' }
      const envelope = await mcpCall(window, endpoint, 'montree_present', args)
      expect(envelope.result.isError ?? false).toBe(false)
      const result = JSON.parse(envelope.result.content[0].text)
      expect(result.kind).toBe('react-artifact')
      const replay = await mcpCall(window, endpoint, 'montree_present', args)
      expect(JSON.parse(replay.result.content[0].text).id).toBe(result.id)
      await prompt(window, sessionId, `present-raw-echo:${JSON.stringify(envelope.result)}`)
      const card = panel.getByTestId('react-artifact-card')
      await expect(card).toBeVisible({ timeout: 15_000 })
      // 同一张卡直接内联 iframe：无需打开预览，对话框不出现
      await expect(panel.getByRole('dialog')).toHaveCount(0)
      const frame = card.locator('iframe[data-testid="react-inline-frame"]')
      await expect(frame).toBeVisible({ timeout: 20_000 })
      expect(await frame.getAttribute('sandbox')).toBe('allow-scripts')
      // 卡片作用域定位：停靠/悬浮双镜像各挂一份（既有架构，不重构），不断言全局唯一
      const inner = card.frameLocator('iframe[data-testid="react-inline-frame"]')
      // ready 即 React commit：标题出现后才可交互
      await expect(inner.getByRole('heading', { name: '计数 0' })).toBeVisible({ timeout: 20_000 })
      await settleFrame(window, frame)
      await inner.getByRole('button', { name: '加一' }).click()
      await expect(inner.getByRole('heading', { name: '计数 1' })).toBeVisible()
      await settleFrame(window, frame)
      await inner.getByLabel('备注').fill('保持')
      await card.getByRole('button', { name: '放大查看：交互计数器' }).click()
      const enlarged = window.getByRole('dialog', { name: '交互计数器', exact: true })
      await expect(enlarged).toBeVisible()
      const enlargedFrame = enlarged.frameLocator('[data-testid="react-inline-frame"]')
      await expect(enlargedFrame.getByRole('heading', { name: '计数 1' })).toBeVisible()
      await expect(enlargedFrame.getByLabel('备注')).toHaveValue('保持')
      await settleFrame(window, enlarged.locator('iframe'))
      await enlargedFrame.getByRole('button', { name: '加一' }).click()
      await expect(enlargedFrame.getByRole('heading', { name: '计数 2' })).toBeVisible()
      await enlargedFrame.getByLabel('备注').focus()
      await window.keyboard.press('Escape')
      await expect(enlarged).toHaveCount(0)
      await expect(inner.getByRole('heading', { name: '计数 2' })).toBeVisible()
      // 隔离：宿主接口缺失、父文档阻断
      await expect(inner.getByText('undefined', { exact: true })).toBeVisible()
      expect(await inner.locator('body').evaluate(() => { try { void (parent as any).document; return false } catch { return true } })).toBe(true)
      // 键盘：源码按钮聚焦回车可展开（行为级可达性）
      await card.getByRole('button', { name: '查看源码' }).focus()
      await window.keyboard.press('Enter')
      await expect(card.getByTestId('react-artifact-source')).toBeVisible()
      await expect(card.getByTestId('react-artifact-source')).toContainText('export default function App')
      // 宿主更新后同一节点、页面状态保持：源码展开 + 新消息追加不重建 iframe
      await card.evaluate((el) => { (window as any).__genuiFrame = el.querySelector('iframe[data-testid="react-inline-frame"]') })
      await prompt(window, sessionId, 'ping-inline')
      await expect(panel.getByText('ping-inline')).toBeVisible({ timeout: 15_000 })
      const same = await card.evaluate((root) => {
        const f = root.querySelector('iframe[data-testid="react-inline-frame"]')
        return f != null && f === (window as any).__genuiFrame && root.contains(f)
      })
      expect(same).toBe(true)
      await expect(inner.getByRole('heading', { name: '计数 2' })).toBeVisible()
      expect(await inner.getByLabel('备注').inputValue()).toBe('保持')
      // 同一 tool 结果在同一镜像只一张卡、一个 iframe
      await expect(card.locator('iframe[data-testid="react-inline-frame"]')).toHaveCount(1)
      await card.getByRole('button', { name: '收起源码' }).click()
      await expect(card.getByTestId('react-artifact-source')).toHaveCount(0)
      await card.scrollIntoViewIfNeeded()
      await card.screenshot({ path: info.outputPath('react-inline.png') })
      await info.attach('react-inline', { path: info.outputPath('react-inline.png'), contentType: 'image/png' })
      await panel.getByRole('button', { name: '更多面板操作' }).click()
      await window.getByRole('menuitem', { name: '切换为悬浮伴读小窗' }).click()
      const floating = window.getByTestId('floating-ai-hud')
      await expect(floating).toBeVisible()
      const floatingCard = floating.getByTestId('react-artifact-card')
      const floatingFrame = floatingCard.locator('iframe[data-testid="react-inline-frame"]')
      const floatingInner = floatingCard.frameLocator('iframe[data-testid="react-inline-frame"]')
      await expect(floatingInner.getByRole('heading', { name: '计数 0' })).toBeVisible({ timeout: 20_000 })
      await settleFrame(window, floatingFrame)
      await floatingInner.getByRole('button', { name: '加一' }).click()
      await expect(floatingInner.getByRole('heading', { name: '计数 1' })).toBeVisible()
      await expect(floating.getByText('呈现结果无法解析')).toHaveCount(0)
      await floating.screenshot({ path: info.outputPath('react-inline-floating.png') })
    } finally { await app.close() }
  })
  test('React artifact：错误降级、隔离边界、宽度与高度限制', async ({}, info) => {
    test.setTimeout(180_000)
    const app = await launchBuiltApp({ ...MOCK_ENV, E2E_DOCUMENT_TOOLS: '1' })
    try {
      const window = await app.firstWindow()
      await window.waitForLoadState('domcontentloaded')
      await expect(window.getByRole('button', { name: '更多操作', exact: true })).toBeVisible()
      const panel = await openPanel(window)
      const sessionId = await connect(window)
      const endpoint = await app.evaluate(async () => (globalThis as any).__montreeE2eMcpEndpoint()) as McpEndpoint

      // 运行错误：同步抛错 → 卡内降级；随后不再被 ready 清掉
      const boom = { kind: 'react-artifact', title: '必崩计数器', source: 'export default function App(){throw new Error("boom-42")}' }
      const boomEnv = await mcpCall(window, endpoint, 'montree_present', boom)
      expect(boomEnv.result.isError ?? false).toBe(false)
      const boomResult = JSON.parse(boomEnv.result.content[0].text)
      await prompt(window, sessionId, `present-echo:${JSON.stringify(boomResult)}`)
      const boomCard = panel.getByTestId('react-artifact-card').filter({ hasText: '必崩计数器' })
      await expect(boomCard.getByText(/运行失败/)).toBeVisible({ timeout: 20_000 })
      await expect(boomCard.getByText(/boom-42/)).toBeVisible()
      await window.waitForTimeout(2000)
      await expect(boomCard.getByText(/运行失败/)).toBeVisible()
      await expect(boomCard.getByRole('button', { name: '重新运行' })).toBeVisible()

      // 编译错误（伪造回放直达卡片编译路径）：可读 + 重试不崩
      await prompt(window, sessionId, `present-echo:${JSON.stringify({ schemaVersion: 1, kind: 'react-artifact', id: 'fake-bad-source-1', title: '坏源码', source: 'export default function(' })}`)
      const badCard = panel.getByTestId('react-artifact-card').filter({ hasText: '坏源码' })
      await expect(badCard.getByText(/编译失败/)).toBeVisible({ timeout: 20_000 })
      await badCard.getByRole('button', { name: '重试' }).click()
      await expect(badCard.getByText(/编译失败/)).toBeVisible()

      // 好卡：伪造挂载与超高上报的边界
      const args = { kind: 'react-artifact', title: '边界计数器', source: 'import {useState} from "react"; export default function App(){const [n,setN]=useState(0);return <main><h1>边界 {n}</h1><button onClick={()=>setN(n+1)}>加一</button></main>}' }
      const envelope = await mcpCall(window, endpoint, 'montree_present', args)
      expect(envelope.result.isError ?? false).toBe(false)
      await prompt(window, sessionId, `present-echo:${envelope.result.content[0].text}`)
      const card = panel.getByTestId('react-artifact-card').filter({ hasText: '边界计数器' })
      const frame = card.locator('iframe[data-testid="react-inline-frame"]')
      await expect(frame).toBeVisible({ timeout: 20_000 })
      const inner = card.frameLocator('iframe[data-testid="react-inline-frame"]')
      await expect(inner.getByRole('heading', { name: '边界 0' })).toBeVisible({ timeout: 20_000 })
      const heightBefore = await frame.evaluate((el) => (el as HTMLElement).style.height)
      // 伪造来源的高度消息被忽略
      await window.evaluate(() => {
        window.dispatchEvent(new MessageEvent('message', { source: window, data: { mountId: 'forged', type: 'artifact-height', value: 900 } }))
      })
      expect(await frame.evaluate((el) => (el as HTMLElement).style.height)).toBe(heightBefore)
      // 真实来源的超高上报钳制到 640（等限频窗口过去；以卡片内帧为作用域）
      await window.waitForTimeout(600)
      const clamped = await card.evaluate((root) => {
        const el = root.querySelector('iframe[data-testid="react-inline-frame"]') as HTMLIFrameElement | null
        const src = el?.getAttribute('srcdoc') ?? ''
        const mountId = /var m="([^"]+)"/.exec(src)?.[1]
        if (!el?.contentWindow || !mountId) return 'skip'
        window.dispatchEvent(new MessageEvent('message', { source: el.contentWindow, data: { mountId, type: 'artifact-height', value: 99999 } }))
        return (el as HTMLElement).style.height
      })
      expect(clamped).toBe('640px')

      // 320/390/480 宽度包含：无横向撑开
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
      for (const target of [320, 390, 480]) {
        const measured = await dragTo(target)
        await expect(card).toBeVisible()
        await expect(frame).toBeVisible()
        const overflow = await panel.evaluate((el) => ({ scrollWidth: el.scrollWidth, clientWidth: el.clientWidth }))
        expect(overflow.scrollWidth, `宽度 ${measured}px 不应横向撑开`).toBeLessThanOrEqual(overflow.clientWidth + 2)
      }
      await panel.screenshot({ path: info.outputPath('react-inline-width.png') })
      await info.attach('react-inline-width', { path: info.outputPath('react-inline-width.png'), contentType: 'image/png' })

      // 超高内容：iframe 钳制 640 且内部可滚
      const tall = { kind: 'react-artifact', title: '高塔', source: 'export default function App(){return <div style={{height:"2000px"}}>高塔内容</div>}' }
      const tallEnv = await mcpCall(window, endpoint, 'montree_present', tall)
      expect(tallEnv.result.isError ?? false).toBe(false)
      await prompt(window, sessionId, `present-echo:${tallEnv.result.content[0].text}`)
      const tallCard = panel.getByTestId('react-artifact-card').filter({ hasText: '高塔' })
      const tallFrame = tallCard.locator('iframe[data-testid="react-inline-frame"]')
      await expect(tallFrame).toBeVisible({ timeout: 20_000 })
      await expect.poll(async () => tallFrame.evaluate((el) => parseFloat((el as HTMLElement).style.height || '0')), { timeout: 20_000 }).toBeLessThanOrEqual(640)
      const innerScrollable = await tallCard.frameLocator('iframe[data-testid="react-inline-frame"]').locator('html').evaluate((el) => el.scrollHeight > (el.clientHeight + 100))
      expect(innerScrollable).toBe(true)

      // 深色：重载后历史恢复照常内联，截图留证
      await window.evaluate(() => {
        const raw = JSON.parse(localStorage.getItem('markdown-editor-ui') ?? '{"state":{}}')
        raw.state = { ...(raw.state ?? {}), theme: 'dark' }
        localStorage.setItem('markdown-editor-ui', JSON.stringify(raw))
      })
      await window.reload()
      await expect(window.getByRole('button', { name: '更多操作', exact: true })).toBeVisible({ timeout: 15_000 })
      const darkPanel = await openPanel(window)
      const darkCard = darkPanel.getByTestId('react-artifact-card').first()
      await expect(darkCard).toBeVisible({ timeout: 15_000 })
      await darkCard.scrollIntoViewIfNeeded()
      await darkCard.screenshot({ path: info.outputPath('react-inline-dark.png') })
      await info.attach('react-inline-dark', { path: info.outputPath('react-inline-dark.png'), contentType: 'image/png' })
    } finally { await app.close() }
  })
  test('全流程：真实工具→界面→选择→原 session 继续回答', async ({}, info) => {
    test.setTimeout(120_000)
    const workspace = await mkdtemp(join(tmpdir(), 'montree-e2e-genui-'))
    await writeFile(join(workspace, 'compare.md'), '# 第一章\n\n甲论点原文在此。\n\n# 第二章\n\n乙论点原文在此。\n')
    const app = await launchBuiltApp({
      E2E_AUTO_OPEN_PATH: workspace,
      E2E_DOCUMENT_TOOLS: '1',
      ...MOCK_ENV,
    })
    try {
      const window = await app.firstWindow()
      await window.waitForLoadState('domcontentloaded')
      await expect(window.getByRole('button', { name: '更多操作', exact: true })).toBeVisible({ timeout: 15_000 })
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

      // 真实 MCP 调用产生界面结果（先读后呈，摘录逐条验原文）
      const envelope = await mcpCall(window, endpoint, 'montree_present', componentUiArgs())
      expect(envelope.result.isError, JSON.stringify(envelope)).toBeFalsy()
      const result = JSON.parse(envelope.result.content[0].text)
      expect(result.kind).toBe('component-ui')
      expect(result.id).toMatch(/^present-component-ui-/)
      // 同一输入重放得同一 id
      const replay = await mcpCall(window, endpoint, 'montree_present', componentUiArgs())
      expect(JSON.parse(replay.result.content[0].text).id).toBe(result.id)
      // 非法树整单拒绝（未知组件）
      const bad = await mcpCall(window, endpoint, 'montree_present', {
        ...componentUiArgs(),
        title: '坏树',
        ui: { root: { component: 'Map', props: {} } },
      })
      expect(bad.result.isError).toBe(true)

      // mock 回放进聊天（透传真实结果，不编造）
      await prompt(window, sessionId, `present-echo:${JSON.stringify(result)}`)
      const card = panel.getByTestId('component-ui-card')
      await expect(card).toBeVisible({ timeout: 15_000 })
      await expect(card.getByText('两章论证对比')).toBeVisible()
      // 布局来自模型的树：Select 在 Evidence 之前
      const order = await card.evaluate((el) => el.textContent ?? '')
      expect(order.indexOf('对比维度')).toBeLessThan(order.indexOf('甲论点原文在此。'))

      // 用户选择维度并提交 → 原 ACP session 收到后续输入并继续回答
      // （单选组为 radiogroup 语义，选项按 radio 定位）
      await card.getByRole('radio', { name: '论证方法', exact: true }).click()
      await card.getByRole('button', { name: '继续分析' }).click()
      await expect(panel.getByText(/generative-ui-submit/)).toBeVisible({ timeout: 15_000 })
      await expect(panel.getByText(/dim: method/)).toBeVisible({ timeout: 15_000 })

      // 证据定位到真实原文
      await card.getByRole('button', { name: '定位原文' }).first().click()
      const selected = await mcpCall(window, endpoint, 'montree_text_read', {
        documentPath: join(workspace, 'compare.md'),
        target: 'selection',
      })
      expect(JSON.parse(selected.result.content[0].text).text).toBe('甲论点原文在此。')

      await panel.screenshot({ path: info.outputPath('generative-ui.png') })
      await info.attach('generative-ui', { path: info.outputPath('generative-ui.png'), contentType: 'image/png' })
      const chapters = [{ key: 'c1', label: '第一章', flatIndex: 0 }]
      const comparison = await mcpCall(window, endpoint, 'montree_present', { kind: 'preset', preset: 'chapter-comparison', title: '内置对比', chapters: componentUiArgs().chapters, items: [] })
      expect(comparison.result.isError ?? false).toBe(false)
      expect(JSON.parse(comparison.result.content[0].text).kind).toBe('chapter-comparison')

      const citations = await mcpCall(window, endpoint, 'montree_present', { kind: 'preset', preset: 'citation-guide', title: '内置引用导航', chapters, citations: [{ label: '主要论点', chapterKey: 'c1', excerpt: '甲论点原文在此。' }] })
      expect(citations.result.isError ?? false).toBe(false)
      await prompt(window, sessionId, `present-raw-echo:${JSON.stringify(citations.result)}`)
      const citationCard = panel.getByTestId('component-ui-card').filter({ hasText: '内置引用导航' })
      await expect(citationCard).toBeVisible()
      await citationCard.getByRole('button', { name: '定位原文' }).click()
      const citationSelection = await mcpCall(window, endpoint, 'montree_text_read', { documentPath: join(workspace, 'compare.md'), target: 'selection' })
      expect(JSON.parse(citationSelection.result.content[0].text).text).toBe('甲论点原文在此。')
      await citationCard.getByRole('radio', { name: '主要论点', exact: true }).click()
      await citationCard.getByRole('button', { name: '分析所选引用' }).click()
      await expect(panel.getByText(/citation: citation-1/).first()).toBeVisible()

      const quiz = await mcpCall(window, endpoint, 'montree_present', { kind: 'preset', preset: 'reading-quiz', title: '内置阅读测验', chapters, questions: [{ question: '第一章的主要论点是什么？', options: ['论点甲', '论点乙'] }] })
      expect(quiz.result.isError ?? false).toBe(false)
      await prompt(window, sessionId, `present-raw-echo:${JSON.stringify(quiz.result)}`)
      const quizCard = panel.getByTestId('component-ui-card').filter({ hasText: '内置阅读测验' })
      await expect(quizCard).toBeVisible()
      await quizCard.getByRole('radio', { name: '论点甲', exact: true }).click()
      await quizCard.getByRole('button', { name: '提交答案，请助手点评' }).click()
      await expect(panel.getByText(/question-1: 论点甲/).first()).toBeVisible()
      await quizCard.screenshot({ path: info.outputPath('reading-quiz-preset.png') })
    } finally {
      await app.close()
      await rm(workspace, { recursive: true, force: true })
    }
  })

  test('线程隔离：新对话无旧卡，切回旧卡仍在且不串线', async ({}, info) => {
    test.setTimeout(120_000)
    const workspace = await mkdtemp(join(tmpdir(), 'montree-e2e-genui-thread-'))
    await writeFile(join(workspace, 'compare.md'), '# 第一章\n\n甲论点原文在此。\n\n# 第二章\n\n乙论点原文在此。\n')
    const app = await launchBuiltApp({
      E2E_AUTO_OPEN_PATH: workspace,
      E2E_DOCUMENT_TOOLS: '1',
      ...MOCK_ENV,
    })
    try {
      const window = await app.firstWindow()
      await window.waitForLoadState('domcontentloaded')
      await expect(window.getByRole('button', { name: '更多操作', exact: true })).toBeVisible({ timeout: 15_000 })
      await window.getByRole('button', { name: '更多操作', exact: true }).click()
      await window.getByRole('menuitem', { name: /打开文件夹/ }).click()
      await window.keyboard.press('Control+p')
      const dialog = window.getByRole('dialog', { name: '快速打开文件' })
      await dialog.getByPlaceholder('搜索工作区文件或电子书...').fill('compare.md')
      await dialog.getByRole('button').filter({ hasText: 'compare.md' }).click()
      await expect(dialog).toBeHidden()

      const panel = await openPanel(window)
      const sessionId = await connect(window)
      const endpoint = (await app.evaluate(
        async () => (globalThis as any).__montreeE2eMcpEndpoint(),
      )) as McpEndpoint
      const envelope = await mcpCall(window, endpoint, 'montree_present', componentUiArgs())
      const result = JSON.parse(envelope.result.content[0].text)
      await prompt(window, sessionId, `present-echo:${JSON.stringify(result)}`)
      const card = panel.getByTestId('component-ui-card')
      await expect(card).toBeVisible({ timeout: 15_000 })
      // persist 落盘异步，poll 等待线程 id 可读
      let oldThreadId = ''
      await expect
        .poll(
          () =>
            window.evaluate(() => {
              try {
                const raw = localStorage.getItem('montree-acp-ui') ?? ''
                return (JSON.parse(raw).state?.activeThreadId ?? '') as string
              } catch {
                return ''
              }
            }),
          { timeout: 10_000 },
        )
        .not.toBe('')
      oldThreadId = await window.evaluate(() => {
        try {
          const raw = localStorage.getItem('montree-acp-ui') ?? ''
          return (JSON.parse(raw).state?.activeThreadId ?? '') as string
        } catch {
          return ''
        }
      })
      expect(oldThreadId).toBeTruthy()

      // 新对话：旧卡不在新线程（线程隔离，消息不串）
      // 注：历史菜单 onSelect 用 preventDefault 保持打开，操作后先 Escape 关闭
      await panel.getByRole('button', { name: '对话历史', exact: true }).click()
      await window.getByRole('menuitem', { name: '新对话' }).click()
      await window.keyboard.press('Escape')
      await expect(panel.getByTestId('component-ui-card')).toHaveCount(0, { timeout: 10_000 })
      await expect
        .poll(
          () =>
            window.evaluate(() => {
              try {
                const raw = localStorage.getItem('montree-acp-ui') ?? ''
                return (JSON.parse(raw).state?.activeThreadId ?? '') as string
              } catch {
                return ''
              }
            }),
          { timeout: 10_000 },
        )
        .not.toBe(oldThreadId)

      // 切回旧线程：旧卡仍在（历史恢复保持界面数据）
      await panel.getByRole('button', { name: '对话历史', exact: true }).click()
      const history = window.locator('[role="menu"]')
      const threadSelects = history.locator('div.group > button:first-child')
      await expect(threadSelects).toHaveCount(2, { timeout: 10_000 })
      await threadSelects.nth(1).click()
      await window.keyboard.press('Escape')
      await expect(panel.getByTestId('component-ui-card')).toBeVisible({ timeout: 15_000 })
      // persist 落盘异步，用 poll 等待切回旧线程（防读到切换前快照）
      await expect
        .poll(
          () =>
            window.evaluate(() => {
              const raw = localStorage.getItem('montree-acp-ui') ?? ''
              return (JSON.parse(raw).state?.activeThreadId ?? '') as string
            }),
          { timeout: 10_000 },
        )
        .toBe(oldThreadId)

      await panel.screenshot({ path: info.outputPath('generative-ui-thread.png') })
      await info.attach('generative-ui-thread', {
        path: info.outputPath('generative-ui-thread.png'),
        contentType: 'image/png',
      })
    } finally {
      await app.close()
      await rm(workspace, { recursive: true, force: true })
    }
  })
})
