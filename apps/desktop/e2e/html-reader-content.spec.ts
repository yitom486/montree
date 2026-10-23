import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test, expect, type ElectronApplication, type Page } from '@playwright/test'
import { launchBuiltApp } from './helpers/launch-app'

async function snapshot(app: ElectronApplication, resource: string, args?: Record<string, unknown>) {
  return app.evaluate(async (_, payload) => (globalThis as unknown as { __montreeE2eDocumentSnapshot: (resource: string, args?: Record<string, unknown>) => Promise<string> }).__montreeE2eDocumentSnapshot(payload.resource, payload.args), { resource, args })
}

async function open(page: Page, name: string) {
  await page.keyboard.press('Control+p')
  const dialog = page.getByRole('dialog', { name: '快速打开文件' })
  await dialog.getByPlaceholder('搜索工作区文件或电子书...').fill(name)
  await expect(dialog.getByText(name, { exact: true }).first()).toBeVisible()
  await page.keyboard.press('Enter')
  await expect(dialog).toBeHidden()
}

test('本地 HTML 通过阅读工具返回渲染后的纯文本而不是源码', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'montree-html-reader-'))
  await writeFile(join(workspace, 'page.html'), `<!doctype html>
<html><body>
  <nav>导航文本</nav>
  <h1>HTML 架构总览</h1>
  <p>HTML needle</p>
  <div class="hidden">隐藏文本</div>
  <script>
    document.body.insertAdjacentHTML('beforeend', '<p>SCRIPT-RENDERED</p>')
    document.querySelector('.hidden').style.display = 'none'
  </script>
  <style>.hidden { display: none }</style>
</body></html>`)
  const app = await launchBuiltApp({ E2E_AUTO_OPEN_PATH: workspace, E2E_DOCUMENT_TOOLS: '1' })
  try {
    const page = await app.firstWindow()
    await page.getByRole('button', { name: '更多操作', exact: true }).click()
    await page.getByRole('menuitem', { name: /打开文件夹/ }).click()
    await open(page, 'page.html')

    await expect.poll(() => snapshot(app, 'chapter.txt')).toContain('SCRIPT-RENDERED')
    const text = await snapshot(app, 'chapter.txt')
    expect(text).toContain('HTML needle')
    expect(text).not.toContain('<h1>')
    expect(text).not.toContain('document.body')
    expect(text).not.toContain('隐藏文本')
    await expect.poll(() => snapshot(app, 'viewport.txt')).toContain('HTML needle')
    expect(await snapshot(app, 'search', { query: 'SCRIPT-RENDERED' })).toContain('SCRIPT-RENDERED')
    const toc = JSON.parse(await snapshot(app, 'toc.json'))
    expect(toc.entries[0]).toMatchObject({ label: 'HTML 架构总览', level: 1 })
    expect(await snapshot(app, 'chapter', { flatIndex: 0 })).toContain('HTML needle')
  } finally {
    await app.close()
  }
})
