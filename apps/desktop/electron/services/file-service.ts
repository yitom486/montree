import { dialog, BrowserWindow } from 'electron'
import { dirname, extname, join } from 'path'
import { mkdir, readFile, writeFile } from 'fs/promises'
import { ALL_DOCUMENT_EXTENSIONS, DEFAULT_SAVE_FILENAME, MARKDOWN_EXTENSIONS } from '@montree/contracts'
import { getDocumentKind } from '@montree/contracts'
import { IMAGE_EXTENSION_BY_MIME, IMAGE_MIME_BY_EXTENSION } from '@montree/contracts'
import { toAppError, type AppError } from '@montree/contracts'
import { err, ok, type Result } from '@montree/contracts'
import type {
  ExportDocumentPayload,
  ExportDocumentResult,
  ExportMarkdownPayload,
  OpenDialogOptions,
  OpenDocumentResult,
  OpenFileResult,
  OpenFolderResult,
  ReadBinaryResult,
  ReadImageResult,
  SaveFilePayload,
  SaveFileResult,
  SavePastedImagePayload,
  SavePastedImageResult,
} from '@montree/contracts'
import { scanWorkspace } from './workspace'
import { resolveExportSavePath } from './export-save-path'

/** Electron 文件对话框过滤器 */
export const MARKDOWN_DIALOG_FILTERS = [
  { name: 'Markdown', extensions: [...MARKDOWN_EXTENSIONS] },
  { name: 'All Files', extensions: ['*'] },
]

/** 打开文件对话框：Markdown + 电子书 */
export const DOCUMENT_DIALOG_FILTERS = [
  { name: '所有支持格式', extensions: [...ALL_DOCUMENT_EXTENSIONS] },
  { name: 'Markdown', extensions: [...MARKDOWN_EXTENSIONS] },
  { name: 'PDF', extensions: ['pdf'] },
  { name: 'EPUB', extensions: ['epub'] },
  { name: 'MOBI / Kindle', extensions: ['mobi', 'azw3', 'azw'] },
  { name: 'All Files', extensions: ['*'] },
]

export const HTML_DIALOG_FILTERS = [{ name: 'HTML', extensions: ['html', 'htm'] }]

export const PDF_DIALOG_FILTERS = [{ name: 'PDF', extensions: ['pdf'] }]

/** 粘贴图片默认保存到 Markdown 文件同级的 assets 目录 */
export const PASTED_IMAGE_ASSETS_DIR = 'assets'

const markdownFilters = MARKDOWN_DIALOG_FILTERS

export async function openDocumentDialog(
  options: OpenDialogOptions = {},
): Promise<Result<OpenDocumentResult, AppError>> {
  try {
    const { canceled, filePaths } = await dialog.showOpenDialog({
      title: '打开文件',
      filters: DOCUMENT_DIALOG_FILTERS,
      properties: ['openFile'],
      ...(options.defaultPath ? { defaultPath: options.defaultPath } : {}),
    })

    if (canceled || filePaths.length === 0) {
      return err({ code: 'CANCELLED', message: '已取消打开文件' })
    }

    const filePath = filePaths[0]!
    const kind = getDocumentKind(filePath)

    if (kind === 'markdown') {
      const content = await readFile(filePath, 'utf-8')
      return ok({ filePath, kind: 'markdown', content })
    }

    if (kind === 'pdf' || kind === 'epub' || kind === 'mobi') {
      return ok({ filePath, kind })
    }

    return err({
      code: 'UNSUPPORTED_FORMAT',
      message: '不支持的文件格式，请选择 Markdown、PDF、EPUB、MOBI 或 AZW3',
    })
  } catch (error) {
    return err(toAppError(error, '打开文件失败'))
  }
}

/** @deprecated 使用 openDocumentDialog */
export async function openFileDialog(
  options: OpenDialogOptions = {},
): Promise<Result<OpenFileResult, AppError>> {
  const result = await openDocumentDialog(options)
  if (!result.ok) return result
  if (result.value.kind !== 'markdown') {
    return err({
      code: 'UNSUPPORTED_FORMAT',
      message: '请选择 Markdown 文件',
    })
  }
  return ok({ filePath: result.value.filePath, content: result.value.content })
}

export async function scanWorkspaceFolder(
  rootPath: string,
): Promise<Result<OpenFolderResult, AppError>> {
  try {
    const tree = await scanWorkspace(rootPath)
    return ok({ rootPath, tree })
  } catch (error) {
    return err(toAppError(error, '扫描工作区失败'))
  }
}

export async function openFolderDialog(
  options: OpenDialogOptions = {},
): Promise<Result<OpenFolderResult, AppError>> {
  try {
    // E2E 测试时通过环境变量跳过原生对话框（先例见 export-save-path.ts）。
    const e2ePath = process.env.E2E_AUTO_OPEN_PATH?.trim()
    if (e2ePath) {
      return scanWorkspaceFolder(e2ePath)
    }

    const { canceled, filePaths } = await dialog.showOpenDialog({
      title: '打开文件夹',
      properties: ['openDirectory'],
      ...(options.defaultPath ? { defaultPath: options.defaultPath } : {}),
    })

    if (canceled || filePaths.length === 0) {
      return err({ code: 'CANCELLED', message: '已取消打开文件夹' })
    }

    const rootPath = filePaths[0]!
    return scanWorkspaceFolder(rootPath)
  } catch (error) {
    return err(toAppError(error, '打开文件夹失败'))
  }
}

export async function readFileByPath(
  filePath: string,
): Promise<Result<OpenFileResult, AppError>> {
  try {
    const kind = getDocumentKind(filePath)
    if (kind !== 'markdown') {
      return err({
        code: 'UNSUPPORTED_FORMAT',
        message: '该文件不是可编辑的 Markdown 文档',
      })
    }

    const content = await readFile(filePath, 'utf-8')
    return ok({ filePath, content })
  } catch (error) {
    return err(toAppError(error, '读取文件失败'))
  }
}

export async function readBinaryFileByPath(
  filePath: string,
): Promise<Result<ReadBinaryResult, AppError>> {
  try {
    const kind = getDocumentKind(filePath)
    if (kind !== 'pdf' && kind !== 'epub' && kind !== 'mobi') {
      return err({
        code: 'UNSUPPORTED_FORMAT',
        message: '该文件不是支持的电子书格式（PDF / EPUB / MOBI / AZW3）',
      })
    }

    const buffer = await readFile(filePath)
    return ok({ filePath, data: new Uint8Array(buffer) })
  } catch (error) {
    return err(toAppError(error, '读取文件失败'))
  }
}

export async function readImageAsDataUrl(
  filePath: string,
): Promise<Result<ReadImageResult, AppError>> {
  try {
    const mime = IMAGE_MIME_BY_EXTENSION[extname(filePath).toLowerCase()]
    if (!mime) {
      return err({
        code: 'FILE_READ_ERROR',
        message: '不支持的图片格式',
      })
    }

    const buffer = await readFile(filePath)
    return ok({
      dataUrl: `data:${mime};base64,${buffer.toString('base64')}`,
    })
  } catch (error) {
    return err(toAppError(error, '读取图片失败'))
  }
}

export async function saveFileDialog(
  payload: SaveFilePayload,
): Promise<Result<SaveFileResult, AppError>> {
  try {
    let filePath = payload.filePath

    if (!filePath) {
      const { canceled, filePath: selectedPath } = await dialog.showSaveDialog({
        title: '保存 Markdown 文件',
        filters: markdownFilters,
        defaultPath: payload.defaultPath ?? DEFAULT_SAVE_FILENAME,
      })

      if (canceled || !selectedPath) {
        return err({ code: 'CANCELLED', message: '已取消保存文件' })
      }

      filePath = selectedPath
    }

    await writeFile(filePath, payload.content, 'utf-8')
    return ok({ filePath })
  } catch (error) {
    return err(toAppError(error, '保存文件失败'))
  }
}

export async function savePastedImage(
  payload: SavePastedImagePayload,
): Promise<Result<SavePastedImageResult, AppError>> {
  try {
    const extension = IMAGE_EXTENSION_BY_MIME[payload.mimeType]
    if (!extension) {
      return err({ code: 'FILE_WRITE_ERROR', message: '不支持的图片格式' })
    }

    const markdownPath = payload.markdownFilePath?.trim()
    const workspaceRoot = payload.workspaceRoot?.trim()
    if (!markdownPath && !workspaceRoot) {
      return err({
        code: 'FILE_WRITE_ERROR',
        message: '保存粘贴图片需要 markdownFilePath 或 workspaceRoot',
      })
    }

    const assetsDir = markdownPath
      ? join(dirname(markdownPath), PASTED_IMAGE_ASSETS_DIR)
      : join(workspaceRoot!, '.montree', 'agent-pasted')
    await mkdir(assetsDir, { recursive: true })

    const fileName = `pasted-${Date.now()}${extension}`
    const absolutePath = join(assetsDir, fileName)
    await writeFile(absolutePath, Buffer.from(payload.base64, 'base64'))

    const relativePath = markdownPath
      ? `./${PASTED_IMAGE_ASSETS_DIR}/${fileName}`.replace(/\\/g, '/')
      : `.montree/agent-pasted/${fileName}`.replace(/\\/g, '/')

    return ok({ relativePath, absolutePath })
  } catch (error) {
    return err(toAppError(error, '保存粘贴图片失败'))
  }
}

export async function exportHtmlDocument(
  payload: ExportDocumentPayload,
): Promise<Result<ExportDocumentResult, AppError>> {
  try {
    const { canceled, filePath } = await resolveExportSavePath({
      title: '导出 HTML',
      filters: HTML_DIALOG_FILTERS,
      defaultPath: payload.suggestedName ?? 'export.html',
    })

    if (canceled || !filePath) {
      return err({ code: 'CANCELLED', message: '已取消导出 HTML' })
    }

    await writeFile(filePath, payload.html, 'utf-8')
    return ok({ filePath })
  } catch (error) {
    return err(toAppError(error, '导出 HTML 失败'))
  }
}

export async function exportPdfDocument(
  payload: ExportDocumentPayload,
): Promise<Result<ExportDocumentResult, AppError>> {
  let exportWindow: BrowserWindow | null = null

  try {
    const { canceled, filePath } = await resolveExportSavePath({
      title: '导出 PDF',
      filters: PDF_DIALOG_FILTERS,
      defaultPath: payload.suggestedName ?? 'export.pdf',
    })

    if (canceled || !filePath) {
      return err({ code: 'CANCELLED', message: '已取消导出 PDF' })
    }

    exportWindow = new BrowserWindow({
      show: false,
      webPreferences: {
        sandbox: true,
        nodeIntegration: false,
        contextIsolation: true,
      },
    })

    const dataUrl = `data:text/html;charset=utf-8,${encodeURIComponent(payload.html)}`
    await exportWindow.loadURL(dataUrl)
    await exportWindow.webContents.executeJavaScript(
      'document.fonts ? document.fonts.ready.then(() => true) : true',
    )

    const pdfBuffer = await exportWindow.webContents.printToPDF({
      printBackground: true,
      landscape: false,
      pageSize: 'A4',
      preferCSSPageSize: true,
      margins: { top: 0, bottom: 0, left: 0, right: 0 },
    })

    await writeFile(filePath, pdfBuffer)
    return ok({ filePath })
  } catch (error) {
    return err(toAppError(error, '导出 PDF 失败'))
  } finally {
    exportWindow?.destroy()
  }
}

export async function exportMarkdownDocument(
  payload: ExportMarkdownPayload,
): Promise<Result<ExportDocumentResult, AppError>> {
  try {
    const { canceled, filePath } = await resolveExportSavePath({
      title: payload.title ?? '导出 Markdown',
      filters: payload.filters ?? markdownFilters,
      defaultPath: payload.suggestedName ?? 'export.md',
    })

    if (canceled || !filePath) {
      return err({ code: 'CANCELLED', message: payload.title ? `已取消${payload.title}` : '已取消导出 Markdown' })
    }

    await writeFile(filePath, payload.content, 'utf-8')
    return ok({ filePath })
  } catch (error) {
    return err(toAppError(error, '导出 Markdown 失败'))
  }
}
