import React from 'react'
import { Check, ChevronDown, Maximize2, Minus, Plus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'

export const MIN_PDF_SCALE = 0.5
export const MAX_PDF_SCALE = 3.0
export const PDF_ZOOM_STEP = 0.15

export const PDF_ZOOM_PRESETS = [
  { label: '50%', value: 0.5 },
  { label: '75%', value: 0.75 },
  { label: '100%', value: 1.0 },
  { label: '125%', value: 1.25 },
  { label: '150%', value: 1.5 },
  { label: '175%', value: 1.75 },
  { label: '200%', value: 2.0 },
  { label: '300%', value: 3.0 },
] as const

interface PdfZoomControlsProps {
  scale: number
  setScale: React.Dispatch<React.SetStateAction<number>>
  fitWidth: () => void
  disabled?: boolean
  className?: string
}

function ZoomTip({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent side="bottom" sideOffset={6} className="text-[11px] px-2 py-0.5">
        {label}
      </TooltipContent>
    </Tooltip>
  )
}

/**
 * PDF 顶部工具栏一体化「微晶缩放胶囊」
 * 包含步进缩小、当前比例下拉菜单（含常用档位）、步进放大以及自适应宽度。
 */
export function PdfZoomControls({
  scale,
  setScale,
  fitWidth,
  disabled = false,
  className,
}: PdfZoomControlsProps) {
  const percentage = Math.round(scale * 100)

  const handleZoomIn = () => {
    setScale((prev) => Math.min(MAX_PDF_SCALE, Number((prev + PDF_ZOOM_STEP).toFixed(2))))
  }

  const handleZoomOut = () => {
    setScale((prev) => Math.max(MIN_PDF_SCALE, Number((prev - PDF_ZOOM_STEP).toFixed(2))))
  }

  const handleSelectPreset = (value: number) => {
    setScale(value)
  }

  return (
    <div
      className={cn(
        'flex items-center rounded-lg border border-border/50 bg-background/60 p-0.5 shadow-2xs backdrop-blur-xs transition-colors hover:border-border/80',
        className,
      )}
    >
      {/* 缩小按钮 */}
      <ZoomTip label="缩小 (Ctrl + -)">
        <Button
          variant="ghost"
          size="icon"
          className="size-6 rounded-md text-muted-foreground transition-all duration-150 hover:bg-muted hover:text-foreground active:scale-95 disabled:opacity-40"
          disabled={disabled || scale <= MIN_PDF_SCALE}
          onClick={handleZoomOut}
          aria-label="缩小页面"
        >
          <Minus className="size-3.5" />
        </Button>
      </ZoomTip>

      {/* 比例显示与预设下拉菜单 */}
      <DropdownMenu>
        <ZoomTip label="缩放比例 / 快速选档">
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="xs"
              className="group h-6 gap-0.5 rounded-md px-1.5 font-mono text-xs font-medium tabular-nums text-muted-foreground transition-all duration-150 hover:bg-muted hover:text-foreground active:scale-95 data-[state=open]:bg-muted data-[state=open]:text-foreground"
              disabled={disabled}
              aria-label="选择缩放比例"
            >
              <span>{percentage}%</span>
              <ChevronDown className="size-3 opacity-50 transition-transform duration-150 group-data-[state=open]:rotate-180" />
            </Button>
          </DropdownMenuTrigger>
        </ZoomTip>
        <DropdownMenuContent align="center" side="bottom" sideOffset={6} className="w-44 p-1">
          <div className="px-2 py-1 text-[11px] font-medium text-muted-foreground">缩放预设</div>
          <div className="grid grid-cols-2 gap-0.5">
            {PDF_ZOOM_PRESETS.map((preset) => {
              const isSelected = Math.abs(scale - preset.value) < 0.03
              return (
                <DropdownMenuItem
                  key={preset.value}
                  className={cn(
                    'flex items-center justify-between rounded-sm px-2 py-1 text-xs tabular-nums cursor-pointer',
                    isSelected && 'bg-primary/10 font-semibold text-primary',
                  )}
                  onClick={() => handleSelectPreset(preset.value)}
                >
                  <span>{preset.label}</span>
                  {isSelected ? <Check className="size-3 text-primary" /> : null}
                </DropdownMenuItem>
              )
            })}
          </div>
          <DropdownMenuSeparator className="my-1" />
          <DropdownMenuItem
            className="flex items-center gap-2 rounded-sm px-2 py-1.5 text-xs text-foreground cursor-pointer"
            onClick={() => {
              fitWidth()
            }}
          >
            <Maximize2 className="size-3.5 text-muted-foreground" />
            <span>自适应宽度 (Fit Width)</span>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      {/* 放大按钮 */}
      <ZoomTip label="放大 (Ctrl + +)">
        <Button
          variant="ghost"
          size="icon"
          className="size-6 rounded-md text-muted-foreground transition-all duration-150 hover:bg-muted hover:text-foreground active:scale-95 disabled:opacity-40"
          disabled={disabled || scale >= MAX_PDF_SCALE}
          onClick={handleZoomIn}
          aria-label="放大页面"
        >
          <Plus className="size-3.5" />
        </Button>
      </ZoomTip>

      {/* 分隔细线 */}
      <div className="mx-0.5 h-3.5 w-px bg-border/50" />

      {/* 适合宽度快捷按钮 */}
      <ZoomTip label="自适应视口宽度">
        <Button
          variant="ghost"
          size="icon"
          className="size-6 rounded-md text-muted-foreground transition-all duration-150 hover:bg-muted hover:text-foreground active:scale-95"
          disabled={disabled}
          onClick={fitWidth}
          aria-label="适合宽度"
        >
          <Maximize2 className="size-3.5" />
        </Button>
      </ZoomTip>
    </div>
  )
}
