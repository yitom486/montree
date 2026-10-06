import { X } from 'lucide-react'
import type { AppError } from '@montree/contracts'
import { Button } from '@/components/ui/button'

interface ErrorBannerProps {
  error: AppError | null
  onDismiss: () => void
}

export function ErrorBanner({ error, onDismiss }: ErrorBannerProps) {
  if (!error) return null

  return (
    <div
      role="alert"
      className="flex items-start gap-3 border-b border-destructive/30 bg-destructive/10 px-4 py-2 text-sm text-destructive"
    >
      <div className="min-w-0 flex-1">
        <p className="font-medium">操作失败</p>
        <p className="text-destructive/90">{error.message}</p>
      </div>
      <Button
        type="button"
        variant="ghost"
        size="icon-xs"
        className="shrink-0 text-destructive hover:bg-destructive/15 hover:text-destructive"
        aria-label="关闭错误提示"
        onClick={onDismiss}
      >
        <X />
      </Button>
    </div>
  )
}
