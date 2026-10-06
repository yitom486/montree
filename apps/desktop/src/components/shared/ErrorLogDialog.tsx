import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { appApi } from '@/api/app-api'
import { formatErrorLogEntry } from '@/lib/workspace/error-reporter'
import { useErrorLogStore } from '@/stores/error-log-store'
import { isOk } from '@montree/contracts'

interface ErrorLogDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function ErrorLogDialog({ open, onOpenChange }: ErrorLogDialogProps) {
  const entries = useErrorLogStore((state) => state.entries)
  const clear = useErrorLogStore((state) => state.clear)
  const [logFilePath, setLogFilePath] = useState('')

  useEffect(() => {
    if (!open) return
    void appApi.getErrorLogPath().then((result) => {
      if (isOk(result)) {
        setLogFilePath(result.value)
      }
    })
  }, [open])

  const handleCopy = useCallback(async () => {
    const text =
      entries.length === 0
        ? '（暂无错误记录）'
        : entries.map((entry) => formatErrorLogEntry(entry)).join('\n\n---\n\n')

    try {
      await navigator.clipboard.writeText(text)
      toast.success('已复制错误日志')
    } catch {
      toast.error('复制失败')
    }
  }, [entries])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>错误日志</DialogTitle>
          <DialogDescription>
            记录本会话中的运行错误，便于排查黑屏或预览失败。关闭应用后内存记录会清空，文件日志仍保留。
          </DialogDescription>
        </DialogHeader>

        {logFilePath && (
          <p className="break-all text-xs text-muted-foreground">文件日志：{logFilePath}</p>
        )}

        <div className="max-h-[50vh] overflow-auto rounded-md border border-border bg-muted/20 p-3">
          {entries.length === 0 ? (
            <p className="text-sm text-muted-foreground">暂无错误记录。</p>
          ) : (
            <ul className="space-y-3">
              {entries.map((entry, index) => (
                <li key={`${entry.timestamp}-${index}`} className="text-xs">
                  <pre className="whitespace-pre-wrap break-words font-mono text-foreground/90">
                    {formatErrorLogEntry(entry)}
                  </pre>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="flex justify-end gap-2">
          <Button type="button" size="sm" variant="outline" onClick={() => clear()} disabled={entries.length === 0}>
            清空会话记录
          </Button>
          <Button type="button" size="sm" variant="outline" onClick={() => void handleCopy()}>
            复制全部
          </Button>
          <Button type="button" size="sm" onClick={() => appApi.toggleDevTools()}>
            打开开发者工具
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
