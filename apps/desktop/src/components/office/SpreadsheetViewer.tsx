import { useCallback, useEffect, useMemo, useState } from 'react'
import * as XLSX from 'xlsx'
import { fileApi } from '@/api/file-api'
import { isOk } from '@montree/contracts'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { toast } from 'sonner'
import {
  Table as TableIcon,
  Plus,
  Trash2,
  Search,
  Download,
  Layers,
  Loader2,
  AlertCircle,
  FileSpreadsheet,
  Sparkles,
  ArrowUp,
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  Eraser,
  Copy,
  Edit2,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { UniverSheetViewer } from './UniverSheetViewer'
import { ScrollArea, ScrollBar } from '@/components/ui/scroll-area'

interface SpreadsheetViewerProps {
  filePath?: string
  content?: string
  onChange?: (newContent: string) => void
  readOnly?: boolean
  className?: string
}

interface SheetData {
  name: string
  headers: string[]
  rows: string[][]
}

interface ContextMenuState {
  x: number
  y: number
  target: 'cell' | 'row' | 'col'
  rowIndex: number
  colIndex: number
}

export function SpreadsheetViewer({
  filePath,
  content,
  onChange,
  readOnly = false,
  className,
}: SpreadsheetViewerProps) {
  const [viewMode, setViewMode] = useState<'univer' | 'grid'>('grid')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [sheetNames, setSheetNames] = useState<string[]>([])
  const [activeSheet, setActiveSheet] = useState<string>('')
  const [sheetsMap, setSheetsMap] = useState<Record<string, SheetData>>({})
  const [searchQuery, setSearchQuery] = useState('')
  const [selectedCell, setSelectedCell] = useState<{ row: number; col: number } | null>(null)
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null)
  const [editingHeaderIndex, setEditingHeaderIndex] = useState<number | null>(null)
  const [headerEditValue, setHeaderEditValue] = useState('')

  const isBinaryExcel = filePath?.endsWith('.xlsx') || filePath?.endsWith('.xls')

  // 全局关闭右键菜单
  useEffect(() => {
    const handleClose = () => setContextMenu(null)
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setContextMenu(null)
    }
    window.addEventListener('click', handleClose)
    window.addEventListener('keydown', handleKeyDown)
    return () => {
      window.removeEventListener('click', handleClose)
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [])

  // 加载数据（支持 .xlsx 二进制文件与 .csv/.tsv 文本内容）
  const loadData = useCallback(async () => {
    setLoading(true)
    setError(null)

    try {
      let workbook: XLSX.WorkBook

      if (isBinaryExcel && filePath) {
        const res = await fileApi.readBinaryFile(filePath)
        if (!isOk(res)) {
          setError(res.error.message || '无法读取 Excel 表格文件')
          setLoading(false)
          return
        }
        workbook = XLSX.read(res.value.data.buffer, { type: 'buffer' })
      } else {
        const text = content ?? ''
        workbook = XLSX.read(text, { type: 'string' })
      }

      const names = workbook.SheetNames
      if (names.length === 0) {
        setSheetNames([])
        setSheetsMap({})
        setActiveSheet('')
        setLoading(false)
        return
      }

      const map: Record<string, SheetData> = {}
      for (const name of names) {
        const worksheet = workbook.Sheets[name]
        const rawRows = XLSX.utils.sheet_to_json<string[]>(worksheet, {
          header: 1,
          defval: '',
          raw: false,
        })

        if (rawRows.length > 0) {
          const headers = (rawRows[0] || []).map((h, i) => String(h || `列 ${i + 1}`))
          const dataRows = rawRows.slice(1).map((r) => {
            const rowArr: string[] = []
            for (let i = 0; i < headers.length; i++) {
              rowArr.push(r[i] !== undefined && r[i] !== null ? String(r[i]) : '')
            }
            return rowArr
          })
          map[name] = { name, headers, rows: dataRows }
        } else {
          map[name] = { name, headers: ['列 1', '列 2', '列 3'], rows: [] }
        }
      }

      setSheetNames(names)
      setSheetsMap(map)
      setActiveSheet((prev) => (names.includes(prev) ? prev : names[0]))
      setLoading(false)
    } catch (err: unknown) {
      console.error('[SpreadsheetViewer] Failed to parse spreadsheet:', err)
      setError(err instanceof Error ? err.message : '表格文件解析失败')
      setLoading(false)
    }
  }, [filePath, content, isBinaryExcel])

  useEffect(() => {
    void loadData()
  }, [loadData])

  const currentSheet = useMemo<SheetData>(() => {
    if (activeSheet && sheetsMap[activeSheet]) {
      return sheetsMap[activeSheet]
    }
    return { name: '', headers: [], rows: [] }
  }, [activeSheet, sheetsMap])

  // 双向更新存盘
  const syncCsvContent = useCallback(
    (headers: string[], rows: string[][]) => {
      if (!isBinaryExcel && onChange) {
        const fullAoa = [headers, ...rows]
        const csvText = XLSX.utils.sheet_to_csv(XLSX.utils.aoa_to_sheet(fullAoa))
        onChange(csvText)
      }
    },
    [isBinaryExcel, onChange],
  )

  // 单元格数据就地修改
  const handleCellChange = (rowIndex: number, colIndex: number, val: string) => {
    if (readOnly || !activeSheet) return

    setSheetsMap((prev) => {
      const sheet = prev[activeSheet]
      if (!sheet) return prev

      const nextRows = sheet.rows.map((r, rIdx) => {
        if (rIdx !== rowIndex) return r
        const nextRow = [...r]
        nextRow[colIndex] = val
        return nextRow
      })

      const updatedSheet: SheetData = { ...sheet, rows: nextRows }
      syncCsvContent(sheet.headers, nextRows)
      return { ...prev, [activeSheet]: updatedSheet }
    })
  }

  // 插入行（指定在上方或下方）
  const handleInsertRow = useCallback(
    (targetRowIndex: number, position: 'above' | 'below') => {
      if (readOnly || !activeSheet) return
      setSheetsMap((prev) => {
        const sheet = prev[activeSheet]
        if (!sheet) return prev
        const insertAt = position === 'above' ? targetRowIndex : targetRowIndex + 1
        const emptyRow = new Array(sheet.headers.length).fill('')
        const nextRows = [
          ...sheet.rows.slice(0, insertAt),
          emptyRow,
          ...sheet.rows.slice(insertAt),
        ]
        const updatedSheet = { ...sheet, rows: nextRows }
        syncCsvContent(sheet.headers, nextRows)
        return { ...prev, [activeSheet]: updatedSheet }
      })
      setContextMenu(null)
      toast.success(`已在第 ${targetRowIndex + 1} 行${position === 'above' ? '上方' : '下方'}插入 1 行`)
    },
    [readOnly, activeSheet, syncCsvContent],
  )

  // 插入列（指定在左侧或右侧）
  const handleInsertCol = useCallback(
    (targetColIndex: number, position: 'left' | 'right') => {
      if (readOnly || !activeSheet) return
      setSheetsMap((prev) => {
        const sheet = prev[activeSheet]
        if (!sheet) return prev
        const insertAt = position === 'left' ? targetColIndex : targetColIndex + 1
        const newColName = `新列 ${sheet.headers.length + 1}`
        const nextHeaders = [
          ...sheet.headers.slice(0, insertAt),
          newColName,
          ...sheet.headers.slice(insertAt),
        ]
        const nextRows = sheet.rows.map((row) => [
          ...row.slice(0, insertAt),
          '',
          ...row.slice(insertAt),
        ])
        const updatedSheet = { ...sheet, headers: nextHeaders, rows: nextRows }
        syncCsvContent(nextHeaders, nextRows)
        return { ...prev, [activeSheet]: updatedSheet }
      })
      setContextMenu(null)
      toast.success(`已在${position === 'left' ? '左侧' : '右侧'}插入 1 列`)
    },
    [readOnly, activeSheet, syncCsvContent],
  )

  // 删除行
  const handleDeleteRow = useCallback(
    (index: number) => {
      if (readOnly || !activeSheet) return
      setSheetsMap((prev) => {
        const sheet = prev[activeSheet]
        if (!sheet) return prev
        const nextRows = sheet.rows.filter((_, idx) => idx !== index)
        const updatedSheet = { ...sheet, rows: nextRows }
        syncCsvContent(sheet.headers, nextRows)
        return { ...prev, [activeSheet]: updatedSheet }
      })
      setContextMenu(null)
      toast.success(`已删除第 ${index + 1} 行`)
    },
    [readOnly, activeSheet, syncCsvContent],
  )

  // 删除列
  const handleDeleteCol = useCallback(
    (index: number) => {
      if (readOnly || !activeSheet) return
      setSheetsMap((prev) => {
        const sheet = prev[activeSheet]
        if (!sheet) return prev
        if (sheet.headers.length <= 1) {
          toast.warning('至少需要保留 1 列')
          return prev
        }
        const colName = sheet.headers[index]
        const nextHeaders = sheet.headers.filter((_, idx) => idx !== index)
        const nextRows = sheet.rows.map((row) => row.filter((_, idx) => idx !== index))
        const updatedSheet = { ...sheet, headers: nextHeaders, rows: nextRows }
        syncCsvContent(nextHeaders, nextRows)
        return { ...prev, [activeSheet]: updatedSheet }
      })
      setContextMenu(null)
      toast.success('已删除列')
    },
    [readOnly, activeSheet, syncCsvContent],
  )

  // 清空单元格
  const handleClearCell = useCallback(
    (rIdx: number, cIdx: number) => {
      handleCellChange(rIdx, cIdx, '')
      setContextMenu(null)
      toast.success('单元格内容已清空')
    },
    [],
  )

  // 复制单元格内容
  const handleCopyCell = useCallback(
    (val: string) => {
      navigator.clipboard.writeText(val)
      setContextMenu(null)
      toast.success('已复制单元格内容')
    },
    [],
  )

  // 重命名列
  const handleSaveHeaderRename = (colIndex: number) => {
    if (readOnly || !activeSheet || !headerEditValue.trim()) {
      setEditingHeaderIndex(null)
      return
    }
    setSheetsMap((prev) => {
      const sheet = prev[activeSheet]
      if (!sheet) return prev
      const nextHeaders = [...sheet.headers]
      nextHeaders[colIndex] = headerEditValue.trim()
      const updatedSheet = { ...sheet, headers: nextHeaders }
      syncCsvContent(nextHeaders, sheet.rows)
      return { ...prev, [activeSheet]: updatedSheet }
    })
    setEditingHeaderIndex(null)
    toast.success('列名已更新')
  }

  // 触发右键上下文菜单
  const openContextMenu = (
    e: React.MouseEvent,
    target: 'cell' | 'row' | 'col',
    rowIndex: number,
    colIndex: number,
  ) => {
    e.preventDefault()
    e.stopPropagation()
    setSelectedCell({ row: rowIndex, col: colIndex })
    const menuWidth = 220
    const menuHeight = 290
    const x = Math.min(e.clientX, window.innerWidth - menuWidth - 10)
    const y = Math.min(e.clientY, window.innerHeight - menuHeight - 10)
    setContextMenu({ x, y, target, rowIndex, colIndex })
  }

  // 导出 CSV
  const handleExportCsv = () => {
    if (!currentSheet.headers.length) return
    const fullAoa = [currentSheet.headers, ...currentSheet.rows]
    const csvContent = XLSX.utils.sheet_to_csv(XLSX.utils.aoa_to_sheet(fullAoa))
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${currentSheet.name || 'sheet'}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  // 搜索过滤
  const filteredRows = useMemo(() => {
    if (!searchQuery.trim()) return currentSheet.rows
    const q = searchQuery.toLowerCase()
    return currentSheet.rows.filter((row) => row.some((cell) => cell.toLowerCase().includes(q)))
  }, [currentSheet.rows, searchQuery])

  const fileName = filePath?.split(/[/\\]/).pop() ?? '电子数据表'

  return (
    <div className={cn('relative flex h-full w-full min-h-0 min-w-0 max-w-full flex-col overflow-hidden bg-background text-foreground', className)}>
      {/* 顶部工具栏 */}
      <div className="flex flex-wrap items-center justify-between border-b border-border bg-muted/40 px-3 py-2 text-xs backdrop-blur-sm gap-2">
        <div className="flex items-center gap-2">
          <FileSpreadsheet className="size-4 text-primary" />
          <span className="font-medium text-foreground max-w-[200px] truncate" title={fileName}>
            {fileName}
          </span>
          <span className="rounded bg-primary/10 px-1.5 py-0.5 text-[10px] font-bold text-primary">
            {isBinaryExcel ? 'EXCEL 工作簿' : '数据表'}
          </span>
          {viewMode === 'grid' && (
            <span className="text-[11px] text-muted-foreground">
              {currentSheet.rows.length} 行 × {currentSheet.headers.length} 列
            </span>
          )}
        </div>

        {/* 模式切换与操作 */}
        <div className="flex items-center gap-2">
          {/* 模式切换胶囊 */}
          <div className="flex items-center rounded-md border border-border bg-muted/60 p-0.5">
            <Button
              variant={viewMode === 'grid' ? 'secondary' : 'ghost'}
              size="xs"
              onClick={() => setViewMode('grid')}
              className="h-6 gap-1 px-2 text-xs"
              title="专业数据网格（支持右键增删行列、就地编辑）"
            >
              <TableIcon className="size-3 text-primary" />
              数据网格
            </Button>
            <Button
              variant={viewMode === 'univer' ? 'secondary' : 'ghost'}
              size="xs"
              onClick={() => setViewMode('univer')}
              className="h-6 gap-1 px-2 text-xs"
              title="Univer 工业级 Excel 画布（支持公式栏、样式与选区）"
            >
              <Sparkles className="size-3 text-primary" />
              Univer Excel
            </Button>
          </div>

          {viewMode === 'grid' && (
            <>
              <div className="relative">
                <Search className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="搜索检索..."
                  className="h-7 w-32 pl-7 text-xs bg-background"
                />
              </div>

              {!readOnly && (
                <>
                  <Button
                    variant="outline"
                    size="xs"
                    onClick={() => handleInsertRow(currentSheet.rows.length, 'below')}
                    className="h-7 gap-1 text-[11px]"
                    title="在末尾新增一行"
                  >
                    <Plus className="size-3 text-primary" />
                    加一行
                  </Button>

                  <Button
                    variant="outline"
                    size="xs"
                    onClick={() => handleInsertCol(currentSheet.headers.length, 'right')}
                    className="h-7 gap-1 text-[11px]"
                    title="在末尾新增一列"
                  >
                    <Plus className="size-3 text-primary" />
                    加一列
                  </Button>
                </>
              )}

              <Button
                variant="ghost"
                size="xs"
                onClick={handleExportCsv}
                title="导出当前工作表为 CSV"
                className="h-7 gap-1 text-[11px] text-muted-foreground hover:text-foreground"
              >
                <Download className="size-3" />
                导出
              </Button>
            </>
          )}
        </div>
      </div>

      {/* 主体渲染区 */}
      {viewMode === 'univer' ? (
        <div className="flex-1 min-h-0 min-w-0 relative overflow-hidden">
          <UniverSheetViewer filePath={filePath} content={content} readOnly={readOnly} />
        </div>
      ) : (
        <div className="relative flex-1 min-h-0 min-w-0 w-full max-w-full overflow-hidden bg-background">
          {loading && (
            <div className="absolute inset-0 z-20 flex flex-col items-center justify-center gap-3 bg-background/80 backdrop-blur-xs">
              <Loader2 className="size-6 animate-spin text-primary" />
              <span className="text-xs text-muted-foreground">正在加载数据表格...</span>
            </div>
          )}

          {error && (
            <div className="flex h-full flex-col items-center justify-center gap-3 text-center p-6">
              <AlertCircle className="size-8 text-destructive" />
              <div className="text-sm font-medium text-destructive">{error}</div>
              <Button variant="outline" size="sm" onClick={() => void loadData()}>
                重试
              </Button>
            </div>
          )}

          {!loading && !error && currentSheet.headers.length > 0 && (
            <ScrollArea type="always" className="h-full w-full">
              <table className="w-max min-w-full border-collapse text-left font-mono text-xs select-text">
              {/* 表头固定 (冻结顶部) */}
              <thead className="sticky top-0 z-20 bg-muted/95 backdrop-blur-sm border-b border-border shadow-xs">
                <tr>
                  {/* 左上角交叉格 (双向冻结顶部与左侧) */}
                  <th className="sticky left-0 top-0 z-30 w-12 bg-muted px-2.5 py-1.5 text-center text-[10px] font-bold text-muted-foreground border-r border-b border-border select-none">
                    #
                  </th>
                  {currentSheet.headers.map((header, colIdx) => (
                    <th
                      key={colIdx}
                      onContextMenu={(e) => openContextMenu(e, 'col', 0, colIdx)}
                      className="border-r border-border px-3 py-1.5 font-semibold text-foreground select-none hover:bg-muted cursor-context-menu min-w-[120px]"
                      title="右键可在左侧/右侧插入列，或删除/重命名此列"
                    >
                      <div className="flex items-center justify-between gap-1">
                        {editingHeaderIndex === colIdx ? (
                          <input
                            type="text"
                            autoFocus
                            value={headerEditValue}
                            onChange={(e) => setHeaderEditValue(e.target.value)}
                            onBlur={() => handleSaveHeaderRename(colIdx)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') handleSaveHeaderRename(colIdx)
                              if (e.key === 'Escape') setEditingHeaderIndex(null)
                            }}
                            className="w-full rounded bg-background px-1 py-0.5 text-xs font-semibold text-foreground border border-primary outline-none"
                          />
                        ) : (
                          <span
                            onDoubleClick={() => {
                              if (!readOnly) {
                                setEditingHeaderIndex(colIdx)
                                setHeaderEditValue(header)
                              }
                            }}
                            className="truncate"
                          >
                            {header}
                          </span>
                        )}
                        <span className="text-[9px] text-muted-foreground/60">
                          {String.fromCharCode(65 + (colIdx % 26))}
                        </span>
                      </div>
                    </th>
                  ))}
                  {!readOnly && (
                    <th className="w-10 px-1 py-1.5 text-center select-none">
                      <Button
                        variant="ghost"
                        size="icon-xs"
                        onClick={() => handleInsertCol(currentSheet.headers.length, 'right')}
                        title="在末尾添加一列"
                        className="size-5 text-muted-foreground hover:text-primary"
                      >
                        <Plus className="size-3" />
                      </Button>
                    </th>
                  )}
                </tr>
              </thead>

              {/* 数据单元格 */}
              <tbody className="divide-y divide-border/60">
                {filteredRows.length === 0 ? (
                  <tr>
                    <td
                      colSpan={currentSheet.headers.length + (readOnly ? 1 : 2)}
                      className="py-16 text-center text-muted-foreground"
                    >
                      没有数据行，点击顶部「加一行」快速开始
                    </td>
                  </tr>
                ) : (
                  filteredRows.map((row, rowIdx) => (
                    <tr key={rowIdx} className="group transition-colors hover:bg-muted/30">
                      {/* 行号 (冻结在左侧，支持右键) */}
                      <td
                        onContextMenu={(e) => openContextMenu(e, 'row', rowIdx, 0)}
                        className="sticky left-0 z-10 w-12 bg-background px-2.5 py-1 text-center text-[10px] text-muted-foreground/60 border-r border-border select-none group-hover:bg-muted/80 group-hover:text-foreground cursor-context-menu hover:bg-primary/10"
                        title="右键可在上方/下方插入行，或删除此行"
                      >
                        {rowIdx + 1}
                      </td>

                      {/* 单元格（支持右键） */}
                      {row.map((cellValue, colIdx) => {
                        const isSelected =
                          selectedCell?.row === rowIdx && selectedCell?.col === colIdx
                        return (
                          <td
                            key={colIdx}
                            onClick={() => setSelectedCell({ row: rowIdx, col: colIdx })}
                            onContextMenu={(e) => openContextMenu(e, 'cell', rowIdx, colIdx)}
                            className={cn(
                              'border-r border-border/70 p-0 cursor-context-menu',
                              isSelected && 'ring-1 ring-primary bg-primary/5',
                            )}
                          >
                            {readOnly ? (
                              <div className="px-2.5 py-1.5 truncate max-w-[280px]" title={cellValue}>
                                {cellValue}
                              </div>
                            ) : (
                              <input
                                type="text"
                                value={cellValue}
                                onChange={(e) => handleCellChange(rowIdx, colIdx, e.target.value)}
                                className="h-full w-full bg-transparent px-2.5 py-1.5 text-xs text-foreground outline-none focus:bg-background focus:ring-1 focus:ring-primary"
                              />
                            )}
                          </td>
                        )
                      })}

                      {/* 快速删除行 */}
                      {!readOnly && (
                        <td className="w-10 px-1 py-0.5 text-center">
                          <Button
                            variant="ghost"
                            size="icon-xs"
                            onClick={() => handleDeleteRow(rowIdx)}
                            title="删除此行"
                            className="size-6 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 hover:text-destructive"
                          >
                            <Trash2 className="size-3" />
                          </Button>
                        </td>
                      )}
                    </tr>
                  ))
                )}
              </tbody>
            </table>
            <ScrollBar orientation="horizontal" className="z-40 h-2.5 border-t border-border bg-muted/40" />
            <ScrollBar orientation="vertical" className="z-40 w-2.5 border-l border-border bg-muted/40" />
          </ScrollArea>
        )}
      </div>
    )}

      {/* 底部多工作表 Sheet 标签栏 */}
      {viewMode === 'grid' && sheetNames.length > 0 && (
        <div className="shrink-0 flex items-center gap-1 border-t border-border bg-muted/40 px-2 py-1.5 text-xs overflow-x-auto select-none">
          <div className="flex items-center gap-1 text-muted-foreground mr-1 select-none">
            <Layers className="size-3.5 text-primary" />
            <span className="text-[10px] font-semibold">工作表:</span>
          </div>

          {sheetNames.map((name) => {
            const isActive = name === activeSheet
            return (
              <button
                key={name}
                type="button"
                onClick={() => setActiveSheet(name)}
                className={cn(
                  'flex items-center gap-1 rounded px-2.5 py-1 text-xs font-medium transition-colors cursor-pointer select-none',
                  isActive
                    ? 'bg-background text-primary shadow-xs border border-border/80'
                    : 'text-muted-foreground hover:bg-muted/80 hover:text-foreground',
                )}
              >
                <TableIcon className="size-3" />
                <span>{name}</span>
              </button>
            )
          })}
        </div>
      )}

      {/* 媲美 Excel 的右键上下文菜单（Context Menu） */}
      {contextMenu && !readOnly && (
        <div
          className="fixed z-50 min-w-52 rounded-md border border-border bg-popover p-1 text-popover-foreground shadow-xl backdrop-blur-md animate-in fade-in-0 zoom-in-95 text-xs select-none"
          style={{ left: contextMenu.x, top: contextMenu.y }}
          onClick={(e) => e.stopPropagation()}
        >
          {/* 行操作 */}
          <button
            onClick={() => handleInsertRow(contextMenu.rowIndex, 'above')}
            className="flex w-full items-center gap-2 rounded px-2 py-1.5 hover:bg-accent hover:text-accent-foreground text-left cursor-pointer"
          >
            <ArrowUp className="size-3.5 text-primary" />
            <span>在上方插入一行</span>
          </button>
          <button
            onClick={() => handleInsertRow(contextMenu.rowIndex, 'below')}
            className="flex w-full items-center gap-2 rounded px-2 py-1.5 hover:bg-accent hover:text-accent-foreground text-left cursor-pointer"
          >
            <ArrowDown className="size-3.5 text-primary" />
            <span>在下方插入一行</span>
          </button>

          <div className="my-1 h-px bg-border/60" />

          {/* 列操作 */}
          <button
            onClick={() => handleInsertCol(contextMenu.colIndex, 'left')}
            className="flex w-full items-center gap-2 rounded px-2 py-1.5 hover:bg-accent hover:text-accent-foreground text-left cursor-pointer"
          >
            <ArrowLeft className="size-3.5 text-primary" />
            <span>在左侧插入一列</span>
          </button>
          <button
            onClick={() => handleInsertCol(contextMenu.colIndex, 'right')}
            className="flex w-full items-center gap-2 rounded px-2 py-1.5 hover:bg-accent hover:text-accent-foreground text-left cursor-pointer"
          >
            <ArrowRight className="size-3.5 text-primary" />
            <span>在右侧插入一列</span>
          </button>

          <div className="my-1 h-px bg-border/60" />

          {/* 单元格与重命名 */}
          {contextMenu.target === 'col' && (
            <button
              onClick={() => {
                setEditingHeaderIndex(contextMenu.colIndex)
                setHeaderEditValue(currentSheet.headers[contextMenu.colIndex] || '')
                setContextMenu(null)
              }}
              className="flex w-full items-center gap-2 rounded px-2 py-1.5 hover:bg-accent hover:text-accent-foreground text-left cursor-pointer"
            >
              <Edit2 className="size-3.5 text-primary" />
              <span>重命名此列</span>
            </button>
          )}

          {contextMenu.target === 'cell' && (
            <>
              <button
                onClick={() => {
                  const cellVal =
                    currentSheet.rows[contextMenu.rowIndex]?.[contextMenu.colIndex] ?? ''
                  handleCopyCell(cellVal)
                }}
                className="flex w-full items-center gap-2 rounded px-2 py-1.5 hover:bg-accent hover:text-accent-foreground text-left cursor-pointer"
              >
                <Copy className="size-3.5 text-muted-foreground" />
                <span>复制单元格内容</span>
              </button>
              <button
                onClick={() => handleClearCell(contextMenu.rowIndex, contextMenu.colIndex)}
                className="flex w-full items-center gap-2 rounded px-2 py-1.5 hover:bg-accent hover:text-accent-foreground text-left cursor-pointer"
              >
                <Eraser className="size-3.5 text-muted-foreground" />
                <span>清空单元格内容</span>
              </button>
              <div className="my-1 h-px bg-border/60" />
            </>
          )}

          {/* 删除操作 */}
          <button
            onClick={() => handleDeleteRow(contextMenu.rowIndex)}
            className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-destructive hover:bg-destructive/10 text-left cursor-pointer"
          >
            <Trash2 className="size-3.5" />
            <span>删除第 {contextMenu.rowIndex + 1} 行</span>
          </button>
          <button
            onClick={() => handleDeleteCol(contextMenu.colIndex)}
            className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-destructive hover:bg-destructive/10 text-left cursor-pointer"
          >
            <Trash2 className="size-3.5" />
            <span>删除第 {contextMenu.colIndex + 1} 列 ({currentSheet.headers[contextMenu.colIndex]})</span>
          </button>
        </div>
      )}
    </div>
  )
}
