import {
  ChevronDown,
  Loader2,
  Settings2,
  Unplug,
  Wifi,
  X,
} from 'lucide-react'
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AgentComposer } from '@/components/agent/AgentComposer'
import { AgentMark } from '@/components/agent/AgentMark'
import { AgentAuthDialog } from '@/components/agent/AgentAuthDialog'
import { AgentProviderDialog } from '@/components/agent/AgentProviderDialog'
import { AgentBunInstallBanner } from '@/components/agent/AgentBunInstallBanner'
import { AgentAgyInstallBanner } from '@/components/agent/AgentAgyInstallBanner'
import { AgentHistoryMenu } from '@/components/agent/AgentHistoryMenu'
import { AgentHeaderOverflowMenu } from '@/components/agent/AgentHeaderOverflowMenu'
import { CompactConfigMenu } from '@/components/agent/CompactConfigMenu'
import { AgentMessageList } from '@/components/agent/chat/AgentMessageList'
import type { ChapterMarkPlanSelectPayload } from '@/components/agent/propose/ChapterMarkPlanCard'
import { Button } from '@/components/ui/button'
import { appendSelectionChatMarker } from '@/lib/agent/context/selection-chat-marker'
import { splitConfigOptions, rankPrimary } from '@/lib/agent/acp-config-menu'
import {
  findListedVariantId,
  listedModelOptionValues,
  pickDashCounterpart,
  selectModelThinkingControl,
  selectReadonlyModelThinking,
  selectSuffixFastState,
} from '@/lib/agent/acp-model-thinking'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { useAcpSession } from '@/hooks/agent/useAcpSession'
import { useHighlightTheme } from '@/hooks/preview/useHighlightTheme'
import { cn } from '@/lib/utils'
import { toast } from 'sonner'
import { useAcpChatShell, useAcpUiStore } from '@/stores/acp-ui-store'
import { useReaderHudUiStore } from '@/stores/acp/reader-hud-store'
import { useEditorUiStore } from '@/stores/editor-ui-store'
import { acpApi } from '@/api/acp-api'
import { isOk } from '@montree/contracts'
import {
  BUILTIN_ACP_RUNTIMES,
  DEFAULT_ACP_RUNTIME_ID,
  findBuiltinAcpRuntime,
} from '@montree/contracts'
import type { AcpConfigOption, AcpProviderStatus, AcpProxySettings } from '@montree/contracts'

interface AgentPanelProps {
  workspaceRoot?: string
  floating?: boolean
  onToggleFloating?: () => void
  onMinimizeToCapsule?: () => void
  /** 嵌入阅读器内框行时限定宽度（如 w-[340px] shrink-0），默认占满父容器 */
  className?: string
}

/**
 * docked 侧栏可见性单一真相源：面板开 + 侧栏态 + 非禅模式。
 * WorkspaceShell 与各阅读器共用，保证两处挂载点互斥、状态一致。
 */
export function useIsDockedAgentVisible(): boolean {
  const panelOpen = useAcpUiStore((s) => s.panelOpen)
  const hudDisplayMode = useAcpUiStore((s) => s.hudDisplayMode)
  const zenMode = useReaderHudUiStore((s) => s.zenMode)
  return panelOpen && hudDisplayMode === 'docked' && !zenMode
}

export const AgentPanel = memo(function AgentPanel({
  workspaceRoot,
  floating = false,
  onToggleFloating,
  onMinimizeToCapsule,
  className,
}: AgentPanelProps) {
  const view = useAcpChatShell()
  const setSelectedRuntimeId = useAcpUiStore((s) => s.setSelectedRuntimeId)
  const setPanelOpen = useAcpUiStore((s) => s.setPanelOpen)
  const setHudDisplayMode = useAcpUiStore((s) => s.setHudDisplayMode)
  const createThread = useAcpUiStore((s) => s.createThread)
  const {
    connect,
    disconnect,
    switchRuntime,
    syncAgentSessionToActiveThread,
    sendPrompt,
    cancel,
    setModel,
    clearMessages,
    authOpen,
    authMethods,
    authBusy,
    authError,
    completeAuth,
    cancelAuth,
  } = useAcpSession(workspaceRoot)
  const [draft, setDraft] = useState('')
  const [authHint, setAuthHint] = useState<string | null>(null)
  const composerInsertNonce = useAcpUiStore((s) => s.composerInsertNonce)
  const bottomRef = useRef<HTMLDivElement>(null)
  const messagesRef = useRef<HTMLDivElement>(null)
  const theme = useEditorUiStore((s) => s.theme)

  useHighlightTheme(theme)

  const selectChapterMarkPlan = useAcpUiStore((s) => s.selectChapterMarkPlan)

  const handleChapterPlanSelect = useCallback(
    (payload: ChapterMarkPlanSelectPayload) => {
      selectChapterMarkPlan(payload.entry.id)
      void sendPrompt({
        text: payload.displayText,
        prompt: [{ type: 'text', text: payload.promptText }],
      })
    },
    [selectChapterMarkPlan, sendPrompt],
  )

  useEffect(() => {
    if (composerInsertNonce === 0) return
    setDraft((prev) => appendSelectionChatMarker(prev))
  }, [composerInsertNonce])

  const { primary, secondary, fastToggle: booleanFastToggle } = useMemo(
    () => splitConfigOptions(view.configOptions),
    [view.configOptions],
  )

  // 无独立思考档时，模型值尾缀自带档位则显示只读徽标（跟随模型切换，不可单独改）
  const readonlyThinking = useMemo(() => selectReadonlyModelThinking(primary), [primary])
  // 尾缀含思考类 key 且同 base listed 候选过滤后≥2 → 只读徽标升级为可设下拉；否则保持只读
  const thinkingControl = useMemo(() => selectModelThinkingControl(primary), [primary])
  // 尾缀含 fast=true|false → 输入栏渲染尾缀版 fast 开关，优先于 boolean 版（两者互斥）
  const suffixFast = useMemo(() => selectSuffixFastState(primary), [primary])
  const fastToggle = suffixFast ? null : booleanFastToggle
  // 保守门槛：尾缀切换只发 listed id。listed 原值取自 Agent 下发的 model options。
  const modelListedValues = useMemo(() => {
    const model = primary.find((o) => rankPrimary(o) === 1)
    return model ? listedModelOptionValues(model) : []
  }, [primary])
  // 横杠 canonical 目录（connect 成功后主进程附带，无则 null=跳过，行为与现状一致）
  const modelCatalog = useAcpUiStore((s) => s.modelCatalogByRuntime[s.selectedRuntimeId] ?? null)
  // dash 匹配用当前模型方括号原值（非字符串即跳过 dash）
  const modelCurrentValue = useMemo(() => {
    const model = primary.find((o) => rankPrimary(o) === 1)
    return typeof model?.currentValue === 'string' ? model.currentValue : null
  }, [primary])
  // fast 开关可用条件：listed 命中即用；未命中时 dash 为最后候补（需目录，否则禁用）
  const suffixFastTarget = suffixFast ? (suffixFast.checked ? 'false' : 'true') : null
  const suffixFastAvailable = useMemo(() => {
    if (!suffixFast || !suffixFastTarget) return false
    if (
      findListedVariantId(
        modelListedValues,
        { base: suffixFast.base, params: suffixFast.params },
        { key: 'fast', value: suffixFastTarget },
      ) != null
    ) {
      return true
    }
    if (!modelCurrentValue || !modelCatalog || modelCatalog.length === 0) return false
    return (
      pickDashCounterpart(modelCatalog, modelCurrentValue, {
        key: 'fast',
        value: suffixFastTarget,
      }) != null
    )
  }, [suffixFast, suffixFastTarget, modelListedValues, modelCurrentValue, modelCatalog])

  // 思考档与 fast 切换只发 listed id：无目标即不发起
  const runtimeName =
    findBuiltinAcpRuntime(view.selectedRuntimeId)?.name ?? view.selectedRuntimeId

  /** Codex 专属能力：本机登录提示 / 自定义 API 仅 codex-acp 运行时可用 */
  const isCodexRuntime = view.selectedRuntimeId === DEFAULT_ACP_RUNTIME_ID

  useEffect(() => {
    let cancelled = false
    if (!isCodexRuntime) {
      // 非 codex 运行时：无本机登录探测/自定义供应商，走中性提示；
      // 具体认证方式由协议 authMethods 弹窗给出（adapter.probeAuth 回落中性）。
      // TODO(下游 adapter 未就绪): claude/gemini/copilot/opencode/cursor-cli/deepseek/agy
      // 专属 probeAuth/getSpawnEnv 落地后，此处按需补各家登录痕迹提示。
      setProviderStatus(null)
      setAuthHint(`当前运行时 ${runtimeName}：连接后按 Agent 指引完成认证`)
      return
    }

    void (async () => {
      const providerResult = await acpApi.getProvider()
      if (cancelled) return
      if (isOk(providerResult) && providerResult.value.configured) {
        setProviderStatus(providerResult.value)
        setAuthHint(
          `已启用自定义 API（${providerResult.value.name ?? '自定义'} · ${
            providerResult.value.model ?? ''
          }），连接时使用该 Key 认证`,
        )
        return
      }
      const result = await acpApi.authPreflight({ runtimeId: view.selectedRuntimeId })
      if (cancelled || !isOk(result)) return
      const p = result.value
      if (p.looksLoggedIn) {
        const via = [
          p.hasAuthFile ? 'auth.json' : null,
          p.hasApiKeyEnv ? '环境变量 API Key' : null,
        ]
          .filter(Boolean)
          .join(' · ')
        setAuthHint(`已检测到本机 Codex 登录（${via}）`)
      } else {
        setAuthHint('未检测到本机 Codex 登录，连接后可能需要 ChatGPT / API Key 认证')
      }
    })()
    return () => {
      cancelled = true
    }
  }, [isCodexRuntime, view.selectedRuntimeId, runtimeName])

  // 代理设置：全局一份，spawn Agent 子进程时注入；保存后需重新连接
  const [proxySettings, setProxySettings] = useState<AcpProxySettings | null>(null)
  useEffect(() => {
    let cancelled = false
    void (async () => {
      const result = await acpApi.getProxySettings()
      if (cancelled) return
      if (isOk(result)) setProxySettings(result.value)
    })()
    return () => {
      cancelled = true
    }
  }, [])

  const updateProxySettings = useCallback(
    (patch: Partial<AcpProxySettings>) => {
      setProxySettings((prev) => {
        const next: AcpProxySettings = {
          enabled: prev?.enabled ?? false,
          host: prev?.host ?? '127.0.0.1',
          port: prev?.port ?? 7897,
          ...patch,
        }
        void acpApi.saveProxySettings(next)
        return next
      })
    },
    [],
  )

  const statusLabel =
    view.status === 'connected'
      ? '已连接'
      : view.status === 'connecting'
        ? '连接中'
        : view.status === 'awaiting_auth'
          ? '待认证'
          : view.status === 'error'
            ? '错误'
            : '未连接'

  const configsDisabled = view.status !== 'connected' || view.prompting

  const handleThinkingSelect = useCallback(
    async (next: string) => {
      if (!thinkingControl || configsDisabled) return
      if (next === thinkingControl.current) return
      // 先走 listed 门槛；未命中时再查 dash 对应（需目录，否则跳过）
      let newId = findListedVariantId(
        modelListedValues,
        { base: thinkingControl.base, params: thinkingControl.params },
        { key: thinkingControl.key, value: next },
      )
      if (!newId && modelCurrentValue && modelCatalog && modelCatalog.length > 0) {
        newId = pickDashCounterpart(modelCatalog, modelCurrentValue, {
          key: thinkingControl.key,
          value: next,
        })
      }
      if (!newId) {
        toast.error('切换配置失败')
        return
      }
      // 同一 setModel 链路：Agent 仍可能拒收 dash id，由单 toast 兜底（旧值保持即回滚）
      const ok = await setModel(thinkingControl.configId, newId)
      if (!ok) {
        toast.error('切换配置失败')
      }
    },
    [thinkingControl, configsDisabled, setModel, modelListedValues, modelCurrentValue, modelCatalog],
  )

  const handleSuffixFastChange = useCallback(
    async (checked: boolean) => {
      if (!suffixFast || configsDisabled) return
      if (checked === suffixFast.checked) return
      // 先走 listed 门槛；未命中时再查 dash 对应（需目录，否则跳过）
      let newId = findListedVariantId(
        modelListedValues,
        { base: suffixFast.base, params: suffixFast.params },
        { key: 'fast', value: checked ? 'true' : 'false' },
      )
      if (!newId && modelCurrentValue && modelCatalog && modelCatalog.length > 0) {
        newId = pickDashCounterpart(modelCatalog, modelCurrentValue, {
          key: 'fast',
          value: checked ? 'true' : 'false',
        })
      }
      if (!newId) {
        toast.error('切换配置失败')
        return
      }
      // 同一 setModel 链路：Agent 仍可能拒收 dash id，由单 toast 兜底（旧值保持即回滚）
      const ok = await setModel(suffixFast.configId, newId)
      if (!ok) {
        toast.error('切换配置失败')
      }
    },
    [suffixFast, configsDisabled, setModel, modelListedValues, modelCurrentValue, modelCatalog],
  )

  // 通用配置切换：setModel 失败只弹一个 toast，不写时间线（收敛三报为一处）
  const handleConfigChange = useCallback(
    async (configId: string, value: string | boolean) => {
      const ok = await setModel(configId, value)
      if (!ok) {
        toast.error('切换配置失败')
      }
    },
    [setModel],
  )

  const thinkingDisplay = thinkingControl ? thinkingControl.current : null
  const suffixFastChecked = suffixFast ? suffixFast.checked : false

  const [providerDialogOpen, setProviderDialogOpen] = useState(false)
  const [providerStatus, setProviderStatus] = useState<AcpProviderStatus | null>(null)

  return (
    <aside
      className={cn(
        'flex h-full w-full min-w-0 flex-col overflow-hidden bg-transparent',
        className,
      )}
      role="region"
      aria-label="Agent 聊天"
      data-testid="agent-panel"
      data-keep-reader-selection
    >
      {/* 内嵌子卡：侧栏是工作区内框的孩子，不再顶天立地贴边 */}
      <div className="m-2 ml-1 flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border border-border/50 bg-sidebar/95 shadow-sm backdrop-blur-sm">
        <div className="flex h-10 shrink-0 items-center gap-2 border-b border-border/50 px-3">
        <div className="flex size-7 items-center justify-center rounded-lg bg-primary/10 text-primary">
          <AgentMark className="size-4" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5 min-w-0">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  className="flex items-center gap-1 rounded px-1 -ml-1 text-sm font-semibold tracking-tight hover:bg-muted/70 transition-colors focus:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                  title="点击切换 Agent 运行时"
                >
                  <span className="truncate max-w-[130px]">{runtimeName}</span>
                  <ChevronDown className="size-3 text-muted-foreground shrink-0" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="w-56">
                <DropdownMenuLabel className="text-[10px] text-muted-foreground">
                  切换 Agent 运行时
                </DropdownMenuLabel>
                <DropdownMenuRadioGroup
                  value={view.selectedRuntimeId}
                  onValueChange={(val) => void switchRuntime(val)}
                >
                  {/* 运行时切换器：全量读 BUILTIN_ACP_RUNTIMES（下游 8 项落地后零改动展示 8 项） */}
                  {BUILTIN_ACP_RUNTIMES.map((rt) => (
                    <DropdownMenuRadioItem
                      key={rt.id}
                      value={rt.id}
                      title={rt.description}
                      className="text-xs flex items-center justify-between"
                    >
                      <span>{rt.name}</span>
                      {rt.id === view.selectedRuntimeId && view.status === 'connected' ? (
                        <span className="size-1.5 rounded-full bg-emerald-500" />
                      ) : null}
                    </DropdownMenuRadioItem>
                  ))}
                </DropdownMenuRadioGroup>

                {isCodexRuntime ? (
                  <>
                    <DropdownMenuSeparator />
                    <DropdownMenuLabel className="text-[10px] text-muted-foreground">
                      认证 / 供应商
                    </DropdownMenuLabel>
                    <DropdownMenuItem
                      className="text-xs"
                      onSelect={() => setProviderDialogOpen(true)}
                    >
                      自定义 API…
                      {providerStatus?.configured ? (
                        <span className="ml-auto text-[10px] text-muted-foreground">
                          {providerStatus.name ?? '已配置'}
                        </span>
                      ) : null}
                    </DropdownMenuItem>
                  </>
                ) : null}
              </DropdownMenuContent>
            </DropdownMenu>

            <span
              className={cn(
                'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium shrink-0',
                view.status === 'connected' &&
                  'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400',
                view.status === 'connecting' &&
                  'bg-amber-500/15 text-amber-700 dark:text-amber-400',
                view.status === 'awaiting_auth' &&
                  'bg-sky-500/15 text-sky-700 dark:text-sky-400',
                view.status === 'error' && 'bg-destructive/15 text-destructive',
                view.status === 'disconnected' && 'bg-muted text-muted-foreground',
              )}
            >
              {view.status === 'connecting' ? (
                <Loader2 className="size-2.5 animate-spin" />
              ) : (
                <span
                  className={cn(
                    'size-1.5 rounded-full',
                    view.status === 'connected' && 'bg-emerald-500',
                    view.status === 'error' && 'bg-destructive',
                    view.status === 'disconnected' && 'bg-muted-foreground/50',
                  )}
                />
              )}
              {statusLabel}
            </span>
            {view.status === 'connecting' && view.selectedRuntimeId === 'agy' ? (
              <p className="truncate text-[10px] text-muted-foreground">
                首次连接需下载约 100MB 桥组件（仅一次），请耐心等待不要重复点击
              </p>
            ) : null}
          </div>
          {view.activeTitle ? (
            <p className="truncate text-[10px] text-muted-foreground" title={view.activeTitle}>
              {view.activeTitle}
            </p>
          ) : null}
        </div>
        <div className="flex items-center gap-0.5">
          {view.status === 'connected' ? (
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="size-7 rounded-lg"
              title="断开"
              onClick={() => void disconnect()}
            >
              <Unplug className="size-3.5" />
            </Button>
          ) : (
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="size-7 rounded-lg"
              title="连接"
              disabled={view.status === 'connecting' || view.status === 'awaiting_auth'}
              onClick={() => void connect()}
            >
              {view.status === 'connecting' ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <Wifi className="size-3.5" />
              )}
            </Button>
          )}
          <AgentHistoryMenu
            workspaceRoot={workspaceRoot}
            onAfterSwitchThread={() => void syncAgentSessionToActiveThread()}
          />
          <AgentHeaderOverflowMenu
            floating={floating}
            actionDisabled={view.prompting}
            onNewThread={() => {
              createThread(workspaceRoot)
              void syncAgentSessionToActiveThread()
            }}
            onClearMessages={clearMessages}
            onMinimizeToCapsule={onMinimizeToCapsule}
            onDockPanel={onToggleFloating}
            onFloatPanel={() => {
              setHudDisplayMode('floating')
            }}
          />
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-7 rounded-lg"
            title="关闭面板"
            onClick={() => {
              setPanelOpen(false)
              if (floating) setHudDisplayMode('docked')
            }}
          >
            <X className="size-3.5" />
          </Button>
        </div>
      </div>

      {!workspaceRoot ? (
        <div className="shrink-0 border-b border-border/50 bg-sky-500/10 px-3 py-1.5 text-[10px] text-sky-800 dark:text-sky-300">
          当前为网页会话（无本地工作区）；可读在线文档，附加本地文件需先打开文件夹
        </div>
      ) : null}

      <AgentMessageList
        bottomRef={bottomRef}
        messagesRef={messagesRef}
        authHint={authHint}
        runtimeName={runtimeName}
        onChapterPlanSelect={handleChapterPlanSelect}
      />

      <div className="shrink-0 space-y-1.5 p-3 pt-2">
        {/* 底部快捷动作：真实 Agent 请求（经 MCP 工具执行），非本地 mock */}
        <div className="flex items-center gap-1.5 overflow-x-auto pb-0.5">
          {(
            [
              {
                key: 'cross-ref',
                label: '跨章引证',
                hint: '调用交叉引用分析当前阅读位置',
                text: '请对当前阅读位置做跨章节引证分析：调用 montree_cross_reference 工具，找出与当前内容相关的章节与实体，给出可跳转的结论。',
              },
              {
                key: 'probe',
                label: '全篇探针',
                hint: '扫描全篇字数与规约约束',
                text: '请对当前文档做全篇探针扫描：统计总字数与预估通读用时，并列出正文中 MUST / SHOULD / MAY 规约约束原句及分布。',
              },
              {
                key: 'resume',
                label: '续读脉络',
                hint: '总结会话并给出续读建议',
                text: '请基于当前会话总结已研读要点，并给出下一步续读建议。',
              },
            ] as const
          ).map((action) => (
            <button
              key={action.key}
              type="button"
              title={action.hint}
              disabled={view.status !== 'connected' || view.prompting}
              onClick={() =>
                void sendPrompt({
                  text: action.text,
                  prompt: [{ type: 'text', text: action.text }],
                })
              }
              className="shrink-0 rounded-full border border-border/60 bg-muted/40 px-2.5 py-1 text-[10.5px] text-muted-foreground transition-all hover:border-primary/40 hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40"
            >
              {action.label}
            </button>
          ))}
        </div>
        <AgentComposer
          disabled={
            view.status === 'connecting' ||
            view.status === 'awaiting_auth'
          }
          prompting={view.prompting}
          workspaceRoot={workspaceRoot}
          promptCapabilities={view.promptCapabilities}
          draft={draft}
          onDraftChange={setDraft}
          onCancel={() => void cancel()}
          onSubmit={(payload) => {
            void sendPrompt({
              text: payload.text,
              prompt: payload.prompt,
              messageAttachments: payload.messageAttachments,
            })
          }}
          toolbarStart={
            <>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button
                    type="button"
                    className="inline-flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                    title="更多设置"
                  >
                    <Settings2 className="size-3.5" />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" className="w-56">
                  <DropdownMenuLabel className="text-[10px] text-muted-foreground">
                    运行时
                  </DropdownMenuLabel>
                  <DropdownMenuRadioGroup
                    value={view.selectedRuntimeId}
                    onValueChange={(val) => void switchRuntime(val)}
                  >
                    {/* 底部设置内同源切换器：同样全量读 BUILTIN_ACP_RUNTIMES */}
                    {BUILTIN_ACP_RUNTIMES.map((rt) => (
                      <DropdownMenuRadioItem
                        key={rt.id}
                        value={rt.id}
                        title={rt.description}
                        className="text-xs"
                      >
                        {rt.name}
                      </DropdownMenuRadioItem>
                    ))}
                  </DropdownMenuRadioGroup>

                  <DropdownMenuSeparator />
                  {isCodexRuntime ? (
                    <>
                      <DropdownMenuLabel className="text-[10px] text-muted-foreground">
                        认证 / 供应商
                      </DropdownMenuLabel>
                      <DropdownMenuItem
                        className="text-xs"
                        onSelect={() => setProviderDialogOpen(true)}
                      >
                        自定义 API…
                        {providerStatus?.configured ? (
                          <span className="ml-auto text-[10px] text-muted-foreground">
                            {providerStatus.name ?? '已配置'}
                          </span>
                        ) : null}
                      </DropdownMenuItem>
                    </>
                  ) : null}

                  <DropdownMenuSeparator />
                  <DropdownMenuLabel className="text-[10px] text-muted-foreground">
                    代理（Agent 子进程）
                  </DropdownMenuLabel>
                  <div className="flex items-center justify-between px-2 py-1">
                    <label
                      className="flex cursor-pointer items-center gap-2 text-xs shrink-0 whitespace-nowrap"
                      title="连接 Agent 时注入 HTTP(S)_PROXY 环境变量"
                    >
                      <input
                        type="checkbox"
                        className="size-3.5 accent-[hsl(var(--primary))]"
                        checked={proxySettings?.enabled ?? false}
                        disabled={view.status === 'connected' || view.status === 'connecting' || view.status === 'awaiting_auth'}
                        onChange={(e) => updateProxySettings({ enabled: e.target.checked })}
                      />
                      启用代理
                    </label>
                    <div className="flex items-center gap-1">
                      <input
                        className="h-6 w-24 rounded-md border border-border/70 bg-background px-1.5 text-[11px] outline-none disabled:opacity-50"
                        value={proxySettings?.host ?? '127.0.0.1'}
                        disabled={!proxySettings?.enabled}
                        spellCheck={false}
                        onChange={(e) => updateProxySettings({ host: e.target.value })}
                      />
                      <span className="text-[10px] text-muted-foreground">:</span>
                      <input
                        className="h-6 w-14 rounded-md border border-border/70 bg-background px-1.5 text-[11px] outline-none disabled:opacity-50"
                        value={proxySettings?.port ?? 7897}
                        disabled={!proxySettings?.enabled}
                        inputMode="numeric"
                        onChange={(e) => {
                          const port = Number(e.target.value)
                          if (Number.isInteger(port) && port >= 1 && port <= 65535) {
                            updateProxySettings({ port })
                          }
                        }}
                      />
                    </div>
                  </div>
                  <p className="px-2 pb-1 text-[10px] text-muted-foreground">
                    仅对 Agent 进程生效；保存后需重新连接
                  </p>

                  {secondary.length > 0 ? (
                    <>
                      <DropdownMenuSeparator />
                      <DropdownMenuLabel className="text-[10px] text-muted-foreground">
                        其它配置
                      </DropdownMenuLabel>
                      {secondary.map((opt) =>
                        opt.type === 'boolean' ? (
                          <label
                            key={opt.configId}
                            className="flex cursor-pointer items-center gap-2 px-2 py-1.5 text-xs"
                            title={opt.description || opt.name}
                          >
                            <input
                              type="checkbox"
                              className="size-3.5 accent-[hsl(var(--primary))]"
                              checked={Boolean(opt.currentValue)}
                              disabled={configsDisabled}
                              onChange={(e) => void handleConfigChange(opt.configId, e.target.checked)}
                            />
                            {opt.name}
                          </label>
                        ) : (
                          <div key={opt.configId} className="px-2 py-1.5">
                            <p className="mb-1 text-[10px] text-muted-foreground">{opt.name}</p>
                            <select
                              className="h-7 w-full rounded-md border border-border/70 bg-background px-2 text-[11px] outline-none disabled:opacity-50"
                              value={String(opt.currentValue ?? '')}
                              disabled={configsDisabled}
                              onChange={(e) => void handleConfigChange(opt.configId, e.target.value)}
                            >
                              {opt.options?.map((item) => (
                                <option key={item.value} value={item.value}>
                                  {item.name}
                                </option>
                              ))}
                            </select>
                          </div>
                        ),
                      )}
                    </>
                  ) : null}

                  <DropdownMenuSeparator />
                  <div className="px-2 py-1.5">
                    <p className="text-[10px] text-muted-foreground">工作区</p>
                    <p className="mt-0.5 truncate text-[11px]" title={workspaceRoot ?? ''}>
                      {workspaceRoot ?? '网页会话（应用沙箱）'}
                    </p>
                    <p className="mt-1 truncate text-[10px] text-muted-foreground" title={runtimeName}>
                      当前运行时 · {runtimeName}
                    </p>
                    {authHint ? (
                      <p className="mt-1.5 text-[10px] leading-relaxed text-muted-foreground">
                        {authHint}
                      </p>
                    ) : null}
                  </div>
                </DropdownMenuContent>
              </DropdownMenu>

              <div className="flex min-w-0 flex-1 items-center gap-0.5 overflow-x-auto">
                {suffixFast ? (
                  <label
                    className="inline-flex max-w-[7.5rem] shrink-0 cursor-pointer items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground has-disabled:pointer-events-none has-disabled:opacity-40"
                    title={
                      suffixFastAvailable
                        ? '快速模式（模型尾缀 fast，优先于 boolean 配置）'
                        : `当前模型无 fast=${suffixFastTarget} 可选版本`
                    }
                  >
                    <input
                      type="checkbox"
                      className="size-3.5 shrink-0 accent-[hsl(var(--primary))]"
                      checked={suffixFastChecked}
                      disabled={configsDisabled || !suffixFastAvailable}
                      onChange={(e) => void handleSuffixFastChange(e.target.checked)}
                    />
                    <span className="truncate">快速</span>
                  </label>
                ) : fastToggle ? (
                  <label
                    className="inline-flex max-w-[7.5rem] shrink-0 cursor-pointer items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground has-disabled:pointer-events-none has-disabled:opacity-40"
                    title={fastToggle.description || fastToggle.name}
                  >
                    <input
                      type="checkbox"
                      className="size-3.5 shrink-0 accent-[hsl(var(--primary))]"
                      checked={Boolean(fastToggle.currentValue)}
                      disabled={configsDisabled}
                      onChange={(e) => void handleConfigChange(fastToggle.configId, e.target.checked)}
                    />
                    <span className="truncate">{fastToggle.name}</span>
                  </label>
                ) : null}
                {primary.map((opt, index) => (
                  <CompactConfigMenu
                    key={opt.configId}
                    option={opt}
                    disabled={configsDisabled}
                    onChange={(configId, value) => void handleConfigChange(configId, value)}
                    emphasize={index === 0}
                  />
                ))}
                {thinkingControl && thinkingDisplay ? (
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <button
                        type="button"
                        disabled={configsDisabled}
                        title={`思考档（改写模型尾缀 ${thinkingControl.key}）`}
                        className="inline-flex max-w-[7.5rem] items-center gap-0.5 rounded-md px-1.5 py-0.5 text-[11px] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:pointer-events-none disabled:opacity-40"
                      >
                        <span className="truncate">思考 {thinkingDisplay}</span>
                        <ChevronDown className="size-3 shrink-0 opacity-60" />
                      </button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="start" className="w-40">
                      <DropdownMenuLabel className="text-[10px] text-muted-foreground">
                        思考档
                      </DropdownMenuLabel>
                      <DropdownMenuRadioGroup
                        value={thinkingDisplay}
                        onValueChange={(v) => void handleThinkingSelect(v)}
                      >
                        {thinkingControl.candidates.map((c) => (
                          <DropdownMenuRadioItem key={c} value={c} className="text-xs">
                            {c}
                          </DropdownMenuRadioItem>
                        ))}
                      </DropdownMenuRadioGroup>
                    </DropdownMenuContent>
                  </DropdownMenu>
                ) : readonlyThinking ? (
                  <button
                    type="button"
                    disabled
                    title="当前模型内置思考参数（跟随模型切换）"
                    className="inline-flex max-w-[7.5rem] items-center gap-0.5 rounded-md px-1.5 py-0.5 text-[11px] text-muted-foreground disabled:pointer-events-none disabled:opacity-70"
                  >
                    <span className="truncate">思考 {readonlyThinking}（只读）</span>
                  </button>
                ) : null}
                {view.status === 'connected' && primary.length === 0 ? (
                  <span className="px-1 text-[10px] text-muted-foreground">无会话配置项</span>
                ) : null}
              </div>
            </>
          }
        />

        {view.statusErrorCode === 'BUN_NOT_INSTALLED' ? (
          <AgentBunInstallBanner onInstalled={() => void connect()} />
        ) : view.selectedRuntimeId === 'agy' &&
          (view.statusError?.includes('Antigravity CLI') ||
            view.statusError?.includes('未安装') ||
            view.statusError?.includes('agy')) ? (
          <AgentAgyInstallBanner onInstalled={() => void connect()} />
        ) : view.statusError ? (
          <p className="px-3 pb-2 text-[10px] text-destructive">{view.statusError}</p>
        ) : null}
      </div>
      </div>
      {/* ↑ 内嵌子卡结束；以下弹窗保持与卡片同级，避免被圆角裁剪 */}

      <AgentAuthDialog
        open={authOpen}
        methods={authMethods}
        busy={authBusy}
        error={authError}
        runtimeName={runtimeName}
        runtimeId={view.selectedRuntimeId}
        onSelect={(methodId) => void completeAuth(methodId)}
        onCancel={() => void cancelAuth()}
      />

      <AgentProviderDialog
        open={providerDialogOpen}
        onOpenChange={setProviderDialogOpen}
        onChanged={(status) => {
          setProviderStatus(status)
          if (status.configured) {
            setAuthHint(
              `已启用自定义 API（${status.name ?? '自定义'} · ${status.model ?? ''}），连接时使用该 Key 认证`,
            )
            if (view.status === 'disconnected' || view.status === 'error') {
              void connect()
            }
          } else {
            setAuthHint('已清除自定义 API，连接时回到本机 ~/.codex 订阅登录')
          }
        }}
      />
    </aside>
  )
})
