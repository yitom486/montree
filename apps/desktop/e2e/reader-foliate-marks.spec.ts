import { mkdtemp } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { test, expect, type Page } from '@playwright/test'
import { launchBuiltApp } from './helpers/launch-app'
import { writeMinimalMobi, writeReaderSmokeWorkspace } from './helpers/ebook-fixture'

/**
 * foliate 统一链路标注回归（E2E_FOLIATE_READER 门控）：
 * closed shadow DOM 下选区/点击走 `window.__montreeE2eReader` 钩子（同一管线），
 * 工具条/面板/弹窗/toast 均为 light DOM 真实断言。
 */

async function openWorkspaceFile(window: Page, fileName: string, query: string): Promise<void> {
  await window.getByRole('button',   { name: '更多操作', exact: true }).click()
  await window.getByRole('menuitem', { name: /打开文件夹/ }).click()
  await expect(window.getByText(fileName).first()).toBeVisible({ timeout: 15_000 })

  await window.keyboard.press('Control+p')
  const dialog = window.getByRole('dialog', { name: '快速打开文件' })
  await expect(dialog).toBeVisible({ timeout: 10_000 })
  await dialog.getByPlaceholder('搜索工作区文件或电子书...').fill(query)
  await expect(dialog.getByText(fileName).first()).toBeVisible({ timeout: 10_000 })
  await window.keyboard.press('Enter')
  await expect(dialog).toBeHidden({ timeout: 10_000 })
}

async function waitForE2eReaderHook(window: Page): Promise<void> {
  await expect(window.locator('#main').locator('foliate-view').first()).toBeAttached({
    timeout: 20_000,
  })
  await expect(window.locator('#main').locator('.foliate-reader-host')).toHaveAttribute(
    'data-e2e-section-text',
    /Montree E2E minimal/,
    { timeout: 20_000 },
  )
  await window.waitForFunction(
    () => typeof window.__montreeE2eReader?.selectText === 'function',
    undefined,
    { timeout: 20_000 },
  )
}

async function e2eSelectText(window: Page, excerpt: string): Promise<void> {
  await waitForE2eReaderHook(window)
  const ok = await window.evaluate(
    (text) => window.__montreeE2eReader?.selectText(text) ?? false,
    excerpt,
  )
  expect(ok).toBe(true)
}

async function e2eListMarks(
  window: Page,
): Promise<Array<{ id: string; kind: string; excerpt?: string }>> {
  return window.evaluate(() => window.__montreeE2eReader?.listMarks() ?? [])
}

test.describe('foliate 标注链路', () => {
  test('EPUB 划重点→面板→检查器→删除全链路', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'montree-e2e-foliate-marks-'))
    const { epubName } = await writeReaderSmokeWorkspace(workspace)
    const app = await launchBuiltApp({
      E2E_AUTO_OPEN_PATH: workspace,
      E2E_FOLIATE_READER: '1',
    })

    try {
      const window = await app.firstWindow()
      await window.waitForLoadState('domcontentloaded')
      await expect(window.getByRole('button',   { name: '更多操作', exact: true })).toBeVisible({
        timeout: 15_000,
      })
      await openWorkspaceFile(window, epubName, 'smoke-sample.epub')
      await expect(window.locator('#main').locator('foliate-view').first()).toBeAttached({
        timeout: 20_000,
      })

      // 划重点
      await e2eSelectText(window, 'Montree E2E minimal EPUB paragraph.')
      const toolbar = window.getByRole('toolbar', { name: '选区操作' })
      await expect(toolbar).toBeVisible({ timeout: 10_000 })
      await toolbar.getByRole('button', { name: '划重点 黄' }).click()
      await expect(window.getByText('已添加高亮')).toBeVisible({ timeout: 10_000 })
      await window.locator('#main').screenshot({ path: 'test-results/foliate-highlight.png' })

      // 面板列出该标记（正文在 closed shadow 内，light DOM 唯一匹配即面板项）
      // 工具栏按钮已改名「批注簿」（旧名「书签与批注」是阶段 9 前的叫法）
      await window.getByRole('button', { name: '批注簿' }).click()
      await expect(window.getByText('Montree E2E minimal EPUB paragraph.').first()).toBeVisible({
        timeout: 10_000,
      })

      // 检查器（经 overlay 点击同链路）→ 删除
      const marks = await e2eListMarks(window)
      expect(marks).toHaveLength(1)
      const opened = await window.evaluate(
        (id) => window.__montreeE2eReader?.clickMark(id) ?? false,
        marks[0]!.id,
      )
      expect(opened).toBe(true)
      const popover = window.getByRole('dialog', { name: '标记操作' })
      await expect(popover).toBeVisible({ timeout: 10_000 })
      await popover.getByRole('button', { name: '删除' }).click()
      await expect(window.getByText('已删除')).toBeVisible({ timeout: 10_000 })
      expect(await e2eListMarks(window)).toHaveLength(0)
    } finally {
      await app.close()
    }
  })

  test('EPUB 写批注落盘', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'montree-e2e-foliate-marks-'))
    const { epubName } = await writeReaderSmokeWorkspace(workspace)
    const app = await launchBuiltApp({
      E2E_AUTO_OPEN_PATH: workspace,
      E2E_FOLIATE_READER: '1',
    })

    try {
      const window = await app.firstWindow()
      await window.waitForLoadState('domcontentloaded')
      await expect(window.getByRole('button',   { name: '更多操作', exact: true })).toBeVisible({
        timeout: 15_000,
      })
      await openWorkspaceFile(window, epubName, 'smoke-sample.epub')
      await expect(window.locator('#main').locator('foliate-view').first()).toBeAttached({
        timeout: 20_000,
      })

      await e2eSelectText(window, 'Montree E2E minimal EPUB paragraph.')
      const toolbar = window.getByRole('toolbar', { name: '选区操作' })
      await expect(toolbar).toBeVisible({ timeout: 10_000 })
      await toolbar.getByRole('button', { name: '批注' }).click()

      const dialog = window.getByRole('dialog', { name: '添加批注' })
      await expect(dialog).toBeVisible({ timeout: 10_000 })
      await dialog.getByPlaceholder('写下你的想法…').fill('e2e 批注内容')
      await dialog.getByRole('button', { name: '保存' }).click()
      await expect(window.getByText('已保存批注')).toBeVisible({ timeout: 10_000 })

      const marks = await e2eListMarks(window)
      expect(marks).toHaveLength(1)
    } finally {
      await app.close()
    }
  })

  test('EPUB 添加书签落盘', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'montree-e2e-foliate-marks-'))
    const { epubName } = await writeReaderSmokeWorkspace(workspace)
    const app = await launchBuiltApp({
      E2E_AUTO_OPEN_PATH: workspace,
      E2E_FOLIATE_READER: '1',
    })

    try {
      const window = await app.firstWindow()
      await window.waitForLoadState('domcontentloaded')
      await expect(window.getByRole('button',   { name: '更多操作', exact: true })).toBeVisible({
        timeout: 15_000,
      })
      await openWorkspaceFile(window, epubName, 'smoke-sample.epub')
      await expect(window.locator('#main').locator('foliate-view').first()).toBeAttached({
        timeout: 20_000,
      })

      // 工具栏按钮已改名「加书签」（旧名「添加书签」是阶段 9 前的叫法）
      await window.getByRole('button', { name: '加书签' }).click()
      await expect(window.getByText('已添加书签')).toBeVisible({ timeout: 10_000 })

      const marks = await e2eListMarks(window)
      expect(marks).toHaveLength(1)
      expect(marks[0]?.kind).toBe('bookmark')

      await window.getByRole('button', { name: '批注簿' }).click()
      await expect(window.getByText('第 1 节').first()).toBeVisible({ timeout: 10_000 })
    } finally {
      await app.close()
    }
  })

  test('MOBI 划重点落盘（mobi 锚点字段）', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'montree-e2e-foliate-marks-'))
    await writeMinimalMobi(join(workspace, 'smoke-sample.mobi'))
    const app = await launchBuiltApp({
      E2E_AUTO_OPEN_PATH: workspace,
      E2E_FOLIATE_READER: '1',
    })

    try {
      const window = await app.firstWindow()
      await window.waitForLoadState('domcontentloaded')
      await expect(window.getByRole('button',   { name: '更多操作', exact: true })).toBeVisible({
        timeout: 15_000,
      })
      await openWorkspaceFile(window, 'smoke-sample.mobi', 'smoke-sample.mobi')
      await expect(window.locator('#main').locator('foliate-view').first()).toBeAttached({
        timeout: 20_000,
      })

      await e2eSelectText(window, 'Montree E2E minimal MOBI paragraph.')
      const toolbar = window.getByRole('toolbar', { name: '选区操作' })
      await expect(toolbar).toBeVisible({ timeout: 10_000 })
      await toolbar.getByRole('button', { name: '划重点 黄' }).click()
      await expect(window.getByText('已添加高亮')).toBeVisible({ timeout: 10_000 })

      const marks = await e2eListMarks(window)
      expect(marks).toHaveLength(1)
    } finally {
      await app.close()
    }
  })
})
