import { useEffect, useMemo, useState } from 'react'
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
import { ArtifactFrame, buildArtifactDocument, newArtifactMountId } from '@/components/agent/tools/ArtifactFrame'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'
import { isOk } from '@montree/contracts'
import type { PresentHtmlArtifact } from '@montree/contracts'

// 既有单测经此入口引用构建函数，保持路径不变。
export { buildArtifactDocument }

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
  // 挂载 ID 随每次打开更新：旧 frame 的消息（同 result 不同挂载）一律拒收
  const mountId = useMemo(() => newArtifactMountId(), [nonce, result.id])
  const [ready, setReady] = useState(false)
  const [frameError, setFrameError] = useState<string | null>(null)

  useEffect(() => {
    setReady(false)
    setFrameError(null)
  }, [nonce, result.id])

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
            <ArtifactFrame
              key={`${result.id}-${mountId}`}
              title={result.title}
              html={result.html}
              mountId={mountId}
              onBridgeMessage={(message) => {
                if (message.kind === 'ready') setReady(true)
                else if (message.kind === 'error') setFrameError(message.message)
              }}
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
  sourceText?: string
}

/** HTML Artifact 聊天卡：紧凑摘要 + 打开预览/查看源码/宿主导出（脚本不触发保存）。 */
export function HtmlArtifactCard({ result, className, sourceText }: HtmlArtifactCardProps) {
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
            {sourceText ?? result.html}
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
