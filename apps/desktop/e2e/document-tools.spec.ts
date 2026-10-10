import { mkdtemp, writeFile, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import * as XLSX from 'xlsx'
import PptxGenJS from 'pptxgenjs'
import { unzipSync, zipSync, strToU8, strFromU8 } from 'fflate'
import { test, expect, type ElectronApplication, type Page } from '@playwright/test'
import { launchBuiltApp } from './helpers/launch-app'

async function tool(app: ElectronApplication, name: string, args: Record<string, unknown>) {
  const result = await app.evaluate(async (_, payload) => {
    const invoke = (globalThis as unknown as { __montreeE2eDocumentTools: (name: string, args: Record<string, unknown>) => Promise<{ content: Array<{ text: string }> }> }).__montreeE2eDocumentTools
    return invoke(payload.name, payload.args)
  }, { name, args })
  return JSON.parse(result.content[0].text)
}
async function snapshot(app: ElectronApplication, resource: string, args?: Record<string, unknown>) {
  return app.evaluate(async (_, payload) => (globalThis as unknown as { __montreeE2eDocumentSnapshot: (resource: string, args?: Record<string, unknown>) => Promise<string> }).__montreeE2eDocumentSnapshot(payload.resource, payload.args), { resource, args })
}
async function open(page: Page, name: string) {
  await page.keyboard.press('Control+p')
  const dialog = page.getByRole('dialog', { name: '快速打开文件' })
  await dialog.getByPlaceholder('搜索工作区文件或电子书...').fill(name)
  await page.keyboard.press('Enter')
  await expect(dialog).toBeHidden()
}
async function workspaceApp(workspace: string) {
  const app = await launchBuiltApp({ E2E_AUTO_OPEN_PATH: workspace, E2E_DOCUMENT_TOOLS: '1' })
  const page = await app.firstWindow()
  await page.getByRole('button', { name: '更多操作', exact: true }).click()
  await page.getByRole('menuitem', { name: /打开文件夹/ }).click()
  return { app, page }
}

test('CSV筛选按原始地址编辑，空白多格选区、数量校验、撤销与磁盘保存', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'montree-table-'))
  const documentPath = join(workspace, 'data.csv')
  await writeFile(documentPath, 'name,value\nfirst,10\nneedle,20')
  const { app, page } = await workspaceApp(workspace)
  try {
    await open(page, 'data.csv')
    await expect(page.getByRole('textbox', { name: 'Sheet1!B3', exact: true })).toHaveValue('20')
    await page.getByRole('textbox', { name: '搜索表格' }).fill('needle')
    const input = page.getByRole('textbox', { name: 'Sheet1!B3', exact: true })
    await input.fill('changed'); await input.press('Enter')
    let state = await tool(app, 'montree_table_read', { documentPath })
    const values = await tool(app, 'montree_table_read', { documentPath, sheet: 'Sheet1', target: { range: 'B2:B3' } })
    expect(values.regions[0].cells.map((row: Array<{ value: string }>) => row[0].value)).toEqual(['10', 'changed'])
    await page.getByRole('textbox', { name: '搜索表格' }).fill('')
    await page.getByRole('textbox', { name: '单元格地址' }).fill('C4:D5')
    await page.getByRole('textbox', { name: '单元格地址' }).press('Enter')
    const selected = JSON.parse(await snapshot(app, 'selection'))
    expect(selected.target.ranges).toEqual(['C4:D5'])
    await expect(tool(app, 'montree_table_edit', { documentPath, revision: state.revision, sheet: 'Sheet1', target: { selectionId: selected.target.selectionId }, operation: 'set', values: [['wrong']], expectedCount: 4 })).rejects.toThrow('完全匹配')
    state = await tool(app, 'montree_table_edit', { documentPath, revision: state.revision, sheet: 'Sheet1', target: { selectionId: selected.target.selectionId }, operation: 'set', values: [['a', 'b'], ['c', 'd']], expectedCount: 4 })
    await expect(page.getByRole('textbox', { name: 'Sheet1!C4', exact: true })).toHaveValue('a')
    state = await tool(app, 'montree_document_undo', { documentPath, revision: state.revision })
    await expect(page.getByRole('textbox', { name: 'Sheet1!C4', exact: true })).toHaveValue('')
    await tool(app, 'montree_document_save', { documentPath, revision: state.revision })
    expect(await readFile(documentPath, 'utf8')).toContain('needle,changed')
    expect(await snapshot(app, 'chapter.txt')).toContain('changed')
    expect(JSON.parse(await snapshot(app, 'toc.json')).entries[0].label).toBe('Sheet1')
  } finally { await app.close() }
})

test('XLSX写入公式和单元格并保存，未改部件保留，外部修改拒绝覆盖', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'montree-excel-'))
  const documentPath = join(workspace, 'book.xlsx')
  const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['name', 'value'], ['item', 12]]), 'Data')
  const files = unzipSync(new Uint8Array(XLSX.write(wb, { type: 'array', bookType: 'xlsx' })))
  files['xl/custom/keep.xml'] = strToU8('<keep/>')
  await writeFile(documentPath, zipSync(files))
  const { app, page } = await workspaceApp(workspace)
  try {
    await open(page, 'book.xlsx')
    await expect(page.getByRole('textbox', { name: 'Data!B2', exact: true })).toHaveValue('12')
    let state = await tool(app, 'montree_table_read', { documentPath })
    state = await tool(app, 'montree_table_edit', { documentPath, revision: state.revision, sheet: 'Data', target: { range: 'B2:C2' }, operation: 'set', values: [[25, { formula: 'B2*2' }]], expectedCount: 2 })
    await page.keyboard.press('Control+s')
    await expect.poll(async () => XLSX.read(await readFile(documentPath), { type: 'buffer' }).Sheets.Data.B2.v).toBe(25)
    const saved = await readFile(documentPath)
    expect(XLSX.read(saved, { type: 'buffer' }).Sheets.Data.C2.f).toBe('B2*2')
    expect(unzipSync(saved)['xl/custom/keep.xml']).toEqual(files['xl/custom/keep.xml'])
    expect(await snapshot(app, 'chapter.txt')).toContain('B2=25')
    await writeFile(documentPath, zipSync({ ...unzipSync(saved), 'changed.xml': strToU8('<external/>') }))
    await expect(tool(app, 'montree_document_save', { documentPath, revision: state.revision })).rejects.toThrow('其他程序修改')
  } finally { await app.close() }
})

test('PPT原始元素选区、文字修改、删除与撤销，保存后仍保留主题部件', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'montree-ppt-'))
  const documentPath = join(workspace, 'slides.pptx')
  const ppt = new PptxGenJS(); const slide = ppt.addSlide()
  slide.addText('Original title', { x: 1, y: 1, w: 5, h: 1, fontSize: 24 })
  slide.addText('Second element', { x: 1, y: 3, w: 5, h: 1 })
  const original = new Uint8Array(await ppt.write({ outputType: 'arraybuffer' }) as ArrayBuffer)
  await writeFile(documentPath, original)
  const { app, page } = await workspaceApp(workspace)
  try {
    await open(page, 'slides.pptx')
    await expect(page.locator('[data-element-id]').first()).toBeVisible()
    let state = await tool(app, 'montree_ppt_read', { documentPath, slide: 1 })
    const id = state.elements.find((element: { text: string }) => element.text === 'Original title').id
    await page.locator(`[data-element-id="${id}"]`).click()
    const selected = JSON.parse(await snapshot(app, 'selection'))
    expect(selected.target.elementIds).toEqual([id])
    state = await tool(app, 'montree_ppt_edit', { documentPath, revision: state.revision, slide: 1, selectionId: selected.target.selectionId, expectedCount: 1, patch: { text: 'Updated title', x: 40, color: '#123456' } })
    await expect(page.locator(`[data-element-id="${id}"]`)).toHaveText('Updated title')
    state = await tool(app, 'montree_ppt_delete', { documentPath, revision: state.revision, slide: 1, elementIds: [id], expectedCount: 1 })
    await expect(page.locator(`[data-element-id="${id}"]`)).toHaveCount(0)
    state = await tool(app, 'montree_document_undo', { documentPath, revision: state.revision })
    await tool(app, 'montree_document_save', { documentPath, revision: state.revision })
    const saved = unzipSync(await readFile(documentPath)); const before = unzipSync(original)
    expect(strFromU8(saved['ppt/slides/slide1.xml'])).toContain('Updated title')
    expect(saved['ppt/theme/theme1.xml']).toEqual(before['ppt/theme/theme1.xml'])
    expect(await snapshot(app, 'chapter.txt')).toContain('Updated title')
    expect(JSON.parse(await snapshot(app, 'toc.json')).entries[0].label).toBe('幻灯片 1')
  } finally { await app.close() }
})

test('PPT按原稿渲染段落默认样式、字号比例和显式换行，编辑撤销同步预览', async ({}, info) => {
  const workspace = await mkdtemp(join(tmpdir(), 'montree-ppt-preview-'))
  const documentPath = join(workspace, 'preview.pptx')
  const ppt = new PptxGenJS(); ppt.layout = 'LAYOUT_WIDE'
  const slide = ppt.addSlide()
  slide.addText('placeholder', { x: 1.2, y: 2.2, w: 11, h: 1.8 })
  slide.addText('placeholder', { x: 1.2, y: 5.2, w: 6, h: 1 })
  const files = unzipSync(new Uint8Array(await ppt.write({ outputType: 'arraybuffer' }) as ArrayBuffer))
  const bodies = [
    '<p:txBody><a:bodyPr wrap="none"/><a:lstStyle/><a:p><a:pPr><a:defRPr sz="4000" b="1"><a:solidFill><a:srgbClr val="1E293B"/></a:solidFill></a:defRPr></a:pPr><a:r><a:t>Montree 桌面端多格式文档与 Agent 架构</a:t></a:r></a:p><a:p><a:pPr><a:spcBef><a:spcPts val="1400"/></a:spcBef><a:defRPr sz="2000"><a:solidFill><a:srgbClr val="64748B"/></a:solidFill></a:defRPr></a:pPr><a:r><a:t>从 Markdown 笔记、电子书阅读到 Office 矩阵与 Skills 智能体生态演进</a:t></a:r></a:p></p:txBody>',
    '<p:txBody><a:bodyPr wrap="none"/><a:lstStyle/><a:p><a:pPr><a:defRPr sz="1300"><a:solidFill><a:srgbClr val="94A3B8"/></a:solidFill></a:defRPr></a:pPr><a:r><a:t>汇报人: Montree 架构设计团队</a:t></a:r><a:br/><a:r><a:t>日期: 2026 年 10 月</a:t></a:r></a:p></p:txBody>',
  ]
  let bodyIndex = 0
  files['ppt/slides/slide1.xml'] = strToU8(strFromU8(files['ppt/slides/slide1.xml']).replace(/<p:txBody>.*?<\/p:txBody>/gs, () => bodies[bodyIndex++]))
  // Optional real-file reproduction operates exclusively on a temporary copy.
  const original = process.env.E2E_PPT_REFERENCE_PATH ? await readFile(process.env.E2E_PPT_REFERENCE_PATH) : zipSync(files)
  await writeFile(documentPath, original)
  const { app, page } = await workspaceApp(workspace)
  try {
    await open(page, 'preview.pptx')
    const canvas = page.locator('[data-slide="1"] [data-slide-canvas]')
    const paragraphs = canvas.locator('[data-slide-paragraph]')
    await expect(paragraphs).toHaveCount(3)
    await expect(canvas).toHaveCSS('background-color', 'rgb(255, 255, 255)')
    await expect(paragraphs.nth(0).locator('span').first()).toHaveCSS('font-weight', '700')
    await expect(paragraphs.nth(0).locator('span').first()).toHaveCSS('color', 'rgb(30, 41, 59)')
    await expect(paragraphs.nth(1).locator('span').first()).toHaveCSS('color', 'rgb(100, 116, 139)')
    await expect(paragraphs.nth(2)).toHaveText('汇报人: Montree 架构设计团队\n日期: 2026 年 10 月')
    const dimensions = await canvas.evaluate((node) => {
      const text = node.querySelectorAll('[data-slide-paragraph]')
      return { width: node.clientWidth, font: Number.parseFloat(getComputedStyle(text[0].querySelector('span')!).fontSize), subtitle: Number.parseFloat(getComputedStyle(text[1].querySelector('span')!).fontSize), before: Number.parseFloat(getComputedStyle(text[1]).marginTop) }
    })
    expect(dimensions.font / dimensions.subtitle).toBeCloseTo(2, 2)
    expect(dimensions.font / dimensions.width).toBeCloseTo(40 / 960, 3)
    expect(dimensions.before / dimensions.width).toBeCloseTo(14 / 960, 3)
    await canvas.screenshot({ path: info.outputPath('ppt-preview.png') })
    let state = await tool(app, 'montree_ppt_read', { documentPath, slide: 1 })
    const id = state.elements[0].id
    state = await tool(app, 'montree_ppt_edit', { documentPath, revision: state.revision, slide: 1, elementIds: [id], expectedCount: 1, patch: { fontSize: 32, color: '#123456' } })
    await expect(canvas.locator('[data-slide-paragraph]').first().locator('span').first()).toHaveCSS('color', 'rgb(18, 52, 86)')
    await tool(app, 'montree_document_undo', { documentPath, revision: state.revision })
    await expect(canvas.locator('[data-slide-paragraph]').first().locator('span').first()).toHaveCSS('color', 'rgb(30, 41, 59)')
    expect(await readFile(documentPath)).toEqual(Buffer.from(original))
  } finally { await app.close() }
})

test('JSON、LOG、本地HTML和Word接入通用正文、目录与搜索', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'montree-doc-read-'))
  await writeFile(join(workspace, 'config.json'), JSON.stringify({ name: 'JSON needle', nested: { enabled: true } }))
  await writeFile(join(workspace, 'server.log'), '2026-10-10 INFO LOG needle\nnext line')
  await writeFile(join(workspace, 'page.html'), '<!doctype html><html><body><h1>HTML heading</h1><p>HTML needle</p></body></html>')
  await writeFile(join(workspace, 'report.docx'), zipSync({
    '[Content_Types].xml': strToU8('<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>'),
    '_rels/.rels': strToU8('<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>'),
    'word/document.xml': strToU8('<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>Word needle</w:t></w:r></w:p><w:sectPr><w:pgSz w:w="11906" w:h="16838"/></w:sectPr></w:body></w:document>'),
  }))
  const { app, page } = await workspaceApp(workspace)
  try {
    for (const [name, text] of [['config.json', 'JSON needle'], ['server.log', 'LOG needle'], ['page.html', 'HTML needle'], ['report.docx', 'Word needle']]) {
      await open(page, name)
      await expect.poll(async () => { try { return await snapshot(app, 'chapter.txt') } catch { return '' } }).toContain(text)
      expect(await snapshot(app, 'search', { query: 'needle' })).toContain('needle')
      expect(await snapshot(app, 'viewport.txt')).toContain('needle')
      expect(JSON.parse(await snapshot(app, 'toc.json')).entries.length).toBeGreaterThan(0)
    }
  } finally { await app.close() }
})
