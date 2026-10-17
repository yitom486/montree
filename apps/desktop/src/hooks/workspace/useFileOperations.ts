import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { getDocumentTools, subscribeDocumentTools } from '@/lib/agent/context/document-tool-registry'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { appApi, fileApi } from '@/api/file-api'
import { appApi as appWindowApi } from '@/api/app-api'
import { workspaceApi } from '@/api/workspace-api'
import { toHostTextRef } from '@/api/workspace-api'
import { queryKeys } from '@/api/query-keys'
import { useWorkspaceIdentity, useWorkspaceStore } from '@/stores/workspace-store'
import { isCancelled, type AppError } from '@yitom/contracts'
import { DEFAULT_SAVE_FILENAME, isLocalWorkspaceId } from '@yitom/contracts'
import {
  getDocumentKind,
  isOfficeDocumentKind,
  isReaderDocumentKind,
  isTextDocumentKind,
  type ReaderDocumentKind,
} from '@yitom/contracts'
import type { FileTreeNode, OpenDocumentResult, OpenFolderResult } from '@yitom/contracts'
import { dirname, joinPath } from '@yitom/contracts'
import { err, isOk, ok, type Result } from '@yitom/contracts'
import { useAppSettingsStore } from '@/stores/app-settings-store'
import { useWebDocStore } from '@/stores/web-doc-store'
import { clearDraftForFile } from '@/hooks/editor/useDraftPersistence'
import { getOpenDialogDefaultPath } from '@/lib/workspace/dialog-default-path'
import { normalizeNewlines } from '@/lib/editor/text-normalize'
import type { DocumentDraft } from '@/lib/editor/draft-utils'
import { useTextDocumentTools } from '@/hooks/editor/useTextDocumentTools'

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
  // 当前窗口工作区身份（local 单槽；远端每身份独立缓存/订阅/草稿）。
  const { workspaceId, generation } = useWorkspaceIdentity()
  const [content, setContent] = useState('')
  const [filePath, setFilePath] = useState<string>()
  const [savedContent, setSavedContent] = useState('')
  const [diskContent, setDiskContent] = useState('')
  // B2：宿主 revision（读时取得，保存时携带；null = 遗留路径无版本校验）。
  const [docRevision, setDocRevision] = useState<string | null>(null)
  const docRevisionRef = useRef<string | null>(null)
  docRevisionRef.current = docRevision
  // P1：窗口工作区身份 ref（远端绑定下裸相对路径转 workspaceId + relativePath）。
  const workspaceIdRef = useRef(workspaceId)
  workspaceIdRef.current = workspaceId
  // B2：外部修改提示（dirty 时不自动覆盖，交用户选择重载/覆盖）。
  const [externalChange, setExternalChange] = useState<{ diskContent: string } | null>(null)
  // P1 冲突基线保护：REVISION_CONFLICT 只记录“待处理磁盘版本”，绝不推进
  // docRevision（已加载/已保存基线）。冲突未解决时普通保存持续拒绝，
  // 只有 resolveExternalChange('overwrite') 携带该磁盘版本显式覆盖。
  const [pendingDiskRevision, setPendingDiskRevision] = useState<string | null>(null)
  const [textSession, setTextSession] = useState(0)
  const textDocument = useTextDocumentTools({ filePath, content, savedContent, diskContent, session: textSession,
    onChange: setContent, onSaved: (text) => { setSavedContent(text); setDiskContent(text) } })
  const [unsavedAction, setUnsavedAction] = useState<UnsavedAction | null>(null)
  const unsavedActionRef = useRef<UnsavedAction | null>(null)

  const documentKind = filePath ? getDocumentKind(filePath) : 'unknown'
  const readerDocumentKind: ReaderDocumentKind | undefined = isReaderDocumentKind(documentKind)
    ? documentKind
    : undefined
  const isMarkdownDocument = documentKind === 'markdown'
  const isTypstDocument = documentKind === 'typst'
  const isSourceDocument = isMarkdownDocument || isTypstDocument
  const isEditableDocument = isTextDocumentKind(documentKind)
  const toolDirty = useSyncExternalStore(subscribeDocumentTools, () => getDocumentTools(filePath)?.isDirty() ?? false)
  const isDirty = getDocumentTools(filePath) ? toolDirty : isEditableDocument && content !== savedContent
  const fileName = getFileName(filePath)

  useEffect(() => {
    unsavedActionRef.current = unsavedAction
  }, [unsavedAction])

  const { data: workspace = null } = useQuery<OpenFolderResult | null>({
    queryKey: queryKeys.workspaceOf(workspaceId),
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
    useAppSettingsStore.getState().addRecentDocument(workspaceId, path)
    useAppSettingsStore.getState().setLastOpenedFilePath(path)
    useAppSettingsStore.getState().setLastOpenedFolderPath(dirname(path))
  }, [workspaceId])

  const loadFile = useCallback(
    (result: { filePath: string; content: string; revision?: string | null }) => {
      useWebDocStore.getState().closePage()
      const kind = getDocumentKind(result.filePath)
      const content = kind === 'markdown' || kind === 'typst' ? normalizeNewlines(result.content) : result.content
      setFilePath(result.filePath)
      setContent(content)
      setSavedContent(content)
      setDiskContent(result.content)
      setDocRevision(result.revision ?? null)
      setPendingDiskRevision(null)
      setExternalChange(null)
      setTextSession((session) => session + 1)
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
      setDocRevision(null)
      setPendingDiskRevision(null)
      setExternalChange(null)
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
      if ('content' in result.value) {
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
      queryClient.setQueryData(queryKeys.workspaceOf(workspaceId), result.value)
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
      queryClient.setQueryData(queryKeys.workspaceOf(workspaceId), result.value)
      useAppSettingsStore.getState().setLastWorkspaceRoot(result.value.rootPath)
    },
  })

  const openPathMutation = useMutation({
    mutationFn: async (path: string): Promise<Result<OpenDocumentResult & { revision?: string }, AppError>> => {
      const kind = getDocumentKind(path)
      if (isTextDocumentKind(kind)) {
        // B2：经宿主读（带 revision；旧构建缺新 IPC 时回落 fileApi，revision 置空）。
        // P1：远端绑定下裸相对路径转 workspaceId + relativePath，直达远端会话。
        const hosted = await workspaceApi.readText(toHostTextRef(workspaceIdRef.current, path))
        if (isOk(hosted)) {
          return ok({
            filePath: hosted.value.filePath,
            kind,
            content: hosted.value.content,
            revision: hosted.value.revision,
          })
        }
        if (hosted.error.code !== 'API_UNAVAILABLE') return hosted
        const result = await fileApi.readFile(path)
        if (!isOk(result)) return result
        return ok({
          filePath: result.value.filePath,
          kind,
          content: result.value.content,
        })
      }
      if (isReaderDocumentKind(kind) || isOfficeDocumentKind(kind)) {
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
          useAppSettingsStore.getState().removeRecentDocument(workspaceId, path)
        }
        reportError(result.error)
        return
      }
      if ('content' in result.value) {
        loadFile({ filePath: result.value.filePath, content: result.value.content, revision: result.value.revision })
        return
      }
      if (isReaderDocumentKind(result.value.kind) || isOfficeDocumentKind(result.value.kind)) {
        loadReader(result.value.filePath)
        return
      }
    },
  })

  const saveFileMutation = useMutation({
    mutationFn: async (payload: { filePath?: string; content: string; silent?: boolean; expectedRevision?: string | null; handled?: boolean }) => {
      const provider = payload.filePath ? getDocumentTools(payload.filePath) : null
      if (provider) {
        try { await provider.save(); return ok({ filePath: provider.filePath }) }
        catch (reason) {
          // P1-残留：远端文件（markdown 经 provider 由 fileApi.saveFile 携带
          // expectedContent，远端宿主已做先读比对）保存失败后核对磁盘：确有
          // 外部修改则亮横幅并报 REVISION_CONFLICT（基线不动，重复保存持续拒绝）；
          // 磁盘无变化则是 genuine 写入失败，沿原 FILE_WRITE_ERROR 上报。
          // 本机 provider 路径保持原行为不变。
          if (payload.filePath && !isLocalWorkspaceId(workspaceIdRef.current)) {
            const ref = toHostTextRef(workspaceIdRef.current, payload.filePath)
            if (ref.workspaceId && ref.relativePath) {
              const disk = await workspaceApi.readText(ref)
              if (isOk(disk) && normalizeNewlines(disk.value.content) !== normalizeNewlines(diskContentRef.current)) {
                setExternalChange({ diskContent: disk.value.content })
                setPendingDiskRevision(disk.value.revision)
                return err({ code: 'REVISION_CONFLICT' as const, message: '文件已被其他程序修改，请处理冲突后再保存' })
              }
            }
          }
          return err({ code: 'FILE_WRITE_ERROR' as const, message: reason instanceof Error ? reason.message : String(reason) })
        }
      }
      if (payload.filePath && isOfficeDocumentKind(getDocumentKind(payload.filePath))) return err({ code: 'INVALID_STATE' as const, message: '文档尚未就绪或不支持编辑保存' })
      // B2：有 revision 走宿主写（expectedRevision 冲突检查；断线报连接错误，
      // buffer 保留不误报成功）。无 revision 沿遗留路径（旧构建/未命名）。
      // P1：远端绑定下裸相对路径转 workspaceId + relativePath。
      // P1 冲突基线保护：显式覆盖（resolveExternalChange）经 expectedRevision
      // 参数传入磁盘版本；普通保存一律用加载基线 docRevision，冲突后不推进。
      const expectedRevision = payload.expectedRevision ?? docRevisionRef.current
      const wid = workspaceIdRef.current
      if (payload.filePath && expectedRevision) {
        const written = await workspaceApi.writeText({
          ...toHostTextRef(wid, payload.filePath),
          content: payload.content,
          expectedRevision,
        })
        if (!isOk(written)) {
          if (written.error.code === 'REVISION_CONFLICT') {
            // 冲突：重读磁盘供差异展示与显式覆盖用，buffer 与加载基线原样保留
            const disk = await workspaceApi.readText(toHostTextRef(wid, payload.filePath))
            setExternalChange(isOk(disk) ? { diskContent: disk.value.content } : { diskContent })
            setPendingDiskRevision(isOk(disk) ? disk.value.revision : null)
          }
          return written
        }
        setDocRevision(written.value.revision)
        setPendingDiskRevision(null)
        return ok({ filePath: written.value.filePath })
      }
      return fileApi.saveFile({ ...payload, expectedContent: payload.filePath ? diskContentRef.current : undefined,
        documentKind: isTypstDocument ? 'typst' : 'markdown' })
    },
    onSuccess: (result, variables) => {
      if (!isOk(result)) {
        // P1：调用方自理反馈（显式覆盖流程）或静默自动保存遇冲突时不弹错误；
        // 横幅/重读由调用方处理，手动保存照常报错
        if (!variables.handled && !(variables.silent && result.error.code === 'REVISION_CONFLICT')) {
          reportError(result.error)
        }
        return
      }
      setFilePath(result.value.filePath)
      if (getDocumentTools(result.value.filePath)?.kind !== 'text') {
        setSavedContent(variables.content)
        setDiskContent(variables.content)
      }
      syncTitle(result.value.filePath, false)
      trackOpenedPath(result.value.filePath)
      clearDraftForFile(result.value.filePath, workspaceId)
      if (!variables.silent) {
        toast.success('已保存')
      }
    },
  })

  const saveFileAsMutation = useMutation({
    mutationFn: (payload: { content: string; silent?: boolean }) => {
      const defaultDir = getOpenDialogDefaultPath()
      const suggestedName = isTypstDocument ? getFileName(filePath) : DEFAULT_SAVE_FILENAME
      const defaultPath = defaultDir ? joinPath(defaultDir, suggestedName) : suggestedName

      return fileApi.saveFileAs({ content: payload.content, defaultPath, documentKind: isTypstDocument ? 'typst' : 'markdown' })
    },
    onSuccess: (result, variables) => {
      if (!isOk(result)) {
        reportError(result.error)
        return
      }
      clearDraftForFile(filePath, workspaceId)
      setFilePath(result.value.filePath)
      setDocRevision(null)
      setPendingDiskRevision(null)
      setExternalChange(null)
      setSavedContent(variables.content)
      setDiskContent(variables.content)
      syncTitle(result.value.filePath, false)
      trackOpenedPath(result.value.filePath)
      clearDraftForFile(result.value.filePath, workspaceId)
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

  const closeWorkspace = useCallback(() => {
    queryClient.setQueryData(queryKeys.workspaceOf(workspaceId), null)
    useAppSettingsStore.getState().setLastWorkspaceRoot(undefined)
    // 解绑 main 侧可信窗口工作区（含停止监听）；状态同步尽力而为，不阻塞关闭。
    void workspaceApi.disconnect()
    toast.success('已关闭工作区')
  }, [queryClient, workspaceId])

  const rescanWorkspace = useCallback(async (targetRootPath?: string) => {
    const rootPath =
      targetRootPath ?? workspace?.rootPath ?? useAppSettingsStore.getState().lastWorkspaceRoot ?? undefined
    if (!rootPath) return
    await rescanWorkspaceMutation.mutateAsync(rootPath)
  }, [rescanWorkspaceMutation, workspace?.rootPath])

  const restoreWorkspaceOnStartup = useCallback(async () => {
    const shouldRestore = useAppSettingsStore.getState().restoreWorkspaceOnStartup
    if (!shouldRestore) return
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
    async (draft: DocumentDraft) => {
      const content = normalizeNewlines(draft.content)
      const baseline = normalizeNewlines(draft.baselineContent)
      const disk = draft.filePath ? await fileApi.readFile(draft.filePath) : null
      setFilePath(draft.filePath)
      setContent(content)
      setSavedContent(baseline)
      // CRLF drafts retain a raw disk baseline only if the restored baseline still matches.
      setDiskContent(disk && isOk(disk) && normalizeNewlines(disk.value.content) === baseline ? disk.value.content : draft.baselineContent)
      setTextSession((session) => session + 1)
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

  // B2：watch 回调内做外部修改判定（refs 避免反复重订阅）。
  const openFileStateRef = useRef({ filePath, content, savedContent, isDirty, docRevision })
  openFileStateRef.current = { filePath, content, savedContent, isDirty, docRevision }
  const diskContentRef = useRef(diskContent)
  diskContentRef.current = diskContent

  /** B2：核对当前打开文件的磁盘版本（外部修改提示用）。 */
  const checkCurrentFileExternalChange = useCallback(async () => {
    const state = openFileStateRef.current
    if (!state.filePath || !isEditableDocument && !getDocumentTools(state.filePath)) return
    // P1：远端绑定下经远端会话重读；加载基线绝不推进，只记待处理磁盘版本
    const disk = await workspaceApi.readText(toHostTextRef(workspaceIdRef.current, state.filePath))
    if (!isOk(disk)) return
    const latest = openFileStateRef.current
    if (latest.filePath !== state.filePath) return
    if (normalizeNewlines(disk.value.content) === normalizeNewlines(latest.savedContent)) return
    if (!latest.isDirty) {
      // 未 dirty：静默跟随磁盘（不丢 buffer——本就没有未保存内容）
      loadFile({ filePath: state.filePath, content: disk.value.content, revision: disk.value.revision })
      return
    }
    // dirty：提示外部修改，由用户选择重载/覆盖（不自动覆盖任何一方）
    setExternalChange({ diskContent: disk.value.content })
    setPendingDiskRevision(disk.value.revision)
  }, [isEditableDocument, loadFile])

  useEffect(() => {
    const rootPath = workspace?.rootPath
    if (!rootPath) return

    appWindowApi.watchWorkspace(rootPath)
    const unsubscribe = appWindowApi.onWorkspaceChanged((payload) => {
      if (payload.rootPath !== rootPath) return
      // 代际隔离：旧工作区事件不得触发新状态重扫（T6）；缺字段旧载荷不过滤。
      if (payload.workspaceId && payload.workspaceId !== workspaceId) return
      if (typeof payload.generation === 'number' && payload.generation !== generation) return
      void rescanWorkspaceRef.current(rootPath)
      // B3：按目录刷新——事件带 dirs 且不含当前文件目录时跳过单文件核对；
      // 缺席/截断时回落全量核对（当前文件必查）。
      const current = openFileStateRef.current.filePath
      if (current && payload.dirs && !payload.truncatedDirs) {
        const fileDir = dirname(current).replace(/\\/g, '/')
        const root = rootPath.replace(/\\/g, '/').replace(/\/+$/, '')
        const relDir = fileDir.toLowerCase() === root.toLowerCase()
          ? '.'
          : fileDir.slice(root.length + 1)
        if (!payload.dirs.includes(relDir)) return
      }
      void checkCurrentFileExternalChange()
    })
    if (!unsubscribe) return

    return () => {
      unsubscribe()
      appWindowApi.unwatchWorkspace()
    }
  }, [checkCurrentFileExternalChange, generation, workspace?.rootPath, workspaceId])

  // 工作区连接状态同步：首帧快照 + main 推送写回 store（旧代际推送由 store 丢弃）。
  useEffect(() => {
    let cancelled = false
    void workspaceApi.getStatus().then((result) => {
      if (!cancelled && isOk(result)) {
        useWorkspaceStore.getState().applyStatus(result.value)
      }
    })
    const unsubscribe = workspaceApi.onStatusChanged((status) => {
      useWorkspaceStore.getState().applyStatus(status)
    })
    return () => {
      cancelled = true
      unsubscribe?.()
    }
  }, [])

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
      } else if (isSourceDocument && (key === 's' || code === 'KeyS') && event.shiftKey) {
        event.preventDefault()
        void saveFileAs()
      } else if ((isEditableDocument || getDocumentTools(filePath)) && (key === 's' || code === 'KeyS') && !event.shiftKey) {
        event.preventDefault()
        void saveFile()
      }
    }

    window.addEventListener('keydown', onKeyDown, { capture: true })
    return () => window.removeEventListener('keydown', onKeyDown, { capture: true })
  }, [filePath, isEditableDocument, isSourceDocument, openFile, openFolder, saveFile, saveFileAs])

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
        setDocRevision(null)
        setPendingDiskRevision(null)
        setExternalChange(null)
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

  /**
   * B2：解决外部修改冲突。reload 丢弃 buffer 载入磁盘版；
   * overwrite 携带重读到的磁盘版本显式覆盖（用户已确认；绝不用已推进的基线）。
   */
  const resolveExternalChange = useCallback(
    async (choice: 'reload' | 'overwrite') => {
      if (!filePath || !externalChange) return
      const ref = toHostTextRef(workspaceIdRef.current, filePath)
      if (choice === 'reload') {
        const disk = await workspaceApi.readText(ref)
        if (isOk(disk)) {
          loadFile({ filePath, content: disk.value.content, revision: disk.value.revision })
        } else {
          reportError(disk.error)
        }
        return
      }
      const disk = await workspaceApi.readText(ref)
      if (!isOk(disk)) {
        reportError(disk.error)
        return
      }
      // P1-残留：有 provider 的文件（markdown）不能走 mutation 的 provider.save
      //（它携带模型内旧基线，会再次被拒），改经宿主用刚重读的磁盘版本直接写入，
      // 成功后同步模型与 hook 基线；无 provider 沿用原 mutation 路径。
      const provider = filePath ? getDocumentTools(filePath) : null
      if (provider && textDocument && textDocument.filePath === filePath) {
        const written = await workspaceApi.writeText({
          ...ref,
          content,
          expectedRevision: disk.value.revision,
        })
        if (!isOk(written)) {
          const fresh = await workspaceApi.readText(ref)
          setExternalChange(isOk(fresh) ? { diskContent: fresh.value.content } : { diskContent: disk.value.content })
          setPendingDiskRevision(isOk(fresh) ? fresh.value.revision : disk.value.revision)
          if (!(written.error.code === 'REVISION_CONFLICT')) reportError(written.error)
          return
        }
        textDocument.markSaved(content, content)
        setDocRevision(written.value.revision)
        setSavedContent(content)
        setDiskContent(content)
        setExternalChange(null)
        setPendingDiskRevision(null)
        syncTitle(filePath, false)
        trackOpenedPath(filePath)
        clearDraftForFile(filePath, workspaceId)
        toast.success('已保存')
        return
      }
      const written = await saveFileMutation.mutateAsync({ filePath, content, expectedRevision: disk.value.revision, handled: true })
      if (!isOk(written)) {
        // 覆盖瞬间又被外部改写：刷新待处理版本并保留横幅，不伪装成功
        const fresh = await workspaceApi.readText(ref)
        setExternalChange(isOk(fresh) ? { diskContent: fresh.value.content } : { diskContent: disk.value.content })
        setPendingDiskRevision(isOk(fresh) ? fresh.value.revision : disk.value.revision)
        if (!(written.error.code === 'REVISION_CONFLICT')) reportError(written.error)
        return
      }
      setExternalChange(null)
      setPendingDiskRevision(null)
      setSavedContent(content)
      setDiskContent(content)
    },
    [externalChange, filePath, loadFile, content, reportError, saveFileMutation, syncTitle, textDocument, trackOpenedPath, workspaceId],
  )

  const dismissExternalChange = useCallback(() => {
    setExternalChange(null)
    setPendingDiskRevision(null)
  }, [])

  /**
   * B2 远端另存为（远端目录选择语义）：调用方给出远端目录与文件名，
   * 不弹 Windows 对话框；本机工作区沿用 saveFileAs 对话框流程。
   */
  const saveRemoteCopy = useCallback(
    async (dirRelativePath: string | undefined, fileName: string) => {
      if (isLocalWorkspaceId(workspaceId)) {
        await saveFileAsMutation.mutateAsync({ content })
        return
      }
      const saved = await workspaceApi.saveTextAs({
        workspaceId,
        dirRelativePath,
        fileName,
        content,
      })
      if (!isOk(saved)) {
        reportError(saved.error)
        return
      }
      toast.success('已保存到远端')
    },
    [content, reportError, saveFileAsMutation, workspaceId],
  )

  return {
    content,
    textDocument,
    setContent,
    filePath,
    fileName,
    savedContent,
    isDirty,
    documentKind,
    readerDocumentKind,
    isMarkdownDocument,
    isTypstDocument,
    isSourceDocument,
    isEditableDocument,
    // B2：宿主 revision（null = 遗留路径）与外部修改提示状态。
    docRevision,
    externalChange,
    resolveExternalChange,
    dismissExternalChange,
    saveRemoteCopy,
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
    closeWorkspace,
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
