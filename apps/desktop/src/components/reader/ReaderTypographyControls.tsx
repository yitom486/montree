import { Minus, Plus, Rows3, Type } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  READER_FONT_SIZE_OPTIONS,
  READER_LINE_HEIGHT_OPTION_LABELS,
  useAppSettingsStore,
  type ReaderFontSize,
  type ReaderLineHeight,
} from '@/stores/app-settings-store'
import { cn } from '@/lib/utils'

interface ReaderTypographyControlsProps {
  disabled?: boolean
}

function nextFontSize(current: ReaderFontSize, direction: -1 | 1): ReaderFontSize {
  const index = READER_FONT_SIZE_OPTIONS.indexOf(current)
  const nextIndex = Math.min(READER_FONT_SIZE_OPTIONS.length - 1, Math.max(0, index + direction))
  return READER_FONT_SIZE_OPTIONS[nextIndex]!
}

/** EPUB / MOBI / AZW3 / 在线文档 共享的阅读排版控制；收敛为单一紧凑触发按钮 + 精致面板 */
export function ReaderTypographyControls({ disabled = false }: ReaderTypographyControlsProps) {
  const fontSize = useAppSettingsStore((state) => state.readerFontSize)
  const lineHeight = useAppSettingsStore((state) => state.readerLineHeight)
  const setFontSize = useAppSettingsStore((state) => state.setReaderFontSize)
  const setLineHeight = useAppSettingsStore((state) => state.setReaderLineHeight)
  const minimum = fontSize === READER_FONT_SIZE_OPTIONS[0]
  const maximum = fontSize === READER_FONT_SIZE_OPTIONS[READER_FONT_SIZE_OPTIONS.length - 1]

  return (
    <div className="flex items-center">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="sm"
            className="h-7 gap-1.5 rounded-lg px-2 text-xs font-medium text-muted-foreground hover:bg-muted/80 hover:text-foreground tabular-nums transition-colors"
            disabled={disabled}
            title="阅读排版设置 (字号 / 行距)"
          >
            <Type className="size-3.5 text-muted-foreground" />
            <span>{fontSize}px</span>
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-52 p-2">
          {/* 顶部字号步进微调器 */}
          <div className="flex items-center justify-between rounded-md bg-muted/50 p-1 mb-1.5">
            <Button
              variant="ghost"
              size="icon"
              className="size-6 text-muted-foreground hover:text-foreground"
              disabled={disabled || minimum}
              onClick={(e) => {
                e.preventDefault()
                setFontSize(nextFontSize(fontSize, -1))
              }}
              title="减小字号"
              aria-label="减小字号"
            >
              <Minus className="size-3" />
            </Button>
            <span className="text-xs font-semibold tabular-nums text-foreground">{fontSize} px</span>
            <Button
              variant="ghost"
              size="icon"
              className="size-6 text-muted-foreground hover:text-foreground"
              disabled={disabled || maximum}
              onClick={(e) => {
                e.preventDefault()
                setFontSize(nextFontSize(fontSize, 1))
              }}
              title="增大字号"
              aria-label="增大字号"
            >
              <Plus className="size-3" />
            </Button>
          </div>

          <DropdownMenuSeparator className="-mx-2 my-1" />
          <DropdownMenuLabel className="px-1 py-0.5 text-[10px] font-medium text-muted-foreground">
            快速选号
          </DropdownMenuLabel>
          <DropdownMenuRadioGroup
            value={String(fontSize)}
            onValueChange={(value) => setFontSize(Number(value) as ReaderFontSize)}
          >
            <div className="grid grid-cols-4 gap-1 py-0.5">
              {READER_FONT_SIZE_OPTIONS.map((value) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => setFontSize(value)}
                  className={cn(
                    'flex h-6 items-center justify-center rounded text-xs transition-colors cursor-pointer',
                    fontSize === value
                      ? 'bg-primary text-primary-foreground font-semibold shadow-xs'
                      : 'text-muted-foreground hover:bg-muted hover:text-foreground',
                  )}
                >
                  {value}
                </button>
              ))}
            </div>
          </DropdownMenuRadioGroup>

          <DropdownMenuSeparator className="-mx-2 my-1.5" />
          <DropdownMenuLabel className="px-1 py-0.5 text-[10px] font-medium text-muted-foreground">
            行间距
          </DropdownMenuLabel>
          <div className="flex items-center gap-1 py-0.5">
            {READER_LINE_HEIGHT_OPTION_LABELS.map((option) => (
              <button
                key={option.value}
                type="button"
                onClick={() => setLineHeight(option.value)}
                className={cn(
                  'flex flex-1 h-6 items-center justify-center gap-1 rounded text-xs transition-colors cursor-pointer',
                  lineHeight === option.value
                    ? 'bg-primary text-primary-foreground font-semibold shadow-xs'
                    : 'text-muted-foreground hover:bg-muted hover:text-foreground',
                )}
              >
                <Rows3 className="size-3" />
                <span>{option.label}</span>
              </button>
            ))}
          </div>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}
