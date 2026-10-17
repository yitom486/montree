import { useEffect, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Download, RefreshCw, Settings2, WrapText } from 'lucide-react'
import { useGroupRef } from 'react-resizable-panels'
import { toast } from 'sonner'
import type { TypstConfig } from '@montree/contracts'
import { typstApi } from '@/api/typst-api'
import { queryKeys } from '@/api/query-keys'
import { useTypstSession } from '@/hooks/editor/useTypstSession'
import { safeTypstPreviewUrl, typstProjectRoot } from '@/lib/editor/typst-lsp'
import type { TextDocument } from '@/lib/editor/text-document'
import { useEditorUiStore, type EditorViewMode } from '@/stores/editor-ui-store'
import { useAppSettingsStore } from '@/stores/app-settings-store'
import { useWorkspaceStore } from '@/stores/workspace-store'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from '@/components/ui/resizable'
import { TypstEditor, type TypstEditorHandle } from './TypstEditor'

interface TypstWorkspaceProps {
  filePath: string
  content: string
  onContentChange: (value: string) => void
  textDocument?: TextDocument
  workspaceRoot?: string
  viewMode?: EditorViewMode
  onOpenFile?: (path: string, line?: number, character?: number) => void
}
const defaultConfig: TypstConfig = { executablePath: '', fontPaths: [], systemFonts: true, entryPath: '' }

export function TypstWorkspace({ filePath, content, onContentChange, textDocument, workspaceRoot, viewMode = 'split', onOpenFile }: TypstWorkspaceProps) {
  const theme = useEditorUiStore((state) => state.theme)
  const fontSize = useAppSettingsStore((state) => state.editorFontSize)
  const tabSize = useAppSettingsStore((state) => state.tabSize)
  const remote = useWorkspaceStore((state) => !!state.descriptor && state.descriptor.kind !== 'local')
  const queryClient = useQueryClient()
  const editorRef = useRef<TypstEditorHandle>(null)
  const groupRef = useGroupRef()
  const previousModeRef = useRef(viewMode)
  const splitLayoutRef = useRef({ 'typst-source': 50, 'typst-preview': 50 })
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [draft, setDraft] = useState<TypstConfig>(defaultConfig)
  const [actionError, setActionError] = useState<string | null>(null)
  const [exporting, setExporting] = useState(false)
  const configKey = queryKeys.typstConfig(filePath)
  const configQuery = useQuery({ queryKey: configKey, enabled: !remote, retry: false,
    queryFn: async () => {
      const result = await typstApi.getConfig(filePath)
      if (!result.ok) throw new Error(result.error.message)
      return result.value
    } })
  const statusQuery = useQuery({ queryKey: queryKeys.typstStatus, enabled: !remote && settingsOpen, retry: false,
    queryFn: async () => {
      const result = await typstApi.status()
      if (!result.ok) throw new Error(result.error.message)
      return result.value
    } })
  const projectRoot = typstProjectRoot(filePath, workspaceRoot)
  const session = useTypstSession(filePath, content, projectRoot, !remote && configQuery.isSuccess)
  const previewUrl = safeTypstPreviewUrl(session.session?.previewUrl)
  const hasCompileErrors = session.diagnostics.some((diagnostic) => diagnostic.severity === 1)
  const saveConfig = useMutation({
    mutationFn: async (input: { config: TypstConfig; filePath: string }) => {
      const result = await typstApi.saveConfig(input.config, input.filePath)
      if (!result.ok) throw new Error(result.error.message)
      return result.value
    },
    onSuccess: (config, input) => {
      queryClient.setQueryData(queryKeys.typstConfig(input.filePath), config)
      void queryClient.invalidateQueries({ queryKey: queryKeys.typstConfigPrefix })
      void queryClient.invalidateQueries({ queryKey: queryKeys.typstStatus })
      if (input.filePath === filePath) { setSettingsOpen(false); setActionError(null); session.restart() }
    },
  })
  useEffect(() => {
    if (settingsOpen && configQuery.data) { setDraft(configQuery.data); saveConfig.reset() }
  }, [settingsOpen, configQuery.data])
  useEffect(() => { setActionError(null); setSettingsOpen(false) }, [filePath])
  useEffect(() => {
    const group = groupRef.current
    if (!group) return
    if (previousModeRef.current === 'split' && viewMode !== 'split') {
      const layout = group.getLayout()
      if (layout['typst-source'] > 0 && layout['typst-preview'] > 0) splitLayoutRef.current = {
        'typst-source': layout['typst-source'], 'typst-preview': layout['typst-preview'],
      }
    }
    group.setLayout(viewMode === 'split' ? splitLayoutRef.current : {
      'typst-source': viewMode === 'editor' ? 100 : 0, 'typst-preview': viewMode === 'preview' ? 100 : 0,
    })
    previousModeRef.current = viewMode
  }, [groupRef, viewMode])

  const error = actionError ?? session.message ?? session.session?.previewError ?? configQuery.error?.message ??
    (session.session?.previewUrl && !previewUrl ? 'Typst 返回了无法使用的预览地址，请重启服务。' : null)
  const status = remote ? '远程工作区暂不支持 Typst 编译与提示' : session.phase === 'starting' ? '正在启动 Typst…' : session.phase === 'syncing' ? '正在同步修改，预览可能尚未更新…' : session.phase === 'error' ? 'Typst 服务不可用' : hasCompileErrors || session.compileStatus === 'compileError' ? '最近一次编译有错误，显示最近成功的预览' : session.compileStatus === 'compiling' ? '正在排版，预览显示最近结果…' : session.compileStatus === 'compileSuccess' ? '最近一次排版已完成' : 'Typst 编辑服务已连接'
  const exportPdf = async () => {
    setExporting(true); setActionError(null)
    try {
      const result = await session.exportPdf()
      if (result) toast.success(`PDF 已导出：${result.filePath}`)
    } catch (error) { setActionError(error instanceof Error ? error.message : String(error)) }
    finally { setExporting(false) }
  }

  return <section className="flex h-full min-h-0 min-w-0 flex-col" aria-label="Typst 工作区" data-testid="typst-workspace">
    <div className="flex min-h-10 flex-wrap items-center gap-1 border-b bg-background px-2 py-1">
      <span className="mr-auto px-2 text-xs text-muted-foreground" role="status" aria-live="polite">{status}</span>
      <Button size="sm" variant="ghost" disabled={!session.session?.capabilities.documentFormattingProvider || remote || session.phase === 'error'} onClick={() => {
        void editorRef.current?.format().catch((error: unknown) => setActionError(error instanceof Error ? error.message : String(error)))
      }} title="格式化 Typst（Ctrl/Cmd+Shift+F）"><WrapText aria-hidden="true" />格式化</Button>
      <Button size="sm" variant="ghost" disabled={remote} onClick={() => { setActionError(null); session.restart(); void configQuery.refetch() }}><RefreshCw aria-hidden="true" />重启服务</Button>
      <Button size="sm" variant="ghost" disabled={remote} onClick={() => setSettingsOpen(true)}><Settings2 aria-hidden="true" />Typst 配置</Button>
      <Button size="sm" variant="outline" disabled={!session.session || remote || exporting || session.phase === 'error'} onClick={() => void exportPdf()}><Download aria-hidden="true" />{exporting ? '正在导出…' : '导出 PDF'}</Button>
    </div>
    {error && <div className="border-b bg-destructive/10 px-4 py-2 text-sm text-destructive" role="alert">{error}</div>}
    <ResizablePanelGroup groupRef={groupRef} orientation="horizontal" className="min-h-0 flex-1" disabled={viewMode !== 'split'}>
      <ResizablePanel id="typst-source" defaultSize="50%" minSize="15%" collapsible collapsedSize={0} className="min-w-0" aria-hidden={viewMode === 'preview'} inert={viewMode === 'preview'}>
        <TypstEditor ref={editorRef} filePath={filePath} value={content} textDocument={textDocument}
          uri={remote ? null : session.session?.uri ?? null} sessionKey={session.session?.sessionId} capabilities={session.session?.capabilities} diagnostics={session.diagnostics}
          theme={theme} fontSize={fontSize} tabSize={tabSize} request={session.request} onError={setActionError} onOpenFile={onOpenFile}
          onChange={(value) => { session.updateContent(value); onContentChange(value) }} />
      </ResizablePanel>
      <ResizableHandle className={viewMode === 'split' ? '' : 'hidden'} withHandle />
      <ResizablePanel id="typst-preview" defaultSize="50%" minSize="15%" collapsible collapsedSize={0} className="min-w-0 bg-muted/20" aria-hidden={viewMode === 'editor'} inert={viewMode === 'editor'}>
        {previewUrl && !remote ? <div className="flex h-full min-h-0 flex-col"><iframe key={previewUrl} src={previewUrl} title="Typst 实时排版预览" className="min-h-0 w-full flex-1 border-0"
          sandbox="allow-scripts allow-same-origin" referrerPolicy="no-referrer" data-testid="typst-preview"
          onError={() => setActionError('Typst 预览加载失败，请重启服务。')} /><p className="border-t px-3 py-1 text-xs text-muted-foreground" title="点击预览后，使用 Ctrl/Cmd+= 放大、Ctrl/Cmd+- 缩小；Ctrl+滚轮缩放。初始排版自动适应宽度。">预览缩放：Ctrl/Cmd+= / - · Ctrl+滚轮</p></div> :
          <div className="flex h-full items-center justify-center p-8 text-center text-sm text-muted-foreground">
            {remote ? '此文档可以编辑和保存；编译、预览与代码提示需要远端 Typst 运行时。' : error ? '预览暂不可用。请检查 Typst 配置后重启服务。' : '正在准备 Typst 实时预览…'}
          </div>}
      </ResizablePanel>
    </ResizablePanelGroup>
    <Dialog open={settingsOpen} onOpenChange={setSettingsOpen}>
      <DialogContent className="max-h-[85vh] overflow-y-auto">
        <DialogHeader><DialogTitle>Typst 配置</DialogTitle><DialogDescription>字体和运行时供本机文档共用，固定入口仅用于当前文件。保存后重启服务。</DialogDescription></DialogHeader>
        <form className="grid gap-4" onSubmit={(event) => { event.preventDefault(); saveConfig.mutate({ filePath, config: { ...draft, fontPaths: draft.fontPaths.map((path) => path.trim()).filter(Boolean) } }) }}>
          <p className="text-xs text-muted-foreground" role="status">{statusQuery.data?.message ?? statusQuery.error?.message ?? '正在检查运行时…'}{statusQuery.data?.version ? `（${statusQuery.data.version}）` : ''}</p>
          <label className="grid gap-2 text-sm">Tinymist 可执行文件<Input value={draft.executablePath} placeholder="留空使用随应用提供的 Tinymist" onChange={(event) => setDraft({ ...draft, executablePath: event.target.value })} /></label>
          <label className="grid gap-2 text-sm">固定项目入口（可选）<Input value={draft.entryPath} placeholder="留空跟随当前文档" onChange={(event) => setDraft({ ...draft, entryPath: event.target.value })} /><span className="text-xs text-muted-foreground">填写项目根目录内的 .typ 文件路径；当前项目根：{session.session?.rootPath ?? projectRoot ?? '当前文件所在目录'}</span></label>
          <label className="grid gap-2 text-sm">额外字体目录（每行一个）<textarea className="min-h-24 rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" value={draft.fontPaths.join('\n')} onChange={(event) => setDraft({ ...draft, fontPaths: event.target.value.split('\n') })} /></label>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={draft.systemFonts} onChange={(event) => setDraft({ ...draft, systemFonts: event.target.checked })} />使用系统字体</label>
          <p className="text-xs text-muted-foreground">Typst 包首次使用时可能需要联网下载；离线时只能使用已经缓存的包和本机字体。</p>
          {saveConfig.error && <p className="text-sm text-destructive" role="alert">{saveConfig.error.message}</p>}
          <div className="flex justify-end gap-2"><Button type="button" variant="ghost" onClick={() => setSettingsOpen(false)}>取消</Button><Button type="submit" disabled={saveConfig.isPending}>{saveConfig.isPending ? '正在保存…' : '保存并重启'}</Button></div>
        </form>
      </DialogContent>
    </Dialog>
  </section>
}
