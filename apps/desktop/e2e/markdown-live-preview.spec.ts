import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { expect, test, type Locator } from '@playwright/test'
import { launchBuiltApp } from './helpers/launch-app'

const source = [
  '# 实时预览回归', '', '**粗体含 *斜体***，正文保持原始 Markdown。', '',
  '## 链接与引用', '', '- 外链：[Montree 官网](https://example.com)，<https://github.com> 自动链接',
  '- 引用式链接：[这个是引用式][ref1]', '', '[ref1]: https://example.com/report.pdf "报告 PDF"', '',
  '| 名称 | 数值 |', '| :--- | ---: |', '| **Apple** | `a\\|b` |', '| Banana | 42 |', '',
  '<img src=\'./assets/image.svg\' alt="HTML 本地图片" width="240" height="80">', '',
  '![Markdown 本地图片][pic]', '',
  '行内公式 $a+b$ 。', '', '$$', '\\frac{1}{2} + x^2', '$$', '',
  '    ```python', '    # 这不是目录标题', '    print("hello")', '    ```', '',
  '- 列表代码示例', '', '  ```js', '  const indentedCode = 42', '  ```', '',
  '```mermaid', 'graph LR', 'A[输入] --> B[输出]', '```', '',
  '> 普通引用', '>', '> > 嵌套引用', '> > - 引用列表 `code`', '',
  '> [!NOTE]', '> **提示内容**', '', '> [!WARNING]', '> 公式 $x>0$', '',
  '<details>', '<summary>更多内容</summary>', '', '可展开的正文 **折叠粗体**', '',
  '```text', 'folded line 1', 'folded line 2', '```', '',
  '```mermaid', 'graph LR', 'C[折叠输入] --> D[折叠输出]', '```', '',
  '</details>', '', '折叠外部正文', '',
  '<div onclick="window.__liveXss=1"><script>window.__liveXss=2</script><img src="x" onerror="window.__liveXss=3"><a href="javascript:window.__liveXss=4">危险链接</a></div>', '',
  '## 文档结尾', '', '末尾正文', '', '[pic]: ./assets/image.svg',
  '', '![图解静态版本](./assets/image.svg)', '', '<!-- montree-diagram',
  JSON.stringify({ schemaVersion: 1, title: '文档交互流程', diagramType: 'er', nodes: [{ id: 'read', label: '读原文', details: '保留文档中的图解参数', fields: [{ name: 'id', type: 'UUID', key: 'PK' }] }, { id: 'note', label: '整理知识', fields: [{ name: 'id', type: 'UUID', key: 'PK' }, { name: 'book_id', type: 'UUID', key: 'FK' }] }], edges: [{ from: 'read', to: 'note', fromCardinality: '1', toCardinality: '0..*', fromField: 'id', toField: 'book_id' }] }), '-->', '',
  '```montree-ui', JSON.stringify({ schemaVersion: 1, title: '文档本地选择', ui: { root: { component: 'Column', children: [{ component: 'Select', props: { id: 'focus', label: '关注方向', options: [{ value: 'idea', label: '关注观点' }, { value: 'evidence', label: '关注证据' }] } }, { component: 'Button', props: { label: '汇总文档选择', action: 'submit-selection' } }] } } }), '```', '',
  '```montree-ui', JSON.stringify({ schemaVersion: 1, title: '拒绝脚本', source: 'window.__liveXss=5' }), '```', '',
].join('\n')

test('Markdown 实时预览复用社区渲染、准确编辑、撤销、主题切换和安全清理', async ({}, testInfo) => {
  test.setTimeout(120_000)
  const workspace = await mkdtemp(join(tmpdir(), 'montree-live-preview-'))
  const name = 'live-preview.md'
  await writeFile(join(workspace, name), source)
  await writeFile(join(workspace, 'another.md'), '# 另一个文档\n\n**默认所见即所得**')
  await writeFile(join(workspace, 'literal.txt'), '# TXT 保留原文\n**不渲染**\n<https://github.com>')
  await mkdir(join(workspace, 'assets'))
  await writeFile(join(workspace, 'assets', 'image.svg'), '<svg xmlns="http://www.w3.org/2000/svg" width="240" height="80"><rect width="240" height="80" fill="#337d67"/><text x="24" y="48" fill="white" font-size="24">Montree</text></svg>')
  const app = await launchBuiltApp({ E2E_AUTO_OPEN_PATH: workspace })
  try {
    const page = await app.firstWindow()
    const errors: string[] = []
    page.on('pageerror', (error) => errors.push(error.message))
    await page.waitForLoadState('domcontentloaded')
    await page.getByRole('button', { name: '更多操作', exact: true }).click()
    await page.getByRole('menuitem', { name: /打开文件夹/ }).click()
    await page.keyboard.press('Control+p')
    const dialog = page.getByRole('dialog', { name: '快速打开文件' })
    await dialog.getByPlaceholder('搜索工作区文件或电子书...').fill(name)
    await expect(dialog.getByText(name).first()).toBeVisible()
    await page.keyboard.press('Enter')
    await expect(dialog).toBeHidden()
    await page.keyboard.press('Control+1')
    const toggle = page.getByRole('button', { name: '编辑器所见即所得模式切换' })
    await expect(toggle).toHaveAttribute('data-editor-mode', 'live-preview')
    await expect(toggle).toHaveText('编辑源码')
    const editor = page.locator('.cm-editor')
    const content = editor.locator('.cm-content')
    // CodeMirror only mounts widgets around its viewport, so reveal distant targets first.
    const reveal = async (target: Locator) => {
      await expect.poll(async () => {
        if (await target.count()) return true
        await editor.locator('.cm-scroller').evaluate((node) => {
          node.scrollTop = node.scrollTop + node.clientHeight >= node.scrollHeight - 1 ? 0 : node.scrollTop + node.clientHeight / 2
        })
        return false
      }, { intervals: [150], timeout: 10_000 }).toBe(true)
      await target.scrollIntoViewIfNeeded()
    }
    const table = editor.locator('table').first()
    await expect(content).toContainText('https://github.com 自动链接')
    await expect(content).not.toContainText('<https://github.com>')
    await expect(content).toContainText('• 外链：')
    await expect(content).not.toContainText('[ref1]:')
    await expect(editor.getByRole('button', { name: '编辑引用定义' }).first()).toBeVisible()
    expect(await editor.locator('.cm-live-h2').first().evaluate((node) => getComputedStyle(node).textDecorationLine)).toBe('none')
    await editor.getByRole('button', { name: '编辑引用定义' }).first().click()
    await expect(content).toContainText('[ref1]: https://example.com/report.pdf')
    await editor.getByRole('button', { name: '完成编辑并预览' }).click()
    await expect(content).not.toContainText('[ref1]:')
    await expect(table).toBeVisible()
    await expect(table.locator('td').first()).toHaveText('Apple')
    expect(await table.locator('th').nth(1).evaluate((cell) => getComputedStyle(cell).textAlign)).toBe('right')
    await expect(editor.locator('.cm-gutters')).toBeHidden()
    expect(await content.evaluate((node) => getComputedStyle(node).fontFamily)).not.toContain('monospace')
    const image = editor.getByAltText('HTML 本地图片')
    await expect(image).toBeVisible()
    await expect.poll(() => image.evaluate((node: HTMLImageElement) => node.complete && node.naturalWidth > 0)).toBe(true)
    expect(await image.getAttribute('src')).toMatch(/^data:image\/svg\+xml/)
    await expect(image).toHaveAttribute('width', '240')
    await expect.poll(() => editor.getByAltText('Markdown 本地图片').evaluate((node: HTMLImageElement) => node.complete && node.naturalWidth > 0)).toBe(true)
    await page.screenshot({ path: testInfo.outputPath('live-preview-top.png') })

    // Double-click chooses the exact source cell rather than the whole table or another occurrence.
    await table.locator('td').nth(1).dblclick()
    await expect(table).toHaveCount(0)
    await expect.poll(() => content.evaluate((node: HTMLElement & { cmView?: unknown }) => node.textContent)).toContain('a\\|b')
    await page.keyboard.press('Control+c')
    expect((await app.evaluate(({ clipboard }) => clipboard.readText())).trim()).toBe('`a\\|b`')
    await page.keyboard.insertText('`changed`')
    await expect(content).toContainText('changed')
    await expect(content).toContainText('Apple')
    await expect(content).toContainText('Banana')
    await page.keyboard.press('Control+z')
    await expect(content).toContainText('a\\|b')
    await editor.getByRole('button', { name: '完成编辑并预览' }).click()
    await expect(editor.locator('table').first().locator('td').nth(1)).toHaveText('a|b')

    const diagram = editor.locator('[data-preview-kind="fence"]').filter({ has: page.locator('[data-testid="mermaid-block"]') })
    await reveal(diagram)
    await expect(diagram.locator('svg').last()).toBeVisible({ timeout: 20_000 })
    await expect(editor.locator('.katex-display')).toHaveCount(1)
    const code = editor.locator('.code-block').first()
    await code.scrollIntoViewIfNeeded()
    await code.getByRole('button', { name: '复制代码' }).click()
    await expect.poll(async () => (await app.evaluate(({ clipboard }) => clipboard.readText())).replace(/\r\n/g, '\n')).toBe('# 这不是目录标题\nprint("hello")\n')
    await page.screenshot({ path: testInfo.outputPath('live-preview-blocks.png') })
    const listCode = editor.locator('[data-preview-kind="bullet_list_open"]').filter({ hasText: 'indentedCode' })
    await reveal(listCode)
    await expect(listCode.locator('ul .code-block code')).toContainText('const indentedCode = 42')
    await listCode.getByRole('button', { name: '编辑源码', exact: true }).click()
    await expect(content).toContainText('```js')
    await editor.getByRole('button', { name: '完成编辑并预览' }).click()
    await expect(listCode.locator('code')).toContainText('const indentedCode = 42')
    const scrollBeforeTheme = await editor.locator('.cm-scroller').evaluate((node) => node.scrollTop)
    await page.getByRole('button', { name: '切换主题', exact: true }).click()
    await page.getByRole('button', { name: '切换主题', exact: true }).click()
    await expect.poll(() => page.evaluate(() => document.documentElement.classList.contains('dark'))).toBe(true)
    await expect(editor.locator('[data-preview-kind="fence"] svg').last()).toBeVisible()
    expect(Math.abs(await editor.locator('.cm-scroller').evaluate((node) => node.scrollTop) - scrollBeforeTheme)).toBeLessThan(80)
    await page.screenshot({ path: testInfo.outputPath('live-preview-dark.png') })
    await reveal(editor.locator('.cm-live-h2').first())
    const colors = await editor.locator('.cm-live-link').first().evaluate((node) => {
      const style = getComputedStyle(node)
      const rootStyle = getComputedStyle(document.documentElement)
      return { link: style.color, foreground: getComputedStyle(node.closest('.cm-editor')!).color,
        info: rootStyle.getPropertyValue('--info').trim(), fg: rootStyle.getPropertyValue('--foreground').trim(),
        background: getComputedStyle(node.closest('.cm-editor')!).backgroundColor }
    })
    const rgb = (hex: string) => `rgb(${[1, 3, 5].map((offset) => parseInt(hex.slice(offset, offset + 2), 16)).join(', ')})`
    expect(colors.link).toBe(rgb(colors.info))
    expect(colors.foreground).toBe(rgb(colors.fg))
    const luminance = (color: string) => color.match(/\d+/g)!.slice(0, 3).map(Number).map((value) => {
      const channel = value / 255
      return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4
    }).reduce((sum, value, index) => sum + value * [0.2126, 0.7152, 0.0722][index], 0)
    expect((luminance(colors.link) + 0.05) / (luminance(colors.background) + 0.05)).toBeGreaterThan(4.5)
    expect(await editor.locator('.cm-live-h2').first().evaluate((node) => getComputedStyle(node).textDecorationLine)).toBe('none')
    await page.screenshot({ path: testInfo.outputPath('live-preview-links-dark.png') })
    const note = editor.locator('.markdown-alert-note')
    await reveal(note)
    await expect(note.locator('.markdown-alert-title')).toHaveText('NOTE')
    await expect(note.locator('strong')).toHaveText('提示内容')
    await expect(note).not.toContainText('[!NOTE]')
    await expect(editor.locator('.markdown-alert-warning .katex')).toHaveCount(1)
    await expect(editor.locator('blockquote blockquote li')).toHaveText('引用列表 code')
    const details = editor.locator('details').first()
    await reveal(details)
    await expect(details).not.toHaveAttribute('open')
    await expect(details.locator(':scope > p')).toBeHidden()
    await expect(details.locator('.code-block')).toBeHidden()
    await expect(details.locator('[data-testid="mermaid-block"]').first()).toBeHidden()
    await details.locator('summary').click()
    await expect(details.locator(':scope > p')).toBeVisible()
    await expect(details.locator('strong')).toHaveText('折叠粗体')
    await expect(details.locator('.code-block')).toBeVisible()
    await expect(details.locator('[data-testid="mermaid-block"] svg').last()).toBeVisible({ timeout: 20_000 })
    await page.screenshot({ path: testInfo.outputPath('live-preview-quotes-details-dark.png') })
    await details.locator('summary').click()
    await expect(details.locator('.code-block')).toBeHidden()
    const detailsBlock = editor.locator('[data-preview-kind="details"]')
    await detailsBlock.getByRole('button', { name: '编辑源码', exact: true }).click()
    await expect(content).toContainText('<summary>更多内容</summary>')
    await expect(content).toContainText('folded line 2')
    await editor.getByRole('button', { name: '完成编辑并预览' }).click()
    await expect(details.locator('.code-block')).toBeHidden()
    const unsafe = editor.locator('.cm-live-block').filter({ hasText: '危险链接' })
    await unsafe.scrollIntoViewIfNeeded()
    await expect(unsafe.locator('script, [onclick], [onerror], a[href^="javascript:"]')).toHaveCount(0)
    expect(await page.evaluate(() => (window as unknown as { __liveXss?: number }).__liveXss)).toBeUndefined()
    const documentDiagram = editor.getByTestId('html-artifact-card').filter({ hasText: '文档交互流程' })
    await reveal(documentDiagram)
    await expect(documentDiagram.frameLocator('iframe').getByRole('img', { name: '文档交互流程' })).toBeVisible()
    await expect(documentDiagram.frameLocator('iframe').locator('.entity')).toHaveCount(2)
    await expect(documentDiagram.frameLocator('iframe').locator('svg')).toContainText('book_id')
    await documentDiagram.frameLocator('iframe').getByRole('button', { name: '读原文', exact: true }).focus()
    await page.keyboard.press('Enter')
    await expect(documentDiagram.frameLocator('iframe').getByRole('status', { name: '节点详情' })).toContainText('保留文档中的图解参数')
    const documentUi = editor.getByTestId('markdown-component-ui')
    await reveal(documentUi)
    await documentUi.getByRole('radio', { name: '关注观点', exact: true }).click()
    await documentUi.getByRole('button', { name: '汇总文档选择', exact: true }).click()
    await expect(documentUi.getByRole('status')).toContainText('=idea')
    const invalidComponent = editor.getByRole('alert').filter({ hasText: '组件包含未支持的属性' })
    await reveal(invalidComponent)
    await expect(invalidComponent).toContainText('可切回源码修正')
    expect(await page.evaluate(() => (window as unknown as { __liveXss?: number }).__liveXss)).toBeUndefined()

    // Mode switching is a decoration-only operation; source and history survive it.
    await toggle.click()
    await expect(toggle).toHaveText('可视编辑')
    await expect(editor.locator('.cm-gutters')).toBeVisible()
    await expect(editor.locator('.cm-live-block')).toHaveCount(0)
    await content.click()
    await page.keyboard.press('Control+End')
    await page.keyboard.insertText('模式测试')
    await toggle.click()
    await page.keyboard.press('Control+z')
    await expect(content).not.toContainText('模式测试')
    await toggle.click()
    await content.click()
    await page.keyboard.press('Control+a')
    await page.keyboard.press('Control+c')
    expect((await app.evaluate(({ clipboard }) => clipboard.readText())).replace(/\r\n/g, '\n')).toBe(source)

    // Source is reachable from reading preview too; new documents always start in live preview.
    await page.keyboard.press('Control+3')
    const readingUi = page.locator('.markdown-preview').getByTestId('markdown-component-ui')
    await readingUi.scrollIntoViewIfNeeded()
    await readingUi.getByRole('radio', { name: '关注证据', exact: true }).click()
    await readingUi.getByRole('button', { name: '汇总文档选择', exact: true }).click()
    await expect(readingUi.getByRole('status')).toContainText('=evidence')
    await expect(page.locator('.markdown-preview').getByTestId('html-artifact-card').filter({ hasText: '文档交互流程' }).locator('iframe')).toHaveCount(1)
    const readingDetails = page.locator('.markdown-preview details').first()
    await readingDetails.scrollIntoViewIfNeeded()
    await expect(readingDetails.locator('.code-block')).toBeHidden()
    await readingDetails.locator('summary').click()
    await expect(readingDetails.locator('.code-block')).toBeVisible()
    await expect(readingDetails.locator('[data-testid="mermaid-block"] svg').last()).toBeVisible({ timeout: 20_000 })
    await readingDetails.locator('summary').click()
    await expect(readingDetails.locator('.code-block')).toBeHidden()
    await expect(toggle).toBeVisible()
    await toggle.click()
    await expect(editor).toBeVisible()
    await page.keyboard.press('Control+/')
    await expect(toggle).toHaveAttribute('data-editor-mode', 'source')
    const openFile = async (file: string) => {
      await page.keyboard.press('Control+p')
      await dialog.getByPlaceholder('搜索工作区文件或电子书...').fill(file)
      await expect(dialog.getByText(file).first()).toBeVisible()
      await page.keyboard.press('Enter')
      await expect(dialog).toBeHidden()
    }
    await openFile('another.md')
    await expect(toggle).toHaveAttribute('data-editor-mode', 'live-preview')
    await expect(editor.locator('.cm-gutters')).toBeHidden()
    await openFile('literal.txt')
    await expect(toggle).toBeHidden()
    await expect(content).toContainText('**不渲染**')
    await expect(editor.locator('.cm-gutters')).toBeVisible()
    expect(errors).toEqual([])
  } finally { await app.close() }
})

test('脚注编号、长脚注、重复回链跨视口跳转，源码编辑撤销和图片消毒', async ({}, testInfo) => {
  test.setTimeout(120_000)
  const workspace = await mkdtemp(join(tmpdir(), 'montree-footnotes-'))
  const name = 'footnotes.md'
  const original = [
    '# 脚注回归', '', '这里有短脚注[^short]，长脚注[^long]，再次短脚注[^short]，行内注^[**行内说明**]，未知[^missing]。', '',
    ...Array.from({ length: 90 }, (_, index) => `中间正文第 ${index + 1} 段。\n`),
    '[^short]: 这是短脚注，含 `code` 与 [链接](https://example.com)。<img src="./note.svg" alt="脚注图片" onerror="window.__footnoteXss=1">', '',
    '[^long]: 这是长脚注：', '', '    - 支持列表', '    - 支持 **样式**', '', '    第二段缩进内容。', '',
    '## 结尾', '', '结尾正文。',
  ].join('\n')
  await writeFile(join(workspace, name), original)
  await writeFile(join(workspace, 'note.svg'), '<svg xmlns="http://www.w3.org/2000/svg" width="40" height="20"><rect width="40" height="20" fill="green"/></svg>')
  const app = await launchBuiltApp({ E2E_AUTO_OPEN_PATH: workspace })
  try {
    const page = await app.firstWindow()
    const errors: string[] = []
    page.on('pageerror', (error) => errors.push(error.message))
    await page.waitForLoadState('domcontentloaded')
    await page.getByRole('button', { name: '更多操作', exact: true }).click()
    await page.getByRole('menuitem', { name: /打开文件夹/ }).click()
    await page.keyboard.press('Control+p')
    const dialog = page.getByRole('dialog', { name: '快速打开文件' })
    await dialog.getByPlaceholder('搜索工作区文件或电子书...').fill(name)
    await expect(dialog.getByText(name).first()).toBeVisible()
    await page.keyboard.press('Enter')
    await expect(dialog).toBeHidden()
    await page.keyboard.press('Control+1')
    const editor = page.locator('.cm-editor')
    const content = editor.locator('.cm-content')
    const toggle = page.getByRole('button', { name: '编辑器所见即所得模式切换' })
    await expect(editor.locator('.cm-live-block').first()).toContainText('行内说明')
    await page.screenshot({ path: testInfo.outputPath('live-preview-footnotes-top.png') })
    await expect(editor.locator('.footnote-ref')).toHaveCount(4)
    await expect(editor.locator('.footnote-ref a').nth(0)).toHaveText('[1]')
    await expect(editor.locator('.footnote-ref a').nth(1)).toHaveText('[2]')
    await expect(editor.locator('.footnote-ref a').nth(2)).toHaveText('[1:1]')
    await expect(editor.locator('#fn3 strong')).toHaveText('行内说明')
    await expect(content).toContainText('[^missing]')

    await editor.locator('.footnote-ref a[href="#fn1"]').first().click()
    await expect(editor.locator('#fn1')).toBeInViewport()
    await expect(editor.locator('#fn1')).toHaveAttribute('value', '1')
    const image = editor.getByAltText('脚注图片')
    await expect.poll(() => image.evaluate((node: HTMLImageElement) => node.complete && node.naturalWidth > 0)).toBe(true)
    await expect(image).toHaveAttribute('src', /^data:image\/svg\+xml/)
    await expect(editor.locator('.cm-live-block [onerror]')).toHaveCount(0)
    expect(await page.evaluate(() => (window as unknown as { __footnoteXss?: number }).__footnoteXss)).toBeUndefined()
    await editor.locator('#fn1 .footnote-backref').nth(1).click()
    await expect(editor.locator('[id="fnref1:1"]')).toBeInViewport()
    await editor.locator('.footnote-ref a[href="#fn2"]').click()
    const note = editor.locator('#fn2')
    await expect(note).toBeInViewport()
    await expect(note).toHaveAttribute('value', '2')
    await expect(note.locator('ul li')).toHaveCount(2)
    await expect(note.locator('strong')).toHaveText('样式')
    await expect(note).toContainText('第二段缩进内容。')

    await editor.locator('.cm-live-block').filter({ has: page.locator('#fn2') }).getByRole('button', { name: '编辑脚注' }).click()
    await expect(content).toContainText('[^long]: 这是长脚注：')
    await expect(content).toContainText('**样式**')
    await page.keyboard.press('End')
    await page.keyboard.insertText('（已编辑）')
    await editor.getByRole('button', { name: '完成编辑并预览' }).click()
    await expect(note).toContainText('（已编辑）')
    await page.getByRole('button', { name: '切换主题', exact: true }).click()
    await page.getByRole('button', { name: '切换主题', exact: true }).click()
    await expect.poll(() => page.evaluate(() => document.documentElement.classList.contains('dark'))).toBe(true)
    await note.scrollIntoViewIfNeeded()
    await expect(note).toBeInViewport()
    await editor.locator('.cm-live-block').filter({ has: page.locator('#fn2') }).screenshot({ path: testInfo.outputPath('live-preview-footnotes-dark.png') })

    await toggle.click()
    await content.click()
    await page.keyboard.press('Control+z')
    await page.keyboard.press('Control+a')
    await page.keyboard.press('Control+c')
    expect((await app.evaluate(({ clipboard }) => clipboard.readText())).replace(/\r\n/g, '\n')).toBe(original)
    await page.keyboard.press('Control+Home')
    await toggle.click()
    await editor.locator('.footnote-ref a[href="#fn2"]').click()
    await expect(note).not.toContainText('（已编辑）')
    await note.locator('.footnote-backref').click()
    await expect(editor.locator('#fnref2')).toBeInViewport()
    expect(errors).toEqual([])
  } finally { await app.close() }
})
