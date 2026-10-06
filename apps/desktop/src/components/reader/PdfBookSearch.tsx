import { useEffect, useMemo, useRef, useState } from 'react'
import { Loader2, Search } from 'lucide-react'
import { err, isOk } from '@montree/contracts'
import { rosettaApi } from '@/api/rosetta-api'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  BOOK_SEARCH_LIMIT,
  BookSearchSession,
  formatBookSearchHeading,
  summarizeBookSearchHit,
  toBookSearchKeyword,
  type BookSearchItem,
} from '@/lib/reader/pdf/pdf-book-search'
import { searchReaderContent } from '@/lib/agent/context/search-reader-content'

/**
 * 正文词语搜索（P0.1/S3）：工具栏紧凑触发按钮 + 独立浮层。
 *
 * 双后端共用同一浮层 UI：index 走 `queryBook(kind='search')`（已入库 PDF，
 * 点击跳页）；memory 走内存 `searchReaderContent`（EPUB/MOBI/AZW3，
 * 点击按章节 label 跳章）。短词不请求；输入改变立即清空旧结果；
 * 后发覆盖先发；展示数（≤20）不冒充总数。
 */
export function PdfBookSearch({
  fingerprint,
  indexed,
  onJumpToPage,
  backend = 'index',
  docKey,
  onJumpToLabel,
}: {
  /** index：当前打开 PDF 的罗盘指纹；memory：当前书标识（切换文件即失效旧状态） */
  fingerprint: string
  /** index 时 false 禁用并提示先建立罗盘索引；memory 时忽略 */
  indexed?: boolean
  /** index：现有阅读器跳页路径 */
  onJumpToPage?: (page: number) => void
  /** 默认 'index'，PDF 可不传 */
  backend?: 'index' | 'memory'
  /** memory：当前书标识（与 fingerprint 二选一绑定会话） */
  docKey?: string
  /** memory：按章节 label 跳转 */
  onJumpToLabel?: (label: string) => void
}): React.JSX.Element {
  const [input, setInput] = useState('')
  const [open, setOpen] = useState(false)
  const [, setTick] = useState(0)
  const backendRef = useRef(backend)
  backendRef.current = backend
  const sessionRef = useRef<BookSearchSession | null>(null)
  if (!sessionRef.current) {
    sessionRef.current = new BookSearchSession(async (key, keyword) => {
      if (backendRef.current === 'memory') {
        const searched = await searchReaderContent(keyword)
        const items: BookSearchItem[] = searched.hits.map((hit, index) => ({
          key: `label:${hit.label}:${index}`,
          heading: hit.label,
          excerpt: hit.snippet,
          jump: { kind: 'label', label: hit.label },
        }))
        return { ok: true as const, value: items }
      }
      const result = await rosettaApi.queryBook({
        kind: 'search',
        fingerprint: key,
        keyword,
        limit: BOOK_SEARCH_LIMIT,
      })
      if (!isOk(result) || result.value.kind !== 'search') {
        return err({ code: 'UNKNOWN', message: !isOk(result) ? result.error.message : '搜索失败' })
      }
      return {
        ok: true as const,
        value: result.value.blocks.map((block) => ({
          key: `p${block.pageNumber}-b${block.id}`,
          heading: formatBookSearchHeading(block.chapterTitle, block.pageNumber),
          excerpt: summarizeBookSearchHit(block.content, keyword),
          jump: { kind: 'page' as const, pageNumber: block.pageNumber },
        })),
      }
    })
  }
  const session = sessionRef.current

  useEffect(() => session.subscribe(() => setTick((tick) => tick + 1)), [session])
  const bindKey = backend === 'memory' ? (docKey ?? fingerprint) : fingerprint
  // 文件切换：清空关键词/结果/错误/pending（旧异步回写按代际丢弃）
  useEffect(() => {
    setInput('')
    setOpen(false)
    session.bind(bindKey)
  }, [bindKey, session])

  const state = session.getState()
  const keywordValid = toBookSearchKeyword(input) !== null
  // memory 后端不经过 indexed 禁用；index 未入库保持禁用提示
  const disabled = backend === 'index' && indexed === false

  const close = (): void => {
    session.reset()
    setOpen(false)
  }

  const submit = (): void => {
    if (disabled) return
    // 短词拒绝不请求；面板保持打开，原地展示“至少输入 3 个字符”
    session.search(input)
  }

  const handleInputChange = (value: string): void => {
    setInput(value)
    // 输入一变就清旧结果（面板保持打开）：旧词结果不得伪装成新词结果，
    // pending 一并作废；idle 时无旧状态可清，直接返回
    if (session.getState().status !== 'idle') {
      session.reset()
    }
  }

  const hint = useMemo(() => {
    if (disabled) return '先建立罗盘索引'
    if (!keywordValid && input.trim()) return '至少输入 3 个字符'
    return ''
  }, [disabled, keywordValid, input])

  const handleJump = (item: BookSearchItem): void => {
    if (item.jump.kind === 'page') onJumpToPage?.(item.jump.pageNumber)
    else onJumpToLabel?.(item.jump.label)
    close()
  }

  return (
    <span className="relative flex items-center">
      <Button
        type="button"
        size="icon-sm"
        variant="ghost"
        disabled={disabled}
        title={disabled ? '先建立罗盘索引' : '搜索正文'}
        aria-label="搜索正文"
        onClick={() => setOpen((value) => !value)}
      >
        <Search className="size-4" aria-hidden />
      </Button>
      {open && !disabled ? (
        <div className="absolute right-0 top-8 z-50 w-96 rounded-md border bg-popover p-2 shadow-md">
          <div className="flex items-center gap-1">
            <Input
              value={input}
              placeholder="搜索正文"
              aria-label="搜索正文关键词"
              className="h-7 text-xs"
              autoFocus
              onChange={(event) => handleInputChange(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') submit()
                if (event.key === 'Escape') close()
              }}
            />
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="h-7 shrink-0 gap-1 text-xs"
              disabled={!keywordValid}
              title="搜索正文（至少 3 个字符）"
              onClick={submit}
            >
              {state.status === 'loading' ? (
                <Loader2 className="size-3.5 animate-spin" aria-hidden />
              ) : null}
              搜索
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="h-7 shrink-0 text-xs"
              onClick={close}
            >
              关闭
            </Button>
          </div>
          {hint ? <p className="px-1 pt-1 text-xs text-muted-foreground">{hint}</p> : null}
          <div className="max-h-80 overflow-auto pt-1">
            <p className="px-1 pb-1 text-xs text-muted-foreground">最多显示 {BOOK_SEARCH_LIMIT} 条</p>
            {state.status === 'loading' ? <p className="px-1 py-2 text-xs">搜索中…</p> : null}
            {state.status === 'empty' ? <p className="px-1 py-2 text-xs">未命中</p> : null}
            {state.status === 'error' ? (
              <p className="px-1 py-2 text-xs text-destructive">{state.error || '搜索失败'}</p>
            ) : null}
            {state.status === 'done'
              ? state.items.map((item) => (
                  <button
                    key={item.key}
                    type="button"
                    className="block w-full rounded px-1 py-1.5 text-left hover:bg-accent"
                    onClick={() => handleJump(item)}
                  >
                    <span className="block text-xs font-medium">{item.heading}</span>
                    <span className="block truncate text-xs text-muted-foreground">{item.excerpt}</span>
                  </button>
                ))
              : null}
          </div>
        </div>
      ) : null}
    </span>
  )
}
