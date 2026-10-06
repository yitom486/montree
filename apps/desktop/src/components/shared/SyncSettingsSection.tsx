import { useEffect, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import {
  Cloud,
  RefreshCw,
  CheckCircle2,
  AlertCircle,
  Eye,
  EyeOff,
  ExternalLink,
  ShieldCheck,
  Zap,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { syncApi } from '@/api/sync-api'
import { appApi } from '@/api/app-api'
import { queryKeys } from '@/api/query-keys'
import { useSyncConfig, useSyncStatus } from '@/hooks/sync/useSyncConfigStatus'
import type { SyncConfig, SyncProviderType } from '@montree/contracts'
import { cn } from '@/lib/utils'
import { toast } from 'sonner'

interface SyncSettingsSectionProps {
  // 可以根据需要扩展
}

const PROVIDER_OPTIONS: Array<{ value: SyncProviderType; label: string }> = [
  { value: 'jianguoyun', label: '坚果云 (推荐)' },
  { value: 'nextcloud', label: 'Nextcloud' },
  { value: 'custom', label: '通用 WebDAV' },
]

export function SyncSettingsSection(_props: SyncSettingsSectionProps) {
  const queryClient = useQueryClient()
  const configQuery = useSyncConfig()
  const { status } = useSyncStatus()

  // 表单编辑态：服务端配置只作为首次种子（避免失效重取覆盖未保存的编辑）
  const [config, setConfig] = useState<SyncConfig>({
    enabled: false,
    provider: 'jianguoyun',
    serverUrl: 'https://dav.jianguoyun.com/dav/',
    username: '',
    password: '',
    remoteDir: '/MontreeSync',
    syncOnStartup: true,
    ignoreTlsErrors: false,
  })
  const seededRef = useRef(false)
  useEffect(() => {
    if (configQuery.data && !seededRef.current) {
      seededRef.current = true
      setConfig(configQuery.data)
    }
  }, [configQuery.data])

  const [showPassword, setShowPassword] = useState(false)
  const [testing, setTesting] = useState(false)
  const [syncing, setSyncing] = useState(false)

  // 推送离开 syncing 态时复位按钮 loading（推送经 setQueryData 已写入 status 缓存）
  useEffect(() => {
    if (status.phase !== 'syncing') {
      setSyncing(false)
    }
  }, [status.phase])

  // 2. 更新配置并持久化（写后失效配置缓存，保持其他消费方一致）
  const updateConfig = (patch: Partial<SyncConfig>) => {
    const next = { ...config, ...patch }
    setConfig(next)
    void syncApi.saveConfig(next).then((res) => {
      if (res.ok) {
        void queryClient.invalidateQueries({ queryKey: queryKeys.syncConfig })
      }
    })
  }

  // 3. 切换服务商预设
  const handleSelectProvider = (provider: SyncProviderType) => {
    if (provider === 'jianguoyun') {
      updateConfig({
        provider,
        serverUrl: 'https://dav.jianguoyun.com/dav/',
        remoteDir: config.remoteDir || '/MontreeSync',
      })
    } else if (provider === 'nextcloud') {
      const defaultNc = config.serverUrl.includes('jianguoyun')
        ? 'https://your-domain.com/remote.php/dav/files/YOUR_USER/'
        : config.serverUrl
      updateConfig({
        provider,
        serverUrl: defaultNc,
        remoteDir: config.remoteDir || '/MontreeSync',
      })
    } else {
      updateConfig({ provider })
    }
  }

  // 4. 测试连接
  const handleTestConnection = async () => {
    if (!config.serverUrl?.trim() || !config.username?.trim() || !config.password?.trim()) {
      toast.error('请先填写服务器地址、用户名与密码')
      return
    }
    setTesting(true)
    try {
      const res = await syncApi.testConnection(config)
      if (res.ok) {
        toast.success(`连接成功！延迟 ${res.value.latencyMs}ms，目录验证通过`)
      } else {
        toast.error(`连接失败：${res.error.message}`)
      }
    } finally {
      setTesting(false)
    }
  }

  // 5. 立即同步
  const handleRunSyncNow = async () => {
    setSyncing(true)
    try {
      const res = await syncApi.runSyncNow()
      if (res.ok) {
        const { stats } = res.value
        toast.success(
          `同步完成！更新划线 ${stats.marksAdded + stats.marksUpdated} 条，进度 ${stats.progressUpdated} 处，测验 ${stats.quizAdded} 条`,
        )
      } else {
        toast.error(`同步失败：${res.error.message}`)
      }
    } finally {
      setSyncing(false)
    }
  }

  const formatLastTime = (ts?: number) => {
    if (!ts) return '尚未同步'
    const date = new Date(ts)
    return `${date.toLocaleDateString()} ${date.toLocaleTimeString()}`
  }

  return (
    <section className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Cloud className="size-4 text-primary" />
          <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            云端同步 (WebDAV)
          </h3>
        </div>
        {/* 状态指示器与快速同步按钮 */}
        {config.enabled && (
          <div className="flex items-center gap-2">
            <span
              className={cn(
                'inline-flex items-center gap-1.5 text-xs font-normal',
                status.phase === 'syncing' && 'text-blue-500',
                status.phase === 'success' && 'text-emerald-500',
                status.phase === 'error' && 'text-rose-500',
                status.phase === 'idle' && 'text-muted-foreground',
              )}
            >
              {status.phase === 'syncing' ? (
                <>
                  <RefreshCw className="size-3 animate-spin" />
                  同步中…
                </>
              ) : status.phase === 'success' ? (
                <>
                  <CheckCircle2 className="size-3" />
                  已同步 ({formatLastTime(status.lastSyncTime)})
                </>
              ) : status.phase === 'error' ? (
                <>
                  <AlertCircle className="size-3" />
                  {status.error || '同步异常'}
                </>
              ) : (
                <>上次同步: {formatLastTime(status.lastSyncTime)}</>
              )}
            </span>
            <Button
              type="button"
              size="xs"
              variant="outline"
              disabled={syncing || status.phase === 'syncing'}
              onClick={() => void handleRunSyncNow()}
              className="gap-1"
            >
              <RefreshCw className={cn('size-3', syncing && 'animate-spin')} />
              立即同步
            </Button>
          </div>
        )}
      </div>

      {/* 启用开关 */}
      <div className="flex items-center justify-between py-1">
        <div>
          <p className="text-sm font-medium text-foreground">启用云端同步</p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            使用您自己的 WebDAV 网盘多端无损同步阅读进度、高亮划线与 AI 测验档案。
          </p>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={config.enabled}
          aria-label="启用云端同步"
          onClick={() => updateConfig({ enabled: !config.enabled })}
          className={cn(
            'relative inline-flex h-6 w-11 items-center rounded-full transition-colors',
            config.enabled ? 'bg-primary' : 'bg-muted',
          )}
        >
          <span
            className={cn(
              'inline-block size-4 transform rounded-full bg-background transition-transform',
              config.enabled ? 'translate-x-6' : 'translate-x-1',
            )}
          />
        </button>
      </div>

      {config.enabled && (
        <div className="space-y-3 rounded-lg border border-border/70 bg-card/60 p-3.5 text-xs">
          {/* 服务商预设选择 */}
          <div className="space-y-1.5">
            <label className="font-medium text-foreground">服务商预设</label>
            <div className="flex flex-wrap gap-1.5">
              {PROVIDER_OPTIONS.map((opt) => (
                <Button
                  key={opt.value}
                  type="button"
                  size="xs"
                  variant={config.provider === opt.value ? 'default' : 'outline'}
                  onClick={() => handleSelectProvider(opt.value)}
                >
                  {opt.label}
                </Button>
              ))}
            </div>
          </div>

          {/* 坚果云专属引导提示 */}
          {config.provider === 'jianguoyun' && (
            <div className="rounded-md border border-amber-500/20 bg-amber-500/10 p-2.5 text-amber-600 dark:text-amber-400">
              <div className="flex items-start justify-between gap-2">
                <div className="space-y-1">
                  <p className="font-medium flex items-center gap-1.5">
                    <ShieldCheck className="size-3.5" />
                    坚果云必须使用「应用授权密码」
                  </p>
                  <p className="text-[11px] leading-relaxed text-amber-700 dark:text-amber-300">
                    请勿使用网页登录密码。登录坚果云网页版 ➔ 账户信息 ➔ 安全选项 ➔ 第三方应用管理 ➔ 添加应用密码。
                  </p>
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="xs"
                  className="h-6 gap-1 px-1.5 text-amber-700 hover:text-amber-800 dark:text-amber-300"
                  onClick={() => void appApi.openExternal('https://www.jianguoyun.com/d/home#/account/security')}
                >
                  前往生成
                  <ExternalLink className="size-3" />
                </Button>
              </div>
            </div>
          )}

          {/* 服务器地址 */}
          <div className="space-y-1">
            <label className="font-medium text-foreground">WebDAV 服务器地址</label>
            <Input
              type="text"
              value={config.serverUrl}
              onChange={(e) => updateConfig({ serverUrl: e.target.value })}
              placeholder="https://dav.jianguoyun.com/dav/"
              className="font-mono text-xs"
            />
          </div>

          {/* 账号与应用密码两列排布 */}
          <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
            <div className="space-y-1">
              <label className="font-medium text-foreground">账户 / 用户名</label>
              <Input
                type="text"
                value={config.username}
                onChange={(e) => updateConfig({ username: e.target.value })}
                placeholder="坚果云注册邮箱"
                className="text-xs"
              />
            </div>
            <div className="space-y-1">
              <div className="flex items-center justify-between">
                <label className="font-medium text-foreground">
                  {config.provider === 'jianguoyun' ? '应用授权密码' : '密码'}
                </label>
                <button
                  type="button"
                  tabIndex={-1}
                  className="flex items-center gap-0.5 text-[11px] text-muted-foreground hover:text-foreground"
                  onClick={() => setShowPassword(!showPassword)}
                >
                  {showPassword ? <EyeOff className="size-3" /> : <Eye className="size-3" />}
                  <span>{showPassword ? '隐藏' : '显示'}</span>
                </button>
              </div>
              <Input
                type={showPassword ? 'text' : 'password'}
                value={config.password}
                onChange={(e) => updateConfig({ password: e.target.value })}
                placeholder={config.provider === 'jianguoyun' ? '填入生成的应用密码' : 'WebDAV 密码'}
                className="font-mono text-xs"
              />
            </div>
          </div>

          {/* 远端同步目录 */}
          <div className="space-y-1">
            <label className="font-medium text-foreground">云端同步文件夹</label>
            <Input
              type="text"
              value={config.remoteDir}
              onChange={(e) => updateConfig({ remoteDir: e.target.value })}
              placeholder="/MontreeSync"
              className="font-mono text-xs"
            />
            <p className="text-[11px] text-muted-foreground">
              云端存储路径，将在此目录下创建 <code>reading-marks.json</code> 与 <code>reading-progress.json</code>。
            </p>
          </div>

          {/* 选项与连接测试 */}
          <div className="flex flex-wrap items-center justify-between gap-3 pt-1 border-t border-border/40">
            <div className="flex items-center gap-4">
              <label className="flex items-center gap-1.5 cursor-pointer text-muted-foreground hover:text-foreground">
                <input
                  type="checkbox"
                  checked={config.syncOnStartup}
                  onChange={(e) => updateConfig({ syncOnStartup: e.target.checked })}
                  className="rounded border-input text-primary focus:ring-1 focus:ring-primary"
                />
                <span>启动时自动同步</span>
              </label>
              {config.provider !== 'jianguoyun' && (
                <label className="flex items-center gap-1.5 cursor-pointer text-muted-foreground hover:text-foreground">
                  <input
                    type="checkbox"
                    checked={Boolean(config.ignoreTlsErrors)}
                    onChange={(e) => updateConfig({ ignoreTlsErrors: e.target.checked })}
                    className="rounded border-input text-primary focus:ring-1 focus:ring-primary"
                  />
                  <span>信任自签名证书 (NAS)</span>
                </label>
              )}
            </div>

            <div className="flex items-center gap-2">
              <Button
                type="button"
                size="xs"
                variant="outline"
                disabled={testing}
                onClick={() => void handleTestConnection()}
                className="gap-1"
              >
                <Zap className="size-3 text-amber-500" />
                {testing ? '测试中…' : '测试连接'}
              </Button>
            </div>
          </div>
        </div>
      )}
    </section>
  )
}
