import {
  AppWindow,
  Bug,
  Ellipsis,
  FileCode2,
  FilePlus,
  FileText,
  FolderOpen,
  FolderPlus,
  HelpCircle,
  LogOut,
  RefreshCw,
  Save,
  SaveAll,
  Search,
  Settings,
  Terminal,
  XCircle,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'

/**
 * 资源管理器 ⋯ 溢出菜单：文件操作 / 窗口 / 文档 / 应用四组。
 * 收敛原 TitleBar 四个下拉菜单 + 资源管理器 header 一排图标按钮——
 * TitleBar 整行删除后，这些入口唯一的家（快捷键除外）。
 */
export interface FileExplorerOverflowMenuProps {
  /** 工作区已打开（新建文件/文件夹、重新扫描可用） */
  canWrite?: boolean
  /** 只读模式（阅读器/在线文档）：文档组隐藏 */
  readOnly?: boolean
  /** Typst 在自身工作区导出，不调用 Markdown HTML/PDF 导出。 */
  markdownExport?: boolean
  isRescanning?: boolean
  isRemoteWorkspace?: boolean
  onNewFile: () => void
  onNewTypstFile?: () => void
  onNewFolder: () => void
  onOpenFile: () => void
  onOpenFolder: () => void
  onOpenRemote?: () => void
  onCloseWorkspace?: () => void
  onQuickOpen?: () => void
  onRescanWorkspace?: () => void
  onNewWindow: () => void
  onSave: () => void
  onSaveAs: () => void
  onExportHtml: () => void
  onExportPdf: () => void
  onOpenSettings: () => void
  onOpenErrorLog: () => void
  onOpenDevTools: () => void
  onAbout: () => void
  onQuit: () => void
}

export function FileExplorerOverflowMenu({
  canWrite = false,
  readOnly = false,
  markdownExport = true,
  isRescanning = false,
  isRemoteWorkspace = false,
  onNewFile,
  onNewTypstFile,
  onNewFolder,
  onOpenFile,
  onOpenFolder,
  onOpenRemote,
  onCloseWorkspace,
  onQuickOpen,
  onRescanWorkspace,
  onNewWindow,
  onSave,
  onSaveAs,
  onExportHtml,
  onExportPdf,
  onOpenSettings,
  onOpenErrorLog,
  onOpenDevTools,
  onAbout,
  onQuit,
}: FileExplorerOverflowMenuProps) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className="h-7 px-2 text-xs text-muted-foreground"
          title="更多操作"
          aria-label="更多操作"
        >
          <Ellipsis className="size-3.5" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuItem disabled={!canWrite} onClick={onNewFile}>
          <FilePlus className="size-4" />
          新建文件
        </DropdownMenuItem>
        {onNewTypstFile && <DropdownMenuItem disabled={!canWrite} onClick={onNewTypstFile}>
          <FileCode2 className="size-4" />
          新建 Typst 文档
        </DropdownMenuItem>}
        <DropdownMenuItem disabled={!canWrite} onClick={onNewFolder}>
          <FolderPlus className="size-4" />
          新建文件夹
        </DropdownMenuItem>
        <DropdownMenuItem onClick={onOpenFile}>
          <FileText className="size-4" />
          打开文件
          <DropdownMenuShortcut>Ctrl+O</DropdownMenuShortcut>
        </DropdownMenuItem>
        <DropdownMenuItem onClick={onOpenFolder}>
          <FolderOpen className="size-4" />
          打开文件夹
          <DropdownMenuShortcut>Ctrl+Shift+O</DropdownMenuShortcut>
        </DropdownMenuItem>
        {onOpenRemote ? (
          <DropdownMenuItem onClick={onOpenRemote}>
            <Terminal className="size-4" />
            打开远程文件夹 (WSL / SSH)…
          </DropdownMenuItem>
        ) : null}
        {onQuickOpen ? (
          <DropdownMenuItem onClick={onQuickOpen}>
            <Search className="size-4" />
            快速打开文件…
            <DropdownMenuShortcut>Ctrl+P</DropdownMenuShortcut>
          </DropdownMenuItem>
        ) : null}
        {onRescanWorkspace ? (
          <DropdownMenuItem disabled={!canWrite || isRescanning} onClick={onRescanWorkspace}>
            <RefreshCw className="size-4" />
            重新扫描工作区
          </DropdownMenuItem>
        ) : null}
        {onCloseWorkspace && canWrite ? (
          <DropdownMenuItem onClick={onCloseWorkspace} className="text-destructive focus:text-destructive">
            <XCircle className="size-4" />
            {isRemoteWorkspace ? '断开远程连接 / 关闭工作区' : '关闭工作区'}
          </DropdownMenuItem>
        ) : null}
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={onNewWindow}>
          <AppWindow className="size-4" />
          新建窗口
          <DropdownMenuShortcut>Ctrl+Shift+N</DropdownMenuShortcut>
        </DropdownMenuItem>
        {!readOnly ? (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={onSave}>
              <Save className="size-4" />
              保存
              <DropdownMenuShortcut>Ctrl+S</DropdownMenuShortcut>
            </DropdownMenuItem>
            <DropdownMenuItem onClick={onSaveAs}>
              <SaveAll className="size-4" />
              另存为
              <DropdownMenuShortcut>Ctrl+Shift+S</DropdownMenuShortcut>
            </DropdownMenuItem>
            {markdownExport && <DropdownMenuItem onClick={onExportHtml}>
              <FileCode2 className="size-4" />
              导出 HTML
            </DropdownMenuItem>}
            {markdownExport && <DropdownMenuItem onClick={onExportPdf}>
              <FileText className="size-4" />
              导出 PDF
            </DropdownMenuItem>}
          </>
        ) : null}
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={onOpenSettings}>
          <Settings className="size-4" />
          设置...
          <DropdownMenuShortcut>Ctrl+,</DropdownMenuShortcut>
        </DropdownMenuItem>
        <DropdownMenuItem onClick={onOpenErrorLog}>
          <FileText className="size-4" />
          错误日志
        </DropdownMenuItem>
        <DropdownMenuItem onClick={onOpenDevTools}>
          <Bug className="size-4" />
          开发者工具
          <DropdownMenuShortcut>Ctrl+Shift+I</DropdownMenuShortcut>
        </DropdownMenuItem>
        <DropdownMenuItem onClick={onAbout}>
          <HelpCircle className="size-4" />
          关于
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem variant="destructive" onClick={onQuit}>
          <LogOut className="size-4" />
          退出
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
