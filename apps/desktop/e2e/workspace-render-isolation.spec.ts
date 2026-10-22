import { mkdtemp, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { mkdir } from 'node:fs/promises'
import { test, expect, type Page } from '@playwright/test'
import { launchBuiltApp } from './helpers/launch-app'
import { writeReaderSmokeWorkspace } from './helpers/ebook-fixture'
import { seedMockChatThread } from './helpers/seed-chat'
import { webDocFixtureDir } from './helpers/web-doc-fixture'

const shotDir = process.env.ROUND3_SCREENSHOT_DIR

async function quickOpen(page: Page, query: string) {
  await page.keyboard.press('Control+p')
  const dialog = page.getByRole('dialog', { name: '快速打开文件' })
  await dialog.getByPlaceholder('搜索工作区文件或电子书...').fill(query)
  await dialog.getByRole('button').filter({ hasText: query }).first().click()
  await expect(dialog).toBeHidden()
}
type Box = { x: number; y: number; width: number; height: number }
async function frames(page: Page): Promise<{ agent: Box; doc: Box; renders: number }> {
  return page.evaluate(() => {
    const box = (id: string) => { const r = document.querySelector(`[data-testid="${id}"]`)!.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height } }
    return { agent: box('workspace-agent-frame'), doc: box('workspace-document-frame'), renders: window.__montreeRenderCounts?.['agent-panel'] ?? 0 }
  })
}
async function shot(page: Page, name: string) {
  if (!shotDir) return
  await mkdir(shotDir, { recursive: true })
  await page.screenshot({ path: join(shotDir, name) })
}

test('切换文档（md→pdf→在线文档→本地 md）与 Mermaid 渲染：聊天面板零重渲染、外框零位移', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'montree-isolation-'))
  const { mdName, pdfName } = await writeReaderSmokeWorkspace(workspace)
  await writeFile(join(workspace, 'plain-note.md'), '# Plain\n\n' + 'Lorem ipsum dolor sit amet. '.repeat(400) + '\n')
  const app = await launchBuiltApp({ E2E_AUTO_OPEN_PATH: workspace, E2E_WEB_DOC_FIXTURE_DIR: webDocFixtureDir() })
  try {
    const page = await app.firstWindow()
    await page.waitForLoadState('domcontentloaded')
    await seedMockChatThread(page, { id: 'isolation-thread', title: '隔离' })
    await page.getByRole('button', { name: '更多操作', exact: true }).click()
    await page.getByRole('menuitem', { name: /打开文件夹/ }).click()
    await expect(page.getByText(mdName).first()).toBeVisible({ timeout: 15_000 })
    await expect(page.getByTestId('workspace-agent-frame')).toBeVisible()

    await quickOpen(page, mdName)
    await expect(page.locator('#main [data-testid="mermaid-block"] svg[id]').first()).toBeVisible({ timeout: 20_000 })
    await page.waitForTimeout(800)
    const base = await frames(page)
    // 150% 缩放下 1280 物理像素宽的屏幕只有约 850 CSS 像素，面板最小宽度随之变窄
    expect(base.agent.width).toBeGreaterThan(120)

    const check = async (label: string) => {
      await page.waitForTimeout(600)
      const now = await frames(page)
      expect(now.agent, `${label}: 聊天面板外框`).toEqual(base.agent)
      expect(now.doc, `${label}: 工作区外框`).toEqual(base.doc)
      expect(now.renders - base.renders, `${label}: 聊天面板重渲染次数`).toBe(0)
    }

    // Mermaid 实时预览中编辑：块内源码改动 → 重新渲染
    const editor = page.locator('#main .cm-content')
    await editor.locator('.cm-line').filter({ hasText: 'Inline math' }).click()
    await page.keyboard.press('End'); await page.keyboard.type(' typing while mermaid renders')
    await check('Markdown 输入 + Mermaid')

    await page.keyboard.press('Control+s')
    await page.waitForTimeout(300)
    await quickOpen(page, pdfName)
    await expect(page.locator('#main canvas').first()).toBeVisible({ timeout: 20_000 })
    await shot(page, 'isolation-pdf.png')
    await check('切到 PDF')

    const urlField = page.getByPlaceholder('https://react.dev/learn').first()
    await urlField.fill('https://e2e.montree.test/book/primitives.html')
    await urlField.press('Enter')
    await expect(page.frameLocator('.web-doc-viewer-host iframe').getByRole('heading', { name: 'Primitives', exact: true })).toBeVisible({ timeout: 20_000 })
    await shot(page, 'isolation-webdoc.png')
    await check('切到在线文档')

    await quickOpen(page, 'plain-note.md')
    await expect(page.locator('#main .cm-content')).toContainText('Lorem ipsum')
    await shot(page, 'isolation-local-md.png')
    await check('切回本地 Markdown')
  } finally {
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().forEach((window) => window.removeAllListeners('close')))
    await app.close()
  }
})
