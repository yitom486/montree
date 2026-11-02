import { mkdtemp, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { expect, test } from '@playwright/test'
import { launchBuiltApp } from './helpers/launch-app'
import { screenshotWithoutToasts } from './helpers/screenshot'

const markdown = [
  '---',
  'title: 比特漫笔',
  'category_id: 019cc173-5ef7',
  'cover: cover.svg',
  'excerpt: 记录技术之外的火花。',
  'sort: 5',
  '---',
  '',
  '# 比特漫笔：拾起逻辑边缘的火花',
  '',
  '这里记录的是对技术的一些“非标准”思考。',
  '',
  '## 关于这个栏目',
  '',
  '正文段落。',
  '',
  '## 我想聊聊的',
  '',
  '- 技术考古',
  '- 二进制诗学',
].join('\n')

test('Frontmatter 预览省略、所见即所得卡片、右侧目录与图片阅读器', async ({}, info) => {
  test.setTimeout(120_000)
  const workspace = await mkdtemp(join(tmpdir(), 'montree-frontmatter-outline-'))
  await writeFile(join(workspace, 'frontmatter.md'), markdown)
  await writeFile(
    join(workspace, 'cover.svg'),
    '<svg xmlns="http://www.w3.org/2000/svg" width="320" height="180"><rect width="320" height="180" fill="#337d67"/><text x="24" y="96" fill="white" font-size="28">Montree</text></svg>',
  )
  const app = await launchBuiltApp({ E2E_AUTO_OPEN_PATH: workspace })
  try {
    const page = await app.firstWindow()
    const errors: string[] = []
    page.on('pageerror', (error) => errors.push(error.message))
    await page.waitForLoadState('domcontentloaded')
    await page.getByRole('button', { name: '更多操作', exact: true }).click()
    await page.getByRole('menuitem', { name: /打开文件夹/ }).click()

    const openFile = async (file: string) => {
      await page.keyboard.press('Control+p')
      const dialog = page.getByRole('dialog', { name: '快速打开文件' })
      await dialog.getByPlaceholder('搜索工作区文件或电子书...').fill(file)
      await expect(dialog.getByText(file).first()).toBeVisible()
      await page.keyboard.press('Enter')
      await expect(dialog).toBeHidden()
    }

    await openFile('frontmatter.md')

    // 默认所见即所得；源码入口位于文档左下角，源码编辑才启用双栏。
    const modeTools = page.getByRole('toolbar', { name: '文档编辑模式' })
    const modeToggle = modeTools.getByRole('button', { name: '编辑器所见即所得模式切换' })
    await expect(modeToggle).toHaveAttribute('data-editor-mode', 'live-preview')
    await expect(page.getByRole('group', { name: '视图模式', exact: true })).toHaveCount(0)
    await expect(page.locator('.markdown-preview.markdown-reading')).toHaveCount(0)
    await modeToggle.click()
    await expect(modeToggle).toHaveAttribute('data-editor-mode', 'source')
    await expect(page.locator('.cm-editor')).toBeVisible()
    await expect(page.locator('.markdown-preview.markdown-reading')).toBeVisible()
    await screenshotWithoutToasts(page, info.outputPath('markdown-source-split.png'))
    await modeToggle.click()
    await expect(modeToggle).toHaveAttribute('data-editor-mode', 'live-preview')
    await expect(page.locator('.markdown-preview.markdown-reading')).toHaveCount(0)
    await screenshotWithoutToasts(page, info.outputPath('markdown-default-live.png'))

    // 阅读预览：frontmatter 原文整段省略。
    await page.keyboard.press('Control+3')
    const preview = page.locator('.markdown-preview.markdown-reading')
    await expect(preview.getByRole('heading', { name: '比特漫笔：拾起逻辑边缘的火花' })).toBeVisible()
    await expect(preview).not.toContainText('category_id:')
    await expect(preview).not.toContainText('title: 比特漫笔')

    // 页内目录：正文标题、当前项加粗高亮、点击跳转、可折叠并重新展开。
    const outline = page.getByRole('region', { name: '文档目录' })
    await expect(outline).toBeVisible()
    // 目录属于文档工具栏下的正文区域，工具栏横跨正文与目录两列。
    const toolbarBox = (await page.getByRole('navigation', { name: '文件路径' }).locator('..').boundingBox())!
    const outlineBox = (await outline.boundingBox())!
    expect(outlineBox.y).toBeGreaterThanOrEqual(toolbarBox.y + toolbarBox.height + 8)
    expect(toolbarBox.x + toolbarBox.width).toBeGreaterThanOrEqual(outlineBox.x + outlineBox.width)
    await expect(page.getByTestId('workspace-document-area').getByRole('region', { name: '文档目录' })).toBeVisible()
    const previewBox = (await preview.boundingBox())!
    expect(outlineBox.x).toBeGreaterThanOrEqual(previewBox.x + previewBox.width)
    const firstHeading = outline.getByRole('button', { name: '比特漫笔：拾起逻辑边缘的火花' })
    const secondHeading = outline.getByRole('button', { name: '关于这个栏目' })
    await expect(firstHeading).toBeVisible()
    await secondHeading.click()
    await expect(secondHeading).toHaveAttribute('aria-current', 'location')
    await screenshotWithoutToasts(page, info.outputPath('outline-integrated-desktop.png'))
    const originalSize = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].getContentSize())
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(1000, 750))
    await expect(secondHeading).toBeVisible()
    const areaBox = (await page.getByTestId('workspace-document-area').boundingBox())!
    const narrowOutlineBox = (await outline.boundingBox())!
    expect(narrowOutlineBox.x + narrowOutlineBox.width).toBeLessThanOrEqual(areaBox.x + areaBox.width)
    await screenshotWithoutToasts(page, info.outputPath('outline-integrated-narrow.png'))
    for (let i = 0; i < 3; i++) {
      if (await page.locator('html').evaluate((element) => element.classList.contains('dark'))) break
      const previousTheme = await page.locator('html').evaluate((element) => ['light', 'sepia', 'dark'].find((theme) => element.classList.contains(theme)))
      await page.getByRole('button', { name: '切换主题', exact: true }).click()
      await expect.poll(() => page.locator('html').evaluate((element) => ['light', 'sepia', 'dark'].find((theme) => element.classList.contains(theme)))).not.toBe(previousTheme)
    }
    await expect(page.locator('html')).toHaveClass(/dark/)
    await expect.poll(() => page.locator('html').evaluate((element) => element.classList.contains('theme-transitioning'))).toBe(false)
    await screenshotWithoutToasts(page, info.outputPath('outline-integrated-dark.png'))
    await app.evaluate(({ BrowserWindow }, [width, height]) => BrowserWindow.getAllWindows()[0].setContentSize(width, height), originalSize)

    await outline.getByRole('button', { name: '收起文档大纲' }).click()
    await expect(outline).toBeHidden()
    await expect(page.getByRole('banner', { name: '应用标题栏' }).getByRole('button', { name: '展开文档目录' })).toHaveCount(0)
    await page.getByTestId('workspace-document-area').getByRole('button', { name: '展开文档目录' }).click()
    await expect(outline).toBeVisible()

    // 所见即所得：frontmatter 变成属性卡片，不再铺原始 key: value。
    await page.keyboard.press('Control+1')
    const editor = page.locator('.cm-editor')
    const card = editor.locator('.cm-live-frontmatter')
    await expect(card).toBeVisible()
    await expect(card).toContainText('比特漫笔')
    await expect(card).toContainText('5 项')
    await expect(editor.locator('.cm-content')).not.toContainText('category_id: 019cc173-5ef7')
    await card.getByRole('button', { name: /展开全部/ }).click()
    await expect(card).toContainText('cover')
    await editor.getByRole('button', { name: '编辑属性源码' }).click()
    await expect(editor.locator('.cm-content')).toContainText('category_id: 019cc173-5ef7')
    await editor.getByRole('button', { name: '完成编辑并预览' }).click()
    await expect(editor.locator('.cm-live-frontmatter')).toBeVisible()

    // 图片文件：工作区扫描入树，打开后进入图片阅读器而非 Markdown 编辑器。
    await modeToggle.click()
    await openFile('cover.svg')
    await expect(page.getByRole('img', { name: 'cover.svg' })).toBeVisible()
    await expect.poll(async () => page.getByRole('img', { name: 'cover.svg' }).evaluate((node: HTMLImageElement) => node.complete && node.naturalWidth > 0)).toBe(true)
    await expect(page.getByRole('button', { name: '编辑器所见即所得模式切换' })).toBeHidden()
    await openFile('frontmatter.md')
    await expect(modeToggle).toHaveAttribute('data-editor-mode', 'live-preview')
    await expect(page.locator('.markdown-preview.markdown-reading')).toHaveCount(0)
    expect(errors).toEqual([])
  } finally {
    await app.close()
  }
})
