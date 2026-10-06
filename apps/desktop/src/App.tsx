import { useCallback, useEffect, useRef, useState } from 'react'
import { AboutDialog } from '@/components/shared/AboutDialog'
import { DraftRecoveryDialog } from '@/components/shared/DraftRecoveryDialog'
import { ErrorLogDialog } from '@/components/shared/ErrorLogDialog'
import { QuickOpenDialog } from '@/components/shared/QuickOpenDialog'
import { SettingsDialog } from '@/components/shared/SettingsDialog'
import { UnsavedChangesDialog } from '@/components/shared/UnsavedChangesDialog'
import {
  EditorWorkspaceMain,
  type EditorOutlineState,
  type EditorWorkspaceMainHandle,
} from '@/components/layout/main/EditorWorkspaceMain'
import { ReaderWorkspaceMain } from '@/components/layout/main/ReaderWorkspaceMain'
import { WebDocWorkspaceMain, type WebDocWorkspaceMainHandle } from '@/components/layout/web-doc/WebDocWorkspaceMain'
import { WorkspaceShell } from '@/components/layout/WorkspaceShell'
import { Toaster } from '@/components/ui/sonner'
import { UpdatePromptHost } from '@/components/shared/UpdatePromptHost'
import { toast } from 'sonner'
import { useAutoSave } from '@/hooks/editor/useAutoSave'
import { useDraftPersistence, clearDraftForFile } from '@/hooks/editor/useDraftPersistence'
import { useDraftRecoveryPrompt } from '@/hooks/editor/useDraftRecovery'
import { useExportDocument } from '@/hooks/editor/useExportDocument'
import { useFileTreeActions } from '@/hooks/workspace/useFileTreeActions'
import { useGlobalErrorHandlers } from '@/hooks/workspace/useGlobalErrorHandlers'
import { useAppMeta, useFileOperations } from '@/hooks/workspace/useFileOperations'
import { useSyncProgressBridge } from '@/hooks/reader/useSyncProgressBridge'
import { useAcpPermissionIngest } from '@/hooks/agent/useAcpPermissionIngest'
import { useInkdownSnapshotHost } from '@/hooks/agent/useInkdownSnapshotHost'
import { useAcpStreamHost } from '@/hooks/agent/useAcpStreamHost'
import { pickLatestRecoverableDraft } from '@/lib/editor/draft-utils'
import { resolveStartupRestoreTarget } from '@/lib/workspace/workspace-session'
import { reportAppError, reportUnknownError } from '@/lib/workspace/report-error'
import { resolveWikilinkTarget } from '@/lib/workspace/resolve-wikilink'
import { parseDeepLinkUrl, isDeepLinkUrl } from '@/lib/editor/deep-link'
import { appApi } from '@/api/app-api'
import { fileApi } from '@/api/file-api'
import { useActiveDocumentStore } from '@/stores/active-document-store'
import { useAppSettingsStore } from '@/stores/app-settings-store'
import { useDraftStore } from '@/stores/draft-store'
import { useEditorUiStore } from '@/stores/editor-ui-store'
import { useWebDocStore } from '@/stores/web-doc-store'
import { baseName } from '@/lib/agent/context/collect-turn-context'
import { registerReaderContent } from '@/lib/agent/context/reader-content-registry'
import { isMarkdownEditorFocused } from '@/lib/editor/editor-focus'
import type { MarkdownHeading } from '@/lib/editor/markdown-headings'

function App() {
  const [aboutOpen, setAboutOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [errorLogOpen, setErrorLogOpen] = useState(false)
  const [quickOpen, setQuickOpen] = useState(false)
  const [outline, setOutline] = useState<EditorOutlineState>({ headings: [] })
  const editorMainRef = useRef<EditorWorkspaceMainHandle>(null)
  const webDocMainRef = useRef<WebDocWorkspaceMainHandle>(null)
  const startupRestoreDoneRef = useRef(false)
  const theme = useEditorUiStore((state) => state.theme)
  const toggleSidebar = useEditorUiStore((state) => state.toggleSidebar)
  const autoSaveEnabled = useAppSettingsStore((state) => state.autoSaveEnabled)
  const autoSaveIntervalMs = useAppSettingsStore((state) => state.autoSaveIntervalMs)
  const recentFiles = useAppSettingsStore((state) => state.recentFiles)
  const restoreLastFileOnStartup = useAppSettingsStore((state) => state.restoreLastFileOnStartup)
  const lastActiveSurface = useAppSettingsStore((state) => state.lastActiveSurface)
  const lastOpenedFilePath = useAppSettingsStore((state) => state.lastOpenedFilePath)
  const lastWebDocUrl = useAppSettingsStore((state) => state.lastWebDocUrl)
  const { data: appMeta } = useAppMeta()
  const { recoveryDraftKey, dismissRecovery } = useDraftRecoveryPrompt({
    enabled: !appApi.isFreshWindow(),
  })
  const recoveryDraft = useDraftStore((state) =>
    recoveryDraftKey ? state.drafts[recoveryDraftKey] : null,
  )
  const removeDraft = useDraftStore((state) => state.removeDraft)

  const {
    content,
    setContent,
    filePath,
    fileName,
    savedContent,
    isDirty,
    readerDocumentKind,
    isMarkdownDocument,
    workspaceRoot,
    fileTree,
    unsavedPromptOpen,
    isFileBusy,
    openFile,
    openFolder,
    rescanWorkspace,
    openFileFromTree,
    openRecentFile,
    openExternalFilePath,
    saveFile,
    saveFileAs,
    restoreDraft,
    quitApp,
    cancelUnsavedPrompt,
    discardUnsavedChanges,
    saveUnsavedChanges,
    notifyPathDeleted,
    notifyPathRenamed,
    openWebDocument,
  } = useFileOperations(reportAppError)

  const webPageUrl = useWebDocStore((state) => state.pageUrl)
  const recentWebUrls = useWebDocStore((state) => state.recentUrls)

  const { exportHtml, exportPdf } = useExportDocument(content, filePath)

  const treeActions = useFileTreeActions({
    workspaceRoot,
    tree: fileTree,
    rescanWorkspace,
    onOpenFile: (path) => void openFileFromTree(path),
    onPathRemoved: notifyPathDeleted,
    onPathRenamed: notifyPathRenamed,
  })

  useDraftPersistence({
    filePath: isMarkdownDocument ? filePath : undefined,
    content,
    savedContent,
    isDirty,
  })
  useGlobalErrorHandlers(filePath)
  useSyncProgressBridge()
  useAcpPermissionIngest()
  useInkdownSnapshotHost()
  // ACP 流式推送宿主：生命周期跟应用走（useAcpStreamHost），
  // 绝不跟 Agent 面板的挂载走——双面板挂载曾导致同一 chunk 进两遍时间线（复读）
  useAcpStreamHost()

  const handleAutoSave = useCallback(async () => {
    if (!isMarkdownDocument || !filePath || !isDirty || isFileBusy) return
    await saveFile({ silent: true })
  }, [filePath, isDirty, isFileBusy, isMarkdownDocument, saveFile])

  useAutoSave({
    enabled: autoSaveEnabled && isMarkdownDocument,
    intervalMs: autoSaveIntervalMs,
    isDirty,
    filePath,
    isSaving: isFileBusy,
    onAutoSave: handleAutoSave,
  })

  const handleExportHtml = useCallback(() => {
    void exportHtml().catch(reportUnknownError)
  }, [exportHtml])

  const handleExportPdf = useCallback(() => {
    void exportPdf().catch(reportUnknownError)
  }, [exportPdf])

  const handleRestoreDraft = useCallback(() => {
    if (!recoveryDraft || !recoveryDraftKey) return
    restoreDraft(recoveryDraft)
    clearDraftForFile(recoveryDraft.filePath)
    dismissRecovery()
  }, [dismissRecovery, recoveryDraft, recoveryDraftKey, restoreDraft])

  const handleDiscardDraft = useCallback(() => {
    if (recoveryDraftKey) {
      removeDraft(recoveryDraftKey)
    }
    dismissRecovery()
  }, [dismissRecovery, recoveryDraftKey, removeDraft])

  const handleOutlineChange = useCallback((next: EditorOutlineState) => {
    setOutline(next)
  }, [])

  const handleSelectHeading = useCallback((heading: MarkdownHeading) => {
    if (useWebDocStore.getState().pageUrl) {
      webDocMainRef.current?.selectHeading(heading)
      return
    }
    editorMainRef.current?.selectHeading(heading)
  }, [])

  useEffect(() => {
    if (appMeta?.error) {
      reportAppError(appMeta.error)
    }
  }, [appMeta?.error])

  /**
   * 取走主进程队列里的外部打开文件并逐个打开（工作区切到文件所在目录）。
   * 返回消费数量；挂载时与窗口聚焦时各调用一次，覆盖冷启动与运行中双击两种情形。
   */
  const drainPendingExternalFiles = useCallback(async () => {
    let consumed = 0
    for (;;) {
      let pending: string | null = null
      try {
        pending = await appApi.takePendingExternalFile()
      } catch {
        return consumed
      }
      if (!pending) return consumed
      consumed += 1
      openExternalFilePath(pending)
    }
  }, [openExternalFilePath])

  useEffect(() => {
    const onFocus = (): void => {
      void drainPendingExternalFiles()
    }
    window.addEventListener('focus', onFocus)
    return () => {
      window.removeEventListener('focus', onFocus)
    }
  }, [drainPendingExternalFiles])

  useEffect(() => {
    if (appApi.isFreshWindow()) return
    if (startupRestoreDoneRef.current) return
    startupRestoreDoneRef.current = true

    void (async () => {
      // 外部打开（资源管理器双击/打开方式）优先于上次状态恢复
      const externalCount = await drainPendingExternalFiles()
      if (externalCount > 0) return

      const hadRecoverableDraft =
        pickLatestRecoverableDraft(useDraftStore.getState().drafts) !== null
      if (hadRecoverableDraft) return

      const target = resolveStartupRestoreTarget({
        restoreOnStartup: restoreLastFileOnStartup,
        activeSurface: lastActiveSurface,
        lastOpenedFilePath,
        lastWebDocUrl,
      })
      if (!target) return

      if (target.kind === 'web-doc') {
        openWebDocument(target.path)
        return
      }
      void openRecentFile(target.path)
    })()
  }, [
    drainPendingExternalFiles,
    lastActiveSurface,
    lastOpenedFilePath,
    lastWebDocUrl,
    openRecentFile,
    openWebDocument,
    restoreLastFileOnStartup,
  ])

  const handleToggleQuickOpen = useCallback(() => {
    setQuickOpen((prev) => !prev)
  }, [])

  const handleOpenFind = useCallback(() => {
    if (filePath && isMarkdownDocument) {
      editorMainRef.current?.openFind()
    } else {
      setQuickOpen(true)
    }
  }, [filePath, isMarkdownDocument])

  const handleOpenReplace = useCallback(() => {
    if (filePath && isMarkdownDocument) {
      editorMainRef.current?.openReplace()
    }
  }, [filePath, isMarkdownDocument])

  const handleOpenDeepLink = useCallback(
    async (url: string) => {
      const parsed = parseDeepLinkUrl(url)
      if (!parsed) {
        toast.error('无效的深度回跳链接')
        return
      }

      const res = resolveWikilinkTarget(parsed.file, fileTree, workspaceRoot)
      if (res.status === 'found' && res.filePath) {
        await openFileFromTree(res.filePath)
        toast.success(parsed.page ? `已跳转至《${parsed.file}》第 ${parsed.page} 页` : `已打开关联文件`)
      } else {
        toast.error(`无法在工作区中找到对应文件: ${parsed.file}`)
      }
    },
    [fileTree, openFileFromTree, workspaceRoot],
  )

  const handleOpenWikilink = useCallback(
    async (target: string) => {
      if (isDeepLinkUrl(target)) {
        await handleOpenDeepLink(target)
        return
      }

      const res = resolveWikilinkTarget(target, fileTree, workspaceRoot)
      if (res.status === 'found' && res.filePath) {
        await openFileFromTree(res.filePath)
        if (res.anchor) {
          toast.info(`已定位至目标文档（锚点：${res.anchor}）`)
        }
        return
      }

      if (res.status === 'missing-book') {
        toast.error(`未在当前工作区找到书籍: ${res.targetName || target}`)
        return
      }

      if (res.status === 'missing-note' && res.targetName) {
        if (!workspaceRoot) {
          toast.info(`请先打开工作区文件夹以自动创建关联笔记`)
          return
        }

        const notePath = `${workspaceRoot.replace(/\\/g, '/').replace(/\/+$/, '')}/${res.targetName}`
        const initialContent = `# ${res.targetName.replace(/\.md$/i, '')}\n\n`

        const saveRes = await fileApi.saveFile({
          filePath: notePath,
          content: initialContent,
        })

        if (saveRes?.ok) {
          toast.success(`已创建并打开关联笔记: ${res.targetName}`)
          await rescanWorkspace()
          await openFileFromTree(notePath)
        } else {
          toast.error(`创建笔记失败: ${saveRes?.error?.message || '未知错误'}`)
        }
      }
    },
    [fileTree, handleOpenDeepLink, openFileFromTree, rescanWorkspace, workspaceRoot],
  )

  useEffect(() => {
    return appApi.onGlobalAction((action) => {
      if (action === 'quick-open') {
        handleToggleQuickOpen()
      } else if (action === 'find') {
        handleOpenFind()
      } else if (action === 'replace') {
        handleOpenReplace()
      } else if (action.startsWith('deep-link:')) {
        const deepUrl = action.slice('deep-link:'.length)
        void handleOpenDeepLink(deepUrl)
      }
    })
  }, [handleOpenDeepLink, handleOpenFind, handleOpenReplace, handleToggleQuickOpen])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const mod = event.ctrlKey || event.metaKey
      const key = event.key.toLowerCase()
      const code = event.code

      if (mod && !event.shiftKey && !event.altKey && (key === 'b' || code === 'KeyB')) {
        if (!isMarkdownEditorFocused()) {
          event.preventDefault()
          toggleSidebar()
        }
        return
      }

      // 新建窗口：Ctrl+Shift+N（VS Code 同键位；Ctrl+N 留空，避免误触开窗）
      if (mod && event.shiftKey && !event.altKey && (key === 'n' || code === 'KeyN')) {
        event.preventDefault()
        appApi.newWindow()
        return
      }

      if (!mod || event.shiftKey || event.altKey) return
      if (key === ',' || code === 'Comma') {
        event.preventDefault()
        setSettingsOpen(true)
        return
      }
      if (key === 'p' || code === 'KeyP') {
        event.preventDefault()
        handleToggleQuickOpen()
        return
      }
      if (key === 'f' || code === 'KeyF') {
        event.preventDefault()
        handleOpenFind()
        return
      }
      if (key === 'h' || code === 'KeyH') {
        if (filePath && isMarkdownDocument) {
          event.preventDefault()
          handleOpenReplace()
        }
        return
      }
    }

    window.addEventListener('keydown', onKeyDown, { capture: true })
    return () => window.removeEventListener('keydown', onKeyDown, { capture: true })
  }, [filePath, handleOpenFind, handleOpenReplace, handleToggleQuickOpen, isMarkdownDocument, toggleSidebar])

  useEffect(() => {
    if (readerDocumentKind && filePath) {
      setOutline({ headings: [] })
    }
  }, [filePath, readerDocumentKind])

  useEffect(() => {
    if (!webPageUrl) return
    setOutline({ headings: [] })
  }, [webPageUrl])

  useEffect(() => {
    useActiveDocumentStore.getState().setActiveFilePath(filePath ?? webPageUrl ?? null)
  }, [filePath, webPageUrl])

  // Markdown 正文：读 ref 而非 content，避免每次按键都重新注册
  const editorContentRef = useRef(content)
  editorContentRef.current = content
  useEffect(() => {
    if (!filePath || readerDocumentKind || webPageUrl) return
    return registerReaderContent({
      filePath,
      getCurrentText: () => editorContentRef.current,
      // Markdown 只有一个单元，检索即整篇全文
      iterateUnits: async function* () {
        yield { label: baseName(filePath), text: editorContentRef.current }
      },
    })
  }, [filePath, readerDocumentKind, webPageUrl])

  const handleOpenWebDoc = useCallback(
    (url: string) => {
      if (!openWebDocument(url)) {
        toast.error('URL 无效，请输入 http(s) 链接')
      }
    },
    [openWebDocument],
  )

  if (!appApi.isAvailable()) {
    const isElectron = navigator.userAgent.includes('Electron')
    return (
      <div className="flex h-screen flex-col items-center justify-center gap-2 bg-background px-6 text-center text-foreground">
        <p className="text-muted-foreground">
          {isElectron
            ? 'Electron 窗口已打开，但 preload 未成功注入 API。请关闭所有 dev 进程后重新执行 bun run dev。'
            : '请在 Electron 窗口中运行此应用，浏览器预览不支持。'}
        </p>
      </div>
    )
  }

  const isReader = Boolean(readerDocumentKind && filePath)
  const isWebDoc = Boolean(webPageUrl)

  return (
    <>
      <Toaster theme={theme === 'dark' ? 'dark' : 'light'} richColors closeButton position="top-right" />
      <UpdatePromptHost />

      <WorkspaceShell
        workspaceRoot={workspaceRoot}
        fileTree={fileTree}
        activeFilePath={filePath}
        webPageUrl={webPageUrl}
        recentWebUrls={recentWebUrls}
        recentFiles={recentFiles}
        treeActions={treeActions}
        headings={isReader ? [] : outline.headings}
        activeHeadingId={isReader ? undefined : outline.activeHeadingId}
        onSelectHeading={isReader ? undefined : handleSelectHeading}
        readOnly={isReader || isWebDoc}
        onOpenFile={() => void openFile()}
        onOpenFolder={() => void openFolder()}
        onQuickOpen={handleToggleQuickOpen}
        onOpenWebDoc={handleOpenWebDoc}
        onRescanWorkspace={() => void rescanWorkspace()}
        isRescanningWorkspace={isFileBusy}
        onSelectFile={(path) => void openFileFromTree(path)}
        onSave={() => void saveFile()}
        onSaveAs={() => void saveFileAs()}
        onExportHtml={handleExportHtml}
        onExportPdf={handleExportPdf}
        onOpenSettings={() => setSettingsOpen(true)}
        onOpenErrorLog={() => setErrorLogOpen(true)}
        onOpenDevTools={() => appApi.toggleDevTools()}
        onAbout={() => setAboutOpen(true)}
        onNewWindow={() => appApi.newWindow()}
        onQuit={quitApp}
        isDirty={isDirty}
        suppressDockedAgent={(isReader && !!readerDocumentKind) || (isWebDoc && !!webPageUrl)}
      >
        {isWebDoc && webPageUrl ? (
          <WebDocWorkspaceMain
            ref={webDocMainRef}
            pageUrl={webPageUrl}
            theme={theme}
            recentUrls={recentWebUrls}
            onNavigateUrl={handleOpenWebDoc}
            onOutlineChange={handleOutlineChange}
            workspaceRoot={workspaceRoot}
          />
        ) : isReader && readerDocumentKind && filePath ? (
          <ReaderWorkspaceMain
            filePath={filePath}
            documentKind={readerDocumentKind}
            theme={theme}
            workspaceRoot={workspaceRoot}
          />
        ) : (
          <EditorWorkspaceMain
            ref={editorMainRef}
            filePath={filePath}
            isDirty={isDirty}
            content={content}
            workspaceRoot={workspaceRoot}
            recentFiles={recentFiles}
            recentWebUrls={recentWebUrls}
            fileTree={fileTree}
            onOpenWikilink={(target) => void handleOpenWikilink(target)}
            onOpenDeepLink={(url) => void handleOpenDeepLink(url)}
            onContentChange={setContent}
            onOpenFile={() => void openFile()}
            onOpenFolder={() => void openFolder()}
            onOpenRecentFile={(path) => void openRecentFile(path)}
            onOpenWebDoc={handleOpenWebDoc}
            onOutlineChange={handleOutlineChange}
          />
        )}
      </WorkspaceShell>

      <QuickOpenDialog
        open={quickOpen}
        onOpenChange={setQuickOpen}
        fileTree={fileTree}
        workspaceRoot={workspaceRoot}
        recentFiles={recentFiles}
        onSelectFile={(selectedPath) => void openFileFromTree(selectedPath)}
      />

      <AboutDialog
        open={aboutOpen}
        onOpenChange={setAboutOpen}
        version={appMeta?.version || '…'}
        platform={appMeta?.platform || ''}
      />

      <SettingsDialog
        open={settingsOpen}
        onOpenChange={setSettingsOpen}
        onOpenErrorLog={() => setErrorLogOpen(true)}
        onOpenAbout={() => setAboutOpen(true)}
      />

      <ErrorLogDialog open={errorLogOpen} onOpenChange={setErrorLogOpen} />

      <DraftRecoveryDialog
        open={recoveryDraftKey !== null}
        draft={recoveryDraft}
        onRestore={handleRestoreDraft}
        onDiscard={handleDiscardDraft}
      />

      <UnsavedChangesDialog
        open={unsavedPromptOpen}
        fileName={fileName}
        saving={isFileBusy}
        onSave={() => void saveUnsavedChanges()}
        onDiscard={() => void discardUnsavedChanges()}
        onCancel={cancelUnsavedPrompt}
      />
    </>
  )
}

export default App
