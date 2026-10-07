import { useEffect } from 'react'
import { reportRuntimeError } from '@/lib/workspace/error-reporter'
import { useAppSettingsStore } from '@/stores/app-settings-store'
import { appApi } from '@/api/app-api'

/** 捕获未处理的 Promise 拒绝与同步脚本错误，避免静默黑屏 */
export function useGlobalErrorHandlers(filePath?: string): void {
  const verboseRendererLogs = useAppSettingsStore((state) => state.verboseRendererLogs)

  useEffect(() => {
    appApi.setVerboseLogs(verboseRendererLogs)
  }, [verboseRendererLogs])

  useEffect(() => {
    const onUnhandledRejection = (event: PromiseRejectionEvent) => {
      reportRuntimeError(event.reason, { source: 'unhandledrejection', filePath })
      event.preventDefault()
    }

    const onWindowError = (event: ErrorEvent) => {
      const msg = event.message || event.error?.message || ''
      if (
        msg.includes('ResizeObserver') ||
        msg.includes('ResizeObserver loop completed') ||
        msg.includes('ResizeObserver loop limit exceeded') ||
        ((msg.includes("reading 'documentElement'") || msg.includes("reading 'defaultView'")) &&
          (!event.filename ||
            event.filename.includes('paginator') ||
            event.filename.includes('foliate') ||
            (typeof event.error?.stack === 'string' &&
              (event.error.stack.includes('paginator') || event.error.stack.includes('foliate')))))
      ) {
        return
      }
      reportRuntimeError(event.error ?? event.message, { source: 'window.error', filePath })
    }

    window.addEventListener('unhandledrejection', onUnhandledRejection)
    window.addEventListener('error', onWindowError)
    return () => {
      window.removeEventListener('unhandledrejection', onUnhandledRejection)
      window.removeEventListener('error', onWindowError)
    }
  }, [filePath])
}
