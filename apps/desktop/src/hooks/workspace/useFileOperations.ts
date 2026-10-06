import { useCallback, useEffect, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { appApi, fileApi } from '@/api/file-api'
import { appApi as appWindowApi } from '@/api/app-api'
import { queryKeys } from '@/api/query-keys'
import { isCancelled, type AppError } from '@montree/contracts'
import { DEFAULT_SAVE_FILENAME } from '@montree/contracts'
import {
  getDocumentKind,
  isReaderDocumentKind,
  type ReaderDocumentKind,
} from '@montree/contracts'
import type { FileTreeNode, OpenDocumentResult, OpenFolderResult } from '@montree/contracts'
import { dirname, joinPath } from '@montree/contracts'
import { err, isOk, ok, type Result } from '@montree/contracts'
import { useAppSettingsStore } from '@/stores/app-settings-store'
import { useWebDocStore } from '@/stores/web-doc-store'
import { clearDraftForFile } from '@/hooks/editor/useDraftPersistence'
import { getOpenDialogDefaultPath } from '@/lib/workspace/dialog-default-path'
import { normalizeNewlines } from '@/lib/editor/text-normalize'
import type { DocumentDraft } from '@/lib/editor/draft-utils'

function getFileName(filePath?: string): string {
  if (!filePath) return '未命名'
  return filePath.split(/[/\\]/).pop() ?? filePath
}

type UnsavedAction =
  | { kind: 'open-file' }
  | { kind: 'open-tree'; path: string }
  | { kind: 'open-external'; dir: string; path: string }
  | { kind: 'close-app' }

export function useFileOperations(onError?: (error: AppError) => void) {
  const queryClient = useQueryClient()
  const [content, setContent] = useState('')
  const [filePath, setFilePath] = useState<string>()
  const [savedContent, setSavedContent] = useState('')
  const [unsavedAction, setUnsavedAction] = useState<UnsavedAction | null>(null)
  const unsavedActionRef = useRef<UnsavedAction | null>(null)

  const documentKind = filePath ? getDocumentKind(filePath) : 'unknown'
  const readerDocumentKind: ReaderDocumentKind | undefined = isReaderDocumentKind(documentKind)
    ? documentKind
    : undefined
  const isMarkdownDocument = documentKind === 'markdown'
  const isDirty = isMarkdownDocument && content !== savedContent
  const fileName = getFileName(filePath)

  useEffect(() => {
    unsavedActionRef.current = unsavedAction
  }, [unsavedAction])

  const { data: workspace = null } = useQuery<OpenFolderResult | null>({
    queryKey: queryKeys.workspace,
    queryFn: async () => null,
    enabled: false,
    initialData: null,
  })

  const reportError = useCallback(
    (error: AppError) => {
      if (!isCancelled(error)) {
        onError?.(error)
      }
    },
    [onError],
  )

  const syncTitle = useCallback((path?: string, dirty = false) => {
    appWindowApi.updateTitle({ filePath: path, isDirty: dirty })
  }, [])

  const trackOpenedPath = useCallback((path: string) => {
    useAppSettingsStore.getState().addRecentFile(path)
    useAppSettingsStore.getState().setLastOpenedFilePath(path)
    useAppSettingsStore.getState().setLastOpenedFolderPath(dirname(path))
  }, [])

  const loadFile = useCallback(
    (result: { filePath: string; content: string }) => {
      useWebDocStore.getState().closePage()
      const content = normalizeNewlines(result.content)
      setFilePath(result.filePath)
      setContent(content)
      setSavedContent(content)
      syncTitle(result.filePath, false)
      trackOpenedPath(result.filePath)
    },
    [syncTitle, trackOpenedPath],
  )

  const loadReader = useCallback(
    (path: string) => {
      useWebDocStore.getState().closePage()
      setFilePath(path)
      setContent('')
      setSavedContent('')
      syncTitle(path, false)
      trackOpenedPath(path)
    },
    [syncTitle, trackOpenedPath],
  )

  const openWebDocument = useCallback(
    (rawUrl: string) => {
      const normalized = useWebDocStore.getState().openPage(rawUrl)
      if (!normalized) {
        reportError({ code: 'FILE_READ_ERROR', message: 'URL 无效，请输入 http(s) 链接' })
        return false
      }
      useAppSettingsStore.getState().setLastWebDocUrl(normalized)
      setFilePath(undefined)
      setContent('')
      setSavedContent('')
      syncTitle(undefined, false)
      return true
    },
    [reportError, syncTitle],
  )

  const openFileMutation = useMutation({
    mutationFn: () =>
      fileApi.openFile({
        defaultPath: getOpenDialogDefaultPath(),
      }),
    onSuccess: (result) => {
      if (!isOk(result)) {
        reportError(result.error)
        return
      }
      if (result.value.kind === 'markdown') {
        loadFile({ filePath: result.value.filePath, content: result.value.content })
        return
      }
      loadReader(result.value.filePath)
    },
  })

  const openFolderMutation = useMutation({
    mutationFn: () =>
      fileApi.openFolder({
        defaultPath: getOpenDialogDefaultPath(),
      }),
    onSuccess: (result) => {
      if (!isOk(result)) {
        reportError(result.error)
        return
      }
      queryClient.setQueryData(queryKeys.workspace, result.value)
      useAppSettingsStore.getState().setLastOpenedFolderPath(result.value.rootPath)
      useAppSettingsStore.getState().setLastWorkspaceRoot(result.value.rootPath)
    },
  })

  const rescanWorkspaceMutation = useMutation({
    mutationFn: (rootPath: string) => fileApi.scanWorkspace(rootPath),
    onSuccess: (result) => {
      if (!isOk(result)) {
        reportError(result.error)
        return
      }
      queryClient.setQueryData(queryKeys.workspace, result.value)
      useAppSettingsStore.getState().setLastWorkspaceRoot(result.value.rootPath)
    },
  })

  const openPathMutation = useMutation({
    mutationFn: async (path: string): Promise<Result<OpenDocumentResult, AppError>> => {
      const kind = getDocumentKind(path)
      if (kind === 'markdown') {
        const result = await fileApi.readFile(path)
        if (!isOk(result)) return result
        return ok({
          filePath: result.value.filePath,
          kind: 'markdown',
          content: result.value.content,
        })
      }
      if (isReaderDocumentKind(kind)) {
        return ok({ filePath: path, kind })
      }
      return err({
        code: 'UNSUPPORTED_FORMAT',
        message: '不支持的文件格式',
      })
    },
    onSuccess: (result, path) => {
      if (!isOk(result)) {
        if (result.error.code === 'FILE_NOT_FOUND') {
          useAppSettingsStore.getState().removeRecentFile(path)
        }
        reportError(result.error)
        return
      }
      if (result.value.kind === 'markdown') {
        loadFile({ filePath: result.value.filePath, content: result.value.content })
        return
      }
      loadReader(result.value.filePath)
    },
  })

  const saveFileMutation = useMutation({
    mutationFn: (payload: { filePath?: string; content: string; silent?: boolean }) =>
      fileApi.saveFile(payload),
    onSuccess: (result, variables) => {
      if (!isOk(result)) {
        reportError(result.error)
        return
      }
      setFilePath(result.value.filePath)
      setSavedContent(variables.content)
      syncTitle(result.value.filePath, false)
      trackOpenedPath(result.value.filePath)
      clearDraftForFile(result.value.filePath)
      if (!variables.silent) {
        toast.success('已保存')
      }
    },
  })

  const saveFileAsMutation = useMutation({
    mutationFn: (payload: { content: string; silent?: boolean }) => {
      const defaultDir = getOpenDialogDefaultPath()
      const defaultPath = defaultDir
        ? joinPath(defaultDir, DEFAULT_SAVE_FILENAME)
        : DEFAULT_SAVE_FILENAME

      return fileApi.saveFileAs({ content: payload.content, defaultPath })
    },
    onSuccess: (result, variables) => {
      if (!isOk(result)) {
        reportError(result.error)
        return
      }
      setFilePath(result.value.filePath)
      setSavedContent(variables.content)
      syncTitle(result.value.filePath, false)
      trackOpenedPath(result.value.filePath)
      clearDraftForFile(result.value.filePath)
      if (!variables.silent) {
        toast.success('已保存')
      }
    },
  })

  /**
   * 外部打开：先把工作区切到文件所在目录，再打开文件。
   * 目录不变时跳过扫描；类型不支持时 openPath 内报错提示。
   */
  const openExternalFileCore = useCallback(
    async (dir: string, path: string) => {
      if (dir !== workspace?.rootPath) {
        const scanResult = await rescanWorkspaceMutation.mutateAsync(dir)
        if (!isOk(scanResult)) return
      }
      await openPathMutation.mutateAsync(path)
    },
    [openPathMutation, rescanWorkspaceMutation, workspace?.rootPath],
  )

  const executeUnsavedAction = useCallback(async (action: UnsavedAction) => {
    switch (action.kind) {
      case 'open-file':
        await openFileMutation.mutateAsync()
        break
      case 'open-tree':
        await openPathMutation.mutateAsync(action.path)
        break
      case 'open-external':
        await openExternalFileCore(action.dir, action.path)
        break
      case 'close-app':
        appWindowApi.confirmClose('proceed')
        break
    }
  }, [openFileMutation, openPathMutation, openExternalFileCore])

  const promptIfDirty = useCallback(
    (action: UnsavedAction, run: () => void | Promise<void>) => {
      if (isDirty) {
        setUnsavedAction(action)
        return
      }
      void run()
    },
    [isDirty],
  )

  const openFile = useCallback(
    () => promptIfDirty({ kind: 'open-file' }, () => void openFileMutation.mutateAsync()),
    [openFileMutation, promptIfDirty],
  )

  const openFolder = useCallback(() => openFolderMutation.mutateAsync(), [openFolderMutation])

  const rescanWorkspace = useCallback(async () => {
    const rootPath =
      workspace?.rootPath ?? useAppSettingsStore.getState().lastWorkspaceRoot ?? undefined
    if (!rootPath) return
    await rescanWorkspaceMutation.mutateAsync(rootPath)
  }, [rescanWorkspaceMutation, workspace?.rootPath])

  const restoreWorkspaceOnStartup = useCallback(async () => {
    const rootPath = useAppSettingsStore.getState().lastWorkspaceRoot
    if (!rootPath || workspace) return
    await rescanWorkspaceMutation.mutateAsync(rootPath)
  }, [rescanWorkspaceMutation, workspace])

  const openFileFromTree = useCallback(
    (path: string) =>
      promptIfDirty({ kind: 'open-tree', path }, () => void openPathMutation.mutateAsync(path)),
    [openPathMutation, promptIfDirty],
  )

  const openRecentFile = useCallback(
    (path: string) =>
      promptIfDirty({ kind: 'open-tree', path }, () => void openPathMutation.mutateAsync(path)),
    [openPathMutation, promptIfDirty],
  )

  /** 资源管理器双击/打开方式：工作区切到文件所在目录并打开（未保存时走统一确认） */
  const openExternalFilePath = useCallback(
    (filePath: string) => {
      const dir = dirname(filePath)
      promptIfDirty({ kind: 'open-external', dir, path: filePath }, () =>
        void openExternalFileCore(dir, filePath),
      )
    },
    [openExternalFileCore, promptIfDirty],
  )

  const saveFile = useCallback(
    (options?: { silent?: boolean }) =>
      saveFileMutation.mutateAsync({ filePath, content, silent: options?.silent }),
    [content, filePath, saveFileMutation],
  )

  const saveFileAs = useCallback(
    () => saveFileAsMutation.mutateAsync({ content }),
    [content, saveFileAsMutation],
  )

  const restoreDraft = useCallback(
    (draft: DocumentDraft) => {
      const content = normalizeNewlines(draft.content)
      const baseline = normalizeNewlines(draft.baselineContent)
      setFilePath(draft.filePath)
      setContent(content)
      setSavedContent(baseline)
      syncTitle(draft.filePath, content !== baseline)
    },
    [syncTitle],
  )

  const cancelUnsavedPrompt = useCallback(() => {
    const action = unsavedActionRef.current
    setUnsavedAction(null)
    if (action?.kind === 'close-app') {
      appWindowApi.confirmClose('cancel')
    }
  }, [])

  const discardUnsavedChanges = useCallback(async () => {
    const action = unsavedActionRef.current
    setUnsavedAction(null)
    if (action) {
      await executeUnsavedAction(action)
    }
  }, [executeUnsavedAction])

  const saveUnsavedChanges = useCallback(async () => {
    const action = unsavedActionRef.current
    const result = await saveFileMutation.mutateAsync({ filePath, content })
    if (!isOk(result)) return

    setUnsavedAction(null)
    if (action) {
      await executeUnsavedAction(action)
    }
  }, [content, executeUnsavedAction, filePath, saveFileMutation])

  const quitApp = useCallback(() => {
    appWindowApi.quit()
  }, [])

  useEffect(() => {
    if (appWindowApi.isFreshWindow()) return
    void restoreWorkspaceOnStartup()
  }, [restoreWorkspaceOnStartup])

  const rescanWorkspaceRef = useRef(rescanWorkspaceMutation.mutateAsync)
  rescanWorkspaceRef.current = rescanWorkspaceMutation.mutateAsync

  useEffect(() => {
    const rootPath = workspace?.rootPath
    if (!rootPath) return

    appWindowApi.watchWorkspace(rootPath)
    const unsubscribe = appWindowApi.onWorkspaceChanged((payload) => {
      if (payload.rootPath !== rootPath) return
      void rescanWorkspaceRef.current(rootPath)
    })
    if (!unsubscribe) return

    return () => {
      unsubscribe()
      appWindowApi.unwatchWorkspace()
    }
  }, [workspace?.rootPath])

  useEffect(() => {
    syncTitle(filePath, isDirty)
  }, [filePath, isDirty, syncTitle])

  useEffect(() => {
    appWindowApi.setDirty(isDirty)
  }, [isDirty])

  useEffect(() => {
    return appWindowApi.onRequestClose(() => {
      if (isDirty) {
        setUnsavedAction({ kind: 'close-app' })
        return
      }
      appWindowApi.confirmClose('proceed')
    })
  }, [isDirty])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey)) return

      const key = event.key.toLowerCase()
      const code = event.code

      if ((key === 'o' || code === 'KeyO') && event.shiftKey) {
        event.preventDefault()
        void openFolder()
      } else if (key === 'o' || code === 'KeyO') {
        event.preventDefault()
        void openFile()
      } else if (isMarkdownDocument && (key === 's' || code === 'KeyS') && event.shiftKey) {
        event.preventDefault()
        void saveFileAs()
      } else if (isMarkdownDocument && (key === 's' || code === 'KeyS')) {
        event.preventDefault()
        void saveFile()
      }
    }

    window.addEventListener('keydown', onKeyDown, { capture: true })
    return () => window.removeEventListener('keydown', onKeyDown, { capture: true })
  }, [isMarkdownDocument, openFile, openFolder, saveFile, saveFileAs])

  const notifyPathDeleted = useCallback(
    (path: string) => {
      if (!filePath) return
      const normalized = filePath.replace(/\\/g, '/')
      const removed = path.replace(/\\/g, '/')
      if (
        normalized === removed ||
        normalized.startsWith(`${removed}/`)
      ) {
        setFilePath(undefined)
        setContent('')
        setSavedContent('')
        syncTitle(undefined, false)
      }
    },
    [filePath, syncTitle],
  )

  const notifyPathRenamed = useCallback(
    (from: string, to: string) => {
      if (!filePath) return
      const normalized = filePath.replace(/\\/g, '/')
      const src = from.replace(/\\/g, '/')
      const dest = to.replace(/\\/g, '/')
      if (normalized === src) {
        setFilePath(to)
        syncTitle(to, content !== savedContent)
        trackOpenedPath(to)
        return
      }
      if (normalized.startsWith(`${src}/`)) {
        const next = dest + filePath.slice(from.length)
        setFilePath(next)
        syncTitle(next, content !== savedContent)
        trackOpenedPath(next)
      }
    },
    [content, filePath, savedContent, syncTitle, trackOpenedPath],
  )

  return {
    content,
    setContent,
    filePath,
    fileName,
    savedContent,
    isDirty,
    documentKind,
    readerDocumentKind,
    isMarkdownDocument,
    workspaceRoot: workspace?.rootPath,
    fileTree: workspace?.tree ?? ([] as FileTreeNode[]),
    unsavedPromptOpen: unsavedAction !== null,
    isFileBusy:
      openFileMutation.isPending ||
      openFolderMutation.isPending ||
      openPathMutation.isPending ||
      rescanWorkspaceMutation.isPending ||
      saveFileMutation.isPending ||
      saveFileAsMutation.isPending,
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
  }
}

export function useAppMeta() {
  return useQuery({
    queryKey: queryKeys.appMeta,
    queryFn: async () => {
      const platformResult = appApi.getPlatform()
      const versionResult = await appApi.getVersion()

      return {
        platform: isOk(platformResult) ? platformResult.value : '',
        version: isOk(versionResult) ? versionResult.value : '',
        error: !isOk(platformResult)
          ? platformResult.error
          : !isOk(versionResult)
            ? versionResult.error
            : null,
      }
    },
    staleTime: Infinity,
  })
}

export type { FileTreeNode }
