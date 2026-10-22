import { mkdtemp, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { test, expect, type Page } from '@playwright/test'
import { launchBuiltApp } from './helpers/launch-app'
import { seedMockChatThread } from './helpers/seed-chat'

// 新用例不允许靠重试掩盖抖动（全局 CI retries=1 对本文件关闭）
test.describe.configure({ retries: 0 })

/**
 * 宽度抖动回归（Windows 经典滚动条 + 125%/150% 缩放时最易出现）：
 * 内容高度在“有无竖向滚动条”临界点、窗口宽度为奇数物理像素时，
 * 外框宽度不得在两个值之间来回跳。用 ResizeObserver 记录静置期间的宽度序列。
 */
async function watchWidths(page: Page, ms: number) {
  return page.evaluate(async (duration) => {
    const ids = ['workspace-agent-frame', 'workspace-document-frame']
    const seen: Record<string, number[]> = {}
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const id = (entry.target as HTMLElement).dataset.testid!
        ;(seen[id] ??= []).push(Math.round(entry.contentRect.width * 100) / 100)
      }
    })
    for (const id of ids) observer.observe(document.querySelector(`[data-testid="${id}"]`)!)
    await new Promise((resolve) => setTimeout(resolve, duration))
    observer.disconnect()
    // 首次回调是注册时的当前尺寸，不算变化
    return Object.fromEntries(ids.map((id) => [id, (seen[id] ?? []).slice(1)]))
  }, ms)
}

test('窗口宽度稳定：滚动条临界内容 + 奇数宽度 + 拖动聊天分隔条后，外框不来回抖动', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'montree-width-'))
  await writeFile(join(workspace, 'edge.md'), '# Edge\n\n' + Array.from({ length: 22 }, (_, i) => `line ${i} ${'宽'.repeat(i % 7)}`).join('\n\n') + '\n')
  const app = await launchBuiltApp({ E2E_AUTO_OPEN_PATH: workspace })
  try {
    const page = await app.firstWindow()
    await page.waitForLoadState('domcontentloaded')
    const scale = await page.evaluate(() => window.devicePixelRatio)
    await seedMockChatThread(page, { id: 'width-thread', title: '宽度' })
    await page.getByRole('button', { name: '更多操作', exact: true }).click()
    await page.getByRole('menuitem', { name: /打开文件夹/ }).click()
    await page.keyboard.press('Control+p')
    const dialog = page.getByRole('dialog', { name: '快速打开文件' })
    await dialog.getByPlaceholder('搜索工作区文件或电子书...').fill('edge.md')
    await dialog.getByRole('button').filter({ hasText: 'edge.md' }).first().click()
    await expect(page.locator('#main .cm-content')).toContainText('line 1 ')
    await expect(page.getByTestId('workspace-agent-frame')).toBeVisible()

    for (const width of [1001, 1137, 1279]) {
      await app.evaluate(({ BrowserWindow }, w) => { const win = BrowserWindow.getAllWindows()[0]; win.setContentSize(w, 701) }, width)
      await page.waitForTimeout(500)
      const changes = await watchWidths(page, 1500)
      expect(changes, `devicePixelRatio=${scale} 宽度=${width} 静置时外框宽度变化`).toEqual({ 'workspace-agent-frame': [], 'workspace-document-frame': [] })
    }

    const handle = page.locator('[data-panel-resize-handle-id], [data-separator], [role="separator"]').first()
    if (await handle.count()) {
      const box = (await handle.boundingBox())!
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
      await page.mouse.down(); await page.mouse.move(box.x - 37.5, box.y + box.height / 2, { steps: 6 }); await page.mouse.up()
      await page.waitForTimeout(500)
      const changes = await watchWidths(page, 1500)
      expect(changes, `devicePixelRatio=${scale} 拖动分隔条后静置`).toEqual({ 'workspace-agent-frame': [], 'workspace-document-frame': [] })
    }
    const dir = process.env.ROUND4_SCREENSHOT_DIR
    if (dir) await page.screenshot({ path: join(dir, `width-stability-${process.platform}-${scale}x.png`) })
  } finally {
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().forEach((window) => window.removeAllListeners('close')))
    await app.close()
  }
})
