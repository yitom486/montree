import { useDefaultLayout } from 'react-resizable-panels'
import { FileExplorer } from '@/components/layout/panels/FileExplorer'
import { DocumentOutline } from '@/components/layout/panels/DocumentOutline'
import { WebDocSidebarPanel } from '@/components/layout/web-doc/WebDocSidebarPanel'
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from '@/components/ui/resizable'
import type { MarkdownHeading } from '@/lib/editor/markdown-headings'
import type { FileTreeNode } from '@montree/contracts'
import type { useFileTreeActions } from '@/hooks/workspace/useFileTreeActions'

interface SidebarProps {
  workspaceRoot?: string
  fileTree: FileTreeNode[]
  activeFilePath?: string
  webPageUrl?: string | null
  recentWebUrls?: string[]
  headings: MarkdownHeading[]
  activeHeadingId?: string
  outlineExpanded: boolean
  onOutlineToggle: () => void
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
  onSelectHeading: (heading: MarkdownHeading) => void
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

export function Sidebar({
  workspaceRoot,
  fileTree,
  activeFilePath,
  webPageUrl,
  recentWebUrls,
  headings,
  activeHeadingId,
  outlineExpanded,
  onOutlineToggle,
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
  onSelectHeading,
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
  const outlineLayout = useDefaultLayout({
    id: 'markdown-editor-explorer-outline',
    panelIds: ['explorer', 'outline'],
  })

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

  const renderOutline = (collapsed = !outlineExpanded) => (
    <DocumentOutline
      headings={headings}
      collapsed={collapsed}
      activeHeadingId={activeHeadingId}
      onToggle={onOutlineToggle}
      onSelectHeading={onSelectHeading}
    />
  )

  // 双长列表（文件树 + 目录）同时展开时，启用纵向分割拖拽手柄
  const isSplitResizable = outlineExpanded && fileTreeExpanded

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden bg-sidebar">
      {isSplitResizable ? (
        <ResizablePanelGroup
          id="markdown-editor-explorer-outline"
          orientation="vertical"
          defaultLayout={outlineLayout.defaultLayout}
          onLayoutChanged={outlineLayout.onLayoutChanged}
          className="h-full min-h-0"
        >
          <ResizablePanel id="explorer" defaultSize="68%" minSize="25%" className="min-h-0 flex flex-col">
            <div className="min-h-0 flex-1 overflow-hidden">
              {renderFileExplorer(false)}
            </div>
            {renderWebDoc()}
          </ResizablePanel>
          <ResizableHandle withHandle />
          <ResizablePanel id="outline" defaultSize="32%" minSize="15%" className="min-h-0 flex flex-col">
            {renderOutline(false)}
          </ResizablePanel>
        </ResizablePanelGroup>
      ) : (
        <>
          {fileTreeExpanded ? (
            <div className="min-h-0 flex-1 overflow-hidden">
              {renderFileExplorer(false)}
            </div>
          ) : (
            renderFileExplorer(true)
          )}

          {renderWebDoc()}

          {outlineExpanded ? (
            <div className="min-h-0 flex-1 overflow-hidden">
              {renderOutline(false)}
            </div>
          ) : (
            renderOutline(true)
          )}
        </>
      )}
    </div>
  )
}
