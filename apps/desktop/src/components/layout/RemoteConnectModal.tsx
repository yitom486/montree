import { useCallback, useEffect, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import {
  ArrowUp,
  Folder,
  FolderOpen,
  Globe,
  Home,
  Loader2,
  RefreshCw,
  Server,
  Terminal,
} from 'lucide-react'
import { isWslPath, type RemoteDirectoryEntry, type RemoteServerConnectionInfo, type SshConfigHost, type WslDistroInfo } from '@yitom/contracts'
import { remoteApi } from '@/api/remote-api'
import { queryKeys } from '@/api/query-keys'
import { useWorkspaceStore } from '@/stores/workspace-store'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'

export interface RemoteConnectModalProps {
  isOpen: boolean
  onClose: () => void
  /**
   * 遗留回调（SSH D 阶段用）：WSL 确认不再经此回调走本机重扫，
   * 而是经 remoteOpenWslWorkspace 完成远端宿主注册与窗口绑定。
   */
  onOpenWorkspace: (workspacePath: string) => void
  currentWorkspace?: string
  onDisconnectRemote?: () => void
}

type RemoteTab = 'wsl' | 'ssh'

export function RemoteConnectModal({
  isOpen,
  onClose,
  currentWorkspace,
  onDisconnectRemote,
}: RemoteConnectModalProps) {
  const queryClient = useQueryClient()
  const [activeTab, setActiveTab] = useState<RemoteTab>('wsl')

  // WSL 状态
  const [distros, setDistros] = useState<WslDistroInfo[]>([])
  const [selectedDistro, setSelectedDistro] = useState<string>('')
  const [currentPath, setCurrentPath] = useState<string>('')
  const [parentPath, setParentPath] = useState<string | null>(null)
  const [inputPath, setInputPath] = useState<string>('')
  const [entries, setEntries] = useState<RemoteDirectoryEntry[]>([])
  const [homePath, setHomePath] = useState<string>('/home')
  const [isLoadingWsl, setIsLoadingWsl] = useState<boolean>(false)
  const [selectedFolder, setSelectedFolder] = useState<string | null>(null)
  // B1 远端连接：浏览经 Ubuntu 服务执行，须先建连；失败显式报错，不回落 UNC
  const [connection, setConnection] = useState<RemoteServerConnectionInfo | null>(null)
  const [connectedDistro, setConnectedDistro] = useState<string>('')
  const [connectError, setConnectError] = useState<string | null>(null)

  // SSH 状态
  const [sshHosts, setSshHosts] = useState<SshConfigHost[]>([])
  const [sshHost, setSshHost] = useState<string>('')
  const [sshUser, setSshUser] = useState<string>('')
  const [sshPort, setSshPort] = useState<string>('22')
  const [sshPath, setSshPath] = useState<string>('/home')

  // 建立远端连接（经 wsl.exe 管道安装/启动 Ubuntu 服务并握手），成功后浏览
  const connectAndBrowse = useCallback(async (distro: string, targetPath?: string) => {
    setIsLoadingWsl(true)
    setConnectError(null)
    setSelectedFolder(null)
    try {
      const connRes = await remoteApi.connectWsl({ distro })
      if (!connRes.ok) {
        setConnection(null)
        setConnectedDistro('')
        setConnectError(connRes.error.message)
        setEntries([])
        return
      }
      setConnection(connRes.value)
      setConnectedDistro(distro)
      const homeRes = await remoteApi.getWslHome(distro)
      const resolvedHome = homeRes.ok ? homeRes.value : '/home'
      setHomePath(resolvedHome)
      const dest = targetPath ?? resolvedHome
      const browseRes = await remoteApi.browseWsl(distro, dest)
      if (browseRes.ok) {
        setCurrentPath(browseRes.value.currentPath)
        setInputPath(browseRes.value.currentPath)
        setParentPath(browseRes.value.parentPath)
        setEntries(browseRes.value.entries.filter((e) => e.isDirectory))
      } else {
        setConnectError(browseRes.error.message)
      }
    } catch (e) {
      console.error('连接远程环境失败', e)
      setConnectError(e instanceof Error ? e.message : '连接远程环境失败')
    } finally {
      setIsLoadingWsl(false)
    }
  }, [])

  // 加载发行版和 SSH 配置（零硬编码，动态检测本机环境），随后建连并浏览
  useEffect(() => {
    if (!isOpen) return

    let cancelled = false

    async function init() {
      try {
        const [distroRes, sshRes] = await Promise.all([
          remoteApi.listWslDistros(),
          remoteApi.listSshConfigHosts(),
        ])

        if (cancelled) return

        if (sshRes.ok && sshRes.value.length > 0) {
          setSshHosts(sshRes.value)
        }

        if (distroRes.ok && distroRes.value.length > 0) {
          const list = distroRes.value
          setDistros(list)
          // 优先选择被标记为默认的发行版，若无则选择第一个
          const defaultOne = list.find((d) => d.isDefault) ?? list[0]
          const targetDistro = defaultOne?.name ?? ''
          setSelectedDistro(targetDistro)
          if (targetDistro) await connectAndBrowse(targetDistro)
        }
      } catch (e) {
        console.error('初始化远程环境失败', e)
      }
    }

    void init()

    return () => {
      cancelled = true
    }
  }, [isOpen, connectAndBrowse])

  // 导航至指定 Linux 路径（须已建连；断线则先重连，不回落 UNC）
  const navigateTo = useCallback(
    async (distro: string, targetPath: string) => {
      if (!distro || !targetPath) return
      if (connection?.state !== 'connected' || connectedDistro !== distro) {
        await connectAndBrowse(distro, targetPath)
        return
      }
      setIsLoadingWsl(true)
      setSelectedFolder(null)
      setConnectError(null)
      try {
        const res = await remoteApi.browseWsl(distro, targetPath)
        if (res.ok) {
          setCurrentPath(res.value.currentPath)
          setInputPath(res.value.currentPath)
          setParentPath(res.value.parentPath)
          setEntries(res.value.entries.filter((e) => e.isDirectory))
        } else {
          setConnectError(res.error.message)
          toast.error(`无法进入路径: ${res.error.message}`)
        }
      } finally {
        setIsLoadingWsl(false)
      }
    },
    [connection, connectedDistro, connectAndBrowse],
  )

  // 切换分发版（重建连接：代际隔离，旧连接进程由主进程清理）
  const handleSelectDistro = async (newDistro: string) => {
    setSelectedDistro(newDistro)
    await connectAndBrowse(newDistro)
  }

  // P1 确认打开选中的 WSL 目录：连接选中根→注册远端宿主→绑定本窗口→
  // 写回工作区身份与初始文件树（不再只验证后关闭，不走本机重扫）。
  const handleConfirmOpenWsl = async () => {
    if (!selectedDistro) {
      toast.error('未选择 WSL 分发版')
      return
    }

    const finalLinuxPath = selectedFolder
      ? `${currentPath.replace(/\/+$/, '')}/${selectedFolder}`
      : currentPath

    const opened = await remoteApi.openWslWorkspace({
      distro: selectedDistro,
      linuxPath: finalLinuxPath || '/',
    })
    if (!opened.ok) {
      setConnectError(opened.error.message)
      toast.error(`打开远端工作区失败: ${opened.error.message}`)
      return
    }
    const { descriptor, status, folder } = opened.value
    queryClient.setQueryData(queryKeys.workspaceOf(descriptor.id), folder)
    useWorkspaceStore.getState().setConnected({ descriptor, generation: status.generation, status })
    onClose()
    const hand = status.state === 'connected' ? connection?.handshake : null
    toast.success(
      `已打开远端工作区 (${selectedDistro}): ${finalLinuxPath || '/'}${hand ? ` [${hand.platform}/${hand.arch} ${hand.nodeVersion}]` : ''}`,
    )
  }

  // 显式断开（清理本连接启动的远端服务进程）
  const handleDisconnectWsl = async () => {
    await remoteApi.disconnectWsl()
    setConnection(null)
    setConnectedDistro('')
    setEntries([])
    setConnectError(null)
    onDisconnectRemote?.()
    onClose()
  }

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-xl max-h-[85vh] flex flex-col p-6 gap-4">
        <DialogHeader>
          <div className="flex items-center gap-2">
            <div className="flex size-8 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <Terminal className="size-4" />
            </div>
            <div>
              <DialogTitle className="text-base font-semibold">远程工作区连接</DialogTitle>
              <DialogDescription className="text-xs text-muted-foreground">
                应用内直连 WSL 或 SSH 远程环境，无需操作系统文件选择器
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        {/* 当前远程环境状态与断开连接 */}
        {currentWorkspace && isWslPath(currentWorkspace) ? (
          <div className="flex items-center justify-between rounded-lg border border-sky-500/30 bg-sky-500/10 px-3 py-2 text-xs text-sky-800 dark:text-sky-300">
            <div className="min-w-0 flex-1 pr-3">
              <span className="font-medium">当前已连接远程环境：</span>
              <span className="font-mono text-[11px] truncate block opacity-90 mt-0.5" title={currentWorkspace}>
                {currentWorkspace}
              </span>
            </div>
            {onDisconnectRemote ? (
              <Button
                type="button"
                variant="destructive"
                size="sm"
                className="shrink-0 h-7 px-2.5 text-xs shadow-none"
                onClick={() => {
                  onDisconnectRemote()
                  onClose()
                }}
              >
                断开远程连接
              </Button>
            ) : null}
          </div>
        ) : null}

        {/* 顶部标签切换 */}
        <div className="flex border-b border-border/60 gap-4 text-xs font-medium">
          <button
            type="button"
            className={cn(
              'pb-2 border-b-2 transition-colors flex items-center gap-1.5',
              activeTab === 'wsl'
                ? 'border-primary text-foreground'
                : 'border-transparent text-muted-foreground hover:text-foreground',
            )}
            onClick={() => setActiveTab('wsl')}
          >
            <Terminal className="size-3.5" />
            <span>WSL Linux 子系统</span>
            {distros.length > 0 && (
              <span className="text-[10px] px-1 rounded-full bg-accent text-accent-foreground font-mono">
                {distros.length}
              </span>
            )}
          </button>
          <button
            type="button"
            className={cn(
              'pb-2 border-b-2 transition-colors flex items-center gap-1.5',
              activeTab === 'ssh'
                ? 'border-primary text-foreground'
                : 'border-transparent text-muted-foreground hover:text-foreground',
            )}
            onClick={() => setActiveTab('ssh')}
          >
            <Server className="size-3.5" />
            <span>SSH 远程主机</span>
            {sshHosts.length > 0 && (
              <span className="text-[10px] px-1 rounded-full bg-accent text-accent-foreground font-mono">
                {sshHosts.length}
              </span>
            )}
          </button>
        </div>

        {/* WSL 选项卡 */}
        {activeTab === 'wsl' && (
          <div className="flex min-h-0 flex-1 flex-col gap-3">
            {distros.length === 0 && !isLoadingWsl ? (
              <div className="flex flex-col items-center justify-center p-8 text-center text-muted-foreground rounded-lg border border-dashed">
                <Terminal className="size-8 mb-2 opacity-50" />
                <p className="text-sm font-medium text-foreground">未检测到已安装的 WSL 分发版</p>
                <p className="text-xs mt-1">您可以在 Windows 终端中运行 <code>wsl --install</code> 安装 Linux 子系统</p>
              </div>
            ) : (
              <>
                {/* 发行版与快捷工具栏 */}
                <div className="flex items-center gap-2">
                  <span className="text-xs text-muted-foreground shrink-0 font-medium">分发版:</span>
                  <select
                    className="h-8 rounded-md border border-input bg-background px-2.5 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
                    value={selectedDistro}
                    onChange={(e) => void handleSelectDistro(e.target.value)}
                    disabled={isLoadingWsl}
                  >
                    {distros.map((d) => (
                      <option key={d.name} value={d.name}>
                        {d.name} {d.isDefault ? '(默认)' : ''}
                      </option>
                    ))}
                  </select>

                  <div className="ml-auto flex items-center gap-1">
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="h-7 px-2 text-xs gap-1"
                      onClick={() => void navigateTo(selectedDistro, homePath)}
                      title="快速回到用户家目录 (~)"
                      disabled={isLoadingWsl}
                    >
                      <Home className="size-3" />
                      <span>~</span>
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="h-7 px-2 text-xs gap-1"
                      onClick={() => void navigateTo(selectedDistro, '/')}
                      title="回到根目录 (/)"
                      disabled={isLoadingWsl}
                    >
                      <span>/</span>
                    </Button>
                    {parentPath && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="h-7 px-2 text-xs gap-1"
                        onClick={() => void navigateTo(selectedDistro, parentPath)}
                        title="上级目录 (..)"
                        disabled={isLoadingWsl}
                      >
                        <ArrowUp className="size-3" />
                        <span>..</span>
                      </Button>
                    )}
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="size-7 p-0"
                      onClick={() => void navigateTo(selectedDistro, currentPath)}
                      title="刷新"
                      disabled={isLoadingWsl}
                    >
                      <RefreshCw className={cn('size-3', isLoadingWsl && 'animate-spin')} />
                    </Button>
                  </div>
                </div>

                {/* 路径直接输入框 */}
                <form
                  onSubmit={(e) => {
                    e.preventDefault()
                    void navigateTo(selectedDistro, inputPath)
                  }}
                  className="flex gap-2"
                >
                  <Input
                    value={inputPath}
                    onChange={(e) => setInputPath(e.target.value)}
                    placeholder="/home/username/projects/blog"
                    className="h-8 text-xs font-mono"
                    disabled={isLoadingWsl}
                  />
                  <Button type="submit" size="sm" variant="secondary" className="h-8 px-3 text-xs shrink-0" disabled={isLoadingWsl}>
                    进入
                  </Button>
                </form>

                {/* 远端连接状态（B1：浏览经 Ubuntu 服务执行，仅显示有效状态） */}
                {connection?.state === 'connected' && connection.handshake ? (
                  <div className="rounded-md border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-1.5 text-[11px] text-emerald-800 dark:text-emerald-300">
                    <span className="font-medium">远端服务已连接：</span>
                    <span className="font-mono">
                      {connection.handshake.platform}/{connection.handshake.arch} {connection.handshake.nodeVersion}
                      {' '}build={connection.handshake.buildId.slice(0, 12)}
                    </span>
                    <button
                      type="button"
                      className="ml-2 underline underline-offset-2 hover:opacity-80"
                      onClick={() => void handleDisconnectWsl()}
                    >
                      断开
                    </button>
                  </div>
                ) : null}
                {connectError ? (
                  <div className="rounded-md border border-destructive/40 bg-destructive/10 px-2.5 py-1.5 text-[11px] text-destructive">
                    <span className="font-medium">连接失败：</span>
                    <span className="whitespace-pre-wrap break-words">{connectError}</span>
                    <button
                      type="button"
                      className="ml-2 underline underline-offset-2 hover:opacity-80"
                      onClick={() => void connectAndBrowse(selectedDistro, currentPath || undefined)}
                    >
                      重试
                    </button>
                  </div>
                ) : null}

                {/* 应用内文件树列表 */}
                <div className="min-h-[220px] max-h-[300px] flex-1 overflow-y-auto rounded-md border border-border/60 bg-muted/20 p-1">
                  {isLoadingWsl ? (
                    <div className="flex h-36 items-center justify-center text-xs text-muted-foreground gap-2">
                      <Loader2 className="size-4 animate-spin text-primary" />
                      <span>正在读取 WSL 目录…</span>
                    </div>
                  ) : entries.length === 0 ? (
                    <div className="flex h-36 items-center justify-center text-xs text-muted-foreground">
                      当前目录下无子文件夹
                    </div>
                  ) : (
                    <div className="grid grid-cols-1 gap-0.5">
                      {entries.map((item) => {
                        const isSelected = selectedFolder === item.name
                        return (
                          <div
                            key={item.name}
                            className={cn(
                              'flex items-center justify-between px-2.5 py-1.5 rounded text-xs select-none cursor-pointer transition-colors group',
                              isSelected
                                ? 'bg-primary/15 text-primary font-medium'
                                : 'hover:bg-accent/50 text-foreground',
                            )}
                            onClick={() => setSelectedFolder(item.name)}
                            onDoubleClick={() => {
                              const next = `${currentPath.replace(/\/+$/, '')}/${item.name}`
                              void navigateTo(selectedDistro, next)
                            }}
                          >
                            <div className="flex items-center gap-2 min-w-0">
                              {isSelected ? (
                                <FolderOpen className="size-3.5 text-primary shrink-0" />
                              ) : (
                                <Folder className="size-3.5 text-amber-500 shrink-0" />
                              )}
                              <span className="truncate">{item.name}</span>
                            </div>
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              className="h-5 px-1.5 text-[10px] opacity-0 group-hover:opacity-100 transition-opacity"
                              onClick={(e) => {
                                e.stopPropagation()
                                const next = `${currentPath.replace(/\/+$/, '')}/${item.name}`
                                void navigateTo(selectedDistro, next)
                              }}
                            >
                              进入
                            </Button>
                          </div>
                        )
                      })}
                    </div>
                  )}
                </div>

                <div className="text-[11px] text-muted-foreground truncate">
                  当前位置: <span className="font-mono text-foreground">{currentPath}</span>
                  {selectedFolder && (
                    <span className="text-primary font-mono font-medium"> / {selectedFolder}</span>
                  )}
                </div>
              </>
            )}
          </div>
        )}

        {/* SSH 选项卡 */}
        {activeTab === 'ssh' && (
          <div className="flex min-h-0 flex-1 flex-col gap-3">
            {sshHosts.length > 0 && (
              <div>
                <p className="text-xs font-medium text-muted-foreground mb-1.5">
                  已检测到的配置主机 (来自 ~/.ssh/config):
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {sshHosts.map((h) => (
                    <Button
                      key={h.host}
                      type="button"
                      variant="outline"
                      size="sm"
                      className="h-7 text-xs font-mono"
                      onClick={() => {
                        setSshHost(h.hostname || h.host)
                        if (h.user) setSshUser(h.user)
                        if (h.port) setSshPort(String(h.port))
                      }}
                    >
                      {h.host}
                    </Button>
                  ))}
                </div>
              </div>
            )}

            <div className="grid grid-cols-2 gap-2 text-xs">
              <div className="space-y-1">
                <span className="text-muted-foreground font-medium">主机地址 (Host/IP)</span>
                <Input
                  value={sshHost}
                  onChange={(e) => setSshHost(e.target.value)}
                  placeholder="192.168.1.100 或 blog.server.com"
                  className="h-8 text-xs font-mono"
                />
              </div>
              <div className="space-y-1">
                <span className="text-muted-foreground font-medium">端口 (Port)</span>
                <Input
                  value={sshPort}
                  onChange={(e) => setSshPort(e.target.value)}
                  placeholder="22"
                  className="h-8 text-xs font-mono"
                />
              </div>
              <div className="space-y-1">
                <span className="text-muted-foreground font-medium">用户名 (User)</span>
                <Input
                  value={sshUser}
                  onChange={(e) => setSshUser(e.target.value)}
                  placeholder="ubuntu"
                  className="h-8 text-xs font-mono"
                />
              </div>
              <div className="space-y-1">
                <span className="text-muted-foreground font-medium">远程目录路径</span>
                <Input
                  value={sshPath}
                  onChange={(e) => setSshPath(e.target.value)}
                  placeholder="/var/www/blog"
                  className="h-8 text-xs font-mono"
                />
              </div>
            </div>

            <p className="text-[11px] text-muted-foreground bg-muted/30 p-2.5 rounded-md border border-border/50">
              💡 提示：SSH 远程主机连接将借助本地 SSH Key（如 <code>~/.ssh/id_rsa</code>）完成认证。如需直接推送到远程 Git 仓库，可配合 WSL 或本地 Git 服务使用。
            </p>
          </div>
        )}

        <DialogFooter className="mt-2 flex items-center justify-between sm:justify-between w-full">
          <Button type="button" variant="ghost" size="sm" onClick={onClose} className="text-xs">
            取消
          </Button>
          {activeTab === 'wsl' && distros.length > 0 && (
            <Button
              type="button"
              size="sm"
              onClick={() => void handleConfirmOpenWsl()}
              disabled={isLoadingWsl}
              className="text-xs gap-1.5"
            >
              <FolderOpen className="size-3.5" />
              <span>打开远端工作区</span>
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
