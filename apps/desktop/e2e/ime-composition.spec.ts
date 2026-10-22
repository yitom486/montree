import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test, expect, type Page } from '@playwright/test'
import { launchBuiltApp } from './helpers/launch-app'
import { seedMockChatThread } from './helpers/seed-chat'

// 新用例不允许靠重试掩盖抖动（全局 CI retries=1 对本文件关闭）
test.describe.configure({ retries: 0 })

/** 用 CDP Input.imeSetComposition / Input.insertText 走真实 composition 事件链（compositionstart/update/end）。 */
async function compose(page: Page, steps: string[], commit: string) {
  const cdp = await page.context().newCDPSession(page)
  for (const step of steps) {
    await cdp.send('Input.imeSetComposition', { text: step, selectionStart: step.length, selectionEnd: step.length })
    await page.waitForTimeout(60)
  }
  await cdp.send('Input.insertText', { text: commit })
  await cdp.detach()
}

test('输入法组合输入：编辑器（含实时预览行）与聊天输入框，提交后文本恰好一次、无拼音残留、保存正确', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'montree-ime-'))
  const md = join(workspace, 'ime.md')
  await writeFile(md, '# 标题\n\n正文 **粗体** 结尾\n')
  const app = await launchBuiltApp({ E2E_AUTO_OPEN_PATH: workspace })
  try {
    const page = await app.firstWindow()
    await page.waitForLoadState('domcontentloaded')
    await seedMockChatThread(page, { id: 'ime-thread', title: 'IME' })
    await page.getByRole('button', { name: '更多操作', exact: true }).click()
    await page.getByRole('menuitem', { name: /打开文件夹/ }).click()
    await page.keyboard.press('Control+p')
    const dialog = page.getByRole('dialog', { name: '快速打开文件' })
    await dialog.getByPlaceholder('搜索工作区文件或电子书...').fill('ime.md')
    await dialog.getByRole('button').filter({ hasText: 'ime.md' }).first().click()
    const editor = page.locator('#main .cm-content')
    await expect(editor).toContainText('结尾')

    // 标题行末尾（实时预览会隐藏/显示 # 标记，组合期间不能重排打断输入）
    await editor.locator('.cm-line').filter({ hasText: '标题' }).click()
    await page.keyboard.press('End')
    await compose(page, ['z', 'zh', 'zhong', 'zhong w', 'zhong wen'], '中文')
    // 粗体行中间
    await editor.locator('.cm-line').filter({ hasText: '结尾' }).click()
    await page.keyboard.press('End')
    await compose(page, ['shu', 'shu ru'], '输入')
    await page.keyboard.press('Control+s')
    await expect.poll(async () => readFile(md, 'utf8')).toBe('# 标题中文\n\n正文 **粗体** 结尾输入\n')
    await expect(editor).not.toContainText('zhong')

    // 聊天输入框：组合中按 Enter 不得发送（由输入法消费），提交后文本恰好一次
    const chat = page.getByRole('region', { name: 'Agent 聊天' })
    const box = chat.locator('textarea').first()
    await box.click()
    const cdp = await page.context().newCDPSession(page)
    await cdp.send('Input.imeSetComposition', { text: 'ni hao', selectionStart: 6, selectionEnd: 6 })
    await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 229, nativeVirtualKeyCode: 229 })
    await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 229, nativeVirtualKeyCode: 229 })
    await cdp.send('Input.insertText', { text: '你好' })
    await cdp.detach()
    await expect(box).toHaveValue('你好')
    const dir = process.env.ROUND4_SCREENSHOT_DIR
    if (dir) await page.screenshot({ path: join(dir, 'ime-composition.png') })
  } finally {
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().forEach((window) => window.removeAllListeners('close')))
    await app.close()
  }
})
