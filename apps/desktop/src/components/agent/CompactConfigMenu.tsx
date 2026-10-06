import { ChevronDown } from 'lucide-react'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { cn } from '@/lib/utils'
import { currentLabel } from '@/lib/agent/acp-config-menu'
import type { AcpConfigOption } from '@montree/contracts'

/** 输入栏旁的紧凑配置下拉（primary 配置项专用）。 */
export function CompactConfigMenu({
  option,
  disabled,
  onChange,
  emphasize,
}: {
  option: AcpConfigOption
  disabled?: boolean
  onChange: (configId: string, value: string) => void
  emphasize?: boolean
}) {
  const label = currentLabel(option)

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          disabled={disabled}
          title={option.name}
          className={cn(
            'inline-flex max-w-[7.5rem] items-center gap-0.5 rounded-md px-1.5 py-0.5 text-[11px] transition-colors',
            'text-muted-foreground hover:bg-muted hover:text-foreground',
            'disabled:pointer-events-none disabled:opacity-40',
            emphasize && 'font-medium text-foreground/90',
          )}
        >
          <span className="truncate">{label}</span>
          <ChevronDown className="size-3 shrink-0 opacity-60" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="max-h-64 min-w-[10rem] overflow-y-auto">
        <DropdownMenuLabel className="text-[10px] text-muted-foreground">
          {option.name}
        </DropdownMenuLabel>
        <DropdownMenuRadioGroup
          value={String(option.currentValue ?? '')}
          onValueChange={(value) => onChange(option.configId, value)}
        >
          {option.options?.map((item) => (
            <DropdownMenuRadioItem key={item.value} value={item.value} className="text-xs">
              {item.name}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
