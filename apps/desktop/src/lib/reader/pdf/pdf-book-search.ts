import { isOk, type Result } from '@montree/contracts'
import type { AppError } from '@montree/contracts'

/**
 * 阅读器手动正文搜索逻辑（P0.1/S3，框架无关；React 组件只做渲染接线）。
 *
 * 边界：短词不请求；后发覆盖先发；文件切换即失效旧状态；
 * 展示数（≤20）永不冒充全书精确总数。命中映射由调用方做：
 * index 后端把库块映射成 item，memory 后端把内存命中映射成 item，
 * 会话层不伪造 blockId/pageNumber。
 */

/** 检索词至少有效字符数（与 FTS trigram 短词下限、P0 审计一致） */
export const BOOK_SEARCH_MIN_CHARS = 3
/** 单次展示上限（与 queryBook limit 一致；接口无精确 total，不猜总数） */
export const BOOK_SEARCH_LIMIT = 20
/** 结果摘要长度（纯文本窗口，字符） */
export const BOOK_SEARCH_SNIPPET_CHARS = 120

/** 去空白后 ≥3 个字符（按码点）才可搜索，否则 null（调用方提示，不调 API） */
export function toBookSearchKeyword(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const keyword = value.trim()
  if ([...keyword].length < BOOK_SEARCH_MIN_CHARS) return null
  return keyword
}

export interface BookSearchItem {
  /** React key，全局唯一即可（如 `p36-b7`、`label:第一章`） */
  key: string
  /** 展示标题：index 用“章节 · 第 N 页”，memory 直接用章节 label */
  heading: string
  excerpt: string
  /** 跳转目标：index 按页跳，memory 按章节 label 跳 */
  jump: { kind: 'page'; pageNumber: number } | { kind: 'label'; label: string }
}

/**
 * 纯文本摘要：首个命中（大小写不敏感）居中开窗，前后补省略号。
 * 只做字符串切片，不产出 HTML，调用方不得用 dangerouslySetInnerHTML 渲染。
 */
export function summarizeBookSearchHit(
  content: string,
  keyword: string,
  maxChars: number = BOOK_SEARCH_SNIPPET_CHARS,
): string {
  const text = content.replace(/\s+/g, ' ').trim()
  if (text.length <= maxChars) return text
  const at = text.toLowerCase().indexOf(keyword.toLowerCase())
  const anchor = at < 0 ? 0 : at
  const half = Math.floor((maxChars - Math.min([...keyword].length, maxChars)) / 2)
  let start = Math.max(0, anchor - half)
  let end = start + maxChars
  if (end > text.length) {
    end = text.length
    start = Math.max(0, end - maxChars)
  }
  const body = text.slice(start, end).trim()
  return `${start > 0 ? '…' : ''}${body}${end < text.length ? '…' : ''}`
}

export type BookSearchStatus = 'idle' | 'loading' | 'done' | 'empty' | 'error'

/**
 * 结果标题：有真实章节标题展示“章节 · 第 N 页”；无标题或标题恰为页码
 * fallback（`第 N 页`）时只显示一次“第 N 页”（防“第 3 页 第 3 页”式重复）。
 */
export function formatBookSearchHeading(chapterTitle: string | null, pageNumber: number): string {
  const fallback = `第 ${pageNumber} 页`
  if (!chapterTitle || chapterTitle === fallback) return fallback
  return `${chapterTitle} · ${fallback}`
}

export interface BookSearchState {
  status: BookSearchStatus
  /** 本轮关键词（展示用）；idle 时为 '' */
  keyword: string
  items: BookSearchItem[]
  /** error 状态的可读原因；短词拒绝走 tip，不进 error */
  error: string
  /** 短词/空词时的输入提示；可搜索时为 '' */
  tip: string
}

const IDLE_STATE: BookSearchState = { status: 'idle', keyword: '', items: [], error: '', tip: '' }

export type BookSearchQuery = (
  fingerprint: string,
  keyword: string,
) => Promise<Result<BookSearchItem[], AppError>>

/**
 * 搜索会话：持有 fingerprint + 代际计数，后发覆盖先发，文件切换即 reset。
 * React 组件订阅 onChange 重渲染；全部可测，不依赖 DOM。
 */
export class BookSearchSession {
  private fingerprint = ''
  private generation = 0
  private state: BookSearchState = { ...IDLE_STATE }
  private listeners = new Set<() => void>()

  constructor(private readonly query: BookSearchQuery) {}

  getState(): BookSearchState {
    return this.state
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  private emit(next: BookSearchState): void {
    this.state = next
    for (const listener of this.listeners) listener()
  }

  /** 绑定文件；切换文件清空关键词/结果/错误/pending（旧异步回写按代际丢弃） */
  bind(fingerprint: string): void {
    if (this.fingerprint === fingerprint) return
    this.fingerprint = fingerprint
    this.generation += 1
    this.emit({ ...IDLE_STATE })
  }

  /** 关闭面板：清空展示并使 pending 失效（与文件切换同语义） */
  reset(): void {
    this.generation += 1
    this.emit({ ...IDLE_STATE })
  }

  /**
   * 提交搜索：短词直接回 tip 且不调 query；合法词发请求，
   * 回来时指纹/代际对不上就丢弃（旧结果不覆盖新结果）。
   */
  search(rawKeyword: unknown): { accepted: boolean; tip: string } {
    const keyword = toBookSearchKeyword(rawKeyword)
    if (!keyword) {
      return { accepted: false, tip: `至少输入 ${BOOK_SEARCH_MIN_CHARS} 个字符` }
    }
    if (!this.fingerprint) {
      return { accepted: false, tip: '先建立罗盘索引' }
    }
    const fingerprint = this.fingerprint
    const generation = (this.generation += 1)
    this.emit({ status: 'loading', keyword, items: [], error: '', tip: '' })
    void this.query(fingerprint, keyword).then(
      (result) => {
        if (this.generation !== generation || this.fingerprint !== fingerprint) return
        if (!isOk(result)) {
          this.emit({ status: 'error', keyword, items: [], error: result.error.message || '搜索失败', tip: '' })
          return
        }
        const items = result.value.slice(0, BOOK_SEARCH_LIMIT)
        this.emit({
          status: items.length === 0 ? 'empty' : 'done',
          keyword,
          items,
          error: '',
          tip: '',
        })
      },
      (cause: unknown) => {
        if (this.generation !== generation || this.fingerprint !== fingerprint) return
        this.emit({
          status: 'error',
          keyword,
          items: [],
          error: cause instanceof Error ? cause.message : '搜索失败',
          tip: '',
        })
      },
    )
    return { accepted: true, tip: '' }
  }
}
