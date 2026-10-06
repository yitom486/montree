import { useDefaultLayout } from 'react-resizable-panels'
import { FileExplorer } from '@/components/layout/panels/FileExplorer'
import { DocumentOutline } from '@/components/layout/panels/DocumentOutline'
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
  onOpenFolder: () => void
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
  onOpenFolder,
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

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden bg-sidebar">
      {outlineExpanded ? (
        <ResizablePanelGroup
          id="markdown-editor-explorer-outline"
          orientation="vertical"
          defaultLayout={outlineLayout.defaultLayout}
          onLayoutChanged={outlineLayout.onLayoutChanged}
          className="h-full min-h-0"
        >
          <ResizablePanel id="explorer" defaultSize="68%" minSize="25%" className="min-h-0">
            <FileExplorer
              workspaceRoot={workspaceRoot}
              tree={fileTree}
              activeFilePath={activeFilePath}
              webPageUrl={webPageUrl}
              recentWebUrls={recentWebUrls}
              onOpenFolder={onOpenFolder}
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
          </ResizablePanel>
          <ResizableHandle withHandle />
          <ResizablePanel id="outline" defaultSize="32%" minSize="15%" className="min-h-0">
            <DocumentOutline
              headings={headings}
              activeHeadingId={activeHeadingId}
              onToggle={onOutlineToggle}
              onSelectHeading={onSelectHeading}
            />
          </ResizablePanel>
        </ResizablePanelGroup>
      ) : (
        <>
          <div className="min-h-0 flex-1 overflow-hidden">
            <FileExplorer
              workspaceRoot={workspaceRoot}
              tree={fileTree}
              activeFilePath={activeFilePath}
              webPageUrl={webPageUrl}
              recentWebUrls={recentWebUrls}
              onOpenFolder={onOpenFolder}
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
          </div>
          <DocumentOutline
            headings={headings}
            collapsed
            activeHeadingId={activeHeadingId}
            onToggle={onOutlineToggle}
            onSelectHeading={onSelectHeading}
          />
        </>
      )}
    </div>
  )
}
