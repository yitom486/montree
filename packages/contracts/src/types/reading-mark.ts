/**
 * 阅读书签 / 高亮 / 批注的跨阅读器数据契约。
 *
 * 锚点按 format 判别：PDF 有 V1 rect 与 V2 quad；不要把 CFI 塞进 PDF。
 * PDF V2 不只保存一套坐标，而是同时保存三层信息：
 *
 * 1. `quads`：PDF 页面用户空间中的视觉几何，用于在任意缩放、DPR 或旋转
 *    下重新绘制高亮/下划线；
 * 2. `begin` / `end`：PDF.js 文字 item 与字符偏移，用于按文字语义恢复选区；
 * 3. `quote`：选中文本及前后文，用于文字 item 顺序变化时的匹配兜底。
 *
 * `rects` 是 V1 兼容数据：它来自渲染 text layer/root 的归一化 viewport
 * 矩形，适合降级绘制，但不是 PDF 页面用户空间坐标。两套坐标不能直接
 * 比较或混用；绘制时应分别通过对应的 viewport 转换路径处理。
 */

export type ReadingMarkKind = 'bookmark' | 'highlight' | 'note'

export type ReadingDocumentFormat = 'pdf' | 'epub' | 'mobi' | 'web'

/**
 * 章节键（品牌类型）：目录 matchKey 的归一化形式，是跨阅读器比较章节归属的
 * 唯一合法载体。禁止用裸字符串比较章节（曾因此出现 `3:text/x` vs `text/x`
 * 恒不等，导致本章过滤全灭；见单测 `resolve-mark-chapter.test.ts` 回归项）。
 * 构造只能走 `toChapterKey()`。
 */
export type ChapterKey = string & { readonly __chapterKeyBrand: unique symbol }

export function toChapterKey(raw: string): ChapterKey {
  return raw as ChapterKey
}

/**
 * 卡片章节归属（写入时固化）：创建卡片的那一刻由创建方按当时目录解析一次，
 * 此后所有消费方（过滤/致灰/出处行/排序）只读该字段，不再现场 resolve。
 * 解析失败记 null（脏卡可查可清，不丢失）；DB 时代对应 `marks.chapter_key`
 *（主联动键）+ `marks.chapter_json`（含 label/index 的原样 round-trip）。
 */
export interface MarkChapterRef {
  key: ChapterKey
  label: string
  /** 目录下标；回退项为 -1 */
  index: number
}

/**
 * V1 兼容的渲染层归一化矩形。
 *
 * 当前 PDF 选择实现从 `Range.getClientRects()` 读取它，并相对于
 * text layer（缺失时为 page root）归一化：原点在左上角，x 向右、y 向下，
 * `x` / `y` / `width` / `height` 均使用页面宽高比例。一个跨行选区通常
 * 对应多个 rect，而不是一个包住所有文字的巨大矩形。
 *
 * 它的优点是结构简单、能兼容旧数据并容易在当前 viewport 中绘制；缺点是
 * 它依赖渲染层布局，精度和恢复能力不如 PDF 用户空间的 `PdfTextQuad`。
 * 这里的 `y` 方向是 text layer 的 viewport 约定，不是 PDF 用户空间的 y-up。
 */
export interface PdfTextRect {
  /** 相对渲染层宽度的比例，范围通常为 0–1 */
  x: number
  /** 相对渲染层高度的比例，范围通常为 0–1 */
  y: number
  /** 相对渲染层宽度的比例 */
  width: number
  /** 相对渲染层高度的比例 */
  height: number
}

/**
 * PDF.js 页面用户空间中的一个点。
 *
 * 它不是 CSS 像素，也不是 `PdfTextRect` 的 0–1 归一化坐标。通常应由
 * `viewport.convertToPdfPoint()` 生成，并在绘制时交给
 * `viewport.convertToViewportPoint()` 转回当前显示坐标；因此缩放、DPR
 * 和浏览器布局变化不会改变已保存的点本身。原点和轴向遵循 PDF.js 的
 * PDF 页面坐标约定（通常为左下角原点、y 向上），页面旋转与 crop box
 * 由 viewport 转换负责处理。
 */
export interface PdfPoint {
  x: number
  y: number
}

/**
 * V2 PDF 页面用户空间中的文字四边形。
 *
 * 四边形比轴对齐矩形更适合保存真实文字几何：选区可能跨多行、文字可能
 * 经过旋转或变换，且 PDF.js 的 text item transform 可以直接生成这套坐标。
 * 一个跨行选区通常保存多个 quad，每个 quad 表示一段视觉行/片段。
 *
 * `points` 的顺序固定为左上、右上、右下、左下。顺序不是装饰信息：渲染
 * SVG polygon、命中测试以及后续合并几何都依赖这个顺序。它仍然处于 PDF
 * 页面坐标系中，不能直接当成浏览器 viewport 像素使用。
 */
export interface PdfTextQuad {
  points: [PdfPoint, PdfPoint, PdfPoint, PdfPoint]
  /**
   * 与 quad 同一 PDF 坐标系中的文字基线起点和终点。
   * 纯批注/下划线沿基线绘制；由旧 rect 或部分 OCR 几何降级生成的 quad
   * 可能没有可靠基线，因此该字段可选。
   */
  baseline?: [PdfPoint, PdfPoint]
}

/**
 * PDF.js 文字内容中的一个语义位置，而不是 textLayer DOM span 的位置。
 *
 * `itemIndex` 指向阅读器登记的 `getTextContent().items` 文字 item 序号，
 * `offset` 指向该 item 文本中的字符偏移。`begin` 与 `end` 组合成选区边界。
 * 这种定位不依赖当前缩放、DPR 或 DOM 重建；但 PDF 文字提取顺序发生变化
 * 时可能失效，所以 V2 同时保存 `quote` 和 `quads` 作为内容与视觉兜底。
 */
export interface PdfTextPosition {
  itemIndex: number
  offset: number
}

/**
 * 文本引用锚点：用于语义位置失效后的重新匹配。
 *
 * `exact` 是选中文本，`prefix` / `suffix` 是附近上下文。上下文不是展示
 * 必需字段，而是为了在同一页出现相同短语时减少误匹配；它也能帮助处理
 * PDF.js item 划分或顺序轻微变化的情况。
 */
export interface PdfTextQuote {
  exact: string
  prefix?: string
  suffix?: string
}

/**
 * PDF 阅读标记的锚点。
 *
 * 版本与恢复策略：
 * - V1：没有 `version`，以 `rects` 为主要定位数据；旧数据仍可绘制。
 * - V2：`version: 2`，优先使用 `begin` / `end` 恢复文字语义，使用 `quads`
 *   恢复视觉区域，并用 `quote` 在语义位置失效时重新匹配；`rects` 仍可
 *   作为旧阅读器或几何生成失败时的降级数据。
 *
 * 所有字段设计成可选，是为了容忍旧库、OCR 页或缺少原生文字层的 PDF。
 * 具体消费者仍应根据数据组合做运行时校验，不能仅凭 TypeScript 类型
 * 断言 `version: 2` 一定同时拥有完整的 begin/end/quads。
 */
export interface PdfReadingAnchor {
  /** 判别字段；PDF 不使用 EPUB 的 CFI 锚点。 */
  format: 'pdf'
  /** 页面号/页索引；0-based 或 1-based 必须由调用方和阅读器统一约定。 */
  page: number
  /** 用于展示、快速比对和文本匹配；不是唯一的几何锚点。 */
  selectedText?: string
  /** V2 标记；缺省表示兼容旧版 V1 rect 锚点。 */
  version?: 2
  /** V2 选区起点：PDF.js text item 序号 + item 内字符偏移。 */
  begin?: PdfTextPosition
  /** V2 选区终点：PDF.js text item 序号 + item 内字符偏移。 */
  end?: PdfTextPosition
  /** 语义位置失效时的文本匹配兜底。 */
  quote?: PdfTextQuote
  /** V2 稳定的 PDF 页面几何；用于缩放/旋转后的高亮与下划线绘制。 */
  quads?: PdfTextQuad[]
  /** V1 兼容字段；新锚点只把它作为降级绘制或恢复数据。 */
  rects?: PdfTextRect[]
}

export interface EpubReadingAnchor {
  format: 'epub'
  cfi: string
  cfiRange?: string
  href?: string
  selectedText?: string
}

export interface MobiReadingAnchor {
  format: 'mobi'
  chapterId: string
  selectedText?: string
  rects?: PdfTextRect[]
  /** foliate 统一后端的位置 CFI（点）与范围 CFI；旧 MOBI 阅读器写入的锚点无此字段 */
  cfi?: string
  cfiRange?: string
}

export interface WebReadingAnchor {
  format: 'web'
  /** 页 URL（规范化，无 hash） */
  url: string
  headingId?: string
  selectedText?: string
  quote?: PdfTextQuote
  rects?: PdfTextRect[]
}

export type ReadingAnchor = PdfReadingAnchor | EpubReadingAnchor | MobiReadingAnchor | WebReadingAnchor

export type ReadingMarkCategory = 'concept' | 'quote' | 'method' | 'diagram' | 'question' | 'note'

export interface ReadingMark {
  id: string
  filePath: string
  fileFingerprint: string
  kind: ReadingMarkKind
  anchor: ReadingAnchor
  label?: string
  note?: string
  excerpt?: string
  color?: string
  category?: ReadingMarkCategory
  title?: string
  aiSummary?: string
  keyPoints?: string[]
  tags?: string[]
  collapsed?: boolean
  diagramId?: string
  /** 写入时固化的章节归属；缺省（老数据）由消费方回落运行时解析 */
  chapter?: MarkChapterRef | null
  createdAt: number
  updatedAt: number
}

export interface CreateReadingMarkPayload {
  filePath: string
  fileFingerprint: string
  kind: ReadingMarkKind
  anchor: ReadingAnchor
  label?: string
  note?: string
  excerpt?: string
  color?: string
  category?: ReadingMarkCategory
  title?: string
  aiSummary?: string
  keyPoints?: string[]
  tags?: string[]
  collapsed?: boolean
  diagramId?: string
  /** 创建方按当时目录解析的章节归属；缺省由消费方回落运行时解析 */
  chapter?: MarkChapterRef | null
}

export interface UpdateReadingMarkPayload {
  id: string
  kind?: ReadingMarkKind
  label?: string
  note?: string
  color?: string
  category?: ReadingMarkCategory
  title?: string
  aiSummary?: string
  keyPoints?: string[]
  tags?: string[]
  collapsed?: boolean
  diagramId?: string
  /** 锚点变更时由调用方重算后传入；缺省保持原值 */
  chapter?: MarkChapterRef | null
}

/** `marks:search` 请求：本书内全文搜（标题/摘录/批注/AI 洞见走 FTS） */
export interface MarksSearchPayload {
  filePath: string
  query: string
}

/**
 * `marks:list-by-chapter` 请求：按章查卡（走 `chapter_key` 索引）。
 * `chapterKeys` 传当前章的 key + matchKey（去空，`toChapterKey` 品牌值亦可）；
 * 服务端额外捎带 `chapter_key = ''` 的未固化卡，调用方按 MarginaliaBar
 * 同规则（固化优先、缺失回落运行时解析）窄化，保证 DB/file 双后端输出一致。
 */
export interface MarksListByChapterPayload {
  filePath: string
  chapterKeys: string[]
}

/** 锚点 href/id 的归一化（与 reader-core normalizeLoadKey 同构；contracts 层零依赖，内联实现）。 */
function normalizeAnchorRef(raw: string | null | undefined): string {
  if (!raw) return ''
  return raw.split('#')[0]?.toLowerCase() ?? raw.toLowerCase()
}

/**
 * 锚点规范键：同一段正文的卡片共享同一键，是"一卡一段、一段多卡"绑定关系
 * 在 DB 的体现（`marks.anchor_key` 抽取列 + 索引，去重/联查走索引）。
 * - epub：href（归一化）+ cfiRange/cfi
 * - pdf：page + begin/end（V1 无语义位置时只有 page，同页多卡同键、创建时间区分）
 * - mobi：chapterId（归一化）+ cfi
 * - web：url + headingId
 * 纯函数、无品牌类型，方便 SQL 回填与 TS 写入两侧对口径（见 marks-anchor-binding 单测）。
 */
export function canonicalAnchorKey(anchor: ReadingAnchor): string {
  switch (anchor.format) {
    case 'epub':
      return `epub|${normalizeAnchorRef(anchor.href)}|${anchor.cfiRange ?? anchor.cfi ?? ''}`
    case 'pdf': {
      const begin = anchor.begin ? `${anchor.begin.itemIndex},${anchor.begin.offset}` : ''
      const end = anchor.end ? `${anchor.end.itemIndex},${anchor.end.offset}` : ''
      return `pdf|${anchor.page}|${begin}-${end}`
    }
    case 'mobi':
      return `mobi|${normalizeAnchorRef(anchor.chapterId)}|${anchor.cfiRange ?? anchor.cfi ?? ''}`
    case 'web':
      return `web|${anchor.url}|${anchor.headingId ?? ''}`
  }
}
