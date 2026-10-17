/** 编辑器支持的 Markdown 相关扩展名（不含点） */
export const MARKDOWN_EXTENSIONS = ['md', 'markdown', 'txt'] as const

/** Typst 排版源码（不含点） */
export const TYPST_EXTENSIONS = ['typ'] as const
export const TYPST_EXTENSION_SET = new Set<string>(TYPST_EXTENSIONS.map((ext) => `.${ext}`))

/** 只读阅读器支持的扩展名（不含点） */
export const READER_EXTENSIONS = ['pdf', 'epub', 'mobi', 'azw3', 'azw'] as const

/** 结构化数据与日志支持的扩展名（不含点） */
export const DATA_EXTENSIONS = ['csv', 'tsv', 'json', 'log'] as const

/** Office 套件支持的扩展名（不含点） */
export const OFFICE_EXTENSIONS = ['docx', 'xlsx', 'pptx'] as const

/** HTML 网页与静态文档支持的扩展名（不含点） */
export const HTML_EXTENSIONS = ['html', 'htm'] as const

/** 带点号的扩展名集合，用于工作区扫描 */
export const MARKDOWN_EXTENSION_SET = new Set<string>(
  MARKDOWN_EXTENSIONS.map((ext) => `.${ext}`),
)

export const READER_EXTENSION_SET = new Set<string>(
  READER_EXTENSIONS.map((ext) => `.${ext}`),
)

export const DATA_EXTENSION_SET = new Set<string>(
  DATA_EXTENSIONS.map((ext) => `.${ext}`),
)

export const OFFICE_EXTENSION_SET = new Set<string>(
  OFFICE_EXTENSIONS.map((ext) => `.${ext}`),
)

export const HTML_EXTENSION_SET = new Set<string>(
  HTML_EXTENSIONS.map((ext) => `.${ext}`),
)

export const ALL_DOCUMENT_EXTENSIONS = [
  ...MARKDOWN_EXTENSIONS,
  ...TYPST_EXTENSIONS,
  ...READER_EXTENSIONS,
  ...DATA_EXTENSIONS,
  ...OFFICE_EXTENSIONS,
  ...HTML_EXTENSIONS,
] as const

/** 工作区扫描支持的扩展名展示（带点） */
export const SUPPORTED_WORKSPACE_EXTENSION_LABEL = ALL_DOCUMENT_EXTENSIONS.map(
  (ext) => `.${ext}`,
).join(' / ')

