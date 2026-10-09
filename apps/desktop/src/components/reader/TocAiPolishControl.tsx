import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { BotMessageSquare, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { toast } from 'sonner'
import { acpApi } from '@/api/acp-api'
import {
  BUILTIN_ACP_RUNTIMES,
  findBuiltinAcpRuntime,
  isOk,
  type AcpConfigOption,
  type OcrTocEntry,
} from '@montree/contracts'
import { useAcpUiStore } from '@/stores/acp-ui-store'
import { rankPrimary, splitConfigOptions } from '@/lib/agent/acp-config-menu'
import {
  findListedVariantId,
  listedModelOptionValues,
  selectModelThinkingControl,
  selectReadonlyModelThinking,
} from '@/lib/agent/acp-model-thinking'
import { buildTocAiPrompt, mergeTocAiDraft, parseTocAiEntries } from '@/lib/reader/rosetta/toc-ai'
import {
  decideTocAiPromptOutcome,
  peekTocDraftSeq,
  takeTocDraftSince,
  waitForTocDraft,
} from '@/lib/agent/context/toc-draft'
import {
  canTocUseImages,
  cancelTocPrompt,
  ensureTocSessionId,
  sendTocPrompt,
  useTocSessionProgress,
  type TocPromptImage,
} from '@/lib/agent/toc-ai-session'
import { TocAiLiveDashboard, type TocWorkStage } from './TocAiLiveDashboard'

interface TocAiPolishControlProps {
  /** 目录范围页的 OCR 原文（调用方按需识别后拼接） */
  getOcrText: () => Promise<string | null>
  /** 目录范围页的原图（离屏渲染；Agent 无图片能力时不调用） */
  getPageImages?: () => Promise<TocPromptImage[] | null>
  /** 解析出的条目进编辑器草稿（用户核对后才保存） */
  onApply: (entries: OcrTocEntry[]) => void
  /** 当前书指纹：与目录工具写入的草稿归属校验用 */
  fileFingerprint: string
  /** 机器基线（启发式已出结果）：AI 当核对者，合并裁决后进草稿 */
  baselineEntries?: readonly OcrTocEntry[]
  /** 真实总页数 + 印刷页偏移：合并时 AI 新增条目的范围门用 */
  pageCount?: number
  pageOffset?: number
  disabled?: boolean
}

type Phase = 'idle' | 'preparing' | 'ready' | 'working'

const TOC_RUNTIME_STORAGE_KEY = 'montree:toc-ai-selected-runtime'

/**
 * 目录校正 editors 内的“AI 整理”：
 * 自由选择 Agent 运行时 → 级联选择模型与思考等级 →
 * 独立目录副会话（仅注入 montree-toc 工具） →
 * 发专属目录提示词 → 工具草稿回填。与右侧主聊天完全隔离。
 */
export function TocAiPolishControl({
  getOcrText,
  getPageImages,
  onApply,
  fileFingerprint,
  baselineEntries,
  pageCount,
  pageOffset,
  disabled,
}: TocAiPolishControlProps) {
  // 合并裁决（AI 为主干，钉死为红线）：两条应用路径共用，结果进草稿等人点保存
  const applyMerged = useCallback(
    (aiEntries: OcrTocEntry[], extraWarnings: string[]) => {
      const merged = mergeTocAiDraft(baselineEntries ?? [], aiEntries, { pageCount, pageOffset })
      console.info(
        `[toc-ai] merge baseline=${baselineEntries?.length ?? 0} ai=${aiEntries.length} ` +
          `kept=${merged.entries.length} aiAdded=${merged.aiAdded} ` +
          `conflicts=${merged.conflicts.length} dropped=${merged.dropped.length}`,
      )
      onApply(merged.entries)
      for (const warning of [...extraWarnings, ...merged.conflicts.slice(0, 5), ...merged.dropped.slice(0, 5)]) {
        toast.message(warning)
      }
      if (merged.conflicts.length > 5 || merged.dropped.length > 5) {
        toast.message(`另有 ${merged.conflicts.length + merged.dropped.length - 10} 条裁决细节已记入控制台`)
      }
      toast.success(
        `AI 整理：采纳 ${merged.entries.length} 条（含新增 ${merged.aiAdded}）` +
          (merged.conflicts.length > 0 ? `，${merged.conflicts.length} 处按钉死页保留` : '') +
          '，请核对后保存',
      )
    },
    [baselineEntries, pageCount, pageOffset, onApply],
  )

  const mainPrompting = useAcpUiStore((s) => s.prompting)
  const imageCapable = useAcpUiStore((s) => s.promptCapabilities.image !== false)
  const progress = useTocSessionProgress()

  const [selectedRuntimeId, setSelectedRuntimeId] = useState<string>(() => {
    return localStorage.getItem(TOC_RUNTIME_STORAGE_KEY) || 'opencode'
  })
  const [switchingRuntime, setSwitchingRuntime] = useState(false)
  const [elapsedSeconds, setElapsedSeconds] = useState(0)
  const [stage, setStage] = useState<TocWorkStage>('slices')
  const [phase, setPhase] = useState<Phase>('idle')
  const [configOptions, setConfigOptions] = useState<AcpConfigOption[]>([])
  const [error, setError] = useState<string | null>(null)

  const sessionRef = useRef<string | null>(null)
  const mountedRef = useRef(true)
  /** 整理轮次：新一轮开始/取消/切文件即递增，等草稿循环凭此过期 */
  const runIdRef = useRef(0)
  const fpRef = useRef(fileFingerprint)
  fpRef.current = fileFingerprint

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
    }
  }, [])

  useEffect(() => {
    if (phase !== 'working') {
      setElapsedSeconds(0)
      return
    }
    const started = Date.now()
    const timer = setInterval(() => {
      setElapsedSeconds(Math.floor((Date.now() - started) / 1000))
    }, 1000)
    return () => clearInterval(timer)
  }, [phase])

  const busy = phase === 'preparing' || phase === 'working'
  const blocked = disabled === true || mainPrompting || busy

  // --- 模型与思考等级级联解析 ---
  const { primary } = useMemo(() => splitConfigOptions(configOptions), [configOptions])
  const modelOption = useMemo(() => primary.find((o) => rankPrimary(o) === 1), [primary])
  const independentThought = useMemo(() => primary.find((o) => rankPrimary(o) === 2), [primary])
  const thinkingControl = useMemo(() => selectModelThinkingControl(primary), [primary])
  const readonlyThinking = useMemo(() => selectReadonlyModelThinking(primary), [primary])

  const modelList = useMemo(() => modelOption?.options ?? [], [modelOption])
  const currentModelValue = String(modelOption?.currentValue ?? (modelList[0]?.value ?? ''))

  const { thoughtType, thoughtCandidates, currentThoughtValue, thoughtConfigId } = useMemo(() => {
    if (independentThought && independentThought.options && independentThought.options.length > 0) {
      return {
        thoughtType: 'independent' as const,
        thoughtCandidates: independentThought.options.map((o) => ({
          value: o.value,
          name: o.name || o.value,
        })),
        currentThoughtValue: String(independentThought.currentValue ?? ''),
        thoughtConfigId: independentThought.configId,
      }
    }
    if (thinkingControl && thinkingControl.candidates.length > 0) {
      return {
        thoughtType: 'suffix' as const,
        thoughtCandidates: thinkingControl.candidates.map((c) => ({
          value: c,
          name: c,
        })),
        currentThoughtValue: thinkingControl.current,
        thoughtConfigId: thinkingControl.configId,
      }
    }
    if (readonlyThinking) {
      return {
        thoughtType: 'readonly' as const,
        thoughtCandidates: [{ value: readonlyThinking, name: readonlyThinking }],
        currentThoughtValue: readonlyThinking,
        thoughtConfigId: undefined,
      }
    }
    return {
      thoughtType: 'none' as const,
      thoughtCandidates: [] as Array<{ value: string; name: string }>,
      currentThoughtValue: '',
      thoughtConfigId: undefined,
    }
  }, [independentThought, thinkingControl, readonlyThinking])

  // --- 切换运行时 ---
  const handleRuntimeChange = useCallback(
    async (nextRuntimeId: string) => {
      if (nextRuntimeId === selectedRuntimeId) return
      setSelectedRuntimeId(nextRuntimeId)
      localStorage.setItem(TOC_RUNTIME_STORAGE_KEY, nextRuntimeId)
      setSwitchingRuntime(true)
      setError(null)
      try {
        const session = await ensureTocSessionId({ runtimeId: nextRuntimeId })
        if (!mountedRef.current) return
        if (!session) {
          setError(
            `连接至 ${findBuiltinAcpRuntime(nextRuntimeId)?.name ?? nextRuntimeId} 失败，请检查 CLI 运行时是否就绪`,
          )
          return
        }
        sessionRef.current = session.sessionId
        setConfigOptions(session.configOptions)
      } catch (err) {
        if (!mountedRef.current) return
        setError(err instanceof Error ? err.message : '切换运行时失败')
      } finally {
        if (mountedRef.current) {
          setSwitchingRuntime(false)
        }
      }
    },
    [selectedRuntimeId],
  )

  // --- 切换模型（联动重算思考档） ---
  const handleModelChange = useCallback(
    async (nextModelValue: string) => {
      const sid = sessionRef.current
      if (!sid || !modelOption) return
      try {
        const res = await acpApi.setConfigOption({
          sessionId: sid,
          configId: modelOption.configId,
          value: nextModelValue,
        })
        if (isOk(res)) {
          setConfigOptions(res.value.configOptions)
          useAcpUiStore
            .getState()
            .rememberConfigPreference(selectedRuntimeId, modelOption.configId, nextModelValue)
        } else {
          toast.error('切换模型失败')
        }
      } catch {
        toast.error('切换模型失败')
      }
    },
    [modelOption, selectedRuntimeId],
  )

  // --- 切换思考档 ---
  const handleThoughtChange = useCallback(
    async (nextThoughtValue: string) => {
      const sid = sessionRef.current
      if (!sid) return
      try {
        if (thoughtType === 'independent' && thoughtConfigId) {
          const res = await acpApi.setConfigOption({
            sessionId: sid,
            configId: thoughtConfigId,
            value: nextThoughtValue,
          })
          if (isOk(res)) {
            setConfigOptions(res.value.configOptions)
            useAcpUiStore
              .getState()
              .rememberConfigPreference(selectedRuntimeId, thoughtConfigId, nextThoughtValue)
          } else {
            toast.error('切换思考档失败')
          }
        } else if (thoughtType === 'suffix' && thinkingControl && modelOption) {
          const modelListedValues = listedModelOptionValues(modelOption)
          const newId = findListedVariantId(
            modelListedValues,
            { base: thinkingControl.base, params: thinkingControl.params },
            { key: thinkingControl.key, value: nextThoughtValue },
          )
          if (!newId) {
            toast.error('未找到对应思考档版本')
            return
          }
          const res = await acpApi.setConfigOption({
            sessionId: sid,
            configId: thinkingControl.configId,
            value: newId,
          })
          if (isOk(res)) {
            setConfigOptions(res.value.configOptions)
            useAcpUiStore
              .getState()
              .rememberConfigPreference(selectedRuntimeId, thinkingControl.configId, newId)
          } else {
            toast.error('切换思考档失败')
          }
        }
      } catch {
        toast.error('切换思考档失败')
      }
    },
    [thoughtType, thoughtConfigId, thinkingControl, modelOption, selectedRuntimeId],
  )

  const handlePrepare = useCallback(async () => {
    runIdRef.current += 1
    setError(null)
    setPhase('preparing')
    try {
      const session = await ensureTocSessionId({ runtimeId: selectedRuntimeId })
      if (!mountedRef.current) return
      if (!session) {
        setError(
          `AI 运行时 ${findBuiltinAcpRuntime(selectedRuntimeId)?.name ?? selectedRuntimeId} 会话创建失败，请稍后重试`,
        )
        setPhase('idle')
        return
      }
      sessionRef.current = session.sessionId
      setConfigOptions(session.configOptions)
      setPhase('ready')
    } catch (err) {
      if (!mountedRef.current) return
      setError(err instanceof Error ? err.message : '创建会话失败')
      setPhase('idle')
    }
  }, [selectedRuntimeId])

  const handleStart = useCallback(async () => {
    const sid = sessionRef.current
    if (!sid) {
      setError('会话已失效，请重新点击 AI 整理')
      setPhase('idle')
      return
    }
    setError(null)
    setPhase('working')
    setStage('slices')
    try {
      // 优先获取目录页原图（多模态视觉直提，无需先做本地 OCR）
      const useImages = canTocUseImages() && getPageImages !== undefined
      const images = useImages ? ((await getPageImages()) ?? []) : []
      if (!mountedRef.current) return

      // OCR 文本仅作无图降级或有图时的辅助定位，绝不阻断有图流程
      let text: string | null = null
      if (images.length === 0) {
        text = await getOcrText()
        if (!mountedRef.current) return
      } else {
        try {
          text = await getOcrText()
        } catch {
          text = null
        }
      }

      if (images.length === 0 && (!text || text.trim().length === 0)) {
        toast.error('未获取到目录页原图或文本，请确认目录页码范围')
        setPhase('ready')
        return
      }

      setStage('session')
      const imagePages = images
        .map((image) => Number.parseInt(image.name.replace(/\D/g, ''), 10))
        .filter((page) => Number.isInteger(page))
      runIdRef.current += 1
      const runId = runIdRef.current
      const startedFp = fileFingerprint
      // 本轮草稿基线：只接受此后落袋的同指纹草稿；之前残留的旧草稿
      // 既不消费也不清除（旧超时操作随后写入会推进世代，仍可恢复）
      const draftBaseline = peekTocDraftSeq(fileFingerprint)
      setStage('reasoning')
      const send = await sendTocPrompt(
        buildTocAiPrompt(text ?? '', fileFingerprint, {
          withImages: images.length > 0,
          imagePages,
          baseline: baselineEntries,
        }),
        images,
        { fingerprint: fileFingerprint },
      )
      // 新一轮/切文件/卸载：本轮回写一律过期，静默退出（新轮次拥有 UI）
      const isCurrentRun = (): boolean =>
        mountedRef.current && runIdRef.current === runId && fpRef.current === startedFp
      if (!isCurrentRun()) return

      setStage('assembly')
      // 先取工具草稿再判空回复：工具型 Agent 可能零正文回复，
      // 先判空会丢弃已写好的草稿（见 decideTocAiPromptOutcome 单测）；
      // 门控消费：只要本轮开始后落袋的，之前残留的不碰
      let drafted = takeTocDraftSince(fileFingerprint, draftBaseline)
      let outcome = decideTocAiPromptOutcome(
        drafted !== null,
        send.reply !== null && send.reply !== '',
      )
      if (outcome.action !== 'apply-draft' && (send.outcome === 'timeout' || send.outcome === 'empty')) {
        // 超时/空回复：服务端大概率仍在跑，等草稿落袋而不是直接报错；
        // 同指纹且本轮之后落袋才消费（切文件/新一轮/卸载即停，旧草稿带不走）
        const waited = await waitForTocDraft(fileFingerprint, {
          minSeq: draftBaseline,
          isCancelled: () => !isCurrentRun(),
        })
        console.info(
          `[toc-ai] draft:wait op=${send.opId} outcome=${waited.outcome} waitedMs=${waited.waitedMs} entries=${waited.entries?.length ?? 0}`,
        )
        if (!isCurrentRun()) return
        if (waited.entries) {
          drafted = waited.entries
          outcome = decideTocAiPromptOutcome(true, send.reply !== null && send.reply !== '')
        }
      }
      if (outcome.action === 'apply-draft') {
        console.info(
          `[toc-ai] tool draft entries=${drafted?.length ?? 0} replyChars=${send.reply?.length ?? 0}`,
        )
        setStage('success')
        applyMerged(drafted ?? [], [])
        setPhase('idle')
        return
      }
      if (outcome.action === 'no-reply') {
        // 彻底放弃才止血：只取消本轮自己的会话（sid 本轮捕获），新一轮的不碰
        void cancelTocPrompt(sid)
        setError('AI 无回复，请重试')
        setPhase('ready')
        return
      }
      const parsed = parseTocAiEntries(send.reply ?? '')
      if (parsed.entries.length === 0) {
        console.info(`[toc-ai] parsed entries=0 dropped=${parsed.dropped} warnings=${parsed.warnings.length}`)
        setError(parsed.warnings[0] ?? '未能解析出条目')
        setPhase('ready')
        return
      }
      console.info(
        `[toc-ai] parsed entries=${parsed.entries.length} dropped=${parsed.dropped} warnings=${parsed.warnings.length}`,
      )
      setStage('success')
      applyMerged(parsed.entries, parsed.warnings)
      setPhase('idle')
    } catch (cause) {
      if (!mountedRef.current) return
      setError(cause instanceof Error ? cause.message : 'AI 整理失败')
      setPhase('ready')
    }
  }, [fileFingerprint, getOcrText, getPageImages, baselineEntries, applyMerged])

  const handleCancel = useCallback(() => {
    runIdRef.current += 1
    sessionRef.current = null
    setError(null)
    setPhase('idle')
  }, [])

  const handleWorkingCancel = useCallback(() => {
    runIdRef.current += 1
    const sid = sessionRef.current
    if (sid) {
      void cancelTocPrompt(sid)
    }
    toast.info('已取消本次 AI 整理')
    setPhase('ready')
  }, [])

  if (phase === 'working') {
    return (
      <TocAiLiveDashboard
        stage={stage}
        elapsedSeconds={elapsedSeconds}
        statusText={
          progress?.statusText ||
          (stage === 'slices'
            ? '正在读取 PDF 并准备目录页高清切片…'
            : stage === 'session'
              ? '正在激活 Agent 会话并装载目录工具…'
              : stage === 'assembly'
                ? '正在组装语义层级与推导起始/结束页…'
                : '大模型深度思考与视觉解析中…')
        }
        currentTool={progress?.currentTool}
        toolStatus={progress?.toolStatus}
        latestThought={progress?.latestThought}
        stepCount={progress?.stepCount}
        onCancel={handleWorkingCancel}
      />
    )
  }

  const currentRuntimeName =
    findBuiltinAcpRuntime(selectedRuntimeId)?.name ?? selectedRuntimeId

  if (phase === 'ready') {
    return (
      <div className="space-y-2 rounded-md border border-border/60 bg-background/60 p-2 text-xs">
        {/* 1. 运行时选择器 */}
        <label className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
          <span className="w-12 shrink-0">运行时</span>
          <select
            className="min-w-0 flex-1 rounded border border-border/60 bg-background px-1.5 py-1 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
            value={selectedRuntimeId}
            disabled={switchingRuntime}
            onChange={(e) => void handleRuntimeChange(e.target.value)}
          >
            {BUILTIN_ACP_RUNTIMES.map((rt) => (
              <option key={rt.id} value={rt.id}>
                {rt.name}
              </option>
            ))}
          </select>
        </label>

        {/* 2. 模型选择器（依赖选中的运行时） */}
        <label className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
          <span className="w-12 shrink-0">模型</span>
          {switchingRuntime ? (
            <div className="flex flex-1 items-center gap-1 py-1 text-muted-foreground">
              <Loader2 className="size-3 animate-spin" />
              <span>正在获取可用模型…</span>
            </div>
          ) : modelList.length > 0 ? (
            <select
              className="min-w-0 flex-1 rounded border border-border/60 bg-background px-1.5 py-1 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
              value={currentModelValue}
              onChange={(e) => void handleModelChange(e.target.value)}
            >
              {modelList.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.name || o.value}
                </option>
              ))}
            </select>
          ) : (
            <span className="text-muted-foreground">（该运行时未提供模型选项）</span>
          )}
        </label>

        {/* 3. 思考档选择器（依赖选中的模型，尾缀或独立参数联动） */}
        <label className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
          <span className="w-12 shrink-0">思考档</span>
          {thoughtType === 'none' ? (
            <select
              disabled
              className="min-w-0 flex-1 rounded border border-border/60 bg-background/50 px-1.5 py-1 text-xs text-muted-foreground opacity-60"
              value=""
            >
              <option value="">当前模型不支持思考档</option>
            </select>
          ) : thoughtType === 'readonly' ? (
            <select
              disabled
              className="min-w-0 flex-1 rounded border border-border/60 bg-background/50 px-1.5 py-1 text-xs text-muted-foreground opacity-60"
              value={currentThoughtValue}
            >
              <option value={currentThoughtValue}>固定思考档：{currentThoughtValue}</option>
            </select>
          ) : (
            <select
              className="min-w-0 flex-1 rounded border border-border/60 bg-background px-1.5 py-1 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
              value={currentThoughtValue}
              disabled={switchingRuntime || thoughtCandidates.length === 0}
              onChange={(e) => void handleThoughtChange(e.target.value)}
            >
              {thoughtCandidates.map((c) => (
                <option key={c.value} value={c.value}>
                  {c.name}
                </option>
              ))}
            </select>
          )}
        </label>

        {error ? <p className="text-[11px] text-destructive">{error}</p> : null}

        <p className="text-[11px] text-muted-foreground/80">
          {imageCapable ? '以图为准（多模态视觉直提）' : '该 Agent 不支持图片，只用 OCR 文本'}
          {' · 专属目录会话与 montree-toc 工具隔离'}
        </p>

        <div className="flex gap-2 pt-1">
          <Button
            type="button"
            size="sm"
            className="h-7 flex-1 text-xs"
            disabled={mainPrompting || switchingRuntime}
            onClick={() => void handleStart()}
          >
            开始整理
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="h-7 text-xs"
            disabled={busy}
            onClick={handleCancel}
          >
            取消
          </Button>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-1">
      <Button
        type="button"
        size="sm"
        variant="outline"
        className="h-7 w-full text-xs"
        disabled={blocked}
        title="用 AI 整理目录 OCR 文本"
        onClick={() => void handlePrepare()}
      >
        {phase === 'preparing' ? (
          <Loader2 className="mr-1 size-3.5 animate-spin" />
        ) : (
          <BotMessageSquare className="mr-1 size-3.5" />
        )}
        {phase === 'preparing' ? `准备 ${currentRuntimeName}…` : `AI 整理 (${currentRuntimeName})`}
      </Button>
      {error ? <p className="text-[11px] text-destructive">{error}</p> : null}
    </div>
  )
}
