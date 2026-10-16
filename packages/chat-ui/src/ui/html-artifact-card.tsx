// 自 `apps/desktop/src/components/agent/tools/HtmlArtifactCard.tsx` 整搬（M3d present 批，props-ify）：
// 解耦仅两处：`theme→colorScheme` prop（宿主 `useEditorUiStore.theme` 直传）、
// `fileApi.exportHtml+toast→onExport` 回调 prop（宿主默认实现含保存+toast，取消不弹错；包内只调回调）。
// `Button` 改包内 `./button`，`Dialog*` 改包内 `./dialog`，`cn` 改 `./cn`，
// `result-card` 改 `./result-card`，`ArtifactFrame` 改 `./artifact-frame`，
// `ArtifactZoomSurface` 改 `./artifact-zoom-surface`；`PresentHtmlArtifact` 仍 contracts；余逐字。
import { useEffect, useMemo, useState } from 'react'
import { Code2, Download, ExternalLink, FileCode2, XCircle } from 'lucide-react'
import { Button } from './button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from './dialog'
import { RESULT_CARD_HEADER, RESULT_CARD_ICON, RESULT_CARD_SUMMARY, resultCardClassName } from './result-card'
import { ArtifactFrame, newArtifactMountId, type ThemeTransitionTarget } from './artifact-frame'
import { cn } from './cn'
import type { PresentHtmlArtifact } from '@montree/contracts'
import { ArtifactZoomSurface } from './artifact-zoom-surface'

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
  /** 主题（宿主 `useEditorUiStore.theme` 直传；缺省不同步主题，只经 `colorScheme` postMessage） */
  colorScheme?: ThemeTransitionTarget
  /**
   * 导出回调（宿主实现原 `fileApi.exportHtml+toast`：含合法文件名、成功 toast、取消静默；
   * 包内只调回调，不碰 IPC/文件）。
   */
  onExport?: () => void
}

/** HTML Artifact 聊天卡：紧凑摘要 + 打开预览/查看源码/宿主导出（脚本不触发保存）。 */
export function HtmlArtifactCard({ result, className, sourceText, colorScheme, onExport }: HtmlArtifactCardProps) {
  const [previewOpen, setPreviewOpen] = useState(false)
  const [previewNonce, setPreviewNonce] = useState(0)
  const [showSource, setShowSource] = useState(false)
  const inlineMountId = useMemo(() => newArtifactMountId(), [result.id, result.html])
  const [inlineError, setInlineError] = useState<string | null>(null)
  useEffect(() => setInlineError(null), [result.id, result.html])

  const handleExport = () => {
    onExport?.()
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
      {result.inline ? (
        <div className="min-w-0 p-2">
          <ArtifactZoomSurface title={result.title}>
          <ArtifactFrame key={inlineMountId} title={result.title} html={result.html} mountId={inlineMountId}
            frameTestId="svg-diagram-frame" initialHeight={360} maxHeight={560} className="w-full min-w-0 rounded-lg border border-border/50"
            colorScheme={colorScheme}
            onBridgeMessage={(message) => { if (message.kind === 'error') setInlineError(message.message) }} />
          </ArtifactZoomSurface>
          {inlineError ? <p role="alert" className="text-xs text-destructive">图表运行失败：{inlineError}</p> : null}
        </div>
      ) : null}
      <div className="flex flex-wrap gap-1.5 p-2">
        {!result.inline ? (
        <Button type="button" size="sm" variant="default" className="h-7 px-2.5 text-[11px]" onClick={() => { setPreviewNonce((n) => n + 1); setPreviewOpen(true) }}>
          <ExternalLink className="size-3.5" />
          打开预览
        </Button>
        ) : null}
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
      {!result.inline ? <ArtifactPreviewDialog
        result={result}
        open={previewOpen}
        nonce={previewNonce}
        onOpenChange={setPreviewOpen}
        onExport={() => void handleExport()}
      /> : null}
    </div>
  )
}
