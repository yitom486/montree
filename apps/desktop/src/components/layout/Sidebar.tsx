import { FileExplorer } from '@/components/layout/panels/FileExplorer'
import { WebDocSidebarPanel } from '@/components/layout/web-doc/WebDocSidebarPanel'
import type { FileTreeNode } from '@yitom/contracts'
import type { useFileTreeActions } from '@/hooks/workspace/useFileTreeActions'

interface SidebarProps {
  workspaceRoot?: string
  fileTree: FileTreeNode[]
  activeFilePath?: string
  webPageUrl?: string | null
  recentWebUrls?: string[]
  fileTreeExpanded?: boolean
  onFileTreeToggle?: () => void
  webDocExpanded?: boolean
  onWebDocToggle?: () => void
  onOpenFolder: () => void
  onOpenRemote?: () => void
  onCloseWorkspace?: () => void
  onOpenWebDoc?: (url: string) => void
  onRescanWorkspace?: () => void
  isRescanningWorkspace?: boolean
  onSelectFile: (path: string) => void
  onHideSidebar?: () => void
  treeActions?: ReturnType<typeof useFileTreeActions>
  /** 只读模式：资源管理器 ⋯ 菜单隐藏文档组 */
  readOnly?: boolean
  onOpenFile?: () => void
  onQuickOpen?: () => void
  onNewWindow?: () => void
  onSave?: () => void
  onSaveAs?: () => void
  onExportHtml?: () => void
  onExportPdf?: () => void
  onOpenSettings?: () => void
  onOpenErrorLog?: () => void
  onOpenDevTools?: () => void
  onAbout?: () => void
  onQuit?: () => void
}

/**
 * 左侧栏：仅承载资源管理器与在线文档入口。
 * 文档目录已移至右侧独立面板（WorkspaceShell），不再与文件树争抢纵向空间。
 */
export function Sidebar({
  workspaceRoot,
  fileTree,
  activeFilePath,
  webPageUrl,
  recentWebUrls,
  fileTreeExpanded = true,
  onFileTreeToggle = () => undefined,
  webDocExpanded = true,
  onWebDocToggle = () => undefined,
  onOpenFolder,
  onOpenRemote,
  onCloseWorkspace,
  onOpenWebDoc,
  onRescanWorkspace,
  isRescanningWorkspace,
  onSelectFile,
  onHideSidebar,
  treeActions,
  readOnly,
  onOpenFile,
  onQuickOpen,
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
}: SidebarProps) {
  const renderFileExplorer = (collapsed = !fileTreeExpanded) => (
    <FileExplorer
      workspaceRoot={workspaceRoot}
      tree={fileTree}
      activeFilePath={activeFilePath}
      collapsed={collapsed}
      onToggle={onFileTreeToggle}
      webPageUrl={webPageUrl}
      recentWebUrls={recentWebUrls}
      onOpenFolder={onOpenFolder}
      onOpenRemote={onOpenRemote}
      onCloseWorkspace={onCloseWorkspace}
      onOpenWebDoc={onOpenWebDoc}
      onRescanWorkspace={onRescanWorkspace}
      isRescanning={isRescanningWorkspace}
      onSelectFile={onSelectFile}
      onHideSidebar={onHideSidebar}
      treeActions={treeActions}
      readOnly={readOnly}
      onOpenFile={onOpenFile}
      onQuickOpen={onQuickOpen}
      onNewWindow={onNewWindow}
      onSave={onSave}
      onSaveAs={onSaveAs}
      onExportHtml={onExportHtml}
      onExportPdf={onExportPdf}
      onOpenSettings={onOpenSettings}
      onOpenErrorLog={onOpenErrorLog}
      onOpenDevTools={onOpenDevTools}
      onAbout={onAbout}
      onQuit={onQuit}
    />
  )

  const renderWebDoc = () =>
    onOpenWebDoc ? (
      <WebDocSidebarPanel
        onOpenWebDoc={onOpenWebDoc}
        recentWebUrls={recentWebUrls}
        collapsed={!webDocExpanded}
        onToggle={onWebDocToggle}
      />
    ) : null

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden bg-sidebar">
      {fileTreeExpanded ? (
        <div className="min-h-0 flex-1 overflow-hidden">
          {renderFileExplorer(false)}
        </div>
      ) : (
        renderFileExplorer(true)
      )}
      {renderWebDoc()}
    </div>
  )
}
