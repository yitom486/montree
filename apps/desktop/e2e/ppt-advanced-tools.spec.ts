import { mkdtemp, writeFile, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test, expect, type ElectronApplication, type Page } from '@playwright/test'
import { unzipSync, strFromU8 } from 'fflate'
import * as XLSX from 'xlsx'
import { launchBuiltApp } from './helpers/launch-app'
import { advancedPptFixture } from '../src/lib/data/presentation-test-fixture'

async function fixture() {
  const workspace = await mkdtemp(join(tmpdir(), 'montree-advanced-ppt-'))
  const documentPath = join(workspace, 'advanced.pptx'); const fixture = await advancedPptFixture()
  await writeFile(documentPath, fixture.original)
  const app = await launchBuiltApp({ E2E_AUTO_OPEN_PATH: workspace, E2E_DOCUMENT_TOOLS: '1' }); const page = await app.firstWindow()
  await page.getByRole('button', { name: '更多操作', exact: true }).click(); await page.getByRole('menuitem', { name: /打开文件夹/ }).click()
  await open(page, 'advanced.pptx'); await expect(page.locator('[data-slide="1"] [data-ppt-chart]')).toBeVisible()
  return { app, page, documentPath, ...fixture }
}
async function open(page: Page, file: string) {
  await page.keyboard.press('Control+p'); const dialog = page.getByRole('dialog', { name: '快速打开文件' })
  await dialog.getByPlaceholder('搜索工作区文件或电子书...').fill(file); await dialog.getByRole('button', { name: file, exact: true }).click()
}
async function client(app: ElectronApplication) {
  const endpoint = await app.evaluate(async () => (globalThis as any).__montreeE2eMcpEndpoint())
  let id = 0; const transcript: unknown[] = []
  const rpc = async (method: string, params?: unknown) => {
    const response = await fetch(endpoint.url, { method: 'POST', headers: { Authorization: `Bearer ${endpoint.authToken}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: ++id, method, params }) })
    expect(response.status).toBe(200); const result = await response.json() as any; expect(result.error).toBeUndefined(); return result.result
  }
  const call = async (name: string, args: Record<string, unknown>) => {
    const model = { tool_calls: [{ id: `mock-${id + 1}`, type: 'function', function: { name, arguments: JSON.stringify(args) } }] }
    const result = await rpc('tools/call', { name: model.tool_calls[0].function.name, arguments: JSON.parse(model.tool_calls[0].function.arguments) })
    transcript.push({ model, result }); return result
  }
  const value = async (name: string, args: Record<string, unknown>) => { const result = await call(name, args); expect(result.isError, result.content[0].text).not.toBe(true); return JSON.parse(result.content[0].text) }
  return { rpc, call, value, transcript }
}
async function close(app: ElectronApplication) { await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().forEach((window) => window.removeAllListeners('close'))); await app.close() }

test('mock模型经真实HTTP MCP编辑嵌套组合、图表数据源、共享设计与动画，预览/放映/撤销/保存重开', async ({}, info) => {
  const { app, page, documentPath, files } = await fixture()
  try {
    const model = await client(app); const tools = await model.rpc('tools/list')
    expect(tools.tools.map((tool: any) => tool.name)).toEqual(expect.arrayContaining(['montree_ppt_chart_edit', 'montree_ppt_design_edit', 'montree_ppt_animation_edit']))
    let state = await model.value('montree_ppt_read', { documentPath, slide: 1 })
    const child = state.elements.find((element: any) => element.text === '组合标题')
    const otherChild = state.elements.find((element: any) => element.text === '组合说明')
    const chartElement = state.elements.find((element: any) => element.chart)
    expect(child.parentId).toBe('101'); expect(child.coordinateSpace).toBe('parent-group-points')
    await page.locator(`[data-slide="1"] [data-element-id="${child.id}"]`).click()
    const selection = await model.value('montree_get_selection', {})
    expect(selection.target.elementIds).toEqual([child.id])
    state = await model.value('montree_ppt_edit_text', { documentPath, revision: state.revision, slide: 1, selectionId: selection.target.selectionId, expectedCount: 1,
      edits: [{ elementId: child.id, paragraphId: 'p1', expectedText: child.text, patch: { text: '组内精细编辑', color: '#059669' } }] })
    await expect(page.locator(`[data-slide="1"] [data-element-id="${child.id}"]`)).toHaveText('组内精细编辑')
    state = await model.value('montree_ppt_edit', { documentPath, revision: state.revision, slide: 1, elementIds: [child.id], expectedCount: 1, patch: { x: 80, width: 600 } })
    expect(await page.locator(`[data-slide="1"] [data-element-id="${child.id}"]`).evaluate((node) => (node as HTMLElement).style.left)).toBe('10%')
    const groupFontRatio = await page.locator(`[data-slide="1"] [data-element-id="${child.id}"] [data-run-id]`).evaluate((node) => parseFloat(getComputedStyle(node).fontSize) / (node.closest('[data-slide-canvas]') as HTMLElement).clientWidth)
    expect(groupFontRatio).toBeCloseTo(30 / 960, 3)
    state = await model.value('montree_ppt_delete', { documentPath, revision: state.revision, slide: 1, elementIds: [otherChild.id], expectedCount: 1 })
    await expect(page.locator(`[data-slide="1"] [data-element-id="${otherChild.id}"]`)).toHaveCount(0)
    state = await model.value('montree_document_undo', { documentPath, revision: state.revision })
    await expect(page.locator(`[data-slide="1"] [data-element-id="${otherChild.id}"]`)).toBeVisible()
    state = await model.value('montree_ppt_chart_edit', { documentPath, revision: state.revision, expectedCount: 1,
      edits: [{ slide: 1, elementId: chartElement.id, expectedSlides: [1], patch: { title: 'AI 更新季度报表', categories: ['第一季', '第二季'], series: [{ id: chartElement.chart.series[0].id, name: '净收入', values: [30, 45], color: '#059669' }] } }] })
    const chart = page.locator('[data-slide="1"] [data-ppt-chart]')
    await expect(chart).toHaveAttribute('aria-label', 'AI 更新季度报表')
    await expect(chart.locator(`[data-chart-series="${chartElement.chart.series[0].id}"]`).first()).toHaveAttribute('fill', '#059669')
    const design = await model.value('montree_ppt_read', { documentPath, target: 'design' })
    const master = design.parts.find((part: any) => part.kind === 'master')
    state = await model.value('montree_ppt_design_edit', { documentPath, revision: state.revision, expectedCount: 1,
      edits: [{ kind: 'style', partId: master.partId, expectedSlides: master.affectedSlides, patch: { fontSize: 36, color: '#059669' } }] })
    await expect(page.locator('[data-slide="2"] [data-slide-paragraph]').filter({ hasText: '继承标题' }).locator('span')).toHaveCSS('color', 'rgb(5, 150, 105)')
    const layout = design.parts.find((part: any) => part.kind === 'layout' && part.affectedSlides.includes(1))
    const decorative = layout.elements.find((element: any) => element.paragraphs.length)
    state = await model.value('montree_ppt_design_edit', { documentPath, revision: state.revision, expectedCount: 1,
      edits: [{ kind: 'style', partId: layout.partId, expectedSlides: layout.affectedSlides, patch: { backgroundColor: '#FEF3C7' } }] })
    await expect(page.locator('[data-slide="1"] [data-slide-canvas]')).toHaveCSS('background-color', 'rgb(254, 243, 199)')
    state = await model.value('montree_ppt_design_edit', { documentPath, revision: state.revision, expectedCount: 1,
      edits: [{ kind: 'style', partId: layout.partId, expectedSlides: layout.affectedSlides, elementId: decorative.id, paragraphId: 'p1', expectedText: decorative.paragraphs[0].text, patch: { text: 'AI 更新母版标识' } }] })
    await expect(page.locator('[data-slide="1"] [data-slide-paragraph]').filter({ hasText: 'AI 更新母版标识' })).toBeVisible()
    const anotherLayout = design.parts.find((part: any) => part.kind === 'layout' && part.partId !== layout.partId)
    state = await model.value('montree_ppt_design_edit', { documentPath, revision: state.revision, expectedCount: 1,
      edits: [{ kind: 'apply-layout', slide: 3, layoutId: anotherLayout.partId, expectedLayoutId: layout.partId }] })
    expect((await model.value('montree_ppt_read', { documentPath, target: 'design' })).slides[2].layoutId).toBe(anotherLayout.partId)
    state = await model.value('montree_document_undo', { documentPath, revision: state.revision })
    state = await model.value('montree_ppt_animation_edit', { documentPath, revision: state.revision, expectedCount: 2, edits: [
      { slide: 1, expectedEffectIds: [], effects: [
        { elementId: child.id, effect: 'fade', trigger: 'onClick', durationMs: 200, delayMs: 0 },
        { elementId: otherChild.id, effect: 'appear', trigger: 'afterPrevious', durationMs: 1, delayMs: 800 },
        { elementId: chartElement.id, effect: 'fade', trigger: 'onClick', durationMs: 200, delayMs: 0 },
      ] }, { slide: 2, transition: { effect: 'push', direction: 'left', durationMs: 1500, advanceOnClick: true } },
    ] })
    const animation = await model.value('montree_ppt_read', { documentPath, target: 'animation', slide: 1 })
    expect(animation.slides[0].editable).toBe(true); expect(animation.slides[0].effects).toHaveLength(3)
    await page.getByRole('button', { name: '第 1 页', exact: true }).click()
    await page.locator('[data-slide="1"] [data-slide-canvas]').screenshot({ path: info.outputPath('advanced-preview.png') })
    await page.getByRole('button', { name: '全屏放映', exact: true }).click()
    await expect(page.getByRole('button', { name: '退出全屏' })).toBeVisible()
    const stage = page.locator('[data-ppt-slideshow]')
    const title = stage.locator(`[data-element-id="${child.id}"]`); const subtitle = stage.locator(`[data-element-id="${otherChild.id}"]`)
    await expect(title).toHaveCSS('visibility', 'hidden'); await expect(subtitle).toHaveCSS('visibility', 'hidden')
    await page.getByRole('button', { name: '播放下一组动画' }).click()
    await expect(title).toHaveAttribute('data-animation-state', 'shown')
    await expect(subtitle).toHaveCSS('visibility', 'hidden')
    await expect(subtitle).toHaveAttribute('data-animation-state', 'shown')
    await expect(stage.locator(`[data-element-id="${chartElement.id}"]`)).toHaveCSS('visibility', 'hidden')
    await page.getByRole('button', { name: '播放下一组动画' }).click()
    await expect(stage.locator(`[data-element-id="${chartElement.id}"]`)).toHaveAttribute('data-animation-state', 'shown')
    await stage.screenshot({ path: info.outputPath('advanced-slideshow.png') })
    await page.getByRole('button', { name: '下一张幻灯片' }).click()
    await expect(page.locator('[data-ppt-presentation-slide]')).toHaveAttribute('data-slide', '2')
    expect(await page.locator('[data-ppt-presentation-slide]').evaluate((node) => node.getAnimations().some((animation) => animation.playState === 'running'))).toBe(true)
    await page.getByRole('button', { name: '退出全屏' }).click()
    await model.value('montree_document_save', { documentPath, revision: state.revision })
    const saved = await readFile(documentPath); const parts = unzipSync(saved)
    expect(parts['ppt/custom/keep.xml']).toEqual(files['ppt/custom/keep.xml'])
    const embedded = Object.keys(parts).find((part) => part.startsWith('ppt/embeddings/') && /1\.xlsx$/.test(part))!
    const workbook = XLSX.read(parts[embedded], { type: 'array' }); expect(workbook.Sheets[workbook.SheetNames[0]].B2.v).toBe(30)
    expect(strFromU8(parts['ppt/slides/slide1.xml'])).toContain('spid=')
    await writeFile(join(documentPath, '..', 'reload.pptx'), saved); await open(page, 'reload.pptx')
    const newPath = join(documentPath, '..', 'reload.pptx')
    await expect.poll(async () => (await model.call('montree_ppt_read', { documentPath: newPath })).isError !== true).toBe(true)
    const reopened = await model.value('montree_ppt_read', { documentPath: newPath, slide: 1 })
    expect(reopened.elements.find((element: any) => element.id === child.id).text).toBe('组内精细编辑')
    expect(reopened.elements.find((element: any) => element.chart).chart.series[0].values).toEqual([30, 45])
    expect((await model.value('montree_ppt_read', { documentPath: newPath, target: 'animation', slide: 1 })).slides[0].effects).toEqual(animation.slides[0].effects)
    const transcript = info.outputPath('mock-advanced-tool-transcript.json'); await writeFile(transcript, JSON.stringify(model.transcript, null, 2)); await info.attach('mock-advanced-tool-transcript', { path: transcript, contentType: 'application/json' })
    await writeFile(info.outputPath('roundtrip.pptx'), saved)
  } finally { await close(app) }
})

test('高级工具非法目标/数量/版本/共享范围/动画引用/数据数量整批拒绝，模型和磁盘保持原样', async () => {
  const { app, documentPath, original } = await fixture()
  try {
    const model = await client(app); const before = await model.value('montree_ppt_read', { documentPath, slide: 1 })
    const chart = before.elements.find((element: any) => element.chart); const child = before.elements.find((element: any) => element.text === '组合标题')
    const design = await model.value('montree_ppt_read', { documentPath, target: 'design' }); const master = design.parts.find((part: any) => part.kind === 'master')
    const chartEdit = { slide: 1, elementId: chart.id, expectedSlides: [1], patch: { title: 'valid' } }
    const animationEdit = { slide: 1, expectedEffectIds: [], effects: [{ elementId: child.id, effect: 'fade', trigger: 'onClick', durationMs: 100, delayMs: 0 }] }
    const badCalls: Array<[string, any]> = [
      ['montree_ppt_chart_edit', { edits: [{ ...chartEdit, patch: { series: [{ id: chart.chart.series[0].id, values: [1] }] } }], expectedCount: 1 }],
      ['montree_ppt_chart_edit', { edits: [chartEdit, { ...chartEdit, elementId: 'missing' }], expectedCount: 2 }],
      ['montree_ppt_chart_edit', { edits: [chartEdit], expectedCount: 2 }],
      ['montree_ppt_chart_edit', { edits: [{ ...chartEdit, expectedSlides: [1, 2] }], expectedCount: 1 }],
      ['montree_ppt_design_edit', { edits: [{ kind: 'style', partId: master.partId, expectedSlides: [1], patch: { color: '#123456' } }], expectedCount: 1 }],
      ['montree_ppt_design_edit', { edits: [{ kind: 'style', partId: '../../outside.xml', expectedSlides: [], patch: { color: '#123456' } }], expectedCount: 1 }],
      ['montree_ppt_animation_edit', { edits: [{ ...animationEdit, expectedEffectIds: ['stale'] }], expectedCount: 1 }],
      ['montree_ppt_animation_edit', { edits: [{ ...animationEdit, effects: [animationEdit.effects[0], animationEdit.effects[0]] }], expectedCount: 1 }],
      ['montree_ppt_animation_edit', { edits: [{ ...animationEdit, effects: [{ ...animationEdit.effects[0], effect: 'motionPath' }] }], expectedCount: 1 }],
      ['montree_ppt_animation_edit', { edits: [animationEdit], expectedCount: 1, revision: 99 }],
    ]
    for (const [name, args] of badCalls) {
      const result = await model.call(name, { documentPath, revision: before.revision, ...args })
      expect(result.isError, name).toBe(true)
      expect(await model.value('montree_ppt_read', { documentPath, slide: 1 })).toEqual(before)
      expect(await readFile(documentPath)).toEqual(Buffer.from(original))
    }
    const applied = await model.value('montree_ppt_animation_edit', { documentPath, revision: 0, edits: [animationEdit], expectedCount: 1 })
    const rejected = await model.call('montree_ppt_delete', { documentPath, revision: applied.revision, slide: 1, elementIds: [child.id], expectedCount: 1 })
    expect(rejected.isError).toBe(true); expect(rejected.content[0].text).toContain('动画')
    const animation = await model.value('montree_ppt_read', { documentPath, target: 'animation', slide: 1 })
    const cleared = await model.value('montree_ppt_animation_edit', { documentPath, revision: applied.revision, expectedCount: 1, edits: [{ slide: 1, expectedEffectIds: animation.slides[0].effects.map((effect: any) => effect.id), effects: [] }] })
    await model.value('montree_ppt_delete', { documentPath, revision: cleared.revision, slide: 1, elementIds: [child.id], expectedCount: 1 })
  } finally { await close(app) }
})

test('自动翻页和与上一效果同时启动，退出放映后清理延时任务', async () => {
  const { app, page, documentPath } = await fixture()
  try {
    const model = await client(app); const before = await model.value('montree_ppt_read', { documentPath, slide: 1 }); const child = before.elements.find((element: any) => element.text === '组合标题')
    await model.value('montree_ppt_animation_edit', { documentPath, revision: 0, expectedCount: 1, edits: [{ slide: 1,
      transition: { effect: 'none', durationMs: 0, advanceOnClick: false, advanceAfterMs: 1500 }, expectedEffectIds: [],
      effects: [{ elementId: child.id, effect: 'appear', trigger: 'withPrevious', durationMs: 1, delayMs: 50 }] }] })
    // Keep fullscreen denial and the browser clock local to this test instance.
    await page.locator('div[data-reader-viewport]').evaluate((node) => { node.requestFullscreen = () => Promise.reject(new Error('denied')) })
    await page.clock.install()
    await page.getByRole('button', { name: '全屏放映', exact: true }).click(); await page.clock.runFor(100)
    await expect(page.locator(`[data-ppt-slideshow] [data-element-id="${child.id}"]`)).toHaveAttribute('data-animation-state', 'shown')
    await page.locator('[data-ppt-presentation-stage]').click(); await expect(page.locator('[data-ppt-presentation-slide]')).toHaveAttribute('data-slide', '1')
    await page.clock.runFor(1600); await expect(page.locator('[data-ppt-presentation-slide]')).toHaveAttribute('data-slide', '2')
    await page.getByRole('button', { name: '结束放映' }).click(); await page.getByRole('button', { name: '第 1 页', exact: true }).click()
    await page.getByRole('button', { name: '全屏放映', exact: true }).click(); await page.clock.runFor(100)
    await page.getByRole('button', { name: '结束放映' }).click(); await page.clock.runFor(2000)
    await expect(page.locator('[data-ppt-slideshow]')).toHaveCount(0)
    await expect(page.getByRole('button', { name: '第 1 页', exact: true })).toHaveAttribute('data-variant', 'secondary')
  } finally { await close(app) }
})
