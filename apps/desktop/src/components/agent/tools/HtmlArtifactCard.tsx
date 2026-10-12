import { useEffect, useMemo, useRef, useState } from 'react'
import { Code2, Download, ExternalLink, FileCode2, XCircle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { fileApi } from '@/api/file-api'
import { RESULT_CARD_HEADER, RESULT_CARD_ICON, RESULT_CARD_SUMMARY, resultCardClassName } from '@/components/agent/tools/result-card'
import { stripHostileHtmlHead } from '@/lib/agent/context/present-result-builder'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'
import { isOk } from '@montree/contracts'
import type { PresentHtmlArtifact } from '@montree/contracts'

const ARTIFACT_CSP =
  "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; " +
  'img-src data:; font-src data:; connect-src \'none\'; object-src \'none\'; ' +
  "base-uri 'none'; form-action 'none'; frame-src 'none';"

const ARTIFACT_MESSAGE_MAX_BYTES = 2048
const ARTIFACT_HEIGHT_MIN = 120
const ARTIFACT_HEIGHT_MAX = 1200
const ARTIFACT_HEIGHT_MIN_INTERVAL_MS = 300

function newMountId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}

function hostScript(mountId: string): string {
  return `<script>(function(){var m=${JSON.stringify(mountId)};function send(t,v){try{var o={mountId:m,type:t,value:v};if(JSON.stringify(o).length>${ARTIFACT_MESSAGE_MAX_BYTES})return;parent.postMessage(o,"*")}catch(e){}}try{send("artifact-ready",1)}catch(e){}var last=0;function report(){try{var now=Date.now();if(now-last<${ARTIFACT_HEIGHT_MIN_INTERVAL_MS})return;last=now;var h=document.documentElement?document.documentElement.scrollHeight:0;send("artifact-height",h||0)}catch(e){}}try{if("ResizeObserver" in window&&document.documentElement){new ResizeObserver(report).observe(document.documentElement)}window.addEventListener("load",report);setTimeout(report,500)}catch(e){}window.addEventListener("error",function(e){try{send("artifact-error",String((e&&e.message)||"error").slice(0,200))}catch(_){}});})();</script>`
}

/**
 * 宿主组装预览文档（纯函数，可单测）：把模型来源规范化并重新组装为
 * 受控完整文档，保证宿主 CSP 永远在任何主动内容之前生效。
 *
 * - 只搬运 `<html>` 之前的前置资源与 head 内联资源到 head（CSP 之后，
 *   保持原文相对顺序）；body 内脚本/样式原地保留（依赖解析顺序）；
 * - base 与全部 meta 丢弃（宿主重加 charset+CSP），模型策略不得覆盖；
 * - 未闭合 script/style 按浏览器语义原样保留（CSP 已先生效，安全不受影响）；
 * - host 桥接脚本对片段/完整/缺 head/异常 HTML 唯一追加。
 */
export function buildArtifactDocument(source: string, mountId: string): string {
  const csp = `<meta http-equiv="Content-Security-Policy" content="${ARTIFACT_CSP}">`
  const host = hostScript(mountId)
  const cleaned = stripHostileHtmlHead(source)
  // 只搬运 <html> 之前的前置资源与 head 内联资源（保持原文相对顺序）；
  // body 内脚本/样式原地保留（依赖解析顺序，如先取元素再绑定）。
  const extras: string[] = []
  const takeExtras = (segment: string): string =>
    segment.replace(/<(style|script)\b[^>]*>([\s\S]*?)(<\/\1\s*>|$)/gi, (match) => {
      extras.push(match)
      return ''
    })
  let bodyContent: string
  if (/<\s*html[\s>]/i.test(cleaned)) {
    const htmlAt = cleaned.search(/<\s*html[\s>]/i)
    bodyContent = takeExtras(cleaned.slice(0, htmlAt))
    const rest = cleaned.slice(htmlAt)
    const headMatch = /<\s*head\b[^>]*>([\s\S]*?)(<\/\s*head\s*>|$)/i.exec(rest)
    let bodyRest = rest
    if (headMatch) {
      takeExtras(headMatch[1] ?? '')
      bodyRest = rest.replace(headMatch[0], '')
    }
    bodyContent += bodyRest.replace(/<\/?\s*(html|head|body|title)\b[^>]*>/gi, '')
  } else {
    bodyContent = cleaned.replace(/<\/?\s*(html|head|body|title)\b[^>]*>/gi, '')
  }
  return (
    '<!DOCTYPE html><html><head><meta charset="utf-8">' +
    `${csp}${extras.join('')}</head><body>${bodyContent}${host}</body></html>`
  )
}
export function sanitizeArtifactFileName(title: string): string {
  const base = title.replace(/[\\/:*?"<>|]/g, '_').trim().slice(0, 80) || 'artifact'
  return `${base}.html`
}

interface ArtifactPreviewDialogProps {
  result: PresentHtmlArtifact
  open: boolean
  /** 每次打开递增：新挂载 ID、新 iframe、新状态（关闭卸载，重开重置） */
  nonce: number
  onOpenChange: (open: boolean) => void
  onExport: () => void
}

/**
 * 隔离预览（S3）：独立于 HtmlViewer 的 iframe，只开 allow-scripts，
 * 无 same-origin/弹窗/下载/顶层导航；无 preload/Node/electronAPI/父 DOM。
 * 关闭即卸载（重开重置应用状态）；chunk/主题刷新不碰 srcDoc。
 */
export function ArtifactPreviewDialog({ result, open, nonce, onOpenChange, onExport }: ArtifactPreviewDialogProps) {
  const frameRef = useRef<HTMLIFrameElement>(null)
  // 挂载 ID 随每次打开更新：旧 frame 的消息（同 result 不同挂载）一律拒收
  const mountId = useMemo(() => newMountId(), [nonce, result.id])
  const [ready, setReady] = useState(false)
  const [frameError, setFrameError] = useState<string | null>(null)
  const lastHeightAt = useRef(0)

  useEffect(() => {
    setReady(false)
    setFrameError(null)
    lastHeightAt.current = 0
  }, [nonce, result.id])

  const srcDoc = useMemo(
    () => buildArtifactDocument(result.html, mountId),
    [result.id, mountId],
  )

  useEffect(() => {
    if (!open) return
    const expectedMountId = mountId
    const onMessage = (event: MessageEvent) => {
      const frame = frameRef.current
      // 只认当前挂载 frame 自身来源；opaque origin 常为 null，不只凭 origin 判断
      if (!frame || event.source !== frame.contentWindow) return
      const data = event.data
      if (!data || typeof data !== 'object') return
      const message = data as { mountId?: unknown; type?: unknown; value?: unknown }
      if (message.mountId !== expectedMountId) return
      let size = 0
      try {
        size = JSON.stringify(data).length
      } catch {
        return
      }
      if (size > ARTIFACT_MESSAGE_MAX_BYTES) return
      // 白名单三类消息；不带函数、IPC 方法名或路径
      if (message.type === 'artifact-ready') {
        setReady(true)
        return
      }
      if (message.type === 'artifact-height' && typeof message.value === 'number' && Number.isFinite(message.value)) {
        const now = Date.now()
        if (now - lastHeightAt.current < ARTIFACT_HEIGHT_MIN_INTERVAL_MS) return
        lastHeightAt.current = now
        const height = Math.max(ARTIFACT_HEIGHT_MIN, Math.min(ARTIFACT_HEIGHT_MAX, Math.round(message.value)))
        if (frameRef.current) frameRef.current.style.height = `${height}px`
        return
      }
      if (message.type === 'artifact-error' && typeof message.value === 'string') {
        setFrameError(message.value.slice(0, 500))
      }
    }
    window.addEventListener('message', onMessage)
    return () => window.removeEventListener('message', onMessage)
  }, [open, result.id, mountId])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex h-[85vh] w-[92vw] max-w-5xl flex-col">
        <DialogHeader>
          <DialogTitle className="truncate">{result.title}</DialogTitle>
          <DialogDescription data-testid="artifact-status" data-ready={ready}>
            {result.summary ?? '离线交互预览（无网络、无文件访问）'}
            {ready ? '' : ' · 加载中'}
          </DialogDescription>
        </DialogHeader>
        <div className="min-h-0 flex-1 overflow-hidden rounded-lg border border-border/60 bg-background">
          {open ? (
            <iframe
              key={`${result.id}-${mountId}`}
              ref={frameRef}
              title={result.title}
              name={`montree-artifact-${mountId}`}
              sandbox="allow-scripts"
              srcDoc={srcDoc}
              data-testid="artifact-frame"
              className="h-full min-h-[320px] w-full border-0 bg-transparent"
            />
          ) : null}
        </div>
        {frameError ? (
          <p className="flex items-center gap-1.5 text-[11px] text-destructive" data-testid="artifact-error">
            <XCircle className="size-3.5 shrink-0" />
            预览脚本报错：{frameError}
          </p>
        ) : null}
        <div className="flex items-center justify-between gap-2">
          <p className="text-[10px] text-muted-foreground">关闭后重开重置应用状态</p>
          <div className="flex gap-1.5">
            <Button type="button" size="sm" variant="outline" onClick={onExport}>
              <Download className="size-3.5" />
              导出 HTML
            </Button>
            <Button type="button" size="sm" variant="default" onClick={() => onOpenChange(false)}>
              关闭
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

interface HtmlArtifactCardProps {
  result: PresentHtmlArtifact
  className?: string
}

/** HTML Artifact 聊天卡：紧凑摘要 + 打开预览/查看源码/宿主导出（脚本不触发保存）。 */
export function HtmlArtifactCard({ result, className }: HtmlArtifactCardProps) {
  const [previewOpen, setPreviewOpen] = useState(false)
  const [previewNonce, setPreviewNonce] = useState(0)
  const [showSource, setShowSource] = useState(false)

  const handleExport = async () => {
    const saved = await fileApi.exportHtml({
      html: result.html,
      suggestedName: sanitizeArtifactFileName(result.title),
    })
    if (isOk(saved)) {
      toast.success(`已导出：${saved.value.filePath}`)
      return
    }
    // 用户取消（CANCELLED）不弹错误
    if (saved.error.code !== 'CANCELLED') {
      toast.error(`导出失败：${saved.error.message}`)
    }
  }

  return (
    <div
      className={resultCardClassName(className)}
      data-testid="html-artifact-card"
      data-present-id={result.id}
    >
      <div className={cn('flex min-w-0 items-center gap-2', RESULT_CARD_HEADER)}>
        <div className={RESULT_CARD_ICON}>
          <FileCode2 className="size-3.5" />
        </div>
        <div className="min-w-0 flex-1">
          <h4 className="truncate text-xs font-semibold tracking-tight text-foreground">{result.title}</h4>
          <p className={RESULT_CARD_SUMMARY}>
            {result.summary ?? '离线 HTML 小应用'}
          </p>
        </div>
      </div>
      <div className="flex flex-wrap gap-1.5 p-2">
        <Button type="button" size="sm" variant="default" className="h-7 px-2.5 text-[11px]" onClick={() => { setPreviewNonce((n) => n + 1); setPreviewOpen(true) }}>
          <ExternalLink className="size-3.5" />
          打开预览
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="h-7 px-2.5 text-[11px]"
          aria-expanded={showSource}
          onClick={() => setShowSource((v) => !v)}
        >
          <Code2 className="size-3.5" />
          {showSource ? '收起源码' : '查看源码'}
        </Button>
        <Button type="button" size="sm" variant="outline" className="h-7 px-2.5 text-[11px]" onClick={() => void handleExport()}>
          <Download className="size-3.5" />
          导出 HTML
        </Button>
      </div>
      {showSource ? (
        <div className="px-2 pb-2">
          <pre
            className="max-h-48 max-w-full overflow-auto whitespace-pre-wrap break-all font-mono text-[10px] leading-relaxed text-muted-foreground [overflow-wrap:anywhere]"
            data-testid="artifact-source"
          >
            {result.html}
          </pre>
        </div>
      ) : null}
      <ArtifactPreviewDialog
        result={result}
        open={previewOpen}
        nonce={previewNonce}
        onOpenChange={setPreviewOpen}
        onExport={() => void handleExport()}
      />
    </div>
  )
}
