import { mkdtemp, writeFile, mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { test, expect } from '@playwright/test'
import { launchBuiltApp } from './helpers/launch-app'

const shotDir = process.env.ROUND3_SCREENSHOT_DIR

test('实时预览 Mermaid：上方输入不重建图、不跳高度；切换源码/预览复用缓存出图', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'montree-mermaid-'))
  const md = ['# 架构', '', '上方段落。', '', '```mermaid', 'flowchart TD', '  A[客户端] --> B{网关}', '  B --> C[服务一]', '  B --> D[服务二]', '  C --> E[(数据库)]', '```', '', '下方段落。', ''].join('\n')
  await writeFile(join(workspace, 'diagram.md'), md)
  const app = await launchBuiltApp({ E2E_AUTO_OPEN_PATH: workspace })
  try {
    const page = await app.firstWindow()
    await page.getByRole('button', { name: '更多操作', exact: true }).click()
    await page.getByRole('menuitem', { name: /打开文件夹/ }).click()
    await page.keyboard.press('Control+p')
    const dialog = page.getByRole('dialog', { name: '快速打开文件' })
    await dialog.getByPlaceholder('搜索工作区文件或电子书...').fill('diagram.md')
    await dialog.getByRole('button').filter({ hasText: 'diagram.md' }).click()
    const block = page.locator('#main .cm-live-block[data-preview-kind="fence"]')
    const svg = block.locator('[data-testid="mermaid-block"] svg[id]')
    await expect(svg).toBeVisible({ timeout: 20_000 })
    await expect(svg).toHaveAttribute('data-montree-renderer', 'pele')
    await page.waitForTimeout(500)

    // 监视：图节点被移除次数 + 块高度变化
    await page.evaluate(() => {
      const host = document.querySelector('#main .cm-live-block[data-preview-kind="fence"]')!
      const state = { removed: 0, heights: new Set<number>(), svg: host.querySelector('svg[id]') }
      ;(window as any).__mermaidWatch = state
      new MutationObserver((records) => { for (const r of records) for (const n of r.removedNodes) if (n instanceof Element && (n.matches('svg') || n.querySelector('svg') || n.classList.contains('cm-live-block'))) state.removed++ })
        .observe(document.querySelector('#main .cm-content')!, { childList: true, subtree: true })
      new ResizeObserver(() => state.heights.add(Math.round(host.getBoundingClientRect().height))).observe(host)
    })
    const before = await block.boundingBox()

    await page.locator('#main .cm-line').filter({ hasText: '上方段落' }).click()
    await page.keyboard.press('End')
    await page.keyboard.type('在 Mermaid 上方持续输入，图不应重建或跳动。', { delay: 15 })
    await page.keyboard.press('Enter'); await page.keyboard.type('新的一行')
    await page.waitForTimeout(500)

    const watch = await page.evaluate(() => { const w = (window as any).__mermaidWatch; return { removed: w.removed, heights: [...w.heights], same: w.svg === document.querySelector('#main .cm-live-block[data-preview-kind="fence"] svg[id]') } })
    expect(watch.removed, '图节点被移除').toBe(0)
    expect(watch.same, 'SVG 仍是同一节点').toBe(true)
    expect(watch.heights.length, `块高度变化: ${watch.heights}`).toBeLessThanOrEqual(1)
    const after = await block.boundingBox()
    expect(after!.height).toBe(before!.height)
    if (shotDir) { await mkdir(shotDir, { recursive: true }); await page.screenshot({ path: join(shotDir, 'mermaid-live-preview.png') }) }

    // 进入源码编辑再退出：缓存命中，首帧即出图（无加载态）
    await block.getByRole('button', { name: '编辑源码' }).click({ force: true }).catch(async () => { await page.locator('#main .cm-line').filter({ hasText: '下方段落' }).click(); await page.keyboard.press('ArrowUp'); await page.keyboard.press('ArrowUp') })
    await expect(page.locator('#main .cm-live-source-block').first()).toBeVisible()
    await page.locator('#main .cm-line').filter({ hasText: '下方段落' }).click()
    await expect(svg).toBeVisible()
    expect(await block.locator('.animate-spin').count()).toBe(0)
    expect((await block.boundingBox())!.height).toBe(before!.height)
  } finally {
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().forEach((window) => window.removeAllListeners('close')))
    await app.close()
  }
})
