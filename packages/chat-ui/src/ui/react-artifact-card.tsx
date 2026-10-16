// 自 `apps/desktop/src/components/agent/generative/ReactArtifactCard.tsx` 整搬（M3d present 批，props-ify）：
// 解耦仅两处：`compileReactArtifact（主进程 Sucrase）→onCompile` 回调 prop（`Result<string,AppError>` 原样透传，
// 宿主直接传 `compileReactArtifact`，编译器不进包）、`fileApi.exportHtml+toast→onExport(html,title)` 回调 prop
// （宿主默认实现含合法文件名+toast，取消静默；包内只调回调）。`Button` 改 `./button`，`result-card` 改
// `./result-card`，`cn` 改 `./cn`，`ArtifactFrame` 改 `./artifact-frame`，`ArtifactZoomSurface` 改
// `./artifact-zoom-surface`，`sanitizeArtifactFileName` 改 `./html-artifact-card`（同包，包内如需文件名宿主亦可复用），
// `isToolActiveStatus` 改 `@montree/chat-core`，`BeuiAgentProgress` 改 `./BeuiAgentProgress`，
// `GenerativeSubmitPayload` 改 `./component-ui-card`；余逐字。
import { useEffect, useMemo, useRef, useState } from 'react'
import { ArtifactZoomSurface } from './artifact-zoom-surface'
import { BeuiAgentProgress } from './BeuiAgentProgress'
import { Code2, Download, RotateCcw } from 'lucide-react'
import { Button } from './button'
import { ArtifactFrame, newArtifactMountId } from './artifact-frame'
import {
  RESULT_CARD_HEADER,
  RESULT_CARD_ICON,
  RESULT_CARD_SUMMARY,
  resultCardClassName,
} from './result-card'
import { REACT_ARTIFACT_MOUNT_TOKEN, type PresentReactArtifact, type AppError, type Result } from '@montree/contracts'
import { isToolActiveStatus } from '@montree/chat-core'
import { cn } from './cn'
import type { GenerativeSubmitPayload } from './component-ui-card'

/** 内联内容区：初始预留高度与上限（px），超高走 iframe 内部滚动 */
export const REACT_INLINE_INITIAL_HEIGHT = 320
export const REACT_INLINE_MAX_HEIGHT = 640
/** 加载等待上限：超时只报失败，不声称能中止框内循环 */
export const REACT_INLINE_LOADING_TIMEOUT_MS = 30_000

/** 本渲染会话已完成编译的结果 id：再次挂载走“恢复”而非“编译” */
const compiledResultIds = new Set<string>()

export type ReactBuildStatus =
  | 'building'
  | 'compiling'
  | 'restoring'
  | 'loading'
  | 'ready'
  | 'compile-error'
  | 'runtime-error'

interface ReactArtifactCardProps {
  result: PresentReactArtifact
  threadId?: string
  prompting?: boolean
  onSubmit?: (payload: GenerativeSubmitPayload) => void | Promise<void>
  /** 工具消息（仅读 streaming/toolStatus，用于区分“构建中”与“编译中”） */
  toolStreaming?: boolean
  toolStatus?: string
  /**
   * 编译回调（宿主 `compileReactArtifact(source,css)` 直传，主进程 Sucrase，不进包；
   * `Result` 原样透传，`ok` 进编译成功、`err.message` 进卡内编译失败）。
   */
  onCompile?: (source: string, css?: string) => Promise<Result<string, AppError>>
  /**
   * 导出回调（宿主实现原 `fileApi.exportHtml+toast`：含合法文件名、成功 toast、取消静默；
   * 包内只调回调，不碰 IPC/文件）。
   */
  onExport?: (html: string, title: string) => void
}

const STATUS_COPY: Record<Extract<ReactBuildStatus, 'building' | 'compiling' | 'restoring' | 'loading'>, string> = {
  building: '正在构建交互界面…',
  compiling: '正在编译交互界面…',
  restoring: '正在恢复交互界面…',
  loading: '正在加载交互界面…',
}

/**
 * React artifact 内联卡（I1–I3）：同一张卡从构建状态切换到可交互 iframe，
 * 不另发完成消息，不要求先打开弹窗。iframe 节点按 result.id + mountId 稳定，
 * 只有真实源码变化或用户重跑才重启；ready 仅代表 React 首次 commit。
 */
export function ReactArtifactCard({ result, threadId, prompting, onSubmit, toolStreaming, toolStatus, onCompile, onExport }: ReactArtifactCardProps) {
  const [compiledHtml, setCompiledHtml] = useState<string | null>(null)
  const [compileError, setCompileError] = useState<string | null>(null)
  const [frameError, setFrameError] = useState<string | null>(null)
  const [reactCommitted, setReactCommitted] = useState(false)
  const [showSource, setShowSource] = useState(false)
  const [compileAttempt, setCompileAttempt] = useState(0)
  const [rerunNonce, setRerunNonce] = useState(0)
  // 同挂载失败标记：晚到的 react-ready 不得覆盖已落失败
  const failedRef = useRef(false)
  const [draft, setDraft] = useState<{ kind: 'analysis' | 'repair'; text: string } | null>(null)
  const draftRef = useRef(draft)
  const sendingRef = useRef(false)
  const [sending, setSending] = useState(false)
  const [sendError, setSendError] = useState<string | null>(null)
  const offerDraft = (value: NonNullable<typeof draft>) => {
    if (draftRef.current || sendingRef.current) return
    draftRef.current = value
    setDraft(value)
    setSendError(null)
  }
  const clearDraft = () => { draftRef.current = null; setDraft(null) }

  // 挂载 ID 归本次源码+重跑：展开源码/宿主更新/消息追加不碰它
  const mountId = useMemo(
    () => newArtifactMountId(),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [result.id, result.source, result.css, rerunNonce],
  )

  const toolRunning =
    toolStreaming === true || (toolStatus !== undefined && isToolActiveStatus(toolStatus))

  useEffect(() => {
    clearDraft()
    setSendError(null)
  }, [mountId])

  const confirmSubmit = async () => {
    const request = draftRef.current
    if (!request || prompting || sendingRef.current || !threadId || !onSubmit) return
    sendingRef.current = true
    setSending(true)
    setSendError(null)
    const displayText = request.kind === 'repair' ? `请修复「${result.title}」交互界面：${request.text}` : `来自「${result.title}」的请求：${request.text}`
    const promptText = request.kind === 'repair'
      ? `[react-artifact-repair resultId=${result.id}]\n用户请求修复该交互界面，请修正后重新调用 montree_present(kind="react-artifact")。\n${JSON.stringify({ error: request.text, source: result.source, css: result.css })}`
      : `[react-artifact-submit resultId=${result.id}]\n用户已确认界面「${result.title}」的请求：\n${request.text}\n请在当前会话继续分析。`
    try {
      await onSubmit({ resultId: result.id, threadId, title: result.title, selections: { request: request.text }, displayText, promptText })
      if (draftRef.current === request) clearDraft()
    } catch { setSendError('发送失败，请重试') }
    finally { sendingRef.current = false; setSending(false) }
  }

  useEffect(() => {
    let cancelled = false
    setCompiledHtml(null)
    setCompileError(null)
    setFrameError(null)
    setReactCommitted(false)
    failedRef.current = false
    if (!onCompile) {
      setCompileError('编译器未注入（宿主需传入 onCompile）')
      return () => {
        cancelled = true
      }
    }
    void onCompile(result.source, result.css).then((response) => {
      if (cancelled) return
      if (response.ok) {
        compiledResultIds.add(result.id)
        setCompiledHtml(response.value)
      } else {
        setCompileError(response.error.message)
      }
    }).catch(() => {
      if (!cancelled) setCompileError('编译请求失败')
    })
    return () => {
      cancelled = true
    }
  }, [result.id, result.source, result.css, compileAttempt, onCompile])

  const status: ReactBuildStatus = compiledHtml == null
    ? compileError != null
      ? 'compile-error'
      : toolRunning
        ? 'building'
        : compiledResultIds.has(result.id)
          ? 'restoring'
          : 'compiling'
    : frameError != null
      ? 'runtime-error'
      : reactCommitted
        ? 'ready'
        : 'loading'

  // 加载超时：只报失败（不声称中止框内循环）；卸载/重跑清理
  useEffect(() => {
    if (status !== 'loading') return
    const timer = window.setTimeout(() => {
      if (failedRef.current) return
      failedRef.current = true
      setFrameError('加载超时（30 秒未收到渲染确认），可重新运行')
    }, REACT_INLINE_LOADING_TIMEOUT_MS)
    return () => window.clearTimeout(timer)
  }, [status, mountId])

  // 挂载占位替换：同 mountId 绑定渲染确认；导出文件保留占位亦无害
  const displayHtml = useMemo(() => {
    if (compiledHtml == null) return null
    return compiledHtml.split(`"${REACT_ARTIFACT_MOUNT_TOKEN}"`).join(JSON.stringify(mountId))
  }, [compiledHtml, mountId])

  const handleExport = () => {
    if (displayHtml == null) return
    onExport?.(displayHtml, result.title)
  }

  const showFrame = displayHtml != null && (status === 'loading' || status === 'ready' || (status === 'runtime-error' && reactCommitted))

  return (
    <div
      className={cn('@container', resultCardClassName())}
      data-testid="react-artifact-card"
      data-present-id={result.id}
      data-build-status={status}
    >
      <div className={RESULT_CARD_HEADER}>
        <div className="flex min-w-0 items-center gap-2">
          <div className={RESULT_CARD_ICON}>
            <Code2 className="size-3.5" />
          </div>
          <div className="min-w-0 flex-1">
            <h4 className="truncate text-xs font-semibold tracking-tight text-foreground">
              React · {result.title}
            </h4>
            <p className={RESULT_CARD_SUMMARY}>
              {result.summary ?? '交互界面（隔离运行，无网络/文件访问）'}
            </p>
          </div>
        </div>
      </div>

      {status === 'ready' ? (
        <p role="status" className="min-h-8 px-3 py-2 text-[11px] text-muted-foreground">
          交互界面已就绪
        </p>
      ) : status === 'building' || status === 'compiling' || status === 'restoring' || status === 'loading' ? (
        <div className="px-3 py-1" data-testid="react-artifact-loading">
          <BeuiAgentProgress label={STATUS_COPY[status]} elapsedSeconds={null} />
        </div>
      ) : null}
      {status === 'compile-error' ? (
        <div role="alert" className="space-y-1.5 px-3 py-2">
          <p className="text-[11px] text-destructive">编译失败：{compileError}</p>
          <Button type="button" size="sm" variant="outline" className="h-7 px-2.5 text-[11px]" onClick={() => setCompileAttempt((n) => n + 1)}>
            <RotateCcw className="size-3.5" />
            重试
          </Button>
        </div>
      ) : null}
      {status === 'runtime-error' && !reactCommitted ? (
        <div role="alert" className="space-y-1.5 px-3 py-2">
          <p className="text-[11px] text-destructive">运行失败：{frameError}</p>
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="h-7 px-2.5 text-[11px]"
            onClick={() => {
              failedRef.current = false
              setFrameError(null)
              setRerunNonce((n) => n + 1)
            }}
          >
            <RotateCcw className="size-3.5" />
            重新运行
          </Button>
        </div>
      ) : null}

      {showFrame && displayHtml != null ? (
        <div className="px-2 pb-1">
          <ArtifactZoomSurface title={result.title}>
            <ArtifactFrame
              key={`${result.id}-${mountId}`}
              title={`${result.title}（交互预览）`}
              html={displayHtml}
              mountId={mountId}
              allowRequests
              initialHeight={REACT_INLINE_INITIAL_HEIGHT}
              maxHeight={REACT_INLINE_MAX_HEIGHT}
              frameTestId="react-inline-frame"
              className={cn('w-full border-0 bg-transparent transition-opacity motion-reduce:transition-none', status === 'loading' && 'pointer-events-none')}
              onBridgeMessage={(message) => {
                if (message.kind === 'react-ready') {
                  // 失败优先：同挂载已落失败不被晚到确认覆盖；卸载后不更新
                  if (failedRef.current) return
                  setReactCommitted(true)
                } else if (message.kind === 'error') {
                  if (failedRef.current) return
                  failedRef.current = true
                  setFrameError(message.message)
                } else if (message.kind === 'analysis-request') {
                  offerDraft({ kind: 'analysis', text: message.text })
                }
              }}
            />
          </ArtifactZoomSurface>
          {status === 'runtime-error' && reactCommitted ? (
            <p className="flex items-center gap-1.5 px-1 pt-1 text-[11px] text-destructive" data-testid="react-frame-error">
              运行报错：{frameError}
            </p>
          ) : null}
        </div>
      ) : null}

      <div className="flex flex-wrap gap-1.5 p-2">
        {compileError || frameError ? <Button type="button" size="sm" variant="outline" disabled={Boolean(prompting) || sending || Boolean(draft) || !onSubmit} onClick={() => offerDraft({ kind: 'repair', text: compileError ?? frameError! })}>请求 Agent 修复</Button> : null}
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="h-7 px-2.5 text-[11px]"
          aria-expanded={showSource}
          onClick={() => setShowSource((v) => !v)}
        >
          <Code2 className="size-3.5" />
          {showSource ? '收起源码' : '查看源码'}
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="h-7 px-2.5 text-[11px]"
          disabled={displayHtml == null}
          onClick={() => void handleExport()}
        >
          <Download className="size-3.5" />
          导出 HTML
        </Button>
        {(status === 'ready' || status === 'runtime-error') && reactCommitted ? (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="h-7 px-2.5 text-[11px]"
            title="以当前源码重启预览（页面状态重置）"
            onClick={() => {
              failedRef.current = false
              setFrameError(null)
              setReactCommitted(false)
              setRerunNonce((n) => n + 1)
            }}
          >
            <RotateCcw className="size-3.5" />
            重新运行
          </Button>
        ) : null}
      </div>
      {draft ? <div data-testid="artifact-request-confirmation" className="m-2 space-y-2 rounded-lg border bg-muted/20 p-3 text-xs">
        <p className="font-medium">{draft.kind === 'repair' ? '待发送的修复请求' : '界面请求继续分析'}</p>
        <p className="whitespace-pre-wrap break-words [overflow-wrap:anywhere]">{draft.text}</p>
        <div className="flex flex-wrap gap-2">
          <Button type="button" size="sm" disabled={Boolean(prompting) || sending || !onSubmit || !threadId || (draft.kind === 'analysis' && status !== 'ready')} onClick={() => { void confirmSubmit() }}>{sending ? '正在处理…' : '确认发送给 Agent'}</Button>
          <Button type="button" size="sm" variant="outline" disabled={sending} onClick={clearDraft}>取消</Button>
        </div>
        {sendError ? <p role="alert" className="text-destructive">{sendError}</p> : null}
      </div> : null}
      {showSource ? (
        <div className="px-2 pb-2">
          <pre
            className="max-h-48 max-w-full overflow-auto whitespace-pre-wrap break-all font-mono text-[10px] leading-relaxed text-muted-foreground [overflow-wrap:anywhere]"
            data-testid="react-artifact-source"
          >
            {result.source}
          </pre>
        </div>
      ) : null}
    </div>
  )
}
