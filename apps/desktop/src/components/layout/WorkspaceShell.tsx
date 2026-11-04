import { lazy, Suspense, useEffect, useMemo, useState, type ReactNode } from 'react'
import { Minimize2 } from 'lucide-react'
import { useDefaultLayout } from 'react-resizable-panels'
import { ActivityBar } from '@/components/layout/ActivityBar'
import { AppTitleBar } from '@/components/layout/AppTitleBar'
import { StatusBar } from '@/components/layout/StatusBar'
import { Sidebar } from '@/components/layout/Sidebar'
import { DocumentOutline } from '@/components/layout/panels/DocumentOutline'
import { RemoteConnectModal } from '@/components/layout/RemoteConnectModal'
import { useIsDockedAgentVisible } from '@/components/agent/AgentPanel'
import { WorkspaceCardRailContext } from './WorkspaceCardRail'
import { WorkspaceCompanionPanel } from './WorkspaceCompanionPanel'
import { WorkspaceDocumentOutlineContext } from './WorkspaceDocumentArea'
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
import type { FileTreeNode } from '@yitom/contracts'
import type { useFileTreeActions } from '@/hooks/workspace/useFileTreeActions'
import { preserveScrollAnchor } from '@/lib/reader/scroll-anchor'
import { DiagramModal } from '@/components/agent/DiagramModal'
import { NotesDrawer } from '@/components/reader/NotesDrawer'
import { LibraryWorkspaceMain } from '@/components/reader/LibraryWorkspaceMain'
import { useReaderHudUiStore } from '@/stores/acp/reader-hud-store'
import { useReadingMarks } from '@/hooks/reader/useReadingMarks'
import { parseDiagramFromMark } from '@/lib/reader/marks/diagram-mark-parser'

import type { AppTheme } from '@/stores/editor-ui-store'
const TerminalPanel = lazy(() => import('./TerminalPanel'))

export interface WorkspaceShellProps {
  workspaceRoot?: string
  fileTree: FileTreeNode[]
  activeFilePath?: string
  isDirty?: boolean
  webPageUrl?: string | null
  recentWebUrls?: string[]
  recentFiles: string[]
  treeActions?: ReturnType<typeof useFileTreeActions>
  headings?: MarkdownHeading[]
  activeHeadingId?: string
  onSelectHeading?: (heading: MarkdownHeading) => void
  readOnly?: boolean
  onOpenFile: () => void
  onOpenFolder: () => void
  onOpenRemote?: () => void
  onCloseWorkspace?: () => void
  onOpenWorkspacePath?: (path: string) => void
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
}

/**
 * 工作区外壳：ActivityBar / 侧栏 / 文档 / 卡片与 AI 共享辅助区。
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
  onOpenRemote,
  onCloseWorkspace,
  onOpenWorkspacePath,
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
  isDirty = false,
}: WorkspaceShellProps) {
  const [internalRemoteModalOpen, setInternalRemoteModalOpen] = useState(false)
  const [terminalVisible, setTerminalVisible] = useState(false)
  const [terminalMounted, setTerminalMounted] = useState(false)
  const [readerAvailable, setReaderAvailable] = useState(false)
  const [cardsHost, setCardsHost] = useState<HTMLDivElement | null>(null)
  const cardRailContext = useMemo(() => ({ host: cardsHost, setReaderAvailable }), [cardsHost])
  const toggleTerminal = () => { setTerminalMounted(true); setTerminalVisible(value => !value) }
  const handleOpenRemoteModal = onOpenRemote || (() => setInternalRemoteModalOpen(true))

  const theme = useEditorUiStore((state) => state.theme)
  const cycleTheme = useEditorUiStore((state) => state.cycleTheme)
  const sidebarVisible = useEditorUiStore((state) => state.sidebarVisible)
  const setSidebarVisible = useEditorUiStore((state) => state.setSidebarVisible)
  const toggleSidebar = useEditorUiStore((state) => state.toggleSidebar)
  const outlineVisible = useEditorUiStore((state) => state.outlineVisible)
  const setOutlineVisible = useEditorUiStore((state) => state.setOutlineVisible)
  const fileTreeExpanded = useEditorUiStore((state) => state.fileTreeExpanded)
  const setFileTreeExpanded = useEditorUiStore((state) => state.setFileTreeExpanded)
  const webDocExpanded = useEditorUiStore((state) => state.webDocExpanded)
  const setWebDocExpanded = useEditorUiStore((state) => state.setWebDocExpanded)
  const agentPanelOpen = useAcpUiStore((state) => state.panelOpen)
  const dockedAgentVisible = useIsDockedAgentVisible()
  const cardRailOpen = useReaderHudUiStore((state) => state.isCardRailOpen)
  const workspacePanelTab = useReaderHudUiStore((state) => state.workspacePanelTab)
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
  const showCards = !zenMode && readerAvailable && cardRailOpen &&
    (!dockedAgentVisible || workspacePanelTab === 'cards')
  const isDockedPanelVisible = dockedAgentVisible || showCards

  // 进入阅读馆主视图时收起左侧文件树面板，让阅读馆独占完整主工作区；返回文档时恢复原侧栏状态
  const isSidebarVisible = !zenMode && !isLibraryOpen && sidebarVisible
  const outlineAvailable = !zenMode && !isLibraryOpen && headings.length > 0 && Boolean(onSelectHeading)
  const showOutline = outlineAvailable && outlineVisible

  const { marks, deleteMark } = useReadingMarks(activeFilePath || '')

  const sidebarPanelRef = useCollapsiblePanelSync(isSidebarVisible)
  const agentPanelRef = useCollapsiblePanelSync(isDockedPanelVisible)

  const shellLayout = useDefaultLayout({
    id: 'workspace-shell',
    panelIds: ['sidebar', 'main', 'agent'],
  })

  const handleToggleSidebar = () => {
    preserveScrollAnchor(() => {
      if (isLibraryOpen) {
        setIsLibraryOpen(false)
        setSidebarVisible(true)
        return
      }
      toggleSidebar()
    })
  }

  const handleSetSidebarVisible = (visible: boolean) => {
    preserveScrollAnchor(() => setSidebarVisible(visible))
  }

  const handleToggleLibrary = () => {
    preserveScrollAnchor(() => setIsLibraryOpen(!isLibraryOpen))
  }

  const handleToggleAgentPanel = () => {
    preserveScrollAnchor(() => {
      if (showCards && dockedAgentVisible) {
        useAcpUiStore.getState().openPanelAndFocusComposer()
      } else {
        toggleAgentPanel()
      }
    })
  }

  const handleLayoutChanged: typeof shellLayout.onLayoutChanged = (layout, meta) => {
    preserveScrollAnchor(() => shellLayout.onLayoutChanged(layout, meta))
  }

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.code === 'Backquote') {
        event.preventDefault(); toggleTerminal(); return
      }
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
          activeFilePath={isLibraryOpen ? '阅读馆' : activeFilePath}
          isDirty={isDirty}
          sidebarVisible={isSidebarVisible}
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
            onToggleSidebar={handleToggleSidebar}
            onOpenLibrary={handleToggleLibrary}
            libraryActive={isLibraryOpen}
            notesLabel={readerAvailable ? '卡片流' : '全书札记中心'}
            notesActive={showCards}
            onOpenNotes={() => readerAvailable
              ? preserveScrollAnchor(() => useReaderHudUiStore.getState().setIsCardRailOpen(true))
              : setIsNotesDrawerOpen(true)}
            onOpenSettings={onOpenSettings}
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
              fileTreeExpanded={fileTreeExpanded}
              onFileTreeToggle={() => setFileTreeExpanded(!fileTreeExpanded)}
              webDocExpanded={webDocExpanded}
              onWebDocToggle={() => setWebDocExpanded(!webDocExpanded)}
              onOpenFolder={onOpenFolder}
              onOpenRemote={handleOpenRemoteModal}
              onCloseWorkspace={onCloseWorkspace}
              onOpenWebDoc={(url) => {
                setIsLibraryOpen(false)
                onOpenWebDoc?.(url)
              }}
              onRescanWorkspace={onRescanWorkspace}
              isRescanningWorkspace={isRescanningWorkspace}
              onSelectFile={(path) => {
                setIsLibraryOpen(false)
                onSelectFile(path)
              }}
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
            <ResizablePanelGroup orientation="vertical">
              <ResizablePanel id="document" defaultSize="70%" minSize="20%">
                {/* 文档区隔离：底层文档始终保持挂载以保留阅读位置与编辑草稿；阅读馆以完整页面层呈现于主工作区 */}
                <div className="relative h-full w-full overflow-hidden" style={{ contain: 'strict' }} data-testid="workspace-document-frame">
                  <div className={isLibraryOpen ? 'hidden h-full w-full' : 'h-full w-full'}>
                    <WorkspaceDocumentOutlineContext.Provider value={{
                      available: outlineAvailable,
                      onToggle: () => preserveScrollAnchor(() => setOutlineVisible(!outlineVisible)),
                      content: showOutline ? (
                        <DocumentOutline
                          headings={headings}
                          activeHeadingId={activeHeadingId}
                          onSelectHeading={onSelectHeading ?? (() => undefined)}
                          onHide={() => preserveScrollAnchor(() => setOutlineVisible(false))}
                        />
                      ) : null,
                    }}>
                      <WorkspaceCardRailContext.Provider value={cardRailContext}>
                        {children}
                      </WorkspaceCardRailContext.Provider>
                    </WorkspaceDocumentOutlineContext.Provider>
                  </div>

                  {isLibraryOpen && (
                    <div className="h-full w-full">
                      <LibraryWorkspaceMain
                        activeFilePath={activeFilePath}
                        isDirty={isDirty}
                        webPageUrl={webPageUrl}
                        recentFiles={recentFiles}
                        recentWebUrls={recentWebUrls}
                        onResumeActiveSession={() => setIsLibraryOpen(false)}
                        onOpenWebDoc={onOpenWebDoc}
                        onSelectFile={onSelectFile}
                        onOpenFile={onOpenFile}
                      />
                    </div>
                  )}
                </div>
              </ResizablePanel>
              {terminalVisible && <ResizableHandle withHandle />}
              {terminalMounted && <ResizablePanel id="terminal" defaultSize="30%" minSize={terminalVisible ? '15%' : 0} maxSize={terminalVisible ? '75%' : 0} style={{ display: terminalVisible ? undefined : 'none' }}>
                <Suspense fallback={<div className="p-2 text-xs">正在加载终端…</div>}><TerminalPanel visible={terminalVisible} workspaceRoot={workspaceRoot} onClose={() => setTerminalVisible(false)} /></Suspense>
              </ResizablePanel>}
            </ResizablePanelGroup>
          </ResizablePanel>

          {isDockedPanelVisible ? <ResizableHandle withHandle /> : null}

          <ResizablePanel
            id="agent"
            panelRef={agentPanelRef}
            collapsible
            collapsedSize={0}
            defaultSize="25%"
            minSize="280px"
            maxSize="45%"
            className="min-w-0"
          >
            <WorkspaceCompanionPanel
              workspaceRoot={workspaceRoot}
              readerAvailable={readerAvailable}
              showCards={showCards}
              onCardsHost={setCardsHost}
            />
          </ResizablePanel>
        </ResizablePanelGroup>
      </div>

      {!zenMode && (
        <StatusBar
          terminalVisible={terminalVisible}
          onToggleTerminal={toggleTerminal}
          workspaceRoot={workspaceRoot}
          activeFilePath={activeFilePath}
          onOpenWorkspacePath={onOpenWorkspacePath}
          onDisconnectWorkspace={onCloseWorkspace}
          onOpenRemote={handleOpenRemoteModal}
        />
      )}

      {/* 远程环境连接器模态弹窗（供侧边栏与状态栏统一呼出） */}
      <RemoteConnectModal
        isOpen={internalRemoteModalOpen}
        onClose={() => setInternalRemoteModalOpen(false)}
        currentWorkspace={workspaceRoot}
        onDisconnectRemote={onCloseWorkspace}
        onOpenWorkspace={(path) => onOpenWorkspacePath?.(path)}
      />

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

      {/* 大图全屏交互模态框：必须置于抽屉之后渲染并保持最高层叠优先级 */}
      <DiagramModal
        isOpen={!!selectedDiagram}
        onClose={() => setSelectedDiagram(null)}
        diagram={selectedDiagram}
      />
    </div>
  )
}
