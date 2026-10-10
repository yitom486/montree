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

      // 后台静默一条龙更新：下载阶段完全在后台无感进行，仅在下载就绪时轻量提示一键重启
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
