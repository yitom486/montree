import { mkdtemp } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { test, expect, type Page } from '@playwright/test'
import { launchBuiltApp } from './helpers/launch-app'
import { writeReaderSmokeWorkspace } from './helpers/ebook-fixture'
import { seedMockChatThread } from './helpers/seed-chat'

async function quickOpen(page: Page, name: string) {
  await page.keyboard.press('Control+p')
  const dialog = page.getByRole('dialog', { name: '快速打开文件' })
  await dialog.getByPlaceholder('搜索工作区文件或电子书...').fill(name)
  await dialog.getByRole('button').filter({ hasText: name }).first().click()
  await expect(dialog).toBeHidden()
}

test('卡片流与 AI 共用一栏：切换保留草稿、正文宽度不变、窄窗控件不互相遮挡', async ({}, info) => {
  const workspace = await mkdtemp(join(tmpdir(), 'montree-companion-'))
  const { pdfName, mdName } = await writeReaderSmokeWorkspace(workspace)
  const app = await launchBuiltApp({ E2E_AUTO_OPEN_PATH: workspace })
  try {
    const page = await app.firstWindow()
    await page.waitForLoadState('domcontentloaded')
    await seedMockChatThread(page, { id: 'companion-thread', title: '布局回归' }, { theme: 'light' })
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(1500, 850))
    await page.getByRole('button', { name: '更多操作', exact: true }).click()
    await page.getByRole('menuitem', { name: /打开文件夹/ }).click()
    await quickOpen(page, pdfName)
    await expect(page.locator('#main canvas').first()).toBeVisible()
    for (const name of ['批注簿', '加书签', '卡片流', '札记箱', '听书', '考考我', '沉浸阅读']) {
      await expect(page.getByTestId('reader-toolbar').getByRole('button', { name, exact: true })).toHaveCount(0)
    }
    await expect(page.getByTestId('reader-toolbar').getByRole('button', { name: '更多工具', exact: true })).toHaveCount(1)

    const companion = page.getByTestId('workspace-companion-panel')
    const chatTab = companion.getByRole('tab', { name: 'AI 对话', exact: true })
    const cardsTab = companion.getByRole('tab', { name: '卡片流', exact: true })
    const input = companion.locator('textarea')
    await expect(chatTab).toHaveAttribute('aria-selected', 'true')
    await input.fill('切换卡片流后保留这段草稿')
    const documentFrame = page.getByTestId('workspace-document-frame')
    const before = await documentFrame.boundingBox()
    await page.screenshot({ path: info.outputPath('companion-chat-desktop.png') })

    // 键盘切换走组件库焦点管理；卡片从阅读器 Portal 到同一辅助区。
    await chatTab.focus()
    await page.keyboard.press('ArrowRight')
    await expect(cardsTab).toHaveAttribute('aria-selected', 'true')
    const cards = page.locator('#marginalia-notes-stream')
    await expect(cards).toBeVisible()
    await expect(page.getByTestId('workspace-cards-host').locator('#marginalia-notes-stream')).toHaveCount(1)
    await expect(documentFrame.locator('#marginalia-notes-stream')).toHaveCount(0)
    await expect(input).toBeHidden()
    expect(await documentFrame.boundingBox()).toEqual(before)
    await page.screenshot({ path: info.outputPath('companion-cards-desktop.png') })

    await cards.getByRole('button', { name: '制卡', exact: true }).click()
    await expect(chatTab).toHaveAttribute('aria-selected', 'true')
    await expect(input).toHaveValue('切换卡片流后保留这段草稿')
    await expect(input).toBeFocused()
    await page.getByRole('button', { name: '卡片流', exact: true }).click()
    await expect(cardsTab).toHaveAttribute('aria-selected', 'true')

    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(1000, 750))
    await expect(page.getByTestId('reader-toolbar').getByRole('button', { name: '下一页', exact: true })).toBeVisible()
    const clipped = await page.getByTestId('reader-toolbar').evaluate((toolbar) => {
      const frame = toolbar.getBoundingClientRect()
      const buttons = Array.from(toolbar.querySelectorAll('button')).map((button) => ({
        label: button.getAttribute('aria-label') ?? button.title,
        rect: button.getBoundingClientRect(),
      })).filter(({ rect }) => rect.width > 0 && rect.height > 0)
      const issues = buttons.filter(({ rect }) => rect.left < frame.left - 1 || rect.right > frame.right + 1).map(({ label }) => label)
      for (let i = 0; i < buttons.length; i++) {
        for (const other of buttons.slice(i + 1)) {
          const a = buttons[i].rect
          const b = other.rect
          if (Math.min(a.right, b.right) - Math.max(a.left, b.left) > 1 && Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 1) {
            issues.push(`${buttons[i].label} / ${other.label}`)
          }
        }
      }
      return issues
    })
    expect(clipped).toEqual([])
    await page.screenshot({ path: info.outputPath('companion-cards-narrow.png') })

    await page.getByRole('button', { name: '更多工具', exact: true }).click()
    await page.getByRole('menuitem', { name: '沉浸阅读', exact: true }).click()
    await expect(companion).toBeHidden()
    await page.keyboard.press('Escape')
    await expect(cardsTab).toHaveAttribute('aria-selected', 'true')
    await expect(cards).toBeVisible()

    await page.emulateMedia({ reducedMotion: 'reduce' })
    for (let i = 0; i < 3; i++) {
      if (await page.locator('html').evaluate((element) => element.classList.contains('dark'))) break
      const previousTheme = await page.locator('html').evaluate((element) => ['light', 'sepia', 'dark'].find((theme) => element.classList.contains(theme)))
      await page.getByRole('button', { name: '切换主题', exact: true }).click()
      await expect.poll(() => page.locator('html').evaluate((element) => ['light', 'sepia', 'dark'].find((theme) => element.classList.contains(theme)))).not.toBe(previousTheme)
    }
    await expect(page.locator('html')).toHaveClass(/dark/)
    await expect.poll(() => page.locator('html').evaluate((element) => element.classList.contains('theme-transitioning'))).toBe(false)
    await cardsTab.click()
    await page.screenshot({ path: info.outputPath('companion-cards-dark.png') })
    await chatTab.click()
    await expect(input).toHaveValue('切换卡片流后保留这段草稿')
    await page.screenshot({ path: info.outputPath('companion-chat-dark.png') })
    await cardsTab.click()

    const narrowBefore = await documentFrame.boundingBox()
    await companion.getByRole('button', { name: '收起辅助面板' }).click()
    await expect(companion).toBeHidden()
    await expect.poll(async () => (await documentFrame.boundingBox())!.width).toBeGreaterThan(narrowBefore!.width + 100)
    await page.getByRole('button', { name: 'AI 伴读', exact: true }).click()
    await expect(chatTab).toHaveAttribute('aria-selected', 'true')
    await quickOpen(page, mdName)
    await expect(page.locator('#main .cm-content')).toBeVisible()
    await expect(cardsTab).toBeAttached()
    await expect(input).toBeVisible()
  } finally {
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().forEach((window) => window.removeAllListeners('close')))
    await app.close()
  }
})
