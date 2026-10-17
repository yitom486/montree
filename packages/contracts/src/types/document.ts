import {
  DATA_EXTENSION_SET,
  HTML_EXTENSION_SET,
  MARKDOWN_EXTENSION_SET,
  OFFICE_EXTENSION_SET,
  READER_EXTENSION_SET,
  TYPST_EXTENSION_SET,
} from '../constants/extensions'

/** 纯文本/结构化数据格式 */
export type DataDocumentKind = 'csv' | 'tsv' | 'json' | 'log'

/** Office 文档格式 */
export type OfficeDocumentKind = 'docx' | 'xlsx' | 'pptx'

/** 当前打开内容的种类；web 用 http(s) URL 当 path，不是磁盘扩展名 */
export type DocumentKind =
  | 'markdown'
  | 'typst'
  | 'pdf'
  | 'epub'
  | 'mobi'
  | 'web'
  | 'html'
  | DataDocumentKind
  | OfficeDocumentKind
  | 'unknown'

/** 走阅读器而不是 Markdown 编辑器的本地电子书 */
export type ReaderDocumentKind = Extract<DocumentKind, 'pdf' | 'epub' | 'mobi'>

export function isWebDocumentPath(path: string): boolean {
  try {
    const url = new URL(path)
    return url.protocol === 'http:' || url.protocol === 'https:'
  } catch {
    return false
  }
}

export function getFileExtension(filePath: string): string {
  const index = filePath.lastIndexOf('.')
  if (index === -1) return ''
  return filePath.slice(index).toLowerCase()
}

export function getDocumentKind(filePath: string): DocumentKind {
  if (isWebDocumentPath(filePath)) return 'web'
  const extension = getFileExtension(filePath)
  if (MARKDOWN_EXTENSION_SET.has(extension)) return 'markdown'
  if (TYPST_EXTENSION_SET.has(extension)) return 'typst'
  if (HTML_EXTENSION_SET.has(extension)) return 'html'
  if (extension === '.pdf') return 'pdf'
  if (extension === '.epub') return 'epub'
  if (extension === '.mobi' || extension === '.azw3' || extension === '.azw') return 'mobi'
  if (extension === '.csv') return 'csv'
  if (extension === '.tsv') return 'tsv'
  if (extension === '.json') return 'json'
  if (extension === '.log') return 'log'
  if (extension === '.docx') return 'docx'
  if (extension === '.xlsx') return 'xlsx'
  if (extension === '.pptx') return 'pptx'
  return 'unknown'
}

export function isReaderDocumentKind(kind: DocumentKind): kind is ReaderDocumentKind {
  return kind === 'pdf' || kind === 'epub' || kind === 'mobi'
}

export function isDataDocumentKind(kind: DocumentKind): kind is DataDocumentKind {
  return kind === 'csv' || kind === 'tsv' || kind === 'json' || kind === 'log'
}

export function isOfficeDocumentKind(kind: DocumentKind): kind is OfficeDocumentKind {
  return kind === 'docx' || kind === 'xlsx' || kind === 'pptx'
}

export function isHtmlDocumentKind(kind: DocumentKind): boolean {
  return kind === 'html'
}

/** 可用 UTF-8 文本打开/保存的文档；不代表 Markdown 或 Agent 语义能力。 */
export function isTextDocumentKind(kind: DocumentKind): kind is 'markdown' | 'typst' | 'html' | DataDocumentKind {
  return kind === 'markdown' || kind === 'typst' || kind === 'html' || isDataDocumentKind(kind)
}

/** 工作区侧栏是否展示该扩展名（Markdown + 阅读器 + 数据表格 + Office + HTML 格式） */
export function isWorkspaceFileExtension(extension: string): boolean {
  return (
    MARKDOWN_EXTENSION_SET.has(extension) ||
    TYPST_EXTENSION_SET.has(extension) ||
    READER_EXTENSION_SET.has(extension) ||
    DATA_EXTENSION_SET.has(extension) ||
    OFFICE_EXTENSION_SET.has(extension) ||
    HTML_EXTENSION_SET.has(extension)
  )
}

