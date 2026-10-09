/**
 * PDF OCR 缓存与组件状态。
 * 用 fileFingerprint 当缓存键（文件内容变了旧缓存自动失效），不要只用路径。
 */

/** 阅读器侧栏目录项（OCR 结果会映射成这套，与 EPUB 等共用） */
export interface ReaderTocUnit {
  label: string
  href: string
  level: number
}

export const PDF_OCR_SCALE_OPTIONS = [1.5, 2, 2.5] as const
export type PdfOcrScale = (typeof PDF_OCR_SCALE_OPTIONS)[number]
export const DEFAULT_PDF_OCR_SCALE: PdfOcrScale = 2
/** 目录页固定清晰档：仅 5 页左右，提清成本可忽略，正文仍走用户档 */
export const DEFAULT_PDF_TOC_SCALE: PdfOcrScale = 2.5
/** 目录页探测固定低清档：只做范围建议，正式识别仍走 2.5 清晰档 */
export const DEFAULT_PDF_TOC_DETECT_SCALE: PdfOcrScale = 1.5

export const PDF_OCR_SCALE_OPTION_LABELS: Array<{ value: PdfOcrScale; label: string }> = [
  { value: 1.5, label: '快速' },
  { value: 2, label: '标准' },
  { value: 2.5, label: '清晰' },
]

/**
 * OCR 识别出的一条目录；printedPage 是印在纸上的页码。
 * source 是证据等级（合并裁决用）：manual（手填）> pipe/geo（表格/坐标钉死）
 * > ai（模型看图）> read/paired/backfilled（文本直读/汤配/回填，皆为推测）。
 */
export type OcrTocEntrySource =
  | 'pipe'
  | 'geo'
  | 'read'
  | 'paired'
  | 'backfilled'
  | 'ai'
  | 'manual'

export interface OcrTocEntry {
  title: string
  printedPage: number
  /** 结束印刷页码。若存在后继章节则为下一部分起始页 - 1，无后继（末尾）则为空 */
  endPage?: number | null
  level: number
  source?: OcrTocEntrySource
}

/** 目录缓存版本；只用于标记新旧，不再作为丢弃依据（旧版走 legacy 评估） */
export const PDF_OCR_TOC_CACHE_VERSION = 7

/** 目录缓存来源：自动识别 vs 用户保存确认（含 AI 核对后保存） */
export type PdfOcrTocOrigin = 'auto' | 'reviewed'

/**
 * 识别摘要（只存计数，不存整页 OCR 原文）。
 * droppedPool=数字汤数量门丢弃，droppedLines=噪音/水印/正文丢弃，
 * watermarkRemovedLines=水印清洗删除行；三者皆为“过滤了什么”的审计口径。
 */
export interface PdfOcrTocStats {
  requestedPages: number
  processedPages: number
  acceptedEntries: number
  pipeRows?: number
  geoPaired?: number
  soupPaired?: number
  droppedPool?: number
  droppedLines?: number
  watermarkRemovedLines?: number
}

export interface PdfOcrTocCache {
  fileFingerprint: string
  tocPageRange: [number, number]
  /** 印刷页码与 PDF 页索引的差 */
  pageOffset: number
  entries: OcrTocEntry[]
  units: ReaderTocUnit[]
  createdAt: string
  /** 提取器版本；仅用于新旧标记，读取容忍旧版（见评估 legacy） */
  extractorVersion?: number
  /** 缺失表示旧版缓存（评估为 legacy，不自动删除） */
  origin?: PdfOcrTocOrigin
  /** 缺失表示旧版缓存或用户修订版（修订版以 origin 为准） */
  stats?: PdfOcrTocStats
}

export interface RecognizePdfTocPayload {
  filePath: string
  fileFingerprint: string
  fromPage: number
  toPage: number
  /** 不传则按 toPage 自动估算 */
  pageOffset?: number
  /** 渲染倍率，越高越清晰但更慢 */
  scale?: PdfOcrScale
  /** 真实总页数（pdf.js 已知）：目录重组范围门用，不再为此解析一次 */
  pageCount: number
}

export interface GetPdfOcrTocPayload {
  fileFingerprint: string
}

export interface SavePdfOcrTocPayload {
  cache: PdfOcrTocCache
}

/** 目录页探测请求：只建议范围，不识别、不写缓存 */
export interface DetectPdfTocPagesPayload {
  filePath: string
  /** 真实总页数（渲染端 pdfjs 已知）：决定探测窗口上界 */
  pageCount: number
}

export type DetectPdfTocPagesOutcome = 'found' | 'ambiguous' | 'not-found'

/** 候选目录段（按分排序；ambiguous 时给用户看差异） */
export interface TocPageCandidate {
  fromPage: number
  toPage: number
  score: number
}

export interface DetectPdfTocPagesResult {
  outcome: DetectPdfTocPagesOutcome
  /** found 时为建议范围（已含低分间隙页） */
  fromPage?: number
  toPage?: number
  /** 候选段（最多 3 段） */
  candidates: TocPageCandidate[]
  /** 实际 OCR 的页数（窗口内） */
  pagesScanned: number
  /** 其中走 OCR 的页数（其余为原生文字层直读） */
  ocrPages: number
  /** ambiguous / not-found 时的人话原因 */
  reason?: string
}

/** 页内像素框；与 OCR 引擎坐标系一致，划词要对齐阅读器缩放 */
export interface OcrPageBBox {
  x0: number
  y0: number
  x1: number
  y1: number
}

export interface OcrPageWord {
  text: string
  bbox: OcrPageBBox
}

export interface PdfOcrPageCache {
  fileFingerprint: string
  page: number
  /** PDF 用户空间页宽（scale=1 viewport） */
  pageWidth: number
  pageHeight: number
  ocrScale: number
  words: OcrPageWord[]
  createdAt: string
}

export interface RecognizePdfPagePayload {
  filePath: string
  fileFingerprint: string
  page: number
  scale?: PdfOcrScale
  /**
   * 调用方视口的 PDF 点尺寸（inspector 几何归一化用，与覆盖层同族）。
   * 缺失时主进程拒绝（INVALID_ARGUMENT），调用方须从 pdfjs viewport 提供。
   */
  pageWidthPt: number
  pageHeightPt: number
}

export interface GetPdfOcrPagePayload {
  fileFingerprint: string
  page: number
}

export interface ListPdfOcrPagesPayload {
  fileFingerprint: string
}

/** 语言包/引擎是否就绪；用 phase 收窄，不要只用 runtimeReady */
export type OcrComponentPhase = 'not-ready' | 'downloading' | 'ready' | 'error'

export interface OcrComponentStatus {
  phase: OcrComponentPhase
  /** 0–100 */
  progress: number
  message?: string
  runtimeReady: boolean
  languages: string[]
  missingLanguages: string[]
}
