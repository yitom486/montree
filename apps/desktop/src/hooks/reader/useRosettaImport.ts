import { useCallback, useEffect, useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { rosettaApi } from '@/api/rosetta-api'
import { queryKeys } from '@/api/query-keys'
import { isOk } from '@montree/contracts'
import type {
  RosettaBookInfo,
  RosettaImportPhase,
  RosettaImportState,
  RosettaTocEntryInput,
} from '@montree/contracts'

export interface RosettaImportStartArgs {
  filePath: string
  title: string
  format: string
  scale?: number
  /** 总页数（pdf.js 已知，主进程不再为此全量解析一次） */
  pageCount: number
  toc: RosettaTocEntryInput[]
  /** P1.2：纯文字书直提（跳过 OCR 运行时），由 PdfViewer 按 !isScannedPdf && !isMixedPdf 设置 */
  preferNative?: boolean
  /** U2：确认后重建（先删本书旧库与 OCR 缓存再全书导入），仅 PdfViewer 置 true */
  forceRebuild?: boolean
}

/**
 * 罗盘导入视图状态：横幅按钮 + 进度 + 已索引信息。
 * 长任务进度走主进程推送；invoke 结果只做兜底（推送已覆盖全部终态）。
 */
export function useRosettaImport(fileFingerprint: string) {
  const queryClient = useQueryClient()
  const [state, setState] = useState<RosettaImportState>('idle')
  const [phase, setPhase] = useState<RosettaImportPhase>('preparing')
  const [donePages, setDonePages] = useState(0)
  const [totalPages, setTotalPages] = useState(0)
  const startingRef = useRef(false)

  // 书索引信息：可缓存读（按 fingerprint），导入完成/目录重建后失效重取
  const infoQuery = useQuery({
    queryKey: queryKeys.rosettaBookInfo(fileFingerprint),
    queryFn: async (): Promise<RosettaBookInfo | null> => {
      const result = await rosettaApi.getBookInfo(fileFingerprint)
      return isOk(result) ? result.value : null
    },
    enabled: Boolean(fileFingerprint),
  })
  const info = infoQuery.data ?? null

  const refreshInfo = useCallback((): Promise<void> => {
    if (!fileFingerprint) return Promise.resolve()
    return queryClient
      .invalidateQueries({ queryKey: queryKeys.rosettaBookInfo(fileFingerprint) })
      .then(() => undefined)
  }, [queryClient, fileFingerprint])

  useEffect(() => {
    if (!fileFingerprint) return
    // 窗口重载时推送已错过：主动拉一次进行中的快照，恢复进度显示
    void rosettaApi.getActiveImport().then((result) => {
      if (!isOk(result) || !result.value || result.value.fingerprint !== fileFingerprint) return
      setState('running')
      setPhase(result.value.phase)
      setDonePages(result.value.donePages)
      setTotalPages(result.value.totalPages)
    })
  }, [fileFingerprint])

  useEffect(() => {
    if (!fileFingerprint) return
    return rosettaApi.onImportStatus((status) => {
      if (status.fingerprint !== fileFingerprint) return
      setState(status.state)
      setPhase(status.phase ?? 'preparing')
      setDonePages(status.donePages)
      setTotalPages(status.totalPages)
      if (status.state === 'done') {
        toast.success(status.message ? `罗盘索引已就绪：${status.message}` : '罗盘索引已就绪，AI 可直接读库')
        void refreshInfo()
      } else if (status.state === 'error') {
        toast.error(status.message || '罗盘导入失败')
      } else if (status.state === 'cancelled') {
        toast.info('已取消罗盘导入')
      }
    })
  }, [fileFingerprint, refreshInfo])

  const startImport = useCallback(
    (args: RosettaImportStartArgs) => {
      if (!fileFingerprint || startingRef.current || state === 'running') return
      startingRef.current = true
      setState('running')
      setDonePages(0)
      setTotalPages(0)
      void rosettaApi
        .importBook({ fileFingerprint, ...args })
        .catch(() => {
          setState('error')
          toast.error('罗盘导入请求失败')
        })
        .finally(() => {
          startingRef.current = false
        })
    },
    [fileFingerprint, state],
  )

  const cancelImport = useCallback(() => {
    rosettaApi.cancelImport()
  }, [])

  /** 纯本地目录重建：只写库不调 OCR，成功后刷新书信息 */
  const rebuildToc = useCallback(
    async (toc: RosettaTocEntryInput[]) => {
      if (!fileFingerprint) return null
      const result = await rosettaApi.rebuildToc({ fingerprint: fileFingerprint, toc })
      if (isOk(result)) {
        await refreshInfo()
        return result.value
      }
      toast.error(result.error.message || '罗盘目录更新失败')
      return null
    },
    [fileFingerprint, refreshInfo],
  )

  return { state, phase, donePages, totalPages, info, startImport, cancelImport, refreshInfo, rebuildToc }
}
