import { copyFile, mkdtemp, mkdir } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { tmpdir } from 'node:os'
import { test, expect, type FrameLocator, type Locator, type Page } from '@playwright/test'
import { launchBuiltApp } from './helpers/launch-app'
import { seedMockChatThread } from './helpers/seed-chat'
import { webDocFixtureDir } from './helpers/web-doc-fixture'

/**
 * 端到端：React 文档（在线文档 fixture + 扫描版 PDF）
 * 划选 → 划重点 → 批注 → 智能制卡（mock Agent）→ 重载后标记持久化并重新锚定。
 */
const __dirname = dirname(fileURLToPath(import.meta.url))
const shotDir = process.env.ROUND3_SCREENSHOT_DIR
const REACT_URL = 'https://e2e.montree.test/react/learn/describing-the-ui'
const INSPECTOR_ENV_KEYS = ['PDFIUM_LIB_PATH', 'ORT_DYLIB_PATH', 'PDF_INSPECTOR_MODEL_CACHE'] as const

async function shot(page: Page, name: string) {
  if (!shotDir) return
  await mkdir(shotDir, { recursive: true })
  // 截图隐藏 toast：只用样式遮掉，不能删 sonner 自管的节点（会让 React 提交时 insertBefore 崩溃）
  await page.screenshot({ path: join(shotDir, name), style: '[data-sonner-toaster] { visibility: hidden !important; }' })
}
function env(workspace: string): Record<string, string> {
  const extra: Record<string, string> = {
    E2E_AUTO_OPEN_PATH: workspace,
    E2E_WEB_DOC_FIXTURE_DIR: webDocFixtureDir(),
    E2E_ACP_WINDOW_TEST: '1',
    E2E_DOCUMENT_TOOLS: '1',
    E2E_ACP_COMMAND: process.execPath,
    E2E_ACP_FIXTURE: resolve('apps/desktop/e2e/fixtures/mock-window-agent.cjs'),
  }
  for (const key of INSPECTOR_ENV_KEYS) if (process.env[key]) extra[key] = process.env[key]!
  return extra
}
async function connectMock(page: Page) {
  page.on('console', (message) => { const text = message.text(); if (/card-studio|subsession|制卡/i.test(text)) console.log('CONSOLE', text) })
  await seedMockChatThread(page, { id: 'react-docs-thread', title: 'React 文档' })
  await expect(page.getByRole('button', { name: '更多操作', exact: true })).toBeVisible({ timeout: 15_000 })
  const connected = await page.evaluate(() => (window as any).electronAPI.acpConnect({ runtimeId: 'mock-window' }))
  expect(connected.ok, JSON.stringify(connected)).toBe(true)
}
async function highlight(page: Page, target: Locator) {
  const toolbar = page.getByRole('toolbar', { name: '选区操作' })
  await expect(toolbar).toBeVisible()
  await toolbar.getByRole('button', { name: /^划重点 / }).first().click()
  await expect(page.getByText(/已添加高亮|已更新高亮/).first()).toBeVisible()
  void target
}
async function annotate(page: Page, note: string) {
  const toolbar = page.getByRole('toolbar', { name: '选区操作' })
  await expect(toolbar).toBeVisible()
  await toolbar.getByRole('button', { name: '批注', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: '添加批注' })
  await dialog.getByPlaceholder('写下你的想法…').fill(note)
  await dialog.getByRole('button', { name: '保存', exact: true }).click()
  await expect(page.getByText('已保存批注', { exact: true }).first()).toBeVisible()
  await expect(dialog).toBeHidden()
  await expect(page.locator('.fixed.inset-0.z-50')).toHaveCount(0)
}
/**
 * Agent 经本窗口 MCP 调 montree_propose_mark 按摘录提议 AI 笔记（mock Agent 与真实 Agent 同一路径），
 * 聊天里出现提议卡，用户「采用并保存」后落库。摘录必须能在渲染后的正文里重新定位。
 */
async function agentProposeNote(page: Page, excerpt: string, note: string): Promise<string> {
  const chat = page.getByRole('region', { name: 'Agent 聊天' })
  const composer = chat.locator('textarea').first()
  await composer.fill(`mcp-call:montree_propose_mark:${JSON.stringify({ excerpt, note })}`)
  await chat.getByRole('button', { name: '发送', exact: true }).click()
  const draft = chat.getByRole('button', { name: /批注草稿.*展开确认/ }).last()
  await expect(draft).toBeVisible({ timeout: 30_000 })
  await draft.click()
  const adopt = chat.getByRole('button', { name: '采用并保存', exact: true }).last()
  await expect(adopt).toBeVisible({ timeout: 30_000 })
  // 采用前在卡片里改稿：写库的必须是改后的文本
  const edited = `${note}（用户改稿）`
  await chat.locator('[data-testid="propose-mark-card"] textarea').last().fill(edited)
  await adopt.click()
  // 卡片落定为已采用；写库失败会弹「未找到/失败」类提示
  const failure = page.locator('[data-sonner-toast]').filter({ hasText: /失败|未找到|无法|未就绪/ })
  await expect(chat.getByRole('button', { name: '采用并保存', exact: true })).toHaveCount(0, { timeout: 15_000 })
  expect(await failure.allTextContents()).toEqual([])
  return edited
}
/** 三击选段。先等阅读器把交互监听绑定到 iframe（data-web-doc-interactive），否则早到的三击没有监听者，工具栏不会出现 */
async function tripleSelect(page: Page, target: Locator) {
  await expect(page.locator('iframe[data-web-doc-interactive="true"]')).toHaveCount(1)
  await target.click({ clickCount: 3 })
  await expect(page.getByRole('toolbar', { name: '选区操作' })).toBeVisible()
}
async function smartCard(page: Page) {
  const toolbar = page.getByRole('toolbar', { name: '选区操作' })
  await expect(toolbar).toBeVisible()
  // 上一步的成功 toast 会盖住右侧弹出的制卡菜单（Windows 窄视口下必现）：先等它们收起
  await expect(page.locator('[data-sonner-toast][data-type="success"]')).toHaveCount(0, { timeout: 15_000 })
  await toolbar.getByRole('button', { name: /智能制卡/ }).click()
  await page.getByRole('button', { name: /通用提炼/ }).or(page.getByRole('menuitem', { name: /通用提炼/ })).first().click()
  const ok = page.getByText(/AI 制卡：【MOCK卡/).first()
  const failed = page.getByText(/制卡失败|AI 无响应|本书信息缺失|没有可用选区|选中文本为空|请在 Agent 登录弹窗/).first()
  await expect(ok.or(failed)).toBeVisible({ timeout: 30_000 })
  if (await failed.isVisible()) throw new Error('制卡失败 toast: ' + await failed.textContent())
}

test('React 在线文档：划重点 / 批注 / 智能制卡，重载后持久化并重新锚定', async () => {
  test.setTimeout(180_000)
  const workspace = await mkdtemp(join(tmpdir(), 'montree-react-web-'))
  const app = await launchBuiltApp(env(workspace))
  try {
    const page = await app.firstWindow()
    await page.waitForLoadState('domcontentloaded')
    await connectMock(page)
    const field = page.getByPlaceholder('https://react.dev/learn').first()
    await field.fill(REACT_URL); await field.press('Enter')
    const frame: FrameLocator = page.frameLocator('.web-doc-viewer-host iframe')
    const intro = frame.getByText(/React is a JavaScript library for rendering user interfaces/).first()
    await expect(intro).toBeVisible({ timeout: 20_000 })

    await tripleSelect(page, intro)
    await highlight(page, intro)
    const second = frame.getByText(/React applications are built from isolated pieces of UI/).first()
    await tripleSelect(page, second)
    await annotate(page, 'React 组件即函数')
    const third = frame.getByText(/Each React component is a JavaScript function that may contain/).first()
    await tripleSelect(page, third)
    await smartCard(page)
    await expect(frame.locator('[data-mark-id]').first()).toBeVisible()
    const webNote = await agentProposeNote(page, 'You can declare many components in one file', 'AI 笔记：一个文件可声明多个组件')
    await shot(page, 'react-webdoc-annotations.png')
    await expect.poll(async () => (await frame.locator('[data-mark-id]').evaluateAll((els) => [...new Set(els.map((el) => (el as HTMLElement).dataset.markId))])).length, { timeout: 15_000 }).toBe(4)

    await page.reload()
    await expect(page.frameLocator('.web-doc-viewer-host iframe').getByText(/React is a JavaScript library/).first()).toBeVisible({ timeout: 20_000 })
    const after = page.frameLocator('.web-doc-viewer-host iframe')
    await expect.poll(async () => (await after.locator('[data-mark-id]').evaluateAll((els) => [...new Set(els.map((el) => (el as HTMLElement).dataset.markId))])).length, { timeout: 15_000 }).toBe(4)
    // 重新锚定到原文：高亮仍覆盖原句文字
    const anchored = await after.locator('[data-mark-id]').evaluateAll((els) => els.map((el) => el.textContent ?? '').join(' '))
    expect(anchored).toContain('React is a JavaScript library')
    // 落库的是改后的批注
    await expect(page.locator('#main').getByText(webNote).first()).toBeAttached({ timeout: 15_000 })
    await shot(page, 'react-webdoc-after-reload.png')
  } finally {
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().forEach((window) => window.removeAllListeners('close')))
    await app.close()
  }
})

test('React 扫描版 PDF：OCR 文字层上划重点 / 批注 / 智能制卡，重载后持久化并重新锚定', async () => {
  test.setTimeout(300_000)
  const workspace = await mkdtemp(join(tmpdir(), 'montree-react-pdf-'))
  await copyFile(join(__dirname, 'fixtures', 'ocr', 'scanned-react.pdf'), join(workspace, 'scanned-react.pdf'))
  const app = await launchBuiltApp(env(workspace))
  try {
    const page = await app.firstWindow()
    await page.waitForLoadState('domcontentloaded')
    await connectMock(page)
    await page.getByRole('button', { name: '更多操作', exact: true }).click()
    await page.getByRole('menuitem', { name: /打开文件夹/ }).click()
    await page.keyboard.press('Control+p')
    const dialog = page.getByRole('dialog', { name: '快速打开文件' })
    await dialog.getByPlaceholder('搜索工作区文件或电子书...').fill('scanned-react')
    await dialog.getByRole('button').filter({ hasText: 'scanned-react.pdf' }).first().click()
    const panel = page.locator('#main')
    const done = panel.getByText(/已识别 \d+\/\d+/)
    const unread = panel.getByText(/本页未识别/)
    await expect(done.or(unread).or(panel.getByText(/识别中…/))).toBeVisible({ timeout: 30_000 })
    if (await unread.isVisible()) {
      await panel.getByRole('button', { name: '更多工具' }).click()
      await page.getByRole('menuitem', { name: '识别本页', exact: true }).click()
    }
    await expect(done).toBeVisible({ timeout: 240_000 })
    const layer = panel.locator('.pdf-text-layer-host')
    await expect(layer).toContainText('JavaScript', { timeout: 10_000 })

    // OCR 文字层按词分 span：从首词左缘拖到末词右缘，模拟真实划选
    const selectWords = async (first: string, last: string) => {
      const from = layer.locator('span', { hasText: new RegExp(`^${first}\\s?$`) }).first()
      const to = layer.locator('span', { hasText: new RegExp(`^${last}\\s?$`) }).first()
      await from.scrollIntoViewIfNeeded()
      const a = (await from.boundingBox())!, b = (await to.boundingBox())!
      await page.mouse.move(a.x + 1, a.y + a.height / 2)
      await page.mouse.down()
      await page.mouse.move((a.x + b.x) / 2, (a.y + b.y) / 2 + 2, { steps: 5 })
      // 落点取末词最后一个字符的右缘（span 宽度延伸到下个词，不能直接用 span 右缘）
      const endX = await to.evaluate((node) => {
        const text = node.firstChild as Text
        const word = (text.textContent ?? '').trimEnd()
        const range = node.ownerDocument.createRange()
        range.setStart(text, Math.max(0, word.length - 1)); range.setEnd(text, word.length)
        return range.getBoundingClientRect().right
      })
      await page.mouse.move(Math.min(endX + 1, b.x + b.width - 1), b.y + b.height / 2, { steps: 5 })
      await page.mouse.up()
      // 回归：OCR 逐词 span 之间必须有空格，选区/摘录不能粘成一串
      expect(await page.evaluate(() => getSelection()?.toString().trim())).toMatch(new RegExp(`^${first} .* ${last}$`))
    }
    const selectLine = async (needle: RegExp) => {
      const words: Record<string, [string, string]> = { 'JavaScript library': ['React', 'rendering'], 'user interfaces': ['user', 'units'], 'Components are reusable': ['Components', 'that'] }
      const [first, last] = words[needle.source]
      await selectWords(first, last)
    }
    await selectLine(/JavaScript library/)
    await highlight(page, layer)
    await selectLine(/user interfaces/)
    await annotate(page, '扫描件批注')
    await selectLine(/Components are reusable/)
    await smartCard(page)
    const marks = panel.locator('[data-mark-id]')
    await expect.poll(async () => (await marks.evaluateAll((els) => [...new Set(els.map((el) => (el as HTMLElement).dataset.markId))])).length).toBe(3)
    const pdfNote = await agentProposeNote(page, 'like buttons, text, and images.', 'AI 笔记：UI 由小单元构成')
    await expect.poll(async () => (await marks.evaluateAll((els) => [...new Set(els.map((el) => (el as HTMLElement).dataset.markId))])).length).toBe(4)
    await shot(page, 'react-scanned-pdf-annotations.png')
    // 卡片轨中的摘录保留词间空格
    await expect(page.getByText(/React is a JavaScript library for rendering/).first()).toBeVisible()

    await page.reload()
    await expect(page.locator('#main').getByText(/已识别 \d+\/\d+/)).toBeVisible({ timeout: 60_000 })
    await expect.poll(async () => (await page.locator('#main [data-mark-id]').evaluateAll((els) => [...new Set(els.map((el) => (el as HTMLElement).dataset.markId))])).length, { timeout: 30_000 }).toBe(4)
    await expect(page.locator('#main').getByText(pdfNote).first()).toBeAttached({ timeout: 15_000 })
    await shot(page, 'react-scanned-pdf-after-reload.png')
  } finally {
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().forEach((window) => window.removeAllListeners('close')))
    await app.close()
  }
})
