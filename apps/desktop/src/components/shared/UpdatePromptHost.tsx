import { useEffect, useRef } from 'react'
import { toast } from 'sonner'
import { appApi } from '@/api/app-api'
import { APP_TITLE } from '@yitom/contracts'
import type { AppUpdateStatus } from '@yitom/contracts'

/** 启动后监听主进程更新事件，用 toast 提示并可一键下载 / 重启安装 */
export function UpdatePromptHost() {
  const toastIdRef = useRef<string | number | null>(null)
  const statusRef = useRef<AppUpdateStatus>({ phase: 'idle' })

  useEffect(() => {
    const renderToast = (status: AppUpdateStatus) => {
      statusRef.current = status

      // 后台静默一条龙更新：下载阶段完全在后台无感进行，就绪时轻量提示一键重启启动
      if (status.phase === 'downloaded') {
        if (toastIdRef.current !== null) toast.dismiss(toastIdRef.current)
        toastIdRef.current = toast.success(`v${status.version} 安装已就绪`, {
          description: '更新已全自动下载就绪，点击立即重启启动新版本',
          duration: Infinity,
          action: {
            label: '重启启动',
            onClick: () => {
              void appApi.installAppUpdate()
            },
          },
        })
        return
      }

      if (status.phase === 'installing') {
        if (toastIdRef.current !== null) toast.dismiss(toastIdRef.current)
        toastIdRef.current = toast.loading('正在静默安装，即将重启启动新版本…', {
          duration: 10000,
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
