import { useState } from 'react'
import { Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { getBunRuntimeStatus, installBunRuntime } from '@/api/bun-api'
import { appApi } from '@/api/app-api'
import { isOk } from '@montree/contracts'
import { toast } from 'sonner'

interface AgentBunInstallBannerProps {
  onInstalled?: () => void
}

export function AgentBunInstallBanner({ onInstalled }: AgentBunInstallBannerProps) {
  const [installing, setInstalling] = useState(false)

  const handleInstall = async () => {
    setInstalling(true)
    try {
      const result = await installBunRuntime()
      if (!result.ok) {
        toast.error(result.error.message)
        return
      }
      const status = await getBunRuntimeStatus()
      if (isOk(status) && status.value.installed) {
        toast.success(`Bun 已安装（${status.value.version ?? 'ok'}）`)
        onInstalled?.()
      } else {
        toast.message('安装脚本已执行', {
          description: '请完全退出 Montree 后重新打开，再试连接 Agent。',
        })
      }
    } finally {
      setInstalling(false)
    }
  }

  return (
    <div className="mx-3 mb-2 rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2.5 text-xs text-amber-950 dark:text-amber-100">
      <p className="font-medium">需要安装 Bun</p>
      <p className="mt-1 leading-relaxed text-amber-900/85 dark:text-amber-100/85">
        Montree 安装包不含 Agent 运行时。连接 Codex 需本机安装 Bun（含 bunx），与 OCR 语言包类似，均为按需准备。
      </p>
      <div className="mt-2 flex flex-wrap gap-2">
        <Button type="button" size="xs" disabled={installing} onClick={() => void handleInstall()}>
          {installing ? (
            <>
              <Loader2 className="mr-1 size-3 animate-spin" />
              安装中…
            </>
          ) : (
            '一键安装 Bun'
          )}
        </Button>
        <Button
          type="button"
          size="xs"
          variant="outline"
          disabled={installing}
          onClick={() => void appApi.openExternal('https://bun.sh/docs/installation')}
        >
          安装说明
        </Button>
      </div>
    </div>
  )
}
