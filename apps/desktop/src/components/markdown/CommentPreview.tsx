import { useMemo, useRef, useState, type MouseEvent } from 'react'
import { Code2, Eye, MessageSquareText, Pencil } from 'lucide-react'
import DOMPurify from 'dompurify'
import { MotionConfig, useReducedMotion } from 'motion/react'
import { Button } from '@/components/ui/button'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleIndicator,
  CollapsibleTrigger,
} from '@/components/motion/collapsible'
import { MarkdownContent } from './MarkdownContent'
import { useCodeBlockCopy } from '@/hooks/preview/useCodeBlockCopy'
import { useHighlightTheme } from '@/hooks/preview/useHighlightTheme'
import { useEditorUiStore } from '@/stores/editor-ui-store'
import { renderMarkdown } from '@/lib/editor/markdown'
import { stripMarkdownInline } from '@/lib/editor/markdown-headings'
import { PREVIEW_SANITIZE_OPTIONS } from '@/lib/preview/preview-sanitize'
import { appApi } from '@/api/app-api'
import { cn } from '@/lib/utils'
import '@/styles/markdown-preview.css'

type CommentViewMode = 'preview' | 'source'

/** 纯装饰线：预览时隐藏，源码模式仍保留原样。 */
const DECORATIVE_SEPARATOR = /^[\s\-_=*]{3,}$/
const HTML_TAG_ONLY = /^\s*<[^>\s][^>]*>\s*$/
const HEADING_PREFIX = /^#{1,6}\s+/
const LIST_PREFIX = /^(?:[-*+]|\d+[.)])\s+/
const QUOTE_PREFIX = /^>\s?/

function commentBody(source: string): string {
  return source.replace(/^\s*<!--/, '').replace(/-->\s*$/, '').trim()
}

/** 折叠摘要：去掉标题/列表/引用标记，避免摘要里出现 `###`、`1.`。 */
function commentSummary(body: string): string {
  const line = body
    .split(/\r?\n/)
    .map((item) => item.trim())
    .find((item) => item && !DECORATIVE_SEPARATOR.test(item))
  if (!line) return '空备注'
  const plain = stripMarkdownInline(
    line.replace(HEADING_PREFIX, '').replace(LIST_PREFIX, '').replace(QUOTE_PREFIX, '').trim(),
  )
  return plain || '空备注'
}

/** 预览时去掉起分隔作用的 ===/--- 线；源码模式不经过这里。 */
function commentPreviewBody(body: string): string {
  return body
    .split(/\r?\n/)
    .filter((line) => !DECORATIVE_SEPARATOR.test(line.trim()) && !HTML_TAG_ONLY.test(line.trim()))
    .join('\n')
    .trim()
}

/**
 * 写作备注（Markdown HTML 注释）卡片。
 *
 * 展开后默认用安全 Markdown 渲染，方便阅读备注里的标题/列表/强调；
 * 源码模式保留原始 `###`、`**` 等标记，「编辑」仍直接回到编辑器源码。
 * 裸 HTML 在 strictSafe 解析器中关闭，并再经 DOMPurify 消毒。
 */
export function CommentPreview({ source, onEdit }: { source: string; onEdit: () => void }) {
  const reduceMotion = useReducedMotion() ?? false
  const theme = useEditorUiStore((state) => state.theme)
  const body = useMemo(() => commentBody(source), [source])
  const summary = useMemo(() => commentSummary(body), [body])
  const [open, setOpen] = useState(false)
  const [mode, setMode] = useState<CommentViewMode>('preview')
  const previewRef = useRef<HTMLDivElement>(null)

  const renderedHtml = useMemo(() => {
    if (!open || mode !== 'preview') return ''
    const html = renderMarkdown(commentPreviewBody(body), undefined, { strictSafe: true })
    return String(
      DOMPurify.sanitize(html, {
        ...PREVIEW_SANITIZE_OPTIONS,
        // 备注标题不能注册成正文锚点，避免与文档目录 / 标题 ID 冲突。
        FORBID_ATTR: ['id'],
      }),
    )
  }, [body, mode, open])

  useCodeBlockCopy(previewRef, renderedHtml)
  useHighlightTheme(theme)

  const handlePreviewClick = (event: MouseEvent<HTMLDivElement>) => {
    const target = event.target
    if (!(target instanceof Element)) return
    const anchor = target.closest<HTMLAnchorElement>('a[href]')
    if (!anchor) return
    event.preventDefault()
    const href = anchor.getAttribute('href') ?? ''
    if (/^https?:/i.test(href)) void appApi.openExternal(href)
  }

  return (
    <MotionConfig skipAnimations={reduceMotion}>
      <Collapsible
        open={open}
        onOpenChange={setOpen}
        className="rounded-lg border border-border bg-muted text-foreground"
      >
        <div className="flex min-w-0 flex-wrap items-center gap-2 p-2">
          <CollapsibleTrigger
            render={<Button variant="ghost" className="h-auto min-h-11 min-w-0 flex-1 basis-48 justify-start whitespace-normal text-left hover:bg-background" />}
            aria-label={`查看写作备注：${summary}`}
          >
            <MessageSquareText className="size-4 shrink-0" aria-hidden="true" />
            <span className="flex min-w-0 flex-1 flex-col gap-1">
              <span className="text-xs font-normal">写作备注</span>
              <span className="truncate text-sm font-medium">{summary}</span>
            </span>
            <CollapsibleIndicator className="text-foreground" />
          </CollapsibleTrigger>
          <Button variant="ghost" className="min-h-11 shrink-0 hover:bg-background" onClick={onEdit} aria-label="编辑写作备注">
            <Pencil className="size-4" aria-hidden="true" />
            编辑
          </Button>
        </div>

        <CollapsibleContent contentClassName="border-t border-border p-4">
          <div className="mb-3 flex items-center justify-between gap-2">
            <div className="inline-flex items-center gap-0.5 rounded-md border border-border/70 bg-background/60 p-0.5" role="group" aria-label="备注显示方式">
              <Button
                type="button"
                size="xs"
                variant={mode === 'preview' ? 'secondary' : 'ghost'}
                aria-pressed={mode === 'preview'}
                onClick={() => setMode('preview')}
              >
                <Eye className="size-3.5" aria-hidden="true" />
                预览
              </Button>
              <Button
                type="button"
                size="xs"
                variant={mode === 'source' ? 'secondary' : 'ghost'}
                aria-pressed={mode === 'source'}
                onClick={() => setMode('source')}
              >
                <Code2 className="size-3.5" aria-hidden="true" />
                源码
              </Button>
            </div>
            <span className="text-[11px] tabular-nums text-muted-foreground">
              {body ? body.split(/\r?\n/).length : 0} 行
            </span>
          </div>

          {mode === 'preview' ? (
            <div
              ref={previewRef}
              className={cn('markdown-preview comment-note-preview max-w-none')}
              onClick={handlePreviewClick}
            >
              {renderedHtml ? (
                <MarkdownContent html={renderedHtml} />
              ) : (
                <p className="text-sm text-muted-foreground">此备注暂无内容。</p>
              )}
            </div>
          ) : (
            <pre className="comment-note-source" aria-label="写作备注源码">
              {body || '此备注暂无内容。'}
            </pre>
          )}
        </CollapsibleContent>
      </Collapsible>
    </MotionConfig>
  )
}
