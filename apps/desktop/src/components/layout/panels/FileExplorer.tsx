import { memo, useCallback, useEffect, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react'
import { SUPPORTED_WORKSPACE_EXTENSION_LABEL } from '@montree/contracts'
import {
  BookMarked,
  BookOpen,
  ChevronDown,
  ChevronRight,
  FileText,
  FileType,
  Folder,
  FolderOpen,
  Globe,
  PanelLeftClose,
} from 'lucide-react'
import type { FileTreeNode } from '@montree/contracts'
import { Button } from '@/components/ui/button'
import { writeWorkspacePathsToDataTransfer } from '@/lib/agent/acp-composer'
import { getParentDir, isAncestorOrSelf, isAncestorPath, isMarkdownPath } from '@/lib/workspace/file-tree-ops'
import { cn } from '@/lib/utils'
import type { useFileTreeActions } from '@/hooks/workspace/useFileTreeActions'
import { FileExplorerOverflowMenu } from '@/components/layout/panels/FileExplorerOverflowMenu'
import { WebDocSidebarPanel } from '@/components/layout/web-doc/WebDocSidebarPanel'

type TreeActions = ReturnType<typeof useFileTreeActions>

interface FileExplorerProps {
  workspaceRoot?: string
  tree: FileTreeNode[]
  activeFilePath?: string
  /** 无工作区时：当前在线文档 URL */
  webPageUrl?: string | null
  /** 最近打开的网页 */
  recentWebUrls?: string[]
  onOpenFolder: () => void
  onOpenWebDoc?: (url: string) => void
  onRescanWorkspace?: () => void
  isRescanning?: boolean
  onSelectFile: (path: string) => void
  onHideSidebar?: () => void
  treeActions?: TreeActions
  /** 只读模式（阅读器/在线文档）：⋯ 菜单隐藏文档组 */
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

function formatWebDocLabel(url: string): string {
  try {
    const parsed = new URL(url)
    const path = parsed.pathname === '/' ? '' : parsed.pathname
    return `${parsed.hostname}${path}`
  } catch {
    return url
  }
}

type MenuState =
  | {
      x: number
      y: number
      target: FileTreeNode | 'root'
    }
  | null

type InlineEdit =
  | { mode: 'rename'; path: string; initial: string }
  | { mode: 'new-file' | 'new-folder'; parentDir: string; initial: string }
  | null

const FileIcon = memo(function FileIcon({ documentKind }: { documentKind?: FileTreeNode['documentKind'] }) {
  switch (documentKind) {
    case 'pdf':
      return <FileType className="size-3.5 shrink-0 text-red-500/90" />
    case 'epub':
      return <BookOpen className="size-3.5 shrink-0 text-sky-500/90" />
    case 'mobi':
      return <BookMarked className="size-3.5 shrink-0 text-amber-500/90" />
    case 'markdown':
      return <FileText className="size-3.5 shrink-0 text-emerald-500/80" />
    default:
      return <FileText className="size-3.5 shrink-0" />
  }
})

function MenuItem({
  label,
  disabled,
  danger,
  onClick,
}: {
  label: string
  disabled?: boolean
  danger?: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      className={cn(
        'flex w-full items-center rounded-sm px-2 py-1.5 text-left text-xs outline-none',
        disabled
          ? 'cursor-not-allowed text-muted-foreground/50'
          : danger
            ? 'text-destructive hover:bg-destructive/10'
            : 'hover:bg-accent hover:text-accent-foreground',
      )}
      onClick={onClick}
    >
      {label}
    </button>
  )
}

function MenuSeparator() {
  return <div className="my-1 h-px bg-border/70" />
}

/**
 * 内联重命名/新建输入框：输入态下沉到本组件内部。
 * 键入只重渲染这一个 input，不再经 FileExplorer 顶层 setState 触发整树重渲染；
 * doneRef 防止 Enter 提交后再触发 blur 导致重复提交。
 */
function InlineEditInput({
  initialValue,
  onCommit,
  onCancel,
}: {
  initialValue: string
  onCommit: (value: string) => void
  onCancel: () => void
}) {
  const [value, setValue] = useState(initialValue)
  const valueRef = useRef(value)
  valueRef.current = value
  const doneRef = useRef(false)

  const commit = useCallback(() => {
    if (doneRef.current) return
    doneRef.current = true
    onCommit(valueRef.current)
  }, [onCommit])

  const cancel = useCallback(() => {
    if (doneRef.current) return
    doneRef.current = true
    onCancel()
  }, [onCancel])

  return (
    <input
      autoFocus
      className="min-w-0 flex-1 rounded border border-ring bg-background px-1 py-0.5 text-xs text-foreground outline-none"
      value={value}
      onChange={(e) => setValue(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault()
          commit()
        }
        if (e.key === 'Escape') {
          e.preventDefault()
          cancel()
        }
      }}
      onClick={(e) => e.stopPropagation()}
      onFocus={(e) => e.currentTarget.select()}
    />
  )
}

const TreeNode = memo(function TreeNode({
  node,
  depth,
  activeFilePath,
  revealPath,
  onSelectFile,
  onContextMenu,
  renamePath,
  renameInitial,
  createParentDir,
  createKind,
  createInitial,
  onInlineCommit,
  onInlineCancel,
}: {
  node: FileTreeNode
  depth: number
  activeFilePath?: string
  /** 新建目标父目录：其自身及祖先自动展开（仅展开不折叠） */
  revealPath?: string | null
  onSelectFile: (path: string) => void
  onContextMenu: (event: ReactMouseEvent, node: FileTreeNode) => void
  renamePath: string | null
  renameInitial: string
  createParentDir: string | null
  createKind: 'new-file' | 'new-folder' | null
  createInitial: string
  onInlineCommit: (value: string) => void
  onInlineCancel: () => void
}) {
  const [expanded, setExpanded] = useState(depth < 2)
  const isDirectory = node.type === 'directory'
  const isActive = node.path === activeFilePath
  const renaming = renamePath === node.path
  const creatingHere = createParentDir === node.path

  // 自动揭示：当前打开文件或新建目标落在本目录之下时展开；
  // 只展开不折叠，手动折叠不受已挂载 effect 干扰（deps 未变不重触发）。
  useEffect(() => {
    if (!isDirectory) return
    if (isAncestorPath(node.path, activeFilePath) || isAncestorOrSelf(node.path, revealPath)) {
      setExpanded(true)
    }
  }, [isDirectory, node.path, activeFilePath, revealPath])

  const rowPadding = { paddingLeft: `${depth * 12 + (isDirectory ? 8 : 24)}px` }

  if (isDirectory) {
    return (
      <div>
        <div
          className="flex w-full items-center gap-1 rounded-md px-2 py-1 text-left text-sm text-muted-foreground hover:bg-accent/50 hover:text-foreground"
          style={rowPadding}
          onContextMenu={(e) => onContextMenu(e, node)}
        >
          <button
            type="button"
            className="inline-flex items-center gap-1 min-w-0 flex-1 text-left"
            onClick={() => setExpanded((value) => !value)}
          >
            {expanded ? (
              <ChevronDown className="size-3.5 shrink-0 opacity-70" />
            ) : (
              <ChevronRight className="size-3.5 shrink-0 opacity-70" />
            )}
            <Folder className="size-3.5 shrink-0 text-amber-500/90" />
            {renaming ? (
              <InlineEditInput
                initialValue={renameInitial}
                onCommit={onInlineCommit}
                onCancel={onInlineCancel}
              />
            ) : (
              <span className="truncate">{node.name}</span>
            )}
          </button>
        </div>
        {expanded ? (
          <div>
            {creatingHere && createKind ? (
              <div
                className="flex items-center gap-2 px-2 py-1"
                style={{ paddingLeft: `${(depth + 1) * 12 + 24}px` }}
              >
                {createKind === 'new-folder' ? (
                  <Folder className="size-3.5 shrink-0 text-amber-500/90" />
                ) : (
                  <FileText className="size-3.5 shrink-0" />
                )}
                <InlineEditInput
                  initialValue={createInitial}
                  onCommit={onInlineCommit}
                  onCancel={onInlineCancel}
                />
              </div>
            ) : null}
            {node.children?.map((child) => (
              <TreeNode
                key={child.path}
                node={child}
                depth={depth + 1}
                activeFilePath={activeFilePath}
                revealPath={revealPath}
                onSelectFile={onSelectFile}
                onContextMenu={onContextMenu}
                renamePath={renamePath}
                renameInitial={renameInitial}
                createParentDir={createParentDir}
                createKind={createKind}
                createInitial={createInitial}
                onInlineCommit={onInlineCommit}
                onInlineCancel={onInlineCancel}
              />
            ))}
          </div>
        ) : null}
      </div>
    )
  }

  return (
    <div
      role="button"
      tabIndex={0}
      className={cn(
        'flex w-full cursor-grab items-center gap-2 rounded-md px-2 py-1 text-left text-sm transition-colors active:cursor-grabbing',
        isActive
          ? 'bg-primary/15 text-primary'
          : 'text-muted-foreground hover:bg-accent/50 hover:text-foreground',
        renaming && 'cursor-default active:cursor-default',
      )}
      style={rowPadding}
      draggable={!renaming}
      title={renaming ? undefined : '拖到 Agent 输入区可附加为引用'}
      onDragStart={(e) => {
        if (renaming) {
          e.preventDefault()
          return
        }
        writeWorkspacePathsToDataTransfer(e.dataTransfer, [node.path])
      }}
      onClick={() => {
        if (!renaming) onSelectFile(node.path)
      }}
      onKeyDown={(e) => {
        if (renaming) return
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          onSelectFile(node.path)
        }
      }}
      onContextMenu={(e) => onContextMenu(e, node)}
    >
      <FileIcon documentKind={node.documentKind} />
      {renaming ? (
        <InlineEditInput
          initialValue={renameInitial}
          onCommit={onInlineCommit}
          onCancel={onInlineCancel}
        />
      ) : (
        <span className="truncate">{node.name}</span>
      )}
    </div>
  )
})

export function FileExplorer({
  workspaceRoot,
  tree,
  activeFilePath,
  webPageUrl,
  recentWebUrls = [],
  onOpenFolder,
  onOpenWebDoc,
  onRescanWorkspace,
  isRescanning = false,
  onSelectFile,
  onHideSidebar,
  treeActions,
  readOnly = false,
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
}: FileExplorerProps) {
  const rootName = workspaceRoot?.split(/[/\\]/).pop() ?? '工作区'
  const webMode = !workspaceRoot && Boolean(webPageUrl)
  const recentOthers = recentWebUrls.filter((url) => url !== webPageUrl)
  const [menu, setMenu] = useState<MenuState>(null)
  const [inlineEdit, setInlineEdit] = useState<InlineEdit>(null)
  const [pinnedReveal, setPinnedReveal] = useState<string | null>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  // latest-ref：保持传给 memo 子树的回调恒稳，App 重渲染不打破 memo
  const inlineEditRef = useRef(inlineEdit)
  const treeActionsRef = useRef(treeActions)
  const workspaceRootRef = useRef(workspaceRoot)
  const onSelectFileRef = useRef(onSelectFile)

  useEffect(() => {
    inlineEditRef.current = inlineEdit
    treeActionsRef.current = treeActions
    workspaceRootRef.current = workspaceRoot
    onSelectFileRef.current = onSelectFile
  })

  useEffect(() => {
    if (!menu) return
    const close = (event: MouseEvent) => {
      if (menuRef.current?.contains(event.target as Node)) return
      setMenu(null)
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMenu(null)
    }
    window.addEventListener('mousedown', close)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('mousedown', close)
      window.removeEventListener('keydown', onKey)
    }
  }, [menu])

  const openMenu = useCallback((event: ReactMouseEvent, target: FileTreeNode | 'root') => {
    event.preventDefault()
    event.stopPropagation()
    setMenu({ x: event.clientX, y: event.clientY, target })
  }, [])

  const handleSelectFile = useCallback((path: string) => {
    onSelectFileRef.current(path)
  }, [])

  const beginRename = (node: FileTreeNode) => {
    setInlineEdit({ mode: 'rename', path: node.path, initial: node.name })
    setMenu(null)
  }

  const beginNew = (mode: 'new-file' | 'new-folder', parentDir: string) => {
    if (!treeActions || !workspaceRoot) return
    const value =
      mode === 'new-file'
        ? treeActions.defaultNewFileName(parentDir)
        : treeActions.defaultNewFolderName(parentDir)
    setPinnedReveal(parentDir)
    setInlineEdit({ mode, parentDir, initial: value })
    setMenu(null)
  }

  const handleInlineCancel = useCallback(() => {
    setInlineEdit(null)
    setPinnedReveal(null)
  }, [])

  const handleInlineCommit = useCallback((rawValue: string) => {
    const current = inlineEditRef.current
    const actions = treeActionsRef.current
    const root = workspaceRootRef.current
    if (!current || !actions || !root) {
      setInlineEdit(null)
      setPinnedReveal(null)
      return
    }
    const value = rawValue.trim()
    if (!value) {
      setInlineEdit(null)
      setPinnedReveal(null)
      return
    }
    // 先收起输入框再发 IPC：感知更快；失败 toast 仍由 actions 内上报
    setInlineEdit(null)
    setPinnedReveal(null)
    if (current.mode === 'rename') {
      void actions.rename(current.path, value)
    } else if (current.mode === 'new-file') {
      void actions.createFile(current.parentDir, value)
    } else {
      void actions.createFolder(current.parentDir, value)
    }
  }, [])

  const rootCreating =
    inlineEdit &&
    (inlineEdit.mode === 'new-file' || inlineEdit.mode === 'new-folder') &&
    workspaceRoot &&
    inlineEdit.parentDir === workspaceRoot

  // 传给 memo 子树的全是原始值：键入时 descriptor 不变，子树不重渲染
  const renamePath = inlineEdit?.mode === 'rename' ? inlineEdit.path : null
  const renameInitial = inlineEdit?.mode === 'rename' ? inlineEdit.initial : ''
  const createParentDir = inlineEdit && inlineEdit.mode !== 'rename' ? inlineEdit.parentDir : null
  const createKind = inlineEdit && inlineEdit.mode !== 'rename' ? inlineEdit.mode : null
  const createInitial = inlineEdit && inlineEdit.mode !== 'rename' ? inlineEdit.initial : ''

  const menuTarget = menu?.target
  const nodeTarget = menuTarget && menuTarget !== 'root' ? menuTarget : null
  const canPaste = Boolean(treeActions?.clipboard)

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden">
      <div className="flex shrink-0 items-center justify-between border-b border-border/60 px-3 py-2.5">
        <div className="flex min-w-0 items-center gap-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          {webMode ? <Globe className="size-3.5 shrink-0" /> : <FolderOpen className="size-3.5 shrink-0" />}
          <span className="truncate">{webMode ? '在线文档' : '资源管理器'}</span>
        </div>
        <div className="flex items-center gap-1">
          {onHideSidebar ? (
            <Button
              variant="ghost"
              size="sm"
              className="h-7 px-2 text-xs text-muted-foreground"
              onClick={onHideSidebar}
              title="隐藏侧栏 (Ctrl+B)"
              aria-label="隐藏侧栏"
            >
              <PanelLeftClose className="size-3.5" />
            </Button>
          ) : null}
          <FileExplorerOverflowMenu
            canWrite={Boolean(workspaceRoot && treeActions)}
            readOnly={readOnly}
            isRescanning={isRescanning}
            onNewFile={() => workspaceRoot && beginNew('new-file', workspaceRoot)}
            onNewFolder={() => workspaceRoot && beginNew('new-folder', workspaceRoot)}
            onOpenFile={onOpenFile ?? (() => undefined)}
            onOpenFolder={onOpenFolder}
            onQuickOpen={onQuickOpen}
            onRescanWorkspace={onRescanWorkspace}
            onNewWindow={onNewWindow ?? (() => undefined)}
            onSave={onSave ?? (() => undefined)}
            onSaveAs={onSaveAs ?? (() => undefined)}
            onExportHtml={onExportHtml ?? (() => undefined)}
            onExportPdf={onExportPdf ?? (() => undefined)}
            onOpenSettings={onOpenSettings ?? (() => undefined)}
            onOpenErrorLog={onOpenErrorLog ?? (() => undefined)}
            onOpenDevTools={onOpenDevTools ?? (() => undefined)}
            onAbout={onAbout ?? (() => undefined)}
            onQuit={onQuit ?? (() => undefined)}
          />
        </div>
      </div>

      <div
        className="min-h-0 flex-1 overflow-auto"
        onContextMenu={(e) => {
          if (!workspaceRoot) return
          openMenu(e, 'root')
        }}
      >
        {!workspaceRoot ? (
          webMode && webPageUrl ? (
            <div className="space-y-3 p-2">
              <div>
                <p className="mb-1 px-2 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                  当前页
                </p>
                <button
                  type="button"
                  className={cn(
                    'flex w-full items-start gap-2 rounded-md px-2 py-1.5 text-left text-xs',
                    'bg-accent/60 text-accent-foreground',
                  )}
                  title={webPageUrl}
                  onClick={() => onOpenWebDoc?.(webPageUrl)}
                >
                  <Globe className="mt-0.5 size-3.5 shrink-0 opacity-80" />
                  <span className="min-w-0 break-all leading-snug">{formatWebDocLabel(webPageUrl)}</span>
                </button>
              </div>
              {recentOthers.length > 0 ? (
                <div>
                  <p className="mb-1 px-2 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                    最近打开
                  </p>
                  <ul className="space-y-0.5">
                    {recentOthers.map((url) => (
                      <li key={url}>
                        <button
                          type="button"
                          className="flex w-full items-start gap-2 rounded-md px-2 py-1.5 text-left text-xs text-muted-foreground hover:bg-accent/40 hover:text-foreground"
                          title={url}
                          onClick={() => onOpenWebDoc?.(url)}
                        >
                          <Globe className="mt-0.5 size-3.5 shrink-0 opacity-60" />
                          <span className="min-w-0 break-all leading-snug">{formatWebDocLabel(url)}</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
              <div className="border-t border-border/50 px-2 pt-3">
                <p className="mb-2 text-[11px] text-muted-foreground">
                  也可打开本地文件夹浏览 Markdown / 电子书
                </p>
                <Button size="sm" variant="outline" className="w-full" onClick={onOpenFolder}>
                  打开文件夹
                </Button>
              </div>
            </div>
          ) : (
            <div className="flex flex-col items-center gap-3 px-4 py-10 text-center">
              <FolderOpen className="size-10 text-muted-foreground/40" />
              <p className="text-sm text-muted-foreground">打开文件夹以浏览 Markdown 与电子书</p>
              <Button size="sm" onClick={onOpenFolder}>
                打开文件夹
              </Button>
            </div>
          )
        ) : (
          <div className="space-y-0.5 p-2">
            <div
              className="mb-2 truncate px-2 text-xs font-medium text-foreground/80"
              onContextMenu={(e) => openMenu(e, 'root')}
            >
              {rootName}
            </div>
            {rootCreating && createKind ? (
              <div className="mb-1 flex items-center gap-2 px-2 py-1" style={{ paddingLeft: 24 }}>
                {createKind === 'new-folder' ? (
                  <Folder className="size-3.5 shrink-0 text-amber-500/90" />
                ) : (
                  <FileText className="size-3.5 shrink-0" />
                )}
                <InlineEditInput
                  initialValue={createInitial}
                  onCommit={handleInlineCommit}
                  onCancel={handleInlineCancel}
                />
              </div>
            ) : null}
            {tree.length === 0 && !rootCreating ? (
              <p className="px-2 py-4 text-xs text-muted-foreground">
                此文件夹中没有支持的文档
                <br />
                <span className="text-[11px] opacity-80">
                  支持：{SUPPORTED_WORKSPACE_EXTENSION_LABEL}
                </span>
              </p>
            ) : (
              tree.map((node) => (
                <TreeNode
                  key={node.path}
                  node={node}
                  depth={0}
                  activeFilePath={activeFilePath}
                  revealPath={pinnedReveal}
                  onSelectFile={handleSelectFile}
                  onContextMenu={openMenu}
                  renamePath={renamePath}
                  renameInitial={renameInitial}
                  createParentDir={createParentDir}
                  createKind={createKind}
                  createInitial={createInitial}
                  onInlineCommit={handleInlineCommit}
                  onInlineCancel={handleInlineCancel}
                />
              ))
            )}
          </div>
        )}
      </div>

      {workspaceRoot && onOpenWebDoc ? (
        <WebDocSidebarPanel onOpenWebDoc={onOpenWebDoc} recentWebUrls={recentWebUrls} />
      ) : null}

      {menu && treeActions && workspaceRoot ? (
        <div
          ref={menuRef}
          className="fixed z-50 min-w-44 rounded-md border border-border/80 bg-popover p-1 text-popover-foreground shadow-md"
          style={{ left: menu.x, top: menu.y }}
          role="menu"
        >
          {menuTarget === 'root' || !nodeTarget ? (
            <>
              <MenuItem
                label="新建文件"
                onClick={() => beginNew('new-file', workspaceRoot)}
              />
              <MenuItem
                label="新建文件夹"
                onClick={() => beginNew('new-folder', workspaceRoot)}
              />
              <MenuSeparator />
              <MenuItem
                label="粘贴"
                disabled={!canPaste}
                onClick={() => {
                  setMenu(null)
                  void treeActions.pasteInto('root')
                }}
              />
              <MenuSeparator />
              <MenuItem
                label="复制完整路径"
                onClick={() => {
                  setMenu(null)
                  void treeActions.copyFullPath(workspaceRoot)
                }}
              />
              <MenuItem
                label="在资源管理器中刷新"
                onClick={() => {
                  setMenu(null)
                  onRescanWorkspace?.()
                }}
              />
            </>
          ) : (
            <>
              <MenuItem
                label="新建文件"
                onClick={() => {
                  const parent =
                    nodeTarget.type === 'directory'
                      ? nodeTarget.path
                      : getParentDir(nodeTarget.path)
                  beginNew('new-file', parent)
                }}
              />
              <MenuItem
                label="新建文件夹"
                onClick={() => {
                  const parent =
                    nodeTarget.type === 'directory'
                      ? nodeTarget.path
                      : getParentDir(nodeTarget.path)
                  beginNew('new-folder', parent)
                }}
              />
              <MenuSeparator />
              <MenuItem
                label="剪切"
                onClick={() => {
                  treeActions.setCut(nodeTarget)
                  setMenu(null)
                }}
              />
              <MenuItem
                label="复制"
                onClick={() => {
                  treeActions.setCopy(nodeTarget)
                  setMenu(null)
                }}
              />
              <MenuItem
                label="粘贴"
                disabled={!canPaste}
                onClick={() => {
                  setMenu(null)
                  void treeActions.pasteInto(nodeTarget)
                }}
              />
              <MenuSeparator />
              <MenuItem label="重命名" onClick={() => beginRename(nodeTarget)} />
              <MenuItem
                label="删除"
                danger
                onClick={() => {
                  setMenu(null)
                  void treeActions.remove(nodeTarget)
                }}
              />
              <MenuSeparator />
              <MenuItem
                label="复制完整路径"
                onClick={() => {
                  setMenu(null)
                  void treeActions.copyFullPath(nodeTarget.path)
                }}
              />
              <MenuItem
                label="复制相对路径"
                onClick={() => {
                  setMenu(null)
                  void treeActions.copyRelativePath(nodeTarget.path)
                }}
              />
              {nodeTarget.type === 'file' && isMarkdownPath(nodeTarget.path) ? (
                <>
                  <MenuSeparator />
                  <MenuItem
                    label="导出为 PDF"
                    onClick={() => {
                      setMenu(null)
                      void treeActions.exportMarkdownPdf(nodeTarget.path)
                    }}
                  />
                </>
              ) : null}
            </>
          )}
        </div>
      ) : null}
    </div>
  )
}
