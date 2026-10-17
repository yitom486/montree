import { useCallback, useEffect, useState } from 'react'
import { appApi } from '@/api/app-api'
import type { AppUpdateStatus } from '@yitom/contracts'

export function useAppUpdate() {
  const [status, setStatus] = useState<AppUpdateStatus>({ phase: 'idle' })

  useEffect(() => {
    void appApi.getAppUpdateStatus().then((current) => {
      if (current) setStatus(current)
    })

    const unsubscribe = appApi.onAppUpdateStatus((next) => {
      setStatus(next)
    })
    return unsubscribe
  }, [])

  const check = useCallback(async () => {
    const next = await appApi.checkAppUpdate()
    if (next) setStatus(next)
    return next
  }, [])

  const download = useCallback(async () => {
    const next = await appApi.downloadAppUpdate()
    if (next) setStatus(next)
    return next
  }, [])

  const install = useCallback(async () => {
    setStatus((prev) => ({
      ...prev,
      phase: 'installing',
      message: '正在准备静默安装，即将重启启动新版本…',
    }))
    await appApi.installAppUpdate()
  }, [])

  return { status, check, download, install }
}
