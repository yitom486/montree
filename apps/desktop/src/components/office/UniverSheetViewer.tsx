import { useEffect, useRef, useState } from 'react'
import * as XLSX from 'xlsx'
import { createUniver, LocaleType } from '@univerjs/presets'
import { UniverSheetsCorePreset } from '@univerjs/preset-sheets-core'
import zhCN from '@univerjs/preset-sheets-core/locales/zh-CN'
import enUS from '@univerjs/preset-sheets-core/locales/en-US'
import '@univerjs/preset-sheets-core/lib/index.css'
import { fileApi } from '@/api/file-api'
import { isOk } from '@montree/contracts'
import { useEditorUiStore } from '@/stores/editor-ui-store'
import { Button } from '@/components/ui/button'
import { FileSpreadsheet, Loader2, AlertCircle, RefreshCw } from 'lucide-react'
import { cn } from '@/lib/utils'

interface UniverSheetViewerProps {
  filePath?: string
  content?: string
  workbook?: XLSX.WorkBook
  revision?: number
  onSelection?: (sheet: string, ranges: string[]) => void
  readOnly?: boolean
  className?: string
}

export function UniverSheetViewer({
  filePath,
  content,
  workbook,
  revision,
  onSelection,
  readOnly = false,
  className,
}: UniverSheetViewerProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const selectionCallback = useRef(onSelection)
  selectionCallback.current = onSelection
  const univerInstanceRef = useRef<{ dispose: () => void } | null>(null)
  const theme = useEditorUiStore((state) => state.theme)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const isBinaryExcel = filePath?.endsWith('.xlsx') || filePath?.endsWith('.xls')
  const fileName = filePath?.split(/[/\\]/).pop() ?? '电子表格'

  useEffect(() => {
    let isCancelled = false

    async function initUniver() {
      if (!containerRef.current) return
      setLoading(true)
      setError(null)

      // 释放旧实例
      if (univerInstanceRef.current) {
        try {
          univerInstanceRef.current.dispose()
        } catch {
          // ignore
        }
        univerInstanceRef.current = null
      }

      containerRef.current.innerHTML = ''

      try {
        let workbookData: XLSX.WorkBook

        if (workbook) {
          workbookData = workbook
        } else if (isBinaryExcel && filePath) {
          const res = await fileApi.readBinaryFile(filePath)
          if (!isOk(res)) {
            if (!isCancelled) {
              setError(res.error.message || '无法读取 Excel 表格文件')
              setLoading(false)
            }
            return
          }
          workbookData = XLSX.read(res.value.data.buffer, { type: 'buffer' })
        } else {
          // CSV / TSV 纯文本
          const text = content ?? ''
          workbookData = XLSX.read(text, { type: 'string' })
        }

        if (isCancelled) return

        // 创建 Univer 实例并注入本地语言包
        const { univer, univerAPI } = createUniver({
          locale: LocaleType.ZH_CN,
          locales: {
            [LocaleType.ZH_CN]: zhCN,
            [LocaleType.EN_US]: enUS,
          },
          darkMode: theme === 'dark',
          presets: [
            UniverSheetsCorePreset({
              container: containerRef.current,
              header: true,
              footer: {
                sheetBar: true,
                statisticBar: true,
                zoomSlider: true,
              },
            }),
          ],
        })

        univerInstanceRef.current = univer

        // 构建 Univer 数据模型
        const sheetObj: Record<string, any> = {}
        const sheetNames = workbookData.SheetNames.length > 0 ? workbookData.SheetNames : ['Sheet1']

        sheetNames.forEach((sheetName, index) => {
          const ws = workbookData.Sheets[sheetName]
          const rawAoa = ws
            ? XLSX.utils.sheet_to_json<any[]>(ws, { header: 1, defval: '', raw: true })
            : []

          const cellData: Record<number, Record<number, { v: any }>> = {}
          let maxCols = 10

          for (let r = 0; r < rawAoa.length; r++) {
            const row = rawAoa[r]
            if (row && row.length > maxCols) maxCols = row.length
            cellData[r] = {}
            for (let c = 0; c < (row ? row.length : 0); c++) {
              const val = row[c]
              if (val !== undefined && val !== null && val !== '') {
                cellData[r][c] = { v: val }
              }
            }
          }

          const sheetId = `sheet_${index + 1}`
          sheetObj[sheetId] = {
            id: sheetId,
            name: sheetName,
            rowCount: Math.max(100, rawAoa.length + 30),
            columnCount: Math.max(26, maxCols + 10),
            cellData,
          }
        })

        const sheetOrder = Object.keys(sheetObj)

        const createdWorkbook = univerAPI.createWorkbook({
          id: 'montree-univer-workbook',
          name: fileName,
          sheets: sheetObj,
          sheetOrder,
        })
        createdWorkbook.setEditable(!readOnly)
        univerAPI.addEvent(univerAPI.Event.SelectionChanged, ({ worksheet, selections }) => {
          const name = sheetObj[worksheet.getSheetId()]?.name as string | undefined
          if (name && selections.length) selectionCallback.current?.(name, selections.map((range) => XLSX.utils.encode_range({ s: { r: range.startRow, c: range.startColumn }, e: { r: range.endRow, c: range.endColumn } })))
        })

        if (!isCancelled) {
          setLoading(false)
        }
      } catch (err: unknown) {
        console.error('[UniverSheetViewer] Initialization failed:', err)
        if (!isCancelled) {
          setError(err instanceof Error ? err.message : 'Univer 电子表格引擎启动失败')
          setLoading(false)
        }
      }
    }

    void initUniver()

    return () => {
      isCancelled = true
      if (univerInstanceRef.current) {
        try {
          univerInstanceRef.current.dispose()
        } catch {
          // ignore
        }
        univerInstanceRef.current = null
      }
    }
  }, [filePath, content, isBinaryExcel, theme, fileName, workbook, readOnly, revision])

  return (
    <div className={cn('relative flex h-full w-full flex-col bg-background text-foreground', className)}>
      {/* 顶部极简信息条 */}
      <div className="flex items-center justify-between border-b border-border bg-muted/40 px-3 py-1.5 text-xs backdrop-blur-sm">
        <div className="flex items-center gap-2">
          <FileSpreadsheet className="size-4 text-primary" />
          <span className="font-medium text-foreground max-w-[240px] truncate" title={fileName}>
            {fileName}
          </span>
          <span className="rounded bg-primary/10 px-1.5 py-0.5 text-[10px] font-bold text-primary tracking-wide">
            UNIVER EXCEL 画布
          </span>
        </div>

        {error && (
          <Button
            variant="ghost"
            size="xs"
            onClick={() => window.location.reload()}
            className="h-6 gap-1 text-[11px] text-destructive hover:bg-destructive/10"
          >
            <RefreshCw className="size-3" />
            重试
          </Button>
        )}
      </div>

      {/* 主画布容器 */}
      <div className="relative flex-1 overflow-hidden">
        {loading && (
          <div className="absolute inset-0 z-20 flex flex-col items-center justify-center gap-3 bg-background/80 backdrop-blur-xs">
            <Loader2 className="size-6 animate-spin text-primary" />
            <span className="text-xs text-muted-foreground">正在加载 Univer Canvas 渲染引擎...</span>
          </div>
        )}

        {error && (
          <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center">
            <AlertCircle className="size-8 text-destructive" />
            <div className="text-sm font-medium text-destructive">{error}</div>
            <div className="text-xs text-muted-foreground max-w-md">
              未能启动 Univer 渲染器。您可以在上级切换到数据网格视图。
            </div>
          </div>
        )}

        <div ref={containerRef} className="h-full w-full" />
      </div>
    </div>
  )
}
