import { useCallback, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { fileApi } from '@/api/file-api'
import {
  buildUniqueChildPath,
  getBaseName,
  getParentDir,
  isMarkdownPath,
  joinPath,
  listChildNames,
  resolvePasteTargetDir,
  toRelativePath,
  type TreeClipboardEntry,
} from '@/lib/workspace/file-tree-ops'
import { buildExportHtml, getSuggestedExportName } from '@/lib/editor/export-document'
import { reportAppError } from '@/lib/workspace/report-error'
import { isOk } from '@montree/contracts'
import type { FileTreeNode } from '@montree/contracts'
import { getDocumentKind } from '@montree/contracts'

interface UseFileTreeActionsOptions {
  workspaceRoot?: string
  tree: FileTreeNode[]
  rescanWorkspace: () => Promise<void> | void
  /** 删除/重命名当前打开文件时回调 */
  onPathRemoved?: (path: string) => void
  onPathRenamed?: (from: string, to: string) => void
  onOpenFile?: (path: string) => void
}

export function useFileTreeActions({
  workspaceRoot,
  tree,
  rescanWorkspace,
  onPathRemoved,
  onPathRenamed,
  onOpenFile,
}: UseFileTreeActionsOptions) {
  const [clipboard, setClipboard] = useState<TreeClipboardEntry | null>(null)

  const refresh = useCallback(async () => {
    await rescanWorkspace()
  }, [rescanWorkspace])

  const copyFullPath = useCallback(async (path: string) => {
    await navigator.clipboard.writeText(path)
    toast.success('已复制完整路径')
  }, [])

  const copyRelativePath = useCallback(
    async (path: string) => {
      if (!workspaceRoot) return
      await navigator.clipboard.writeText(toRelativePath(path, workspaceRoot))
      toast.success('已复制相对路径')
    },
    [workspaceRoot],
  )

  const setCopy = useCallback((node: FileTreeNode) => {
    setClipboard({
      mode: 'copy',
      path: node.path,
      isDirectory: node.type === 'directory',
      name: node.name,
    })
    toast.message('已复制')
  }, [])

  const setCut = useCallback((node: FileTreeNode) => {
    setClipboard({
      mode: 'cut',
      path: node.path,
      isDirectory: node.type === 'directory',
      name: node.name,
    })
    toast.message('已剪切')
  }, [])

  const pasteInto = useCallback(
    async (target: FileTreeNode | 'root') => {
      if (!workspaceRoot || !clipboard) return
      const parentDir = resolvePasteTargetDir(
        target === 'root' ? 'root' : { path: target.path, type: target.type },
        workspaceRoot,
      )
      const names = listChildNames(tree, parentDir, workspaceRoot)
      const toPath = buildUniqueChildPath(parentDir, clipboard.name, names)
      const payload = {
        workspaceRoot,
        fromPath: clipboard.path,
        toPath,
      }
      const result =
        clipboard.mode === 'cut'
          ? await fileApi.moveWorkspacePath(payload)
          : await fileApi.copyWorkspacePath(payload)
      if (!isOk(result)) {
        reportAppError(result.error)
        return
      }
      if (clipboard.mode === 'cut') {
        onPathRenamed?.(clipboard.path, result.value.path)
        setClipboard(null)
      }
      toast.success(clipboard.mode === 'cut' ? '已移动' : '已粘贴')
      await refresh()
    },
    [clipboard, onPathRenamed, refresh, tree, workspaceRoot],
  )

  const createFile = useCallback(
    async (parentDir: string, name: string) => {
      if (!workspaceRoot) return null
      const path = joinPath(parentDir, name)
      const result = await fileApi.createWorkspaceFile({
        workspaceRoot,
        path,
        content: '',
      })
      if (!isOk(result)) {
        reportAppError(result.error)
        return null
      }
      if (getDocumentKind(result.value.path) === 'unknown') {
        toast.message('已创建，但该后缀不在侧栏扫描范围（建议 .md / .txt）')
      } else {
        toast.success('已创建文件')
      }
      await refresh()
      if (getDocumentKind(result.value.path) !== 'unknown') {
        onOpenFile?.(result.value.path)
      }
      return result.value.path
    },
    [onOpenFile, refresh, workspaceRoot],
  )

  const createFolder = useCallback(
    async (parentDir: string, name: string) => {
      if (!workspaceRoot) return null
      const path = joinPath(parentDir, name)
      const result = await fileApi.createWorkspaceDirectory({ workspaceRoot, path })
      if (!isOk(result)) {
        reportAppError(result.error)
        return null
      }
      toast.success('已创建文件夹')
      await refresh()
      return result.value.path
    },
    [refresh, workspaceRoot],
  )

  const rename = useCallback(
    async (fromPath: string, newName: string) => {
      if (!workspaceRoot) return null
      const trimmed = newName.trim()
      if (!trimmed) {
        toast.error('名称不能为空')
        return null
      }
      if (/[/\\]/.test(trimmed)) {
        toast.error('名称不能包含路径分隔符')
        return null
      }
      const toPath = joinPath(getParentDir(fromPath), trimmed)
      if (toPath === fromPath) return fromPath
      const result = await fileApi.renameWorkspacePath({
        workspaceRoot,
        fromPath,
        toPath,
      })
      if (!isOk(result)) {
        reportAppError(result.error)
        return null
      }
      onPathRenamed?.(fromPath, result.value.path)
      if (getDocumentKind(result.value.path) === 'unknown') {
        toast.message('已重命名；该后缀可能不会出现在侧栏列表中')
      } else {
        toast.success('已重命名')
      }
      await refresh()
      return result.value.path
    },
    [onPathRenamed, refresh, workspaceRoot],
  )

  const remove = useCallback(
    async (node: FileTreeNode) => {
      if (!workspaceRoot) return
      const label = node.type === 'directory' ? '文件夹' : '文件'
      const okConfirm = window.confirm(`确定删除${label}「${node.name}」？此操作不可撤销。`)
      if (!okConfirm) return
      const result = await fileApi.deleteWorkspacePath({
        workspaceRoot,
        path: node.path,
      })
      if (!isOk(result)) {
        reportAppError(result.error)
        return
      }
      onPathRemoved?.(node.path)
      toast.success('已删除')
      await refresh()
    },
    [onPathRemoved, refresh, workspaceRoot],
  )

  const exportMarkdownPdf = useCallback(
    async (filePath: string) => {
      if (!isMarkdownPath(filePath)) {
        toast.error('仅支持将 Markdown / 文本导出为 PDF')
        return
      }
      const read = await fileApi.readFile(filePath)
      if (!isOk(read)) {
        reportAppError(read.error)
        return
      }
      const html = await buildExportHtml(read.value.content, filePath)
      const result = await fileApi.exportPdf({
        html,
        suggestedName: getSuggestedExportName(filePath, 'pdf'),
      })
      if (!isOk(result)) {
        reportAppError(result.error)
        return
      }
      toast.success('已导出 PDF')
    },
    [],
  )

  const defaultNewFileName = useCallback(
    (parentDir: string) => {
      if (!workspaceRoot) return 'untitled.md'
      const names = listChildNames(tree, parentDir, workspaceRoot)
      return getBaseName(buildUniqueChildPath(parentDir, 'untitled.md', names))
    },
    [tree, workspaceRoot],
  )

  const defaultNewFolderName = useCallback(
    (parentDir: string) => {
      if (!workspaceRoot) return 'New Folder'
      const names = listChildNames(tree, parentDir, workspaceRoot)
      return getBaseName(buildUniqueChildPath(parentDir, 'New Folder', names))
    },
    [tree, workspaceRoot],
  )

  // useMemo 稳住容器对象 identity：调用方重渲染时 memo 子树 props 不变
  return useMemo(
    () => ({
      clipboard,
      copyFullPath,
      copyRelativePath,
      setCopy,
      setCut,
      pasteInto,
      createFile,
      createFolder,
      rename,
      remove,
      exportMarkdownPdf,
      defaultNewFileName,
      defaultNewFolderName,
    }),
    [
      clipboard,
      copyFullPath,
      copyRelativePath,
      setCopy,
      setCut,
      pasteInto,
      createFile,
      createFolder,
      rename,
      remove,
      exportMarkdownPdf,
      defaultNewFileName,
      defaultNewFolderName,
    ],
  )
}
