import { useEffect, type ReactNode } from 'react'
import { Minimize2 } from 'lucide-react'
import { useDefaultLayout } from 'react-resizable-panels'
import { ActivityBar } from '@/components/layout/ActivityBar'
import { AppTitleBar } from '@/components/layout/AppTitleBar'
import { Sidebar } from '@/components/layout/Sidebar'
import { AgentPanel, useIsDockedAgentVisible } from '@/components/agent/AgentPanel'
import { FloatingAIHud } from '@/components/agent/FloatingAIHud'
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from '@/components/ui/resizable'
import { useCollapsiblePanelSync } from '@/hooks/workspace/useSidebarPanelSync'
import type { MarkdownHeading } from '@/lib/editor/markdown-headings'
import { useEditorUiStore } from '@/stores/editor-ui-store'
import { useAcpUiStore } from '@/stores/acp-ui-store'
import type { FileTreeNode } from '@montree/contracts'
import type { useFileTreeActions } from '@/hooks/workspace/useFileTreeActions'
import { preserveScrollAnchor } from '@/lib/reader/scroll-anchor'
import { DiagramModal } from '@/components/agent/DiagramModal'
import { NotesDrawer } from '@/components/reader/NotesDrawer'
import { LibraryDrawer } from '@/components/reader/LibraryDrawer'
import { useReaderHudUiStore } from '@/stores/acp/reader-hud-store'
import { useReadingMarks } from '@/hooks/reader/useReadingMarks'
import { parseDiagramFromMark } from '@/lib/reader/marks/diagram-mark-parser'

import type { AppTheme } from '@/stores/editor-ui-store'

export interface WorkspaceShellProps {
  workspaceRoot?: string
  fileTree: FileTreeNode[]
  activeFilePath?: string
  isDirty?: boolean
  webPageUrl?: string | null
  recentWebUrls?: string[]
  recentFiles: string[]
  treeActions?: ReturnType<typeof useFileTreeActions>
  /** Markdown ????????????????????? */
  headings?: MarkdownHeading[]
  activeHeadingId?: string
  onSelectHeading?: (heading: MarkdownHeading) => void
  /** ????????????/??? */
  readOnly?: boolean
  onOpenFile: () => void
  onOpenFolder: () => void
  onQuickOpen?: () => void
  onOpenWebDoc?: (url: string) => void
  onRescanWorkspace?: () => void
  isRescanningWorkspace?: boolean
  onSelectFile: (path: string) => void
  onSave: () => void
  onSaveAs: () => void
  onExportHtml: () => void
  onExportPdf: () => void
  onOpenSettings: () => void
  onOpenErrorLog: () => void
  onOpenDevTools: () => void
  onAbout: () => void
  onNewWindow: () => void
  onQuit: () => void
  children: ReactNode
  /**
   * 阅读器模式由各 viewer 在内框行自行挂载 docked 侧栏（工具栏之下、底导航之上），
   * 外壳此时不再于主区右侧挂载，避免底导航被顶穿。编辑器等模式保持外壳挂载。
   */
  suppressDockedAgent?: boolean
}

/**
 * 工作区外壳：ActivityBar / 侧栏 / Agent 常驻（顶栏 TitleBar 已删除）。
 * 切换 Markdown ↔ PDF 时只替换 children（主区），避免 Agent 面板整树卸载。
 */
export function WorkspaceShell({
  workspaceRoot,
  fileTree,
  activeFilePath,
  webPageUrl,
  recentWebUrls,
  recentFiles,
  treeActions,
  headings = [],
  activeHeadingId,
  onSelectHeading,
  readOnly = false,
  onOpenFile,
  onOpenFolder,
  onQuickOpen,
  onOpenWebDoc,
  onRescanWorkspace,
  isRescanningWorkspace,
  onSelectFile,
  onSave,
  onSaveAs,
  onExportHtml,
  onExportPdf,
  onOpenSettings,
  onOpenErrorLog,
  onOpenDevTools,
  onAbout,
  onNewWindow,
  onQuit,
  children,
  suppressDockedAgent = false,
  isDirty = false,
}: WorkspaceShellProps) {
  const theme = useEditorUiStore((state) => state.theme)
  const cycleTheme = useEditorUiStore((state) => state.cycleTheme)
  const sidebarVisible = useEditorUiStore((state) => state.sidebarVisible)
  const setSidebarVisible = useEditorUiStore((state) => state.setSidebarVisible)
  const toggleSidebar = useEditorUiStore((state) => state.toggleSidebar)
  const outlineExpanded = useEditorUiStore((state) => state.outlineExpanded)
  const setOutlineExpanded = useEditorUiStore((state) => state.setOutlineExpanded)
  const agentPanelOpen = useAcpUiStore((state) => state.panelOpen)
  const dockedAgentVisible = useIsDockedAgentVisible()
  const isDockedPanelVisible = dockedAgentVisible && !suppressDockedAgent
  const toggleAgentPanel = useAcpUiStore((state) => state.togglePanel)
  const isNotesDrawerOpen = useReaderHudUiStore((state) => state.isNotesDrawerOpen)
  const setIsNotesDrawerOpen = useReaderHudUiStore((state) => state.setIsNotesDrawerOpen)
  const isLibraryOpen = useReaderHudUiStore((state) => state.isLibraryOpen)
  const setIsLibraryOpen = useReaderHudUiStore((state) => state.setIsLibraryOpen)
  const selectedDiagram = useReaderHudUiStore((state) => state.selectedDiagram)
  const setSelectedDiagram = useReaderHudUiStore((state) => state.setSelectedDiagram)
  const zenMode = useReaderHudUiStore((state) => state.zenMode)
  const setZenMode = useReaderHudUiStore((state) => state.setZenMode)
  const toggleZenMode = useReaderHudUiStore((state) => state.toggleZenMode)

  const isSidebarVisible = !zenMode && sidebarVisible

  const { marks, deleteMark } = useReadingMarks(activeFilePath || '')

  const sidebarPanelRef = useCollapsiblePanelSync(isSidebarVisible)
  const agentPanelRef = useCollapsiblePanelSync(isDockedPanelVisible)

  const shellLayout = useDefaultLayout({
    id: 'workspace-shell',
    panelIds: ['sidebar', 'main', 'agent'],
  })

  const handleToggleSidebar = () => {
    preserveScrollAnchor(() => toggleSidebar())
  }

  const handleSetSidebarVisible = (visible: boolean) => {
    preserveScrollAnchor(() => setSidebarVisible(visible))
  }

  const handleToggleAgentPanel = () => {
    preserveScrollAnchor(() => toggleAgentPanel())
  }

  const handleLayoutChanged: typeof shellLayout.onLayoutChanged = (layout, meta) => {
    preserveScrollAnchor(() => shellLayout.onLayoutChanged(layout, meta))
  }

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && zenMode) {
        preserveScrollAnchor(() => setZenMode(false))
        return
      }
      if ((event.ctrlKey || event.metaKey) && event.altKey && event.key.toLowerCase() === 'z') {
        event.preventDefault()
        preserveScrollAnchor(() => toggleZenMode())
        return
      }
      if (!(event.ctrlKey || event.metaKey) || !event.shiftKey) return
      if (event.key.toLowerCase() !== 'a') return
      event.preventDefault()
      handleToggleAgentPanel()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [handleToggleAgentPanel, zenMode, setZenMode, toggleZenMode])

  return (
    <div className="flex h-screen flex-col bg-background text-foreground overflow-hidden">
      {!zenMode && (
        <AppTitleBar
          activeFilePath={activeFilePath}
          isDirty={isDirty}
          sidebarVisible={sidebarVisible}
          onToggleSidebar={handleToggleSidebar}
          onQuickOpen={onQuickOpen}
          onToggleAgentPanel={handleToggleAgentPanel}
          agentPanelOpen={agentPanelOpen}
          theme={theme}
          onCycleTheme={cycleTheme}
          onOpenSettings={onOpenSettings}
        />
      )}

      <div className="flex min-h-0 flex-1">
        {!zenMode && (
          <ActivityBar
            sidebarVisible={sidebarVisible}
            agentPanelOpen={agentPanelOpen}
            onToggleSidebar={handleToggleSidebar}
            onToggleAgentPanel={handleToggleAgentPanel}
            onOpenLibrary={() => setIsLibraryOpen(true)}
            onOpenNotes={() => setIsNotesDrawerOpen(true)}
          />
        )}

        <ResizablePanelGroup
          id="workspace-shell"
          orientation="horizontal"
          defaultLayout={shellLayout.defaultLayout}
          onLayoutChanged={handleLayoutChanged}
          className="min-h-0 min-w-0 flex-1"
        >
          <ResizablePanel
            id="sidebar"
            panelRef={sidebarPanelRef}
            collapsible
            collapsedSize={0}
            defaultSize="18%"
            minSize="12%"
            maxSize="36%"
            className="min-w-0"
          >
            <Sidebar
              workspaceRoot={workspaceRoot}
              fileTree={fileTree}
              activeFilePath={activeFilePath}
              webPageUrl={webPageUrl}
              recentWebUrls={recentWebUrls}
              headings={headings}
              activeHeadingId={activeHeadingId}
              outlineExpanded={outlineExpanded && headings.length > 0}
              onOutlineToggle={() => setOutlineExpanded(!outlineExpanded)}
              onOpenFolder={onOpenFolder}
              onOpenWebDoc={onOpenWebDoc}
              onRescanWorkspace={onRescanWorkspace}
              isRescanningWorkspace={isRescanningWorkspace}
              onSelectFile={onSelectFile}
              onSelectHeading={onSelectHeading ?? (() => undefined)}
              onHideSidebar={() => handleSetSidebarVisible(false)}
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

          {isSidebarVisible ? <ResizableHandle withHandle /> : null}

          <ResizablePanel id="main" defaultSize={isDockedPanelVisible ? '57%' : '75%'} minSize="30%" className="min-w-0">
            {children}
          </ResizablePanel>

          {isDockedPanelVisible ? <ResizableHandle withHandle /> : null}

          <ResizablePanel
            id="agent"
            panelRef={agentPanelRef}
            collapsible
            collapsedSize={0}
            defaultSize="25%"
            minSize="16%"
            maxSize="45%"
            className="min-w-0"
          >
            <AgentPanel workspaceRoot={workspaceRoot} />
          </ResizablePanel>
        </ResizablePanelGroup>
      </div>

      {!zenMode && (
        <FloatingAIHud workspaceRoot={workspaceRoot} activeFilePath={activeFilePath} />
      )}

      {zenMode && (
        <button
          type="button"
          onClick={() => preserveScrollAnchor(() => setZenMode(false))}
          className="fixed bottom-4 right-4 z-50 flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-background/85 hover:bg-background border border-border shadow-lg text-xs text-muted-foreground hover:text-foreground backdrop-blur-md transition-all cursor-pointer group animate-in fade-in"
          title="退出沉浸禅模式 (Esc)"
        >
          <Minimize2 className="size-3.5 text-primary group-hover:scale-110 transition-transform" />
          <span>退出禅模式 (Esc)</span>
        </button>
      )}

      <NotesDrawer
        isOpen={isNotesDrawerOpen}
        onClose={() => setIsNotesDrawerOpen(false)}
        marks={marks ?? []}
        bookTitle={activeFilePath ? activeFilePath.split(/[/\\]/).pop() : undefined}
        filePath={activeFilePath ?? undefined}
        onDeleteMark={(id) => void deleteMark(id)}
        onOpenDiagram={(diagramId) => {
          const m = marks?.find((item) => item.diagramId === diagramId || item.id === diagramId)
          if (m) {
            const parsed = parseDiagramFromMark(m)
            if (parsed) {
              setSelectedDiagram(parsed)
            }
          }
        }}
      />

      <LibraryDrawer
        isOpen={isLibraryOpen}
        onClose={() => setIsLibraryOpen(false)}
        recentFiles={recentFiles}
        activeFilePath={activeFilePath}
        onSelectFile={onSelectFile}
        recentWebUrls={recentWebUrls}
        webPageUrl={webPageUrl}
        onOpenWebDoc={onOpenWebDoc}
        onOpenFile={onOpenFile}
      />

      {/* 大图全屏交互模态框：必须置于抽屉之后渲染并保持最高层叠优先级 */}
      <DiagramModal
        isOpen={!!selectedDiagram}
        onClose={() => setSelectedDiagram(null)}
        diagram={selectedDiagram}
      />
    </div>
  )
}
