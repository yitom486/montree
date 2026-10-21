import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test, expect, type ElectronApplication, type Page } from '@playwright/test'
import { launchBuiltApp } from './helpers/launch-app'

async function openWorkspaceFile(page: Page, file: string) {
  await page.getByRole('button', { name: '更多操作', exact: true }).click()
  await page.getByRole('menuitem', { name: /打开文件夹/ }).click()
  await page.keyboard.press('Control+p')
  const dialog = page.getByRole('dialog', { name: '快速打开文件' })
  await dialog.getByPlaceholder('搜索工作区文件或电子书...').fill(file)
  await dialog.getByRole('button').filter({ hasText: file }).click()
  await expect(dialog).toBeHidden()
  await expect(page.locator('.cm-editor')).toBeVisible()
}
async function endpointFor(app: ElectronApplication, page: Page) {
  const marker = `w-${Math.random().toString(36).slice(2)}`
  await page.evaluate((name) => { window.name = name }, marker)
  return app.evaluate(async ({ BrowserWindow }, name) => {
    for (const window of BrowserWindow.getAllWindows()) {
      if (await window.webContents.executeJavaScript('window.name') === name) return (globalThis as any).__montreeE2eMcpEndpointForWindow(window.webContents.id)
    }
    throw new Error('window not found')
  }, marker)
}
function client(endpoint: { url: string; authToken: string }) {
  let id = 0
  return async (name: string, args: Record<string, unknown>) => {
    const response = await fetch(endpoint.url, { method: 'POST', headers: { Authorization: `Bearer ${endpoint.authToken}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: ++id, method: 'tools/call', params: { name, arguments: args } }) })
    const result = ((await response.json()) as any).result
    return { isError: result.isError === true, value: JSON.parse(result.content[0].text.startsWith('{') ? result.content[0].text : '{}'), text: result.content[0].text as string }
  }
}

test('修改建议按窗口隔离：同一文件在两个窗口中，各自 MCP 只影响本窗口', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'montree-proposals-mw-'))
  const md = join(workspace, 'shared.md')
  await writeFile(md, 'alpha beta gamma\n')
  const app = await launchBuiltApp({ E2E_AUTO_OPEN_PATH: workspace, E2E_DOCUMENT_TOOLS: '1' })
  try {
    const first = await app.firstWindow()
    await openWorkspaceFile(first, 'shared.md')
    const secondPromise = app.waitForEvent('window')
    await first.keyboard.press('Control+Shift+N')
    const second = await secondPromise
    await second.waitForLoadState('domcontentloaded')
    await openWorkspaceFile(second, 'shared.md')

    const call1 = client(await endpointFor(app, first)), call2 = client(await endpointFor(app, second))
    const read1 = await call1('montree_text_read', { documentPath: md })
    const created = await call1('montree_text_propose', { documentPath: md, revision: read1.value.revision, expectedCount: 1, edits: [{ from: 6, to: 10, expectedText: 'beta', text: 'BETA' }] })
    expect(created.isError, created.text).toBe(false)
    await expect(first.locator('.cm-ai-proposal-del')).toHaveCount(1)
    await expect(second.locator('.cm-ai-proposal')).toHaveCount(0)
    await expect(second.getByTestId('proposal-review-bar')).toHaveCount(0)

    // 窗口 2 自己的版本号；用窗口 1 的 revision 调用窗口 2 必须被拒绝
    const stale = await call2('montree_text_propose', { documentPath: md, revision: read1.value.revision, expectedCount: 1, edits: [{ from: 0, to: 5, expectedText: 'alpha', text: 'A' }] })
    const read2 = await call2('montree_text_read', { documentPath: md })
    if (read2.value.revision !== read1.value.revision) expect(stale.isError).toBe(true)
    const own = await call2('montree_text_propose', { documentPath: md, revision: read2.value.revision, expectedCount: 1, edits: [{ from: 11, to: 16, expectedText: 'gamma', text: 'GAMMA' }] })
    expect(own.isError, own.text).toBe(false)
    await expect(second.locator('.cm-ai-proposal-del')).toHaveCount(stale.isError ? 1 : 2)
    await expect(first.locator('.cm-ai-proposal-del')).toHaveCount(1)

    // 在窗口 1 接受只改窗口 1 的缓冲区
    await first.locator('[data-proposal-action="accept"]').click()
    expect((await call1('montree_text_read', { documentPath: md, target: 'document' })).value.text).toBe('alpha BETA gamma\n')
    expect((await call2('montree_text_read', { documentPath: md, target: 'document' })).value.text).toBe('alpha beta gamma\n')
    await expect(second.locator('.cm-ai-proposal-del').first()).toBeVisible()
  } finally {
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().forEach((window) => window.removeAllListeners('close')))
    await app.close()
  }
})
