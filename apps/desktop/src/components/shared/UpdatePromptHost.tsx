import { useEffect, useRef } from 'react'
import { toast } from 'sonner'
import { appApi } from '@/api/app-api'
import { APP_TITLE } from '@montree/contracts'
import type { AppUpdateStatus } from '@montree/contracts'

/** 启动后监听主进程更新事件，用 toast 提示并可一键下载 / 重启安装 */
export function UpdatePromptHost() {
  const toastIdRef = useRef<string | number | null>(null)
  const statusRef = useRef<AppUpdateStatus>({ phase: 'idle' })

  useEffect(() => {
    const renderToast = (status: AppUpdateStatus) => {
      statusRef.current = status

      if (status.phase === 'available') {
        if (toastIdRef.current !== null) toast.dismiss(toastIdRef.current)
        toastIdRef.current = toast.info(`${APP_TITLE} v${status.version} 可用`, {
          description: status.message ?? '点击下载并在完成后重启安装',
          duration: Infinity,
          action: {
            label: '立即更新',
            onClick: () => {
              void appApi.downloadAppUpdate()
            },
          },
          cancel: {
            label: '稍后',
            onClick: () => undefined,
          },
        })
        return
      }

      if (status.phase === 'downloading') {
        if (toastIdRef.current !== null) toast.dismiss(toastIdRef.current)
        toastIdRef.current = toast.loading(status.message ?? '正在下载更新…', {
          description: status.percent != null ? `${status.percent}%` : undefined,
        })
        return
      }

      if (status.phase === 'downloaded') {
        if (toastIdRef.current !== null) toast.dismiss(toastIdRef.current)
        toastIdRef.current = toast.success(`v${status.version} 已就绪`, {
          description: '重启应用以完成安装',
          duration: Infinity,
          action: {
            label: '重启并安装',
            onClick: () => {
              void appApi.installAppUpdate()
            },
          },
        })
        return
      }

      if (status.phase === 'error' && status.message?.includes('开发模式')) {
        return
      }
    }

    const unsubscribe = appApi.onAppUpdateStatus((status) => {
      renderToast(status)
    })

    return () => {
      unsubscribe?.()
      if (toastIdRef.current !== null) toast.dismiss(toastIdRef.current)
    }
  }, [])

  return null
}
