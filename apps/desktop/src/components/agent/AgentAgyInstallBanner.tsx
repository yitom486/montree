import { useState } from 'react'
import { Check, Copy, Loader2, Sparkles } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { acpApi } from '@/api/acp-api'
import { appApi } from '@/api/app-api'
import { isOk } from '@montree/contracts'
import { toast } from 'sonner'

interface AgentAgyInstallBannerProps {
  onInstalled?: () => void
}

export function AgentAgyInstallBanner({ onInstalled }: AgentAgyInstallBannerProps) {
  const [installing, setInstalling] = useState(false)
  const [copied, setCopied] = useState(false)

  const isWindows = appApi.getPlatform() === 'win32'
  const commandSnippet = isWindows
    ? 'irm https://antigravity.google/cli/install.ps1 | iex'
    : 'curl -fsSL https://antigravity.google/cli/install.sh | bash'

  const handleInstall = async () => {
    setInstalling(true)
    try {
      const result = await acpApi.installAgyCli()
      if (!result.ok) {
        toast.error(result.error.message)
        return
      }
      if (isOk(result) && result.value.installed) {
        toast.success(`Antigravity CLI (agy) 已安装（${result.value.version ?? '已就绪'}），正在连接…`)
        onInstalled?.()
      } else {
        toast.message('安装脚本已执行', {
          description: '若未自动连接，请在终端执行 agy --version 验证后重试。',
        })
      }
    } finally {
      setInstalling(false)
    }
  }

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(commandSnippet)
      setCopied(true)
      toast.success('安装命令已复制到剪贴板')
      setTimeout(() => setCopied(false), 2000)
    } catch {
      toast.error('复制失败，请手动在终端执行安装')
    }
  }

  return (
    <div className="mx-3 mb-2 rounded-md border border-sky-500/30 bg-sky-500/10 px-3 py-2.5 text-xs text-sky-950 dark:text-sky-100">
      <div className="flex items-center gap-1.5 font-medium">
        <Sparkles className="size-3.5 text-sky-500" />
        <span>需要安装 Antigravity CLI (agy)</span>
      </div>
      <p className="mt-1 leading-relaxed text-sky-900/85 dark:text-sky-100/85">
        连接 Google Antigravity 需本机具备官方 <code>agy</code> 命令行引擎。点击下方按钮可全自动完成静默安装并配置系统环境变量。
      </p>
      <div className="mt-2 flex flex-wrap gap-2">
        <Button
          type="button"
          size="xs"
          disabled={installing}
          onClick={() => void handleInstall()}
        >
          {installing ? (
            <>
              <Loader2 className="mr-1 size-3 animate-spin" />
              正在安装 agy 并配置环境变量…
            </>
          ) : (
            '一键安装 agy'
          )}
        </Button>
        <Button
          type="button"
          size="xs"
          variant="outline"
          disabled={installing}
          onClick={() => void handleCopy()}
        >
          {copied ? (
            <>
              <Check className="mr-1 size-3" />
              已复制
            </>
          ) : (
            <>
              <Copy className="mr-1 size-3" />
              复制终端命令
            </>
          )}
        </Button>
        <Button
          type="button"
          size="xs"
          variant="ghost"
          disabled={installing}
          onClick={() => void appApi.openExternal('https://antigravity.google')}
        >
          官方指引
        </Button>
      </div>
    </div>
  )
}
