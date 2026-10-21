import { mkdtemp, writeFile, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test, expect, type ElectronApplication, type Locator, type Page } from '@playwright/test'
import { launchBuiltApp } from './helpers/launch-app'

const shotDir = process.env.PROPOSAL_SCREENSHOT_DIR

async function shot(page: Page, info: { outputPath: (name: string) => string }, name: string, target: Page | Locator = page) {
  // 启动时与本用例无关的提示 toast 会遮挡审阅栏，截图前移除
  await page.evaluate(() => document.querySelectorAll('[data-sonner-toast]').forEach((toast) => toast.remove()))
  await target.screenshot({ path: info.outputPath(name) })
  if (shotDir) { await mkdir(shotDir, { recursive: true }); await target.screenshot({ path: join(shotDir, name) }) }
}
async function open(page: Page, file: string) {
  await page.keyboard.press('Control+p')
  const dialog = page.getByRole('dialog', { name: '快速打开文件' })
  await dialog.getByPlaceholder('搜索工作区文件或电子书...').fill(file)
  await dialog.getByRole('button').filter({ hasText: file }).click()
  await expect(dialog).toBeHidden()
}
async function close(app: ElectronApplication) {
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().forEach((window) => window.removeAllListeners('close')))
  await app.close()
}

test('AI 修改建议：MCP 提议→编辑器内差异→逐条/全部接受拒绝→撤销→预览切换→Typst 多行→迟到事件拒绝', async ({}, info) => {
  const workspace = await mkdtemp(join(tmpdir(), 'montree-proposals-'))
  const md = join(workspace, 'notes.md'), typ = join(workspace, 'paper.typ')
  const source = '# 标题\n\nThe quick brown fox jumps over the lazy dog.\n\nsame\n\nsame 😀 end\n'
  await writeFile(md, source)
  await writeFile(typ, '= Typst 标题\n#let a = 1\n#let b = 2\n正文\n')
  const app = await launchBuiltApp({ E2E_AUTO_OPEN_PATH: workspace, E2E_DOCUMENT_TOOLS: '1' })
  try {
    const page = await app.firstWindow()
    await page.getByRole('button', { name: '更多操作', exact: true }).click()
    await page.getByRole('menuitem', { name: /打开文件夹/ }).click()
    await open(page, 'notes.md'); await expect(page.locator('.cm-editor')).toBeVisible()
    const endpoint = await app.evaluate(async () => (globalThis as any).__montreeE2eMcpEndpoint())
    let id = 0
    const call = async (name: string, args: Record<string, unknown>) => {
      const response = await fetch(endpoint.url, { method: 'POST', headers: { Authorization: `Bearer ${endpoint.authToken}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: ++id, method: 'tools/call', params: { name, arguments: args } }) })
      return ((await response.json()) as any).result
    }
    const value = async (name: string, args: Record<string, unknown>) => {
      const result = await call(name, args)
      expect(result.isError, result.content[0].text).not.toBe(true)
      return JSON.parse(result.content[0].text)
    }
    const text = async (documentPath = md) => (await value('montree_text_read', { documentPath, target: 'document' })).text as string

    const list = await fetch(endpoint.url, { method: 'POST', headers: { Authorization: `Bearer ${endpoint.authToken}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: ++id, method: 'tools/list' }) })
    expect(((await list.json()) as any).result.tools.map((tool: any) => tool.name)).toContain('montree_text_propose')

    let state = await value('montree_text_read', { documentPath: md })
    const quick = source.indexOf('quick'), second = source.lastIndexOf('same')
    const created = await value('montree_text_propose', { documentPath: md, revision: state.revision, expectedCount: 2, edits: [
      { from: quick, to: quick + 'quick brown'.length, expectedText: 'quick brown', text: 'slow red' },
      { from: second, to: second + 4, expectedText: 'same', text: 'other' },
    ] })
    expect(created).toMatchObject({ status: 'proposal_created', awaiting: 'user', proposedCount: 2, revision: state.revision })
    expect(await text()).toBe(source)

    const editor = page.locator('.cm-content')
    await expect(editor.locator('.cm-ai-proposal-del')).toHaveCount(2)
    await expect(editor.locator('.cm-ai-proposal-ins').first()).toContainText('slow red')
    const bar = page.getByTestId('proposal-review-bar')
    await expect(page.getByTestId('proposal-review-count')).toHaveText('2 处修改建议')
    await shot(page, info, 'markdown-inline-diff.png')
    await editor.locator('.cm-ai-proposal-btn-accept').first().hover()
    await shot(page, info, 'markdown-accept-reject-buttons.png', editor.locator('.cm-line').filter({ hasText: 'fox' }))
    await shot(page, info, 'review-bar.png', bar)

    // 用户在第一处之前输入：位置随之映射，仍可接受
    await editor.click(); await page.keyboard.press('Control+Home'); await page.keyboard.type('>')
    await editor.locator('[data-proposal-action="accept"]').first().click()
    await expect(page.getByTestId('proposal-review-count')).toHaveText('1 处修改建议')
    expect(await text()).toBe('>' + source.replace('quick brown', 'slow red'))
    // 接受是一次普通撤销
    await editor.click(); await page.keyboard.press('Control+z')
    expect(await text()).toBe('>' + source)
    // 切换到阅读模式再回来，建议仍在
    await page.keyboard.press('Control+3'); await expect(page.locator('.cm-editor')).toHaveCount(0)
    await expect(bar).toBeVisible()
    await page.keyboard.press('Control+1'); await expect(editor.locator('.cm-ai-proposal-del')).toHaveCount(1)
    await bar.getByRole('button', { name: '拒绝当前' }).click()
    await expect(bar).toHaveCount(0)
    expect(await text()).toBe('>' + source)

    // 选区内用户编辑使建议失效，不能被接受
    state = await value('montree_text_read', { documentPath: md })
    const current = await text(), emoji = current.indexOf('😀')
    await value('montree_text_propose', { documentPath: md, revision: state.revision, expectedCount: 1, edits: [{ from: emoji, to: emoji + 2, expectedText: '😀', text: '🎉' }] })
    await expect(editor.locator('.cm-ai-proposal-del')).toHaveCount(1)
    await editor.locator('.cm-ai-proposal-del').click({ position: { x: 2, y: 4 } })
    await page.keyboard.type('x')
    await expect(page.getByTestId('proposal-review-count')).toContainText('1 处已失效')
    await bar.getByRole('button', { name: '清除失效' }).click()
    await expect(bar).toHaveCount(0)

    // 全部接受 = 单个事务
    state = await value('montree_text_read', { documentPath: md })
    const now = await text(), dog = now.indexOf('dog'), title = now.indexOf('标题')
    await value('montree_text_propose', { documentPath: md, revision: state.revision, expectedCount: 2, edits: [{ from: dog, to: dog + 3, expectedText: 'dog', text: 'cat' }, { from: title, to: title + 2, expectedText: '标题', text: '新标题' }] })
    await page.getByTestId('proposal-accept-all').click()
    expect(await text()).toBe(now.replace('dog', 'cat').replace('标题', '新标题'))
    await editor.click(); await page.keyboard.press('Control+z')
    expect(await text()).toBe(now)

    // Typst 多行建议
    await page.keyboard.press('Control+p')
    const quickOpen = page.getByRole('dialog', { name: '快速打开文件' })
    await quickOpen.getByPlaceholder('搜索工作区文件或电子书...').fill('paper.typ')
    await quickOpen.getByRole('button').filter({ hasText: 'paper.typ' }).click()
    await page.getByRole('alertdialog', { name: '未保存的更改' }).getByRole('button', { name: '不保存' }).click()
    await expect(page.getByTestId('typst-workspace')).toBeVisible()
    const typState = await value('montree_text_read', { documentPath: typ })
    const typText = await text(typ), from = typText.indexOf('#let a'), to = typText.indexOf('正文') - 1
    // 迟到事件：仍指向已切走的 Markdown 文档 → 拒绝
    const late = await call('montree_text_propose', { documentPath: md, revision: state.revision, expectedCount: 1, edits: [{ from: 0, to: 1, expectedText: '>', text: '' }] })
    expect(late.isError).toBe(true)
    await value('montree_text_propose', { documentPath: typ, revision: typState.revision, expectedCount: 1, edits: [{ from, to, expectedText: '#let a = 1\n#let b = 2', text: '#let a = 10\n#let b = 20\n#let c = 30' }] })
    const typEditor = page.getByTestId('typst-workspace').locator('.cm-content')
    await expect(typEditor.locator('.cm-ai-proposal-block')).toBeVisible()
    await expect(typEditor.locator('.cm-ai-proposal-del-line')).toHaveCount(2)
    await shot(page, info, 'typst-multiline-proposal.png')
    await typEditor.locator('.cm-ai-proposal-block [data-proposal-action="accept"]').click()
    expect(await text(typ)).toBe('= Typst 标题\n#let a = 10\n#let b = 20\n#let c = 30\n正文\n')
  } finally { await close(app) }
})
