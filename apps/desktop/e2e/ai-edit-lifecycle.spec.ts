import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test, expect, type ElectronApplication, type Page } from '@playwright/test'
import { launchBuiltApp } from './helpers/launch-app'
import { connectMockAgent, mockAgentEnv } from './helpers/mock-agent'
import { screenshotWithoutToasts } from './helpers/screenshot'

// 新用例不允许靠重试掩盖抖动（全局 CI retries=1 对本文件关闭）
test.describe.configure({ retries: 0 })

async function close(app: ElectronApplication) {
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().forEach((window) => window.removeAllListeners('close')))
  await app.close()
}
async function open(page: Page, file: string) {
  await page.keyboard.press('Control+p')
  const dialog = page.getByRole('dialog', { name: '快速打开文件' })
  await dialog.getByPlaceholder('搜索工作区文件或电子书...').fill(file)
  await dialog.getByRole('button').filter({ hasText: file }).click()
  await expect(dialog).toBeHidden()
}

test('修改建议按 MCP _meta toolCallId 去重；审阅模式拦截直接编辑；清空对话撤回全部未处理建议', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'montree-proposal-life-'))
  const md = join(workspace, 'life.md')
  const source = 'Alpha beta gamma.\n\nDelta epsilon zeta.\n\nEta theta.\n'
  await writeFile(md, source)
  const app = await launchBuiltApp(mockAgentEnv(workspace, { E2E_DOCUMENT_TOOLS: '1' }))
  try {
    const page = await app.firstWindow()
    await page.waitForLoadState('domcontentloaded')
    await connectMockAgent(page, 'life-thread')
    await page.getByRole('button', { name: '更多操作', exact: true }).click()
    await page.getByRole('menuitem', { name: /打开文件夹/ }).click()
    await open(page, 'life.md'); await expect(page.locator('.cm-editor')).toBeVisible()
    // 设置里打开审阅模式（真实 UI 路径）
    await page.keyboard.press('Control+Comma')
    const review = page.getByRole('switch', { name: '审阅模式' })
    await review.scrollIntoViewIfNeeded()
    await review.click()
    await expect(review).toHaveAttribute('aria-checked', 'true')
    await page.keyboard.press('Escape')
    await expect(review).toBeHidden()

    const endpoint = await app.evaluate(async () => (globalThis as any).__montreeE2eMcpEndpoint())
    let id = 0
    const call = async (name: string, args: Record<string, unknown>, toolCallId?: string) => {
      const params = { name, arguments: args, ...(toolCallId ? { _meta: { toolCallId } } : {}) }
      const response = await fetch(endpoint.url, { method: 'POST', headers: { Authorization: `Bearer ${endpoint.authToken}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: ++id, method: 'tools/call', params }) })
      const result = ((await response.json()) as any).result
      expect(result.isError, result.content[0].text).not.toBe(true)
      return JSON.parse(result.content[0].text)
    }
    const read = async () => call('montree_text_read', { documentPath: md, target: 'document' }) as Promise<{ text: string; revision: number }>
    const count = page.getByTestId('proposal-review-count')
    const edit = (word: string, text: string) => { const from = source.indexOf(word); return { from, to: from + word.length, expectedText: word, text } }

    const { revision } = await call('montree_text_read', { documentPath: md })
    const first = await call('montree_text_propose', { documentPath: md, revision, expectedCount: 1, edits: [edit('beta', 'BETA')] }, 'tc-propose-1')
    expect(first).toMatchObject({ status: 'proposal_created' })
    await expect(count).toHaveText('1 处修改建议')
    // 同一 toolCallId 重放（Agent 重试/迟到事件）：返回已有批次，不新建卡片
    const replay = await call('montree_text_propose', { documentPath: md, revision, expectedCount: 1, edits: [edit('beta', 'BETA')] }, 'tc-propose-1')
    expect(replay.proposalIds ?? replay.ids ?? null).toEqual(first.proposalIds ?? first.ids ?? null)
    await expect(count).toHaveText('1 处修改建议')
    await call('montree_text_propose', { documentPath: md, revision, expectedCount: 1, edits: [edit('epsilon', 'EPSILON')] }, 'tc-propose-2')
    await expect(count).toHaveText('2 处修改建议')

    // 审阅模式：直接编辑被拦截为待确认建议，文档不变
    await call('montree_text_edit', { documentPath: md, revision, expectedCount: 1, edits: [edit('theta', 'THETA')] }, 'tc-edit-1')
    await expect(count).toHaveText('3 处修改建议')
    expect((await read()).text).toBe(source)
    await expect(page.locator('.cm-content .cm-ai-proposal-del')).toHaveCount(3)
    const dir = process.env.ROUND4_SCREENSHOT_DIR
    if (dir) await screenshotWithoutToasts(page, join(dir, 'proposal-review-mode.png'))

    // 清空当前对话：该线程的建议全部撤回，附可见说明，不提交任何修改
    await page.getByRole('button', { name: '更多面板操作', exact: true }).click()
    await page.getByRole('menuitem', { name: '清空当前对话' }).click()
    await expect(page.getByTestId('proposal-notice')).toContainText('对话已清空，已撤回 3 处修改建议')
    await expect(page.locator('.cm-content .cm-ai-proposal-del')).toHaveCount(0)
    expect((await read()).text).toBe(source)
    if (dir) await screenshotWithoutToasts(page, join(dir, 'proposal-withdrawn.png'))
  } finally {
    await close(app)
  }
})
