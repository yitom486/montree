import { mkdtemp, writeFile, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test, expect, type Locator, type Page } from '@playwright/test'
import { launchBuiltApp } from './helpers/launch-app'

const shotDir = process.env.PROPOSAL_SCREENSHOT_DIR

async function shot(page: Page, info: { outputPath: (name: string) => string }, name: string, target: Page | Locator = page) {
  await page.evaluate(() => document.querySelectorAll('[data-sonner-toast]').forEach((toast) => toast.remove()))
  await target.screenshot({ path: info.outputPath(name) })
  if (shotDir) { await mkdir(shotDir, { recursive: true }); await target.screenshot({ path: join(shotDir, name) }) }
}

test('逐句审阅、侧边审阅面板、选区工具栏、行内补全', async ({}, info) => {
  const workspace = await mkdtemp(join(tmpdir(), 'montree-review-tools-'))
  const md = join(workspace, 'notes.md')
  const paragraph = '春天来了。花开得很好。We walked to the park. It was sunny.'
  await writeFile(md, `# 笔记\n\n${paragraph}\n\n`)
  const app = await launchBuiltApp({ E2E_AUTO_OPEN_PATH: workspace, E2E_DOCUMENT_TOOLS: '1', E2E_INLINE_COMPLETION_MOCK: '1' })
  try {
    const page = await app.firstWindow()
    await page.getByRole('button', { name: '更多操作', exact: true }).click()
    await page.getByRole('menuitem', { name: /打开文件夹/ }).click()
    await page.keyboard.press('Control+p')
    const dialog = page.getByRole('dialog', { name: '快速打开文件' })
    await dialog.getByPlaceholder('搜索工作区文件或电子书...').fill('notes.md')
    await dialog.getByRole('button').filter({ hasText: 'notes.md' }).click()
    const editor = page.locator('.cm-content')
    await expect(editor).toBeVisible()

    const endpoint = await app.evaluate(async () => (globalThis as any).__montreeE2eMcpEndpoint())
    let id = 0
    const value = async (name: string, args: Record<string, unknown>) => {
      const response = await fetch(endpoint.url, { method: 'POST', headers: { Authorization: `Bearer ${endpoint.authToken}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: ++id, method: 'tools/call', params: { name, arguments: args } }) })
      const result = ((await response.json()) as any).result
      expect(result.isError, result.content[0].text).not.toBe(true)
      return JSON.parse(result.content[0].text)
    }
    const text = async () => (await value('montree_text_read', { documentPath: md, target: 'document' })).text as string

    // 逐句审阅
    const state = await value('montree_text_read', { documentPath: md })
    const from = (await text()).indexOf(paragraph)
    await value('montree_text_propose', { documentPath: md, revision: state.revision, expectedCount: 1, edits: [{ from, to: from + paragraph.length, expectedText: paragraph,
      text: '春天终于来了。花开得很好。We strolled to the park. It was bright and sunny.' }] })
    await expect(editor.locator('.cm-ai-proposal-del')).toHaveCount(1)
    await page.getByTestId('proposal-panel-toggle').click()
    const panel = page.getByTestId('proposal-review-panel')
    await expect(panel).toBeVisible()
    await expect(panel.getByTestId('proposal-panel-item')).toHaveCount(1)
    await shot(page, info, 'side-panel.png')
    await editor.locator('[data-proposal-action="hunks"]').first().click()
    await expect(editor.locator('.cm-ai-hunk')).toHaveCount(3)
    await editor.locator('[data-proposal-action="hunk-accept"][data-hunk-index="0"]').click()
    await editor.locator('[data-proposal-action="hunk-reject"][data-hunk-index="1"]').click()
    await editor.locator('[data-proposal-action="hunk-accept"][data-hunk-index="2"]').click()
    await shot(page, info, 'sentence-review.png')
    await editor.locator('[data-proposal-action="hunks-commit"]').click()
    expect(await text()).toBe('# 笔记\n\n春天终于来了。花开得很好。We walked to the park. It was bright and sunny.\n\n')
    await expect(page.getByTestId('proposal-review-bar')).toHaveCount(0)
    await editor.click(); await page.keyboard.press('Control+z')
    expect(await text()).toBe(`# 笔记\n\n${paragraph}\n\n`)

    // 撤销后建议回到待审；全部拒绝后关闭面板
    await expect(page.getByTestId('proposal-review-count')).toHaveText('1 处修改建议')
    await page.getByTestId('proposal-reject-current').click()
    await expect(page.getByTestId('proposal-review-bar')).toHaveCount(0)

    // 选区工具栏
    await editor.locator('.cm-line').filter({ hasText: '春天来了' }).click()
    await page.keyboard.press('Home'); await page.keyboard.press('Shift+End')
    const toolbar = page.locator('.cm-ai-selection-toolbar')
    await expect(toolbar).toBeVisible()
    await expect(toolbar.locator('[data-selection-action]')).toHaveCount(6)
    await shot(page, info, 'selection-toolbar.png')
    await page.keyboard.press('Control+j')
    await expect(toolbar.locator('input')).toBeFocused()
    await page.keyboard.press('Escape')

    // 行内补全（模拟模型）
    await page.keyboard.press('Control+End')
    await page.keyboard.type('The quick brown')
    const ghost = editor.locator('.cm-ai-ghost')
    await expect(ghost).toContainText('fox jumps')
    await shot(page, info, 'ghost-text-completion.png')
    await page.keyboard.press('Tab')
    await expect(ghost).toHaveCount(0)
    expect(await text()).toContain('The quick brown fox jumps over the lazy dog.')
  } finally {
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().forEach((window) => window.removeAllListeners('close')))
    await app.close()
  }
})
