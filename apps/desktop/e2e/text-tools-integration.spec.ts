import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test, expect, type ElectronApplication, type Page } from '@playwright/test'
import { launchBuiltApp } from './helpers/launch-app'

async function open(page: Page, file: string) {
  await page.keyboard.press('Control+p')
  const dialog = page.getByRole('dialog', { name: '快速打开文件' })
  await dialog.getByPlaceholder('搜索工作区文件或电子书...').fill(file)
  await dialog.getByRole('button').filter({ hasText: file }).click()
  await expect(dialog).toBeHidden()
}
async function fixture() {
  const workspace = await mkdtemp(join(tmpdir(), 'montree-text-tools-'))
  const documentPath = join(workspace, 'notes.md'), txtPath = join(workspace, 'plain.txt'), typPath = join(workspace, 'main.typ')
  const source = '# First\n\nsame\n\n# Second\n\nsame\n\n<!-- Page 1 -->\n[[note]]\n![architecture](https://example.test/figure.png)\n'
  await writeFile(documentPath, source.replace(/\n/g, '\r\n'))
  await writeFile(txtPath, '# Literal heading\n![literal](picture.png)\nsecond\n')
  await writeFile(typPath, '= Typst 标题\n正文 😀\n$ x^2 + y^2 = z^2 $\n')
  const app = await launchBuiltApp({ E2E_AUTO_OPEN_PATH: workspace, E2E_DOCUMENT_TOOLS: '1' })
  const page = await app.firstWindow()
  await page.getByRole('button', { name: '更多操作', exact: true }).click()
  await page.getByRole('menuitem', { name: /打开文件夹/ }).click()
  await open(page, 'notes.md'); await expect(page.locator('.cm-editor')).toBeVisible()
  const endpoint = await app.evaluate(async () => (globalThis as any).__montreeE2eMcpEndpoint())
  let id = 0
  const transcript: unknown[] = []
  const rpc = async (method: string, params?: unknown) => {
    const response = await fetch(endpoint.url, { method: 'POST', headers: { Authorization: `Bearer ${endpoint.authToken}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: ++id, method, params }) })
    expect(response.status).toBe(200)
    const result = await response.json() as any
    expect(result.error).toBeUndefined()
    return result.result
  }
  const call = async (name: string, args: Record<string, unknown>) => {
    const model = { tool_calls: [{ type: 'function', function: { name, arguments: JSON.stringify(args) } }] }
    const output = model.tool_calls[0].function
    const result = await rpc('tools/call', { name: output.name, arguments: JSON.parse(output.arguments) })
    transcript.push({ model, result }); return result
  }
  const value = async (name: string, args: Record<string, unknown>) => {
    const result = await call(name, args)
    expect(result.isError, result.content[0].text).not.toBe(true)
    return JSON.parse(result.content[0].text)
  }
  return { app, page, workspace, documentPath, txtPath, typPath, source, rpc, call, value, transcript }
}
async function close(app: ElectronApplication) {
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().forEach((window) => window.removeAllListeners('close')))
  await app.close()
}

test('mock模型经真实MCP查询Markdown、精确选区批量修改、共享撤销、所有视图、保存和重开', async ({}, info) => {
  const f = await fixture()
  const { app, page, documentPath, source, value, call } = f
  try {
    const tools = await f.rpc('tools/list')
    expect(tools.tools.map((tool: any) => tool.name)).toEqual(expect.arrayContaining(['montree_text_read', 'montree_text_edit', 'montree_document_save', 'montree_document_undo']))
    let state = await value('montree_text_read', { documentPath })
    expect(state.units.map((unit: any) => unit.label)).toEqual(['First', 'Second'])
    const toc = await value('montree_read', { scope: 'toc' })
    expect(toc.entries.map((unit: any) => unit.label)).toEqual(['First', 'Second'])
    const chapter = await value('montree_read', { scope: 'chapter', flatIndex: 1 })
    expect(chapter.text).toBe(source.slice(source.indexOf('# Second')))
    expect(chapter.revision).toBe(state.revision)
    expect(chapter.images[0].src).toContain('figure.png')
    const lines = await value('montree_text_read', { documentPath, target: 'lines', startLine: 7, endLine: 7 })
    expect(lines.text).toBe('same')
    const bounded = await value('montree_text_read', { documentPath, target: 'document', maxChars: 8 })
    expect(bounded).toMatchObject({ text: '# First\n', to: 8, truncated: true })

    // Keyboard selection targets the second occurrence; no test-only editor mutation.
    await page.locator('.cm-content').click()
    await page.keyboard.press('Control+Home')
    for (let i = 0; i < 6; i++) await page.keyboard.press('ArrowDown')
    await page.keyboard.press('Home'); await page.keyboard.press('Shift+End')
    const selection = await value('montree_get_selection', {})
    expect(selection.selection).toBe('same')
    expect(selection.target).toMatchObject({ kind: 'text', from: lines.from, to: lines.to, revision: state.revision })
    const request = { documentPath, revision: state.revision, selectionId: selection.target.selectionId, expectedCount: 1,
      edits: [{ from: lines.from, to: lines.to, expectedText: 'same', text: '**chosen**' }] }
    const outside = await call('montree_text_edit', { ...request, edits: [{ from: source.indexOf('same'), to: source.indexOf('same') + 4, expectedText: 'same', text: 'wrong' }] })
    expect(outside.isError).toBe(true)
    state = await value('montree_text_edit', request)
    const edited = source.slice(0, lines.from) + '**chosen**' + source.slice(lines.to)
    expect((await value('montree_text_read', { documentPath, target: 'document' })).text).toBe(edited)
    expect(await readFile(documentPath, 'utf8')).toBe(source.replace(/\n/g, '\r\n'))
    expect((await call('montree_text_edit', request)).isError).toBe(true)
    await expect(page.locator('.cm-content')).toContainText('chosen')
    const livePreviewToggle = page.getByRole('button', { name: '编辑器所见即所得模式切换', exact: true })
    if (await livePreviewToggle.count()) await livePreviewToggle.click()
    expect((await value('montree_text_read', { documentPath })).revision).toBe(state.revision)
    await expect(page.locator('.cm-content')).toContainText('**chosen**')
    // One AI transaction is one ordinary Ctrl+Z event.
    await page.locator('.cm-content').click(); await page.keyboard.press('Control+z')
    expect((await value('montree_text_read', { documentPath, target: 'document' })).text).toBe(source)
    state = await value('montree_text_read', { documentPath })

    // Validate full-batch rejection, then edit two different ranges at once.
    const edits = [{ from: source.indexOf('same'), to: source.indexOf('same') + 4, expectedText: 'same', text: 'one' },
      { from: lines.from, to: lines.to, expectedText: 'same', text: 'two' }]
    const bad = await call('montree_text_edit', { documentPath, revision: state.revision, expectedCount: 2, edits: [edits[0], { ...edits[1], expectedText: 'wrong' }] })
    expect(bad.isError).toBe(true)
    expect((await value('montree_text_read', { documentPath, target: 'document' })).text).toBe(source)
    state = await value('montree_text_edit', { documentPath, revision: state.revision, expectedCount: 2, edits })
    const both = source.replace('same', 'one').replace('same', 'two')
    await page.keyboard.press('Control+2')
    expect((await value('montree_text_read', { documentPath, target: 'document' })).text).toBe(both)
    await page.keyboard.press('Control+3')
    await expect(page.locator('.cm-editor')).toHaveCount(0)
    expect((await value('montree_read', { scope: 'viewport' })).scope).toBe('section-fallback')
    state = await value('montree_document_undo', { documentPath, revision: state.revision })
    expect((await value('montree_text_read', { documentPath, target: 'document' })).text).toBe(source)
    state = await value('montree_text_edit', { documentPath, revision: state.revision, expectedCount: 2, edits })
    await page.keyboard.press('Control+1')
    await expect(page.locator('.cm-content')).toContainText('two')
    const search = await value('montree_read', { scope: 'search', query: 'two' })
    expect(JSON.stringify(search)).toContain('two')
    await value('montree_document_save', { documentPath, revision: state.revision })
    expect(await readFile(documentPath, 'utf8')).toBe(both)
    expect((await value('montree_text_read', { documentPath })).dirty).toBe(false)
    await open(page, 'plain.txt'); await open(page, 'notes.md')
    expect((await value('montree_text_read', { documentPath, target: 'document' })).text).toBe(both)
    const transcript = info.outputPath('mock-text-tool-transcript.json')
    await writeFile(transcript, JSON.stringify(f.transcript, null, 2))
    await info.attach('mock-text-tool-transcript', { path: transcript, contentType: 'application/json' })
    await page.screenshot({ path: info.outputPath('text-tools-after.png') })
  } finally { await close(app) }
})

test('TXT读取未保存手动输入、普通保存、跨文件目标拒绝、外部修改拒绝覆盖', async () => {
  const { app, page, documentPath, txtPath, value, call } = await fixture()
  try {
    const old = await value('montree_text_read', { documentPath })
    await open(page, 'plain.txt')
    let state = await value('montree_text_read', { documentPath: txtPath, target: 'document' })
    expect(state.format).toBe('txt'); expect(state.images).toEqual([])
    const toc = await value('montree_read', { scope: 'toc' })
    expect(toc.entries[0].label).toBe('第 1–4 行')
    expect((await call('montree_text_edit', { documentPath, revision: old.revision, expectedCount: 1, edits: [{ from: 0, to: 0, expectedText: '', text: 'bad' }] })).isError).toBe(true)
    await page.locator('.cm-content').click(); await page.keyboard.press('Control+End'); await page.keyboard.type('manual')
    state = await value('montree_text_read', { documentPath: txtPath, target: 'document' })
    expect(state.text.endsWith('manual')).toBe(true); expect(state.dirty).toBe(true)
    await page.keyboard.press('Control+s')
    await expect.poll(() => readFile(txtPath, 'utf8')).toBe(state.text)
    expect((await value('montree_text_read', { documentPath: txtPath })).dirty).toBe(false)
    state = await value('montree_text_edit', { documentPath: txtPath, revision: state.revision, expectedCount: 1, edits: [{ from: 0, to: 0, expectedText: '', text: 'AI\n' }] })
    await writeFile(txtPath, 'external changes')
    const result = await call('montree_document_save', { documentPath: txtPath, revision: state.revision })
    expect(result.isError).toBe(true); expect(result.content[0].text).toContain('其他程序修改')
    expect(await readFile(txtPath, 'utf8')).toBe('external changes')
    expect((await value('montree_text_read', { documentPath: txtPath })).dirty).toBe(true)
    await value('montree_document_undo', { documentPath: txtPath, revision: state.revision })
  } finally { await close(app) }
})

test('Typst源码接入统一MCP：format=typst、读取/选区/编辑/保存/撤销', async () => {
  const { app, page, typPath, value } = await fixture()
  try {
    await open(page, 'main.typ')
    await expect(page.locator('.cm-editor')).toBeVisible()
    let state = await value('montree_text_read', { documentPath: typPath })
    expect(state.format).toBe('typst')
    expect(state.units[0].label).toContain('行')
    const document = await value('montree_text_read', { documentPath: typPath, target: 'document' })
    expect(document.text).toContain('= Typst 标题')
    // The Typst editor selection feeds montree_get_selection through the same text selection provider.
    await page.locator('.cm-content').click()
    await page.keyboard.press('Control+Home')
    await page.keyboard.press('Shift+End')
    const selection = await value('montree_get_selection', {})
    expect(selection.selection).toBe('= Typst 标题')
    expect(selection.target).toMatchObject({ kind: 'text', documentPath: typPath })
    // Plain-source UTF-16 edit, then explicit save and undo; no Markdown parsing is involved.
    state = await value('montree_text_edit', {
      documentPath: typPath,
      revision: document.revision,
      expectedCount: 1,
      edits: [{ from: 0, to: 0, expectedText: '', text: '// ' }],
    })
    expect((await value('montree_text_read', { documentPath: typPath, target: 'document' })).text).toContain('// = Typst 标题')
    await value('montree_document_save', { documentPath: typPath, revision: state.revision })
    expect(await readFile(typPath, 'utf8')).toContain('// = Typst 标题')
    await value('montree_document_undo', { documentPath: typPath, revision: state.revision })
    expect((await value('montree_text_read', { documentPath: typPath, target: 'document' })).text).toContain('= Typst 标题')
  } finally { await close(app) }
})
