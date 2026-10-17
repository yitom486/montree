import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { isOk } from '@yitom/contracts'

const { showOpenDialog, showSaveDialog, printToPDF, loadURL, destroy, executeJavaScript } = vi.hoisted(() => ({
  showOpenDialog: vi.fn(),
  showSaveDialog: vi.fn(),
  printToPDF: vi.fn(),
  loadURL: vi.fn(),
  destroy: vi.fn(),
  executeJavaScript: vi.fn(),
}))

vi.mock('electron', () => {
  class MockBrowserWindow {
    loadURL = loadURL
    destroy = destroy
    webContents = { printToPDF, executeJavaScript }
  }

  return {
    dialog: {
      showOpenDialog,
      showSaveDialog,
    },
    BrowserWindow: MockBrowserWindow,
  }
})

import { exportHtmlDocument, exportPdfDocument, openDocumentDialog, readFileByPath, saveFileDialog } from './file-service'

describe('Typst text file lifecycle', () => {
  it('opens raw UTF-8/CRLF source via both dialog and path, with a distinct kind', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'typst-'))
    const filePath = join(dir, '中文😀.typ')
    const content = '#let title = "中文😀"\r\n= Hello\r\n$ x^2 $'
    await writeFile(filePath, content, 'utf-8')
    showOpenDialog.mockResolvedValueOnce({ canceled: false, filePaths: [filePath] })
    expect(await openDocumentDialog()).toEqual({ ok: true, value: { filePath, kind: 'typst', content } })
    expect(await readFileByPath(filePath)).toEqual({ ok: true, value: { filePath, content } })
  })

  it('uses Typst save filters/default and refuses a stale text baseline', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'typst-save-'))
    const filePath = join(dir, '论文.typ')
    showSaveDialog.mockResolvedValueOnce({ canceled: false, filePath })
    expect(await saveFileDialog({ content: '= 中文😀', documentKind: 'typst' })).toMatchObject({ ok: true, value: { filePath } })
    expect(showSaveDialog).toHaveBeenLastCalledWith(expect.objectContaining({
      title: '保存 Typst 文件', defaultPath: '未命名.typ', filters: [{ name: 'Typst', extensions: ['typ'] }],
    }))
    await writeFile(filePath, '= 外部修改', 'utf-8')
    const result = await saveFileDialog({ filePath, content: '= buffer', expectedContent: '= 中文😀', documentKind: 'typst' })
    expect(result.ok).toBe(false)
    expect(await readFile(filePath, 'utf-8')).toBe('= 外部修改')
  })

  it('canceling a Typst save leaves no write and returns CANCELLED', async () => {
    showSaveDialog.mockResolvedValueOnce({ canceled: true })
    expect(await saveFileDialog({ content: '= 草稿', documentKind: 'typst' })).toMatchObject({ ok: false, error: { code: 'CANCELLED' } })
  })
})

describe('exportHtmlDocument', () => {
  let tempDir = ''

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'export-html-'))
    showSaveDialog.mockReset()
    loadURL.mockResolvedValue(undefined)
  })

  afterEach(() => {
    tempDir = ''
    delete process.env.E2E_AUTO_EXPORT_PATH
  })

  it('写入 HTML 到用户选择的路径', async () => {
    const target = join(tempDir, 'out.html')
    showSaveDialog.mockResolvedValue({ canceled: false, filePath: target })

    const result = await exportHtmlDocument({
      html: '<!DOCTYPE html><html><body><h1>Hi</h1></body></html>',
      suggestedName: 'demo.html',
    })

    expect(isOk(result)).toBe(true)
    if (!isOk(result)) return
    expect(result.value.filePath).toBe(target)

    const written = await readFile(target, 'utf-8')
    expect(written).toContain('<h1>Hi</h1>')
  })

  it('用户取消时返回 CANCELLED', async () => {
    showSaveDialog.mockResolvedValue({ canceled: true, filePath: undefined })

    const result = await exportHtmlDocument({ html: '<p>x</p>' })

    expect(isOk(result)).toBe(false)
    if (isOk(result)) return
    expect(result.error.code).toBe('CANCELLED')
  })
})

describe('exportPdfDocument', () => {
  let tempDir = ''

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'export-pdf-'))
    showSaveDialog.mockReset()
    loadURL.mockClear()
    printToPDF.mockReset()
    destroy.mockClear()
    executeJavaScript.mockReset()
    executeJavaScript.mockResolvedValue(true)
    printToPDF.mockResolvedValue(Buffer.from('%PDF-1.4\n% mock pdf content'))
  })

  afterEach(() => {
    tempDir = ''
    delete process.env.E2E_AUTO_EXPORT_PATH
  })

  it('加载 HTML 并调用 printToPDF 写入 PDF 文件', async () => {
    const target = join(tempDir, 'out.pdf')
    showSaveDialog.mockResolvedValue({ canceled: false, filePath: target })

    const html = '<!DOCTYPE html><html><body><h1>Export</h1></body></html>'
    const result = await exportPdfDocument({ html, suggestedName: 'demo.pdf' })

    expect(isOk(result)).toBe(true)
    if (!isOk(result)) return
    expect(result.value.filePath).toBe(target)

    expect(loadURL).toHaveBeenCalledTimes(1)
    const loadedUrl = loadURL.mock.calls[0]?.[0] as string
    expect(loadedUrl.startsWith('data:text/html;charset=utf-8,')).toBe(true)
    expect(decodeURIComponent(loadedUrl.replace('data:text/html;charset=utf-8,', ''))).toContain(
      '<h1>Export</h1>',
    )

    expect(printToPDF).toHaveBeenCalledWith({
      printBackground: true,
      landscape: false,
      pageSize: 'A4',
      preferCSSPageSize: true,
      margins: { top: 0, bottom: 0, left: 0, right: 0 },
    })

    const written = await readFile(target)
    expect(written.subarray(0, 5).toString()).toBe('%PDF-')
    expect(destroy).toHaveBeenCalledTimes(1)
  })

  it('用户取消时不创建 PDF', async () => {
    showSaveDialog.mockResolvedValue({ canceled: true, filePath: undefined })

    const result = await exportPdfDocument({ html: '<p>x</p>' })

    expect(isOk(result)).toBe(false)
    if (isOk(result)) return
    expect(result.error.code).toBe('CANCELLED')
    expect(loadURL).not.toHaveBeenCalled()
    expect(printToPDF).not.toHaveBeenCalled()
  })

  it('E2E_AUTO_EXPORT_PATH 存在时跳过保存对话框', async () => {
    const target = join(tempDir, 'e2e.pdf')
    process.env.E2E_AUTO_EXPORT_PATH = target

    const result = await exportPdfDocument({ html: '<p>e2e export</p>' })

    expect(showSaveDialog).not.toHaveBeenCalled()
    expect(isOk(result)).toBe(true)
    if (!isOk(result)) return
    expect(result.value.filePath).toBe(target)

    const written = await readFile(target)
    expect(written.subarray(0, 5).toString()).toBe('%PDF-')
  })
})
