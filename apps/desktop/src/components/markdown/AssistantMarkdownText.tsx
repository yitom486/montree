import { memo, useMemo, useState, type FC } from 'react'
import {
  MarkdownTextPrimitive,
  memoizeMarkdownComponents,
  useIsMarkdownCodeBlock,
  type CodeHeaderProps,
} from '@assistant-ui/react-markdown'
import '@assistant-ui/react-markdown/styles/dot.css'
import remarkGfm from 'remark-gfm'
import { Check, Copy } from 'lucide-react'
import { TextMessagePartProvider } from '@assistant-ui/react'
import { cn } from '@/lib/utils'

const AcpCodeHeader: FC<CodeHeaderProps> = ({ language, code }) => {
  const [copied, setCopied] = useState(false)
  const copy = () => {
    if (!code || copied) return
    navigator.clipboard.writeText(code).catch(() => {})
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }
  return (
    <div className="mt-2 flex items-center justify-between rounded-t-lg border border-b-0 border-border bg-background/80 px-3 py-1 text-[11px] font-mono text-muted-foreground">
      <span>{language || 'code'}</span>
      <button
        type="button"
        onClick={copy}
        className="flex items-center gap-1 hover:text-foreground transition-colors cursor-pointer"
        title="复制代码"
      >
        {copied ? <Check className="w-3.5 h-3.5 text-emerald-500" /> : <Copy className="w-3.5 h-3.5" />}
        <span>{copied ? '已复制' : '复制'}</span>
      </button>
    </div>
  )
}

const acpMarkdownComponents = memoizeMarkdownComponents({
  h1: ({ className, ...props }: React.ComponentProps<'h1'>) => (
    <h1 className={cn('text-base font-bold text-foreground mt-3 mb-1.5', className)} {...props} />
  ),
  h2: ({ className, ...props }: React.ComponentProps<'h2'>) => (
    <h2 className={cn('text-[15px] font-bold text-foreground mt-3 mb-1.5', className)} {...props} />
  ),
  h3: ({ className, ...props }: React.ComponentProps<'h3'>) => (
    <h3 className={cn('text-sm font-bold text-foreground mt-2.5 mb-1', className)} {...props} />
  ),
  h4: ({ className, ...props }: React.ComponentProps<'h4'>) => (
    <h4 className={cn('text-[13px] font-bold text-foreground mt-2 mb-1', className)} {...props} />
  ),
  p: ({ className, ...props }: React.ComponentProps<'p'>) => (
    <p className={cn('my-1.5 leading-relaxed text-[13px]', className)} {...props} />
  ),
  ul: ({ className, ...props }: React.ComponentProps<'ul'>) => (
    <ul className={cn('my-1.5 ml-4 list-disc space-y-1 text-[13px] marker:text-muted-foreground', className)} {...props} />
  ),
  ol: ({ className, ...props }: React.ComponentProps<'ol'>) => (
    <ol className={cn('my-1.5 ml-4 list-decimal space-y-1 text-[13px] marker:text-muted-foreground', className)} {...props} />
  ),
  li: ({ className, ...props }: React.ComponentProps<'li'>) => (
    <li className={cn('leading-relaxed', className)} {...props} />
  ),
  blockquote: ({ className, ...props }: React.ComponentProps<'blockquote'>) => (
    <blockquote className={cn('my-2 border-l-2 border-primary/50 pl-3 text-muted-foreground text-xs italic', className)} {...props} />
  ),
  a: ({ className, href, children, ...props }: React.ComponentProps<'a'>) => (
    <a
      className={cn('text-primary underline-offset-2 hover:underline cursor-pointer', className)}
      target="_blank"
      rel="noreferrer"
      href={href}
      {...props}
    >
      {children}
    </a>
  ),
  strong: ({ className, ...props }: React.ComponentProps<'strong'>) => (
    <strong className={cn('font-semibold text-foreground', className)} {...props} />
  ),
  hr: ({ className, ...props }: React.ComponentProps<'hr'>) => (
    <hr className={cn('my-3 border-border/60', className)} {...props} />
  ),
  table: ({ className, ...props }: React.ComponentProps<'table'>) => (
    <div className="my-2 overflow-x-auto rounded-lg border border-border">
      <table className={cn('w-full text-xs', className)} {...props} />
    </div>
  ),
  thead: ({ className, ...props }: React.ComponentProps<'thead'>) => (
    <thead className={cn('bg-muted/60', className)} {...props} />
  ),
  th: ({ className, ...props }: React.ComponentProps<'th'>) => (
    <th className={cn('px-2.5 py-1.5 text-left font-semibold text-foreground border-b border-border', className)} {...props} />
  ),
  td: ({ className, ...props }: React.ComponentProps<'td'>) => (
    <td className={cn('px-2.5 py-1.5 border-b border-border/60 align-top', className)} {...props} />
  ),
  pre: ({ className, ...props }: React.ComponentProps<'pre'>) => (
    <pre className={cn('overflow-x-auto rounded-b-lg border border-t-0 border-border bg-muted/30 px-3 py-2.5 text-xs leading-relaxed font-mono text-foreground', className)} {...props} />
  ),
  code: function AcpCode({ className, ...props }: React.ComponentProps<'code'>) {
    const isBlock = useIsMarkdownCodeBlock()
    if (!isBlock) {
      return (
        <code className={cn('rounded bg-muted/60 px-1 py-0.5 font-mono text-[11px] text-foreground', className)} {...props} />
      )
    }
    return <code className={className} {...props} />
  },
  CodeHeader: AcpCodeHeader,
})

export interface AssistantMarkdownTextProps {
  text: string
  streaming?: boolean
  className?: string
}

export const AssistantMarkdownText = memo(function AssistantMarkdownText({
  text,
  streaming = false,
  className,
}: AssistantMarkdownTextProps) {
  const components = useMemo(() => acpMarkdownComponents, [])
  return (
    <TextMessagePartProvider text={text} isRunning={streaming}>
      <MarkdownTextPrimitive
        remarkPlugins={[remarkGfm]}
        className={cn('text-[13px] leading-relaxed break-words text-foreground font-sans', className)}
        components={components}
        defer
        smooth
      />
    </TextMessagePartProvider>
  )
})
