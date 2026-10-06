import { useCallback, useEffect, useRef, useState } from 'react'
import { BotMessageSquare, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { toast } from 'sonner'
import { acpApi } from '@/api/acp-api'
import { isOk } from '@montree/contracts'
import { useAcpUiStore } from '@/stores/acp-ui-store'
import type { AcpConfigOption } from '@montree/contracts'
import type { OcrTocEntry } from '@montree/contracts'
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
  pickTocModelOptions,
  pickTocThoughtOptions,
  sendTocPrompt,
  type TocPromptImage,
} from '@/lib/agent/toc-ai-session'

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

interface SelectState {
  configId: string
  value: string
}

type Phase = 'idle' | 'preparing' | 'ready' | 'working'

function defaultSelect(options: readonly AcpConfigOption[]): SelectState | null {
  const group = options[0]
  if (!group || !group.options || group.options.length === 0) return null
  const current = group.currentValue == null ? '' : String(group.currentValue)
  const value = group.options.some((o) => o.value === current)
    ? current
    : group.options[0]!.value
  return { configId: group.configId, value }
}

/**
 * 目录校正 editors 内的“AI 整理”：新建目录副会话 → 可选模型/思考档 →
 * 发 OCR 原文 → JSON 解析校验 → 回填草稿。不进右侧时间线。
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
  const agentConnected = useAcpUiStore((s) => s.status === 'connected')
  const mainPrompting = useAcpUiStore((s) => s.prompting)
  const imageCapable = useAcpUiStore((s) => s.promptCapabilities.image === true)
  const [phase, setPhase] = useState<Phase>('idle')
  const [modelOptions, setModelOptions] = useState<AcpConfigOption[]>([])
  const [thoughtOptions, setThoughtOptions] = useState<AcpConfigOption[]>([])
  const [model, setModel] = useState<SelectState | null>(null)
  const [thought, setThought] = useState<SelectState | null>(null)
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

  const busy = phase === 'preparing' || phase === 'working'
  const blocked = disabled === true || mainPrompting || busy

  const handlePrepare = useCallback(async () => {
    if (!agentConnected) {
      toast.error('请先连接 AI')
      return
    }
    // 新会话即新一轮：在途旧轮次的等待与回写全部过期
    runIdRef.current += 1
    setError(null)
    setPhase('preparing')
    const session = await ensureTocSessionId()
    if (!mountedRef.current) return
    if (!session) {
      setError('AI 会话创建失败，请稍后重试')
      setPhase('idle')
      return
    }
    sessionRef.current = session.sessionId
    setModelOptions(pickTocModelOptions(session.configOptions))
    setThoughtOptions(pickTocThoughtOptions(session.configOptions))
    setModel(defaultSelect(pickTocModelOptions(session.configOptions)))
    setThought(defaultSelect(pickTocThoughtOptions(session.configOptions)))
    setPhase('ready')
  }, [agentConnected])

  const handleStart = useCallback(async () => {
    const sid = sessionRef.current
    if (!sid) {
      setError('会话已失效，请重新点击 AI 整理')
      setPhase('idle')
      return
    }
    setError(null)
    setPhase('working')
    try {
      for (const override of [model, thought]) {
        if (!override) continue
        const applied = await acpApi.setConfigOption({
          sessionId: sid,
          configId: override.configId,
          value: override.value,
        })
        if (!isOk(applied)) {
          throw new Error('模型配置应用失败')
        }
      }
      const text = await getOcrText()
      if (!mountedRef.current) return
      if (!text) {
        toast.error('目录页无可用 OCR 文本，请先识别目录')
        setPhase('ready')
        return
      }
      // 有图片能力才渲染附图（5 页 PNG，文本照旧作为辅助一起发）
      const useImages = canTocUseImages() && getPageImages !== undefined
      const images = useImages ? ((await getPageImages()) ?? []) : []
      if (!mountedRef.current) return
      const imagePages = images
        .map((image) => Number.parseInt(image.name.replace(/\D/g, ''), 10))
        .filter((page) => Number.isInteger(page))
      runIdRef.current += 1
      const runId = runIdRef.current
      const startedFp = fileFingerprint
      // 本轮草稿基线：只接受此后落袋的同指纹草稿；之前残留的旧草稿
      // 既不消费也不清除（旧超时操作随后写入会推进世代，仍可恢复）
      const draftBaseline = peekTocDraftSeq(fileFingerprint)
      const send = await sendTocPrompt(
        buildTocAiPrompt(text, fileFingerprint, {
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
      applyMerged(parsed.entries, parsed.warnings)
      setPhase('idle')
    } catch (cause) {
      if (!mountedRef.current) return
      setError(cause instanceof Error ? cause.message : 'AI 整理失败')
      setPhase('ready')
    }
  }, [fileFingerprint, getOcrText, getPageImages, model, thought, applyMerged])

  const handleCancel = useCallback(() => {
    runIdRef.current += 1
    sessionRef.current = null
    setError(null)
    setPhase('idle')
  }, [])

  if (phase === 'ready') {
    const modelGroup = modelOptions[0]
    const thoughtGroup = thoughtOptions[0]
    return (
      <div className="space-y-2 rounded-md border border-border/60 bg-background/60 p-2">
        {modelGroup?.options ? (
          <label className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
            模型
            <select
              className="min-w-0 flex-1 rounded border border-border/60 bg-background px-1.5 py-1 text-xs text-foreground"
              value={model?.value ?? ''}
              onChange={(e) =>
                setModel(
                  model ? { ...model, value: e.target.value } : null,
                )
              }
            >
              {modelGroup.options.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.name || o.value}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        {thoughtGroup?.options ? (
          <label className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
            思考档
            <select
              className="min-w-0 flex-1 rounded border border-border/60 bg-background px-1.5 py-1 text-xs text-foreground"
              value={thought?.value ?? ''}
              onChange={(e) =>
                setThought(
                  thought ? { ...thought, value: e.target.value } : null,
                )
              }
            >
              {thoughtGroup.options.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.name || o.value}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        {error ? <p className="text-[11px] text-destructive">{error}</p> : null}
        <p className="text-[11px] text-muted-foreground">
          {imageCapable ? '整理时附带目录页原图，以图为准。' : '该 Agent 不支持图片，只用 OCR 文本整理。'}
        </p>
        <div className="flex gap-2">
          <Button
            type="button"
            size="sm"
            className="h-7 flex-1 text-xs"
            disabled={mainPrompting}
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
        disabled={blocked || !agentConnected}
        title={agentConnected ? '用 AI 整理目录 OCR 文本' : '请先连接 AI'}
        onClick={() => void handlePrepare()}
      >
        {busy ? (
          <Loader2 className="mr-1 size-3.5 animate-spin" />
        ) : (
          <BotMessageSquare className="mr-1 size-3.5" />
        )}
        {phase === 'preparing' ? '准备会话…' : phase === 'working' ? '整理中…' : 'AI 整理'}
      </Button>
      {error ? <p className="text-[11px] text-destructive">{error}</p> : null}
    </div>
  )
}
