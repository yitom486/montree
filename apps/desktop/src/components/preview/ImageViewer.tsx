import { useEffect, useMemo, useState } from 'react'
import { FileImage, ImageOff, Loader2, Maximize2, Minus, Plus, RotateCcw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { fileApi } from '@/api/file-api'
import { toHostTextRef, workspaceApi } from '@/api/workspace-api'
import { useWorkspaceIdentity } from '@/stores/workspace-store'
import { getImageFormatLabel } from '@/lib/workspace/image-types'
import { cn } from '@/lib/utils'
import { isOk } from '@yitom/contracts'

interface ImageViewerProps {
  filePath: string
}

interface ImageState {
  status: 'loading' | 'ready' | 'error'
  dataUrl?: string
  error?: string
  naturalWidth?: number
  naturalHeight?: number
}

const MIN_ZOOM = 0.1
const MAX_ZOOM = 8
const ZOOM_STEP = 0.25

function baseName(filePath: string): string {
  return filePath.split(/[/\\]/).pop() ?? filePath
}

/** 图片阅读器：本机 / 远端工作区统一走宿主读取为 data URL，SVG 同样以 <img> 隔离脚本。 */
export function ImageViewer({ filePath }: ImageViewerProps) {
  const { workspaceId } = useWorkspaceIdentity()
  const [state, setState] = useState<ImageState>({ status: 'loading' })
  const [zoom, setZoom] = useState(1)
  const [fit, setFit] = useState(true)
  const [rotation, setRotation] = useState(0)

  useEffect(() => {
    let cancelled = false
    setState({ status: 'loading' })
    setZoom(1)
    setFit(true)
    setRotation(0)

    void (async () => {
      const hosted = await workspaceApi.readImage(toHostTextRef(workspaceId, filePath))
      const result = isOk(hosted) ? hosted : await fileApi.readImage(filePath)
      if (cancelled) return
      if (!isOk(result)) {
        setState({ status: 'error', error: result.error.message })
        return
      }
      setState({ status: 'ready', dataUrl: result.value.dataUrl })
    })()

    return () => {
      cancelled = true
    }
  }, [filePath, workspaceId])

  const zoomPercent = useMemo(() => Math.round(zoom * 100), [zoom])
  const format = getImageFormatLabel(filePath)

  const setZoomClamped = (next: number) => {
    setFit(false)
    setZoom(Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, Number(next.toFixed(2)))))
  }

  if (state.status === 'loading') {
    return (
      <div className="flex h-full items-center justify-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="size-4 animate-spin" aria-hidden />
        正在加载图片…
      </div>
    )
  }

  if (state.status === 'error') {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center">
        <ImageOff className="size-10 text-muted-foreground/40" aria-hidden />
        <p className="text-sm font-medium text-foreground">无法显示该图片</p>
        <p className="max-w-md text-xs text-muted-foreground">{state.error ?? '图片格式不受支持或文件已损坏。'}</p>
      </div>
    )
  }

  return (
    <div className="flex h-full min-h-0 flex-col bg-editor">
      <div className="flex h-9 shrink-0 items-center gap-2 border-b border-border/60 bg-background/70 px-3 text-xs text-muted-foreground backdrop-blur-sm">
        <FileImage className="size-3.5 shrink-0" aria-hidden />
        <span className="truncate font-medium text-foreground/85" title={filePath}>{baseName(filePath)}</span>
        <span className="rounded-full bg-muted px-1.5 py-0.5 text-[10px] uppercase tracking-wide">{format}</span>
        {state.naturalWidth && state.naturalHeight ? (
          <span className="hidden text-[11px] tabular-nums sm:inline">
            {state.naturalWidth} × {state.naturalHeight}
          </span>
        ) : null}

        <div className="ml-auto flex items-center gap-0.5">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="size-7"
                aria-label="缩小"
                onClick={() => setZoomClamped(zoom - ZOOM_STEP)}
              >
                <Minus className="size-3.5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom">缩小</TooltipContent>
          </Tooltip>
          <button
            type="button"
            className="min-w-12 rounded px-1 text-center text-[11px] tabular-nums text-muted-foreground hover:bg-accent/60 hover:text-foreground"
            onClick={() => { setFit(false); setZoom(1) }}
            title="恢复 100%"
          >
            {fit ? '适应' : `${zoomPercent}%`}
          </button>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="size-7"
                aria-label="放大"
                onClick={() => setZoomClamped(zoom + ZOOM_STEP)}
              >
                <Plus className="size-3.5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom">放大</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                type="button"
                variant={fit ? 'secondary' : 'ghost'}
                size="icon"
                className="size-7"
                aria-label="适应窗口"
                aria-pressed={fit}
                onClick={() => { setFit(true); setZoom(1) }}
              >
                <Maximize2 className="size-3.5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom">适应窗口</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="size-7"
                aria-label="旋转 90 度"
                onClick={() => setRotation((value) => (value + 90) % 360)}
              >
                <RotateCcw className="size-3.5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom">旋转 90°</TooltipContent>
          </Tooltip>
        </div>
      </div>

      <div
        className={cn(
          'relative min-h-0 flex-1 overflow-auto bg-muted/20',
          fit ? 'flex items-center justify-center p-6' : 'p-6',
        )}
      >
        <img
          src={state.dataUrl}
          alt={baseName(filePath)}
          draggable={false}
          className={cn(
            'rounded-md border border-border/60 bg-background shadow-sm transition-transform duration-150 motion-reduce:transition-none',
            fit ? 'max-h-full max-w-full object-contain' : 'mx-auto max-w-none',
          )}
          style={{
            transform: `rotate(${rotation}deg)`,
            transformOrigin: 'center center',
            width: fit ? undefined : state.naturalWidth ? state.naturalWidth * zoom : undefined,
            height: fit ? undefined : state.naturalHeight ? state.naturalHeight * zoom : undefined,
          }}
          onLoad={(event) => {
            const image = event.currentTarget
            setState((current) => ({
              ...current,
              naturalWidth: image.naturalWidth,
              naturalHeight: image.naturalHeight,
            }))
          }}
          onError={() => setState({ status: 'error', error: '图片解码失败，可能是扩展名与实际格式不一致。' })}
        />
      </div>
    </div>
  )
}
