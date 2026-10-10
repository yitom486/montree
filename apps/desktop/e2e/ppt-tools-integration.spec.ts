import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import PptxGenJS from 'pptxgenjs'
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate'
import { test, expect, type ElectronApplication, type Page } from '@playwright/test'
import { launchBuiltApp } from './helpers/launch-app'

interface ToolResult { isError?: boolean; content: Array<{ type: string; text?: string }> }
interface MockModelOutput { tool_calls: Array<{ id: string; type: 'function'; function: { name: string; arguments: string } }> }
interface Paragraph { id: string; text: string; runs: Array<{ id: string; text: string; color: string; bold: boolean; fontSize: number; italic: boolean }> }
interface State { revision: number; context: { visibleSlide: number; visibleSlides: number[]; navigationSlide: number; selectionSlide: number | null }; elements: Array<{ id: string; text: string; appearance: { paragraphs: Paragraph[] } }> }

/** Only the model output is mocked. Dispatch uses real HTTP MCP, main→renderer IPC, and file saving. */
async function modelClient(app: ElectronApplication) {
  const endpoint = await app.evaluate(async () => (globalThis as unknown as { __montreeE2eMcpEndpoint: () => Promise<{ url: string; authToken: string }> }).__montreeE2eMcpEndpoint())
  let sequence = 0
  const transcript: Array<{ model: MockModelOutput; result: ToolResult }> = []
  const rpc = async (method: string, params?: unknown) => {
    const response = await fetch(endpoint.url, { method: 'POST', headers: { Authorization: `Bearer ${endpoint.authToken}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: ++sequence, method, params }) })
    expect(response.status).toBe(200)
    const message = await response.json() as { result: any; error?: unknown }
    expect(message.error).toBeUndefined()
    return message.result
  }
  const dispatch = async (model: MockModelOutput): Promise<ToolResult[]> => {
    const results: ToolResult[] = []
    for (const call of model.tool_calls) {
      const result: ToolResult = await rpc('tools/call', { name: call.function.name, arguments: JSON.parse(call.function.arguments) })
      transcript.push({ model: { tool_calls: [call] }, result }); results.push(result)
    }
    return results
  }
  const call = async (name: string, args: Record<string, unknown> = {}) => (await dispatch({ tool_calls: [{ id: `mock-${sequence + 1}`, type: 'function', function: { name, arguments: JSON.stringify(args) } }] }))[0]
  const value = async <T = State>(name: string, args: Record<string, unknown> = {}): Promise<T> => {
    const result = await call(name, args)
    expect(result.isError, result.content[0]?.text).not.toBe(true)
    return JSON.parse(result.content[0].text!) as T
  }
  return { rpc, call, value, transcript }
}

async function fixture() {
  const workspace = await mkdtemp(join(tmpdir(), 'montree-ppt-mcp-'))
  const documentPath = join(workspace, 'precise.pptx')
  const ppt = new PptxGenJS(); ppt.layout = 'LAYOUT_WIDE'
  const slide = ppt.addSlide()
  slide.addText('placeholder', { x: 1, y: 1.5, w: 11, h: 3 })
  slide.addText('可删除元素', { x: 1, y: 6, w: 5, h: 0.5, fontSize: 14 })
  ppt.addSlide().addText('第二页内容', { x: 1, y: 1, w: 10, h: 2, fontSize: 30 })
  ppt.addSlide().addText('第三页内容', { x: 1, y: 1, w: 10, h: 2, fontSize: 30 })
  const files = unzipSync(new Uint8Array(await ppt.write({ outputType: 'arraybuffer' }) as ArrayBuffer))
  files['ppt/slides/slide1.xml'] = strToU8(strFromU8(files['ppt/slides/slide1.xml']).replace(/<p:txBody>.*?<\/p:txBody>/s,
    '<p:txBody><a:bodyPr wrap="none"/><a:lstStyle/><a:p><a:pPr><a:defRPr sz="4000" b="1"><a:solidFill><a:srgbClr val="1E293B"/></a:solidFill></a:defRPr></a:pPr><a:r><a:t>Montree 文档与 AI</a:t></a:r></a:p><a:p><a:pPr><a:spcBef><a:spcPts val="1400"/></a:spcBef><a:defRPr sz="2000"><a:solidFill><a:srgbClr val="64748B"/></a:solidFill></a:defRPr></a:pPr><a:r><a:t>保留 </a:t></a:r><a:r><a:rPr i="1"><a:solidFill><a:srgbClr val="2563EB"/></a:solidFill></a:rPr><a:t>旧的副标题</a:t></a:r><a:r><a:t> 结尾</a:t></a:r></a:p><a:p><a:pPr><a:defRPr sz="1300"/></a:pPr><a:fld id="date" type="datetime"><a:t>日期：2026</a:t></a:fld></a:p></p:txBody>'))
  const original = zipSync(files); await writeFile(documentPath, original)
  const app = await launchBuiltApp({ E2E_AUTO_OPEN_PATH: workspace, E2E_DOCUMENT_TOOLS: '1' })
  const page = await app.firstWindow()
  await page.getByRole('button', { name: '更多操作', exact: true }).click()
  await page.getByRole('menuitem', { name: /打开文件夹/ }).click()
  await open(page, 'precise.pptx')
  await expect(page.locator('[data-slide="1"] [data-element-id]').first()).toBeVisible()
  return { workspace, documentPath, original, files, app, page }
}
async function open(page: Page, name: string) {
  await page.keyboard.press('Control+p')
  const dialog = page.getByRole('dialog', { name: '快速打开文件' })
  await dialog.getByPlaceholder('搜索工作区文件或电子书...').fill(name)
  await dialog.getByRole('button', { name, exact: true }).click(); await expect(dialog).toBeHidden()
}
async function closeFixture(app: ElectronApplication): Promise<void> {
  // These tests intentionally leave unsaved edits/conflicts; cleanup bypasses only
  // the temporary test window's close confirmation, never the editing or save path.
  await app.evaluate(({ BrowserWindow }) => { for (const window of BrowserWindow.getAllWindows()) window.removeAllListeners('close') })
  await app.close()
}

test('mock模型调用经真实MCP完成局部修改、样式预览、删除撤销、保存和重开', async ({}, info) => {
  const { app, page, documentPath, original, files } = await fixture()
  try {
    const model = await modelClient(app)
    const definitions = await model.rpc('tools/list') as { tools: Array<{ name: string; inputSchema: { required: string[] } }> }
    expect(definitions.tools.find((tool) => tool.name === 'montree_ppt_edit_text')?.inputSchema.required).toEqual(expect.arrayContaining(['revision', 'edits', 'expectedCount']))
    let state = await model.value('montree_ppt_read', { documentPath, slide: 1 })
    const id = state.elements[0].id; const titleBefore = state.elements[0].appearance.paragraphs[0]
    const canvas = page.locator('[data-slide="1"] [data-slide-canvas]')
    await canvas.screenshot({ path: info.outputPath('before.png') })
    const sourceRun = canvas.locator(`[data-element-id="${id}"] [data-paragraph-id="p2"] [data-run-id="r2"]`)
    await sourceRun.click()
    const selection = await model.value<{ target: { selectionId: string; slide: number; paragraphId: string; runId: string } }>('montree_get_selection')
    expect(selection.target).toMatchObject({ slide: 1, paragraphId: 'p2', runId: 'r2' })
    await expect(page.getByLabel('元素检查器')).toHaveCount(0)
    state = await model.value('montree_ppt_edit_text', { documentPath, revision: state.revision, slide: 1, selectionId: selection.target.selectionId,
      edits: [{ elementId: id, paragraphId: 'p2', runId: 'r2', start: 0, end: 2, expectedText: '旧的', patch: { text: '精细化', color: '#EA580C', bold: true, italic: false, fontSize: 24 } }], expectedCount: 1 })
    expect(state.elements[0].appearance.paragraphs[0]).toEqual(titleBefore)
    expect(state.elements[0].appearance.paragraphs[1].text).toBe('保留 精细化副标题 结尾')
    const edited = canvas.locator('[data-paragraph-id="p2"] span').filter({ hasText: '精细化' })
    await expect(edited).toHaveCSS('font-weight', '700'); await expect(edited).toHaveCSS('color', 'rgb(234, 88, 12)'); await expect(edited).toHaveCSS('font-style', 'normal')
    await expect(canvas.locator('[data-paragraph-id="p2"] span').filter({ hasText: '副标题' })).toHaveCSS('font-style', 'italic')
    await expect(canvas.locator(`[data-element-id="${id}"] [data-paragraph-id="p1"] span`)).toHaveCSS('color', 'rgb(30, 41, 59)')
    await expect(canvas.locator(`[data-element-id="${id}"] [data-paragraph-id="p1"] span`)).toHaveCSS('font-weight', '700')
    expect(await readFile(documentPath)).toEqual(Buffer.from(original))
    state = await model.value('montree_ppt_edit_text', { documentPath, revision: state.revision, slide: 1,
      edits: [{ elementId: id, paragraphId: 'p2', patch: { align: 'center', spaceAfter: 8 } }], expectedCount: 1 })
    await expect(canvas.locator('[data-paragraph-id="p2"]')).toHaveCSS('text-align', 'center')
    const removable = state.elements.find((element) => element.text === '可删除元素')!.id
    state = await model.value('montree_ppt_delete', { documentPath, revision: state.revision, slide: 1, elementIds: [removable], expectedCount: 1 })
    await expect(canvas.locator(`[data-element-id="${removable}"]`)).toHaveCount(0)
    state = await model.value('montree_document_undo', { documentPath, revision: state.revision })
    state = await model.value('montree_ppt_read', { documentPath, slide: 1 })
    await expect(canvas.locator(`[data-element-id="${removable}"]`)).toBeVisible()
    await canvas.screenshot({ path: info.outputPath('after.png') })
    await model.value('montree_document_save', { documentPath, revision: state.revision })
    const saved = unzipSync(await readFile(documentPath))
    expect(strFromU8(saved['ppt/slides/slide1.xml'])).toContain('精细化')
    for (const [path, data] of Object.entries(files)) if (path !== 'ppt/slides/slide1.xml') expect(saved[path], path).toEqual(data)
    await writeFile(join(documentPath, '..', 'reload.pptx'), await readFile(documentPath))
    await open(page, 'reload.pptx')
    await expect.poll(async () => (await model.call('montree_ppt_read', { documentPath: join(documentPath, '..', 'reload.pptx'), slide: 1 })).isError !== true).toBe(true)
    const reopened = await model.value('montree_ppt_read', { documentPath: join(documentPath, '..', 'reload.pptx'), slide: 1 })
    expect(reopened.elements[0].appearance.paragraphs).toEqual(state.elements[0].appearance.paragraphs)
    const transcriptPath = info.outputPath('mock-model-tool-transcript.json')
    await writeFile(transcriptPath, JSON.stringify(model.transcript, null, 2))
    await info.attach('mock-model-tool-transcript', { path: transcriptPath, contentType: 'application/json' })
  } finally { await closeFixture(app) }
})

test('mock模型的非法/过期/重叠/字段调用返回工具错误，整批原子拒绝；保存冲突保留外部文件', async () => {
  const { app, page, documentPath, original } = await fixture()
  try {
    const model = await modelClient(app)
    const before = await model.value('montree_ppt_read', { documentPath, slide: 1 }); const id = before.elements[0].id
    const edit = { elementId: id, paragraphId: 'p2', runId: 'r2', expectedText: '旧的副标题', patch: { text: 'changed' } }
    const args = { documentPath, revision: before.revision, slide: 1, edits: [edit], expectedCount: 1 }
    const badCalls: Array<[Record<string, unknown>, string]> = [
      [{ ...args, revision: 99 }, '版本'], [{ ...args, documentPath: join(documentPath, '..', 'other.pptx') }, '不匹配'], [{ ...args, expectedCount: 2 }, '数量'],
      [{ ...args, edits: [edit, { ...edit, paragraphId: 'p99' }], expectedCount: 2 }, '段落'], [{ ...args, edits: [edit, edit], expectedCount: 2 }, '重叠'],
      [{ ...args, edits: [{ ...edit, expectedText: 'wrong' }] }, 'expectedText'], [{ ...args, edits: [{ ...edit, patch: { animation: 'fade' } }] }, '不支持'],
      [{ ...args, edits: [{ ...edit, paragraphId: 'p3', runId: undefined, expectedText: '日期：2026' }] }, '字段'], [{ ...args, selectionId: 'stale' }, '选区'],
    ]
    for (const [args, message] of badCalls) {
      const result = await model.call('montree_ppt_edit_text', args)
      expect(result.isError).toBe(true); expect(result.content[0].text).toContain(message)
      expect(await model.value('montree_ppt_read', { documentPath, slide: 1 })).toEqual(before)
      expect(await readFile(documentPath)).toEqual(Buffer.from(original))
    }
    const changed = await model.value('montree_ppt_edit_text', args)
    const files = unzipSync(original); files['external.xml'] = strToU8('<external/>'); const external = zipSync(files)
    await writeFile(documentPath, external)
    const result = await model.call('montree_document_save', { documentPath, revision: changed.revision })
    expect(result.isError).toBe(true); expect(result.content[0].text).toContain('其他程序修改')
    expect(await readFile(documentPath)).toEqual(Buffer.from(external))
    await expect(page.locator('[data-slide="1"] [data-paragraph-id="p2"]')).toHaveText('保留 changed 结尾')
  } finally { await closeFixture(app) }
})

test('连续浏览分别返回可见页、导航页、选区页；检查器按需打开并只编辑指定段落', async () => {
  const { app, page, documentPath } = await fixture()
  try {
    const model = await modelClient(app)
    let state = await model.value('montree_ppt_read', { documentPath, slide: 1 }); const id = state.elements[0].id
    await page.locator(`[data-slide="1"] [data-element-id="${id}"] [data-paragraph-id="p2"] [data-run-id="r2"]`).click()
    await expect(page.getByLabel('元素检查器')).toHaveCount(0)
    await page.getByRole('button', { name: '元素详情', exact: true }).click()
    await page.getByRole('button', { name: '编辑文字与样式' }).click()
    await page.getByLabel('段落文字').fill('手动只改副标题')
    await page.getByLabel('段落文字').blur()
    expect((await model.value('montree_ppt_read', { documentPath, slide: 1 })).revision).toBe(state.revision)
    await page.getByRole('button', { name: '应用文字', exact: true }).click()
    state = await model.value('montree_ppt_read', { documentPath, slide: 1 })
    expect(state.elements[0].appearance.paragraphs[0].text).toBe('Montree 文档与 AI')
    expect(state.elements[0].appearance.paragraphs[0].runs[0]).toMatchObject({ fontSize: 40, bold: true })
    expect(state.elements[0].appearance.paragraphs[1]).toMatchObject({ text: '手动只改副标题' })
    await page.getByRole('button', { name: '编辑文字与样式' }).click()
    await page.getByLabel('段落字号').fill('18')
    await page.getByLabel('段落颜色').fill('#0d9488')
    await page.getByRole('checkbox', { name: '粗体', exact: true }).check()
    await page.getByRole('button', { name: '应用样式', exact: true }).click()
    state = await model.value('montree_ppt_read', { documentPath, slide: 1 })
    expect(state.elements[0].appearance.paragraphs[1].runs[0]).toMatchObject({ fontSize: 18, color: '#0d9488', bold: true })
    expect(state.elements[0].appearance.paragraphs[0].runs[0]).toMatchObject({ fontSize: 40, bold: true })
    await page.getByRole('button', { name: '收起元素详情', exact: true }).click()
    await page.locator('[data-slide="2"]').evaluate((node) => node.scrollIntoView({ block: 'start' }))
    await expect.poll(async () => (await model.value('montree_ppt_read', { documentPath })).context.visibleSlide).toBe(2)
    const metadata = await model.value('montree_ppt_read', { documentPath })
    expect(metadata.context).toMatchObject({ navigationSlide: 1, selectionSlide: 1, visibleSlide: 2 })
    const text = await model.call('montree_read', { scope: 'current' })
    expect(text.content[0].text).toContain('第二页内容')
    const selection = await model.value<{ target: { slide: number; revision: number } }>('montree_get_selection')
    expect(selection.target).toMatchObject({ slide: 1, revision: state.revision })
    await page.getByRole('button', { name: '第 3 页', exact: true }).click()
    await expect.poll(async () => (await model.value('montree_ppt_read', { documentPath })).context.visibleSlide).toBe(3)
    expect((await model.value('montree_ppt_read', { documentPath })).context).toMatchObject({ navigationSlide: 3, selectionSlide: null })
  } finally { await closeFixture(app) }
})
