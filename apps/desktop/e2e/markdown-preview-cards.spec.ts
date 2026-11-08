import { mkdtemp, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { test, expect, type ElectronApplication, type Page } from '@playwright/test'
import type { ReadingMark } from '@yitom/contracts'
import { launchBuiltApp } from './helpers/launch-app'
import { seedMockChatThread } from './helpers/seed-chat'
import { screenshotWithoutToasts } from './helpers/screenshot'

const quote = '原文摘录会保存在卡片中，段落前面增加内容仍然可以定位。'
const aiQuote = 'Markdown 预览应当复用卡片、批注和复习能力。'
const source = `# Markdown 阅读实验\n\n${quote}\n\n${aiQuote}\n\n## 下一节\n\n第二节的正文。\n`

async function openFile(page: Page) {
  await page.keyboard.press('Control+p')
  const dialog = page.getByRole('dialog', { name: '快速打开文件' })
  await dialog.getByPlaceholder('搜索工作区文件或电子书...').fill('reader.md')
  await dialog.getByRole('button').filter({ hasText: 'reader.md' }).first().click()
  await expect(dialog).toBeHidden()
}
async function preview(page: Page) {
  const area = page.getByRole('toolbar', { name: '文档编辑模式' })
  await expect(area).toBeVisible()
  const button = area.getByRole('button', { name: '预览', exact: true })
  if (await button.count()) await button.click()
  await expect(page.locator('.markdown-preview.markdown-reading')).toBeVisible()
}
async function marks(page: Page, path: string): Promise<ReadingMark[]> {
  return page.evaluate(async (path) => {
    const result = await window.electronAPI.listReadingMarks(path)
    if (!result.ok) throw new Error(result.error.message)
    return result.value
  }, path)
}
async function select(page: Page, text: string) {
  await page.locator('.markdown-preview.markdown-reading').getByText(text, { exact: true }).click({ clickCount: 3 })
  await expect(page.getByRole('toolbar', { name: '选区操作' })).toBeVisible()
}
async function mcpTool<T>(app: ElectronApplication, name: string, args: Record<string, unknown> = {}): Promise<T> {
  const endpoint = await app.evaluate(() => (globalThis as unknown as {
    __montreeE2eMcpEndpoint: () => { url: string; authToken: string }
  }).__montreeE2eMcpEndpoint())
  const response = await fetch(endpoint.url, { method: 'POST',
    headers: { Authorization: `Bearer ${endpoint.authToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }),
  })
  expect(response.status).toBe(200)
  const rpc = await response.json() as { result: { isError?: boolean; content: Array<{ text: string }> } }
  const result = rpc.result
  expect(result.isError, result.content[0].text).not.toBe(true)
  return JSON.parse(result.content[0].text) as T
}
const selectionContext = (app: ElectronApplication) => mcpTool<{ selection: string; target?: { kind: string } }>(app, 'montree_get_selection')
async function setSource(page: Page, text: string) {
  await page.getByRole('toolbar', { name: '文档编辑模式' }).getByRole('button', { name: '编辑器所见即所得模式切换' }).click()
  const content = page.locator('.cm-content')
  await content.click()
  await page.keyboard.press('Control+a')
  await page.keyboard.insertText(text)
  await page.keyboard.press('Control+s')
  await preview(page)
}

test('Markdown 预览批注落盘、卡片跨模式保留、移位重新定位、改写保留引用快照', async ({}, info) => {
  const workspace = await mkdtemp(join(tmpdir(), 'montree-markdown-cards-'))
  const path = join(workspace, 'reader.md')
  await writeFile(path, source)
  const app = await launchBuiltApp({ E2E_AUTO_OPEN_PATH: workspace })
  try {
    const page = await app.firstWindow()
    const errors: string[] = []
    page.on('pageerror', (error) => errors.push(error.message))
    await page.waitForLoadState('domcontentloaded')
    await page.getByRole('button', { name: '更多操作', exact: true }).click()
    await page.getByRole('menuitem', { name: /打开文件夹/ }).click()
    await openFile(page)
    await expect(page.getByTestId('workspace-companion-panel').getByRole('tab', { name: '卡片流' })).toBeAttached()
    await preview(page)
    await select(page, quote)
    const selection = page.getByRole('toolbar', { name: '选区操作' })
    await selection.getByRole('button', { name: '选择高亮颜色' }).click()
    await selection.getByRole('button', { name: '写批注', exact: true }).click()
    const dialog = page.getByRole('dialog', { name: '添加批注' })
    await dialog.getByPlaceholder('写下你的想法…').fill('Markdown 批注持久化验证')
    await dialog.getByRole('button', { name: '保存', exact: true }).click()
    await expect(dialog).toBeHidden()
    const rail = page.locator('#marginalia-notes-stream')
    await expect(rail).toContainText('Markdown 批注持久化验证')
    await expect.poll(async () => (await marks(page, path)).length).toBe(1)
    const saved = (await marks(page, path))[0]
    expect(saved.excerpt).toBe(quote)
    expect(saved.anchor.format).toBe('web')
    if (saved.anchor.format === 'web') expect(saved.anchor.url).toContain('montree-markdown:')
    await expect.poll(() => page.evaluate(() => CSS.highlights.get('montree-md-yellow')?.size ?? 0)).toBe(1)
    await screenshotWithoutToasts(page, info.outputPath('markdown-preview-cards.png'))
    const originalSize = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].getContentSize())
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(1000, 750))
    const modeTools = page.getByRole('toolbar', { name: '文档编辑模式' })
    await expect(modeTools.getByRole('button', { name: '打开卡片流' })).toBeInViewport()
    await expect(page.getByRole('region', { name: '文档目录' })).toBeVisible()
    await screenshotWithoutToasts(page, info.outputPath('markdown-preview-narrow.png'))
    for (let i = 0; i < 3; i++) {
      if (await page.locator('html').evaluate((element) => element.classList.contains('dark'))) break
      const previousTheme = await page.locator('html').getAttribute('class')
      await page.getByRole('button', { name: '切换主题', exact: true }).click()
      await expect(page.locator('html')).not.toHaveAttribute('class', previousTheme!)
    }
    await expect(page.locator('html')).toHaveClass(/dark/)
    await expect.poll(() => page.locator('html').evaluate((element) => element.classList.contains('theme-transitioning'))).toBe(false)
    await expect.poll(() => page.evaluate(() => CSS.highlights.get('montree-md-yellow')?.size ?? 0)).toBe(1)
    await screenshotWithoutToasts(page, info.outputPath('markdown-preview-dark.png'))
    await app.evaluate(({ BrowserWindow }, [width, height]) => BrowserWindow.getAllWindows()[0].setContentSize(width, height), originalSize)

    await page.getByRole('toolbar', { name: '文档编辑模式' }).getByRole('button', { name: '返回编辑', exact: true }).click()
    await expect(rail).toContainText('Markdown 批注持久化验证')
    await rail.locator(`[data-card-id="${saved.id}"]`).click()
    await expect(page.locator('.markdown-preview.markdown-reading')).toBeVisible()
    await expect.poll(() => page.evaluate(() => CSS.highlights.get('montree-md-focus')?.size ?? 0)).toBe(1)

    const moved = source.replace(quote, `在原段落之前插入新内容。\n\n${quote}`)
    await setSource(page, moved)
    await expect(page.locator('.markdown-preview').getByText('在原段落之前插入新内容。', { exact: true })).toBeVisible()
    await expect.poll(() => page.evaluate(() => CSS.highlights.get('montree-md-yellow')?.size ?? 0)).toBe(1)
    await expect(rail.getByText('原文已变化，引用待重新关联')).toHaveCount(0)

    await setSource(page, moved.replace(quote, '这段内容已经改写。'))
    await expect(page.locator('.markdown-preview').getByText('这段内容已经改写。', { exact: true })).toBeVisible()
    await expect(rail.getByText('原文已变化，引用待重新关联')).toBeVisible()
    expect((await marks(page, path))[0].excerpt).toBe(quote)
    await page.reload()
    await preview(page)
    await page.getByRole('toolbar', { name: '文档编辑模式' }).getByRole('button', { name: '打开卡片流' }).click()
    await expect(rail).toContainText('Markdown 批注持久化验证')
    await expect(rail.getByText('原文已变化，引用待重新关联')).toBeVisible()
    expect((await marks(page, path))[0].id).toBe(saved.id)
    await screenshotWithoutToasts(page, info.outputPath('markdown-reference-changed.png'))
    await rail.getByRole('button', { name: '更多卡片操作' }).click()
    await expect(page.getByRole('menuitem', { name: '本章测验', exact: true })).toBeVisible()
    await expect(page.getByRole('menuitem', { name: '复习全书闪卡', exact: true })).toBeVisible()
    await page.getByRole('menuitem', { name: '本章测验', exact: true }).click()
    const quiz = page.getByRole('dialog', { name: /AI 智考工坊/ })
    await expect(quiz).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(quiz).toBeHidden()
    await rail.getByRole('button', { name: '更多卡片操作' }).click()
    await page.getByRole('menuitem', { name: '复习全书闪卡', exact: true }).click()
    const review = page.getByRole('dialog', { name: /闪卡工坊/ })
    await expect(review).toBeVisible()
    await expect(review).toContainText(quote)
    await page.keyboard.press('Escape')
    await expect(review).toBeHidden()
    expect(errors).toEqual([])
  } finally {
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().forEach((window) => window.removeAllListeners('close')))
    await app.close()
  }
})

test('Markdown 预览 AI 制卡通过真实会话链路保存并可重新打开', async ({}, info) => {
  test.setTimeout(120_000)
  const workspace = await mkdtemp(join(tmpdir(), 'montree-markdown-ai-card-'))
  const path = join(workspace, 'reader.md')
  await writeFile(path, source)
  const app = await launchBuiltApp({ E2E_AUTO_OPEN_PATH: workspace, E2E_ACP_WINDOW_TEST: '1', E2E_DOCUMENT_TOOLS: '1',
    E2E_ACP_COMMAND: process.execPath, E2E_ACP_FIXTURE: resolve('apps/desktop/e2e/fixtures/mock-window-agent.cjs') })
  try {
    const page = await app.firstWindow()
    await page.waitForLoadState('domcontentloaded')
    const reloaded = page.waitForEvent('domcontentloaded')
    await seedMockChatThread(page, { id: 'markdown-card-thread', title: 'Markdown 制卡' })
    await reloaded
    const connected = await page.evaluate(() => window.electronAPI.acpConnect({ runtimeId: 'mock-window' }))
    expect(connected.ok).toBe(true)
    await page.getByRole('button', { name: '更多操作', exact: true }).click()
    await page.getByRole('menuitem', { name: /打开文件夹/ }).click()
    await openFile(page)
    await page.getByRole('toolbar', { name: '文档编辑模式' }).getByRole('button', { name: '编辑器所见即所得模式切换' }).click()
    await page.locator('.cm-content').click()
    await page.keyboard.press('Control+a')
    expect((await selectionContext(app)).target?.kind).toBe('text')
    await preview(page)
    await select(page, aiQuote)
    const selectedPreview = await selectionContext(app)
    expect(selectedPreview.selection).toBe(aiQuote)
    expect(selectedPreview.target).toBeUndefined()
    await page.getByRole('toolbar', { name: '选区操作' }).getByRole('button', { name: 'AI', exact: true }).click()
    await page.getByRole('menuitem', { name: /通用提炼/ }).click()
    await expect.poll(async () => (await marks(page, path)).length, { timeout: 30_000 }).toBe(1)
    const card = (await marks(page, path))[0]
    expect(card.title).toContain('MOCK卡:')
    expect(card.aiSummary).toContain('MOCK摘要：')
    expect(card.excerpt).toBe(aiQuote)
    const rail = page.locator('#marginalia-notes-stream')
    await expect(rail).toContainText('MOCK卡:')
    await screenshotWithoutToasts(page, info.outputPath('markdown-ai-card.png'))
    await page.reload()
    await preview(page)
    await page.getByRole('toolbar', { name: '文档编辑模式' }).getByRole('button', { name: '打开卡片流' }).click()
    await expect(rail).toContainText('MOCK卡:')
    expect((await marks(page, path))[0].id).toBe(card.id)
    const listed = await mcpTool<{ count: number; marks: Array<{ id: string }> }>(app, 'montree_list_marks')
    expect(listed.count).toBe(1)
    expect(listed.marks[0].id).toBe(card.id)

    // mock Agent 经真实 MCP 提议；采用之前不入库，采用后可从同一工具查询。
    await page.getByTestId('workspace-companion-panel').getByRole('tab', { name: 'AI 对话', exact: true }).click()
    const chat = page.getByRole('region', { name: 'Agent 聊天' })
    await chat.locator('textarea').first().fill(`mcp-call:montree_propose_mark:${JSON.stringify({ excerpt: quote, note: 'MCP 提议的批注', category: 'method', title: 'MCP 方法卡' })}`)
    await chat.getByRole('button', { name: '发送', exact: true }).click()
    const draft = chat.getByRole('button', { name: /批注草稿.*展开确认/ }).last()
    await expect(draft).toBeVisible({ timeout: 30_000 })
    expect((await marks(page, path)).length).toBe(1)
    await draft.click()
    const proposal = chat.getByTestId('propose-mark-card').last()
    await proposal.locator('textarea').fill('MCP 提议经用户修改后采用')
    await proposal.getByRole('button', { name: '采用并保存', exact: true }).click()
    await expect.poll(async () => (await marks(page, path)).length).toBe(2)
    const adopted = (await marks(page, path)).find((item) => item.excerpt === quote)!
    expect(adopted).toMatchObject({ note: 'MCP 提议经用户修改后采用', category: 'method', title: 'MCP 方法卡' })
    const highlights = await mcpTool<{ count: number; marks: Array<{ id: string }> }>(app, 'montree_list_marks', { filter: 'highlights' })
    expect(highlights.count).toBe(2)
    expect(highlights.marks.map((item) => item.id)).toContain(adopted.id)
    await mcpTool(app, 'montree_create_bookmark')
    const bookmarks = await mcpTool<{ count: number }>(app, 'montree_list_marks', { filter: 'bookmarks' })
    expect(bookmarks.count).toBe(1)
  } finally {
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().forEach((window) => window.removeAllListeners('close')))
    await app.close()
  }
})
