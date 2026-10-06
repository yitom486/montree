import { useEffect, useState } from 'react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { rosettaApi } from '@/api/rosetta-api'
import { isOk } from '@montree/contracts'
import { validateCustomEdgeToken } from '@montree/ocr-core'
import type {
  RosettaBodyWatermarkApplyResult,
  RosettaBodyWatermarkPreviewResult,
} from '@montree/contracts'

interface BodyWatermarkPreviewDialogProps {
  open: boolean
  fingerprint: string
  onOpenChange: (open: boolean) => void
}

/**
 * P1 自定义结果区：只展示本轮自定义候选（reason `custom-edge-*` 前缀过滤），
 * 无任何应用入口。样例来自全局前 20 条，自定义候选超出时如实注明。
 */
function CustomPreviewResult({ preview }: { preview: RosettaBodyWatermarkPreviewResult }) {
  const reasonEntries = Object.entries(preview.reasonCounts)
    .filter(([reason]) => reason.startsWith('custom-edge-'))
    .sort((a, b) => b[1] - a[1])
  const samples = preview.samples.filter((sample) => sample.reason.startsWith('custom-edge-'))
  const customCount = reasonEntries.reduce((sum, [, count]) => sum + count, 0)
  const samplePages = new Set(samples.map((sample) => sample.pageNumber)).size
  return (
    <div className="space-y-1">
      <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
        <span>自定义候选 {customCount} 条</span>
        <span>样例涉及 {samplePages} 页</span>
      </div>
      {reasonEntries.length > 0 ? (
        <ul className="space-y-1 text-xs">
          {reasonEntries.map(([reason, count]) => (
            <li key={reason} className="flex items-center justify-between gap-2">
              <span className="min-w-0 flex-1 truncate" title={reason}>
                {reason}
              </span>
              <span className="shrink-0 tabular-nums">× {count}</span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-xs text-muted-foreground">本轮自定义规则无候选</p>
      )}
      {samples.length > 0 ? (
        <ul className="space-y-2">
          {samples.map((sample) => (
            <li key={sample.id} className="rounded-md border p-2 text-xs">
              <div className="flex items-center gap-2 text-muted-foreground">
                <span>第 {sample.pageNumber} 页</span>
                <span>#{sample.id}</span>
                <span>自定义修剪</span>
              </div>
              <div className="mt-1 truncate" title={sample.reason}>
                {sample.reason}
              </div>
              <div className="mt-1 break-all">前：{sample.before}</div>
              {sample.after !== undefined ? (
                <div className="mt-1 break-all">后：{sample.after}</div>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
      {customCount > samples.length ? (
        <p className="text-xs text-muted-foreground">样例为全局前 20 条，自定义候选超出部分未展示。</p>
      ) : null}
    </div>
  )
}

/**
 * 正文水印清洗预览 + 备份并应用（Phase 2.3）。
 * 预览语义与 Phase 2.2 一致（只读计数 + 最多 20 条样例，不写库）；
 * 应用须经二次确认态：先展示签名/统计，点“确认应用”后才调应用通道；
 * 应用成功后展示备份路径与结果。确认前绝不调用应用通道。
 */
export function BodyWatermarkPreviewDialog({
  open,
  fingerprint,
  onOpenChange,
}: BodyWatermarkPreviewDialogProps) {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [preview, setPreview] = useState<RosettaBodyWatermarkPreviewResult | null>(null)
  const [pageInput, setPageInput] = useState('')
  /** 二次确认态：preview 仅展示，confirm 才允许调应用通道 */
  const [confirming, setConfirming] = useState(false)
  const [applying, setApplying] = useState(false)
  const [applyError, setApplyError] = useState<string | null>(null)
  const [applyResult, setApplyResult] = useState<RosettaBodyWatermarkApplyResult | null>(null)
  /** P1 自定义规则（仅预览）：输入原文 + 本轮自定义结果；绝无应用入口 */
  const [customInput, setCustomInput] = useState('')
  const [customLoading, setCustomLoading] = useState(false)
  const [customError, setCustomError] = useState<string | null>(null)
  const [customPreview, setCustomPreview] = useState<RosettaBodyWatermarkPreviewResult | null>(null)

  async function loadPreview(samplePage: number | null): Promise<void> {
    if (!fingerprint) return
    setLoading(true)
    setError(null)
    try {
      const result = await rosettaApi.previewBodyWatermark(
        samplePage === null ? { fingerprint } : { fingerprint, samplePage },
      )
      if (isOk(result)) setPreview(result.value)
      else setError(result.error.message || '预览失败')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '预览失败')
    } finally {
      setLoading(false)
    }
  }

  function handleRefreshSamples(): void {
    const text = pageInput.trim()
    if (!text) {
      void loadPreview(null)
      return
    }
    const page = Number(text)
    if (!Number.isInteger(page) || page < 1) {
      setError('页码须为正整数')
      return
    }
    void loadPreview(page)
  }

  useEffect(() => {
    if (!open || !fingerprint) return
    let cancelled = false
    setLoading(true)
    setError(null)
    setPreview(null)
    setPageInput('')
    setConfirming(false)
    setApplying(false)
    setApplyError(null)
    setApplyResult(null)
    setCustomInput('')
    setCustomLoading(false)
    setCustomError(null)
    setCustomPreview(null)
    void (async () => {
      try {
        const result = await rosettaApi.previewBodyWatermark({ fingerprint })
        if (cancelled) return
        if (isOk(result)) setPreview(result.value)
        else setError(result.error.message || '预览失败')
      } catch (cause) {
        if (!cancelled) setError(cause instanceof Error ? cause.message : '预览失败')
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [open, fingerprint])

  /** P1 自定义预览：仅生成候选，不存在应用入口；输入一变就清旧结果 */
  function handleCustomInputChange(value: string): void {
    setCustomInput(value)
    setCustomPreview(null)
    setCustomError(null)
  }

  async function handleCustomPreview(): Promise<void> {
    if (!fingerprint || customLoading) return
    const token = customInput.trim()
    if (!token) {
      setCustomError('请输入自定义水印文本')
      return
    }
    const validated = validateCustomEdgeToken(token)
    if (!validated.ok) {
      setCustomError(validated.reason)
      return
    }
    let samplePage: number | null = null
    const pageText = pageInput.trim()
    if (pageText) {
      const page = Number(pageText)
      if (!Number.isInteger(page) || page < 1) {
        setCustomError('页码须为正整数')
        return
      }
      samplePage = page
    }
    setCustomLoading(true)
    setCustomError(null)
    try {
      const result = await rosettaApi.previewBodyWatermark(
        samplePage === null
          ? { fingerprint, customToken: token }
          : { fingerprint, samplePage, customToken: token },
      )
      if (isOk(result)) setCustomPreview(result.value)
      else setCustomError(result.error.message || '预览失败')
    } catch (cause) {
      setCustomError(cause instanceof Error ? cause.message : '预览失败')
    } finally {
      setCustomLoading(false)
    }
  }

  /** 二次确认后才调应用通道；确认前仅展示签名/统计，绝不写库 */
  async function handleConfirmApply(): Promise<void> {
    if (!preview || applying) return
    setApplying(true)
    setApplyError(null)
    try {
      const result = await rosettaApi.applyBodyWatermark({
        fingerprint,
        planSignature: preview.planSignature,
        deleteCount: preview.deleteCount,
        updateCount: preview.updateCount,
      })
      if (isOk(result)) setApplyResult(result.value)
      else setApplyError(result.error.message || '应用失败')
    } catch (cause) {
      setApplyError(cause instanceof Error ? cause.message : '应用失败')
    } finally {
      setApplying(false)
    }
  }

  const reasonEntries = preview
    ? Object.entries(preview.reasonCounts).sort((a, b) => b[1] - a[1])
    : []

  /** 自定义输入即时提示（纯本地校验；权威校验在主进程预览服务） */
  const customLocalValidation = customInput.trim()
    ? validateCustomEdgeToken(customInput.trim())
    : null

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-w-2xl max-h-[85vh] flex flex-col"
        aria-describedby="body-watermark-preview-desc"
      >
        <DialogHeader>
          <DialogTitle>预览正文水印清洗</DialogTitle>
          <DialogDescription id="body-watermark-preview-desc">
            {confirming
              ? '二次确认：核对签名与统计后，点“确认应用”才会备份并写库；返回则不写库。'
              : '只读预览，尚未修改数据库。进入“备份并应用”需二次确认，确认前不写库。'}
          </DialogDescription>
        </DialogHeader>

        {loading && !preview ? (
          <div className="py-10 text-center text-sm text-muted-foreground">正在只读统计…</div>
        ) : error && !preview ? (
          <div className="py-10 text-center text-sm text-destructive">{error}</div>
        ) : preview ? (
          <div className="min-h-0 flex-1 space-y-3 overflow-y-auto text-sm">
            {loading ? (
              <div className="text-xs text-muted-foreground">正在只读统计…</div>
            ) : null}
            {error ? <div className="text-xs text-destructive">{error}</div> : null}
            <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
              <span>待删 {preview.deleteCount} 条</span>
              <span>待改 {preview.updateCount} 条</span>
              <span>共 {preview.totalPatches} 条</span>
              <span>涉及 {preview.pageCount} 页</span>
            </div>
            <div className="break-all text-xs text-muted-foreground" title={preview.planSignature}>
              计划签名：{preview.planSignature}
            </div>
            {!confirming ? (
              <>
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <label htmlFor="body-watermark-sample-page">查看第 N 页候选</label>
                  <Input
                    id="body-watermark-sample-page"
                    type="number"
                    min={1}
                    step={1}
                    inputMode="numeric"
                    placeholder="如 36 / 303"
                    className="h-7 w-28"
                    value={pageInput}
                    onChange={(event) => setPageInput(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') handleRefreshSamples()
                    }}
                  />
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="h-7"
                    disabled={loading}
                    onClick={handleRefreshSamples}
                  >
                    刷新
                  </Button>
                </div>
                {reasonEntries.length > 0 ? (
                  <div className="space-y-1">
                    <div className="text-xs font-medium text-muted-foreground">按原因聚合</div>
                    <ul className="space-y-1 text-xs">
                      {reasonEntries.map(([reason, count]) => (
                        <li key={reason} className="flex items-center justify-between gap-2">
                          <span className="min-w-0 flex-1 truncate" title={reason}>
                            {reason}
                          </span>
                          <span className="shrink-0 tabular-nums">× {count}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}
                <div className="space-y-1">
                  <div className="text-xs font-medium text-muted-foreground">
                    {preview.samplePage == null
                      ? '全书样例（最多 20 条，仅展示）'
                      : `第 ${preview.samplePage} 页样例（最多 20 条，仅展示）`}
                  </div>
                  {preview.samples.length === 0 ? (
                    <div className="text-xs text-muted-foreground">暂无可清洗水印块</div>
                  ) : (
                    <ul className="space-y-2">
                      {preview.samples.map((sample) => (
                        <li key={sample.id} className="rounded-md border p-2 text-xs">
                          <div className="flex items-center gap-2 text-muted-foreground">
                            <span>第 {sample.pageNumber} 页</span>
                            <span>#{sample.id}</span>
                            <span>{sample.action === 'delete' ? '删除整块' : '修剪首尾'}</span>
                          </div>
                          <div className="mt-1 truncate" title={sample.reason}>
                            {sample.reason}
                          </div>
                          <div className="mt-1 break-all">前：{sample.before}</div>
                          {sample.after !== undefined ? (
                            <div className="mt-1 break-all">后：{sample.after}</div>
                          ) : null}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
                <div className="space-y-2 rounded-md border p-2">
                  <div className="text-xs font-medium">自定义水印规则（仅预览）</div>
                  <div className="text-xs text-muted-foreground">
                    仅预览，尚未写入数据库；自定义规则目前不可应用。3–24 字，
                    只匹配块首/块尾空白边界，不删整块、不碰中间。
                  </div>
                  <div className="flex items-center gap-2">
                    <Input
                      value={customInput}
                      placeholder="如 版权所有"
                      aria-label="自定义水印文本"
                      className="h-7 text-xs"
                      onChange={(event) => handleCustomInputChange(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter') void handleCustomPreview()
                      }}
                    />
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      className="h-7 shrink-0"
                      disabled={customLoading}
                      onClick={() => void handleCustomPreview()}
                    >
                      {customLoading ? '生成中…' : '生成预览'}
                    </Button>
                  </div>
                  {customLocalValidation && !customLocalValidation.ok ? (
                    <p className="text-xs text-muted-foreground">{customLocalValidation.reason}</p>
                  ) : null}
                  {customError ? <p className="text-xs text-destructive">{customError}</p> : null}
                  {customPreview ? (
                    <CustomPreviewResult preview={customPreview} />
                  ) : null}
                </div>
              </>
            ) : (
              <div className="space-y-2 rounded-md border border-amber-500/40 bg-amber-500/5 p-3 text-xs">
                <div className="font-medium">二次确认 · 备份并应用</div>
                <div className="text-muted-foreground">
                  将先在同目录生成时间戳备份（不可覆盖），校验通过后单事务写入；
                  任一条件冲突即整体回滚。确认后才调用应用通道。
                </div>
                <div className="break-all">
                  签名：<span className="font-mono">{preview.planSignature}</span>
                </div>
                <div className="text-muted-foreground">
                  待删 {preview.deleteCount} 条 / 待改 {preview.updateCount} 条 / 共{' '}
                  {preview.totalPatches} 条
                </div>
                {applying ? (
                  <div className="text-muted-foreground">正在备份并应用…</div>
                ) : null}
                {applyError ? <div className="text-destructive">{applyError}</div> : null}
                {applyResult ? (
                  <div className="space-y-1">
                    <div>
                      {applyResult.status === 'noop'
                        ? '无需写入：计划为空（noop）。'
                        : `已应用：${applyResult.blocksBefore} → ${applyResult.blocksAfter} 块。`}
                    </div>
                    {applyResult.status === 'applied' ? (
                      <>
                        <div className="break-all">备份路径：{applyResult.backupPath}</div>
                        <div className="text-muted-foreground">
                          备份 {applyResult.backupSize} 字节 / sha256{' '}
                          <span className="font-mono break-all">{applyResult.backupHash}</span>
                        </div>
                      </>
                    ) : null}
                  </div>
                ) : null}
                <div className="flex gap-2">
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={applying}
                    onClick={() => setConfirming(false)}
                  >
                    返回预览
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="destructive"
                    disabled={applying || preview.totalPatches === 0 || applyResult !== null}
                    onClick={() => void handleConfirmApply()}
                  >
                    {applying ? '应用中…' : '确认应用'}
                  </Button>
                </div>
              </div>
            )}
          </div>
        ) : null}

        <DialogFooter>
          {!confirming && preview && preview.totalPatches > 0 ? (
            <Button type="button" variant="secondary" onClick={() => setConfirming(true)}>
              备份并应用…
            </Button>
          ) : null}
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            关闭
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
