import { memo, useCallback, useMemo, useState } from 'react'
import {
  ArrowDownAZ,
  ArrowUpAZ,
  Code2,
  FileSpreadsheet,
  Plus,
  RotateCcw,
  Search,
  Table as TableIcon,
  Trash2,
  X,
} from 'lucide-react'
import { CsvDataset } from '@/lib/data/csv-dataset'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'

interface DataSheetViewerProps {
  content: string
  onChange: (value: string) => void
  readOnly?: boolean
}

export const DataSheetViewer = memo(function DataSheetViewer({
  content,
  onChange,
  readOnly = false,
}: DataSheetViewerProps) {
  const [viewMode, setViewMode] = useState<'table' | 'raw'>('table')
  const [searchQuery, setSearchQuery] = useState('')
  const [sortCol, setSortCol] = useState<{ index: number; dir: 'asc' | 'desc' } | null>(null)
  const [editingCell, setEditingCell] = useState<{ row: number; col: number; val: string } | null>(null)

  // 解析数据集
  const dataset = useMemo(() => {
    try {
      return CsvDataset.parse(content)
    } catch {
      return new CsvDataset(['原始内容'], [[content]])
    }
  }, [content])

  // 排序与过滤视图行
  const displayRows = useMemo(() => {
    let rows = dataset.getRows().map((row, idx) => ({ originalIndex: idx, cells: row }))

    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase().trim()
      rows = rows.filter((r) => r.cells.some((cell) => cell.toLowerCase().includes(q)))
    }

    if (sortCol !== null) {
      const { index, dir } = sortCol
      rows.sort((a, b) => {
        const valA = a.cells[index] ?? ''
        const valB = b.cells[index] ?? ''
        const numA = Number(valA)
        const numB = Number(valB)
        const isNum = !isNaN(numA) && !isNaN(numB) && valA.trim() !== '' && valB.trim() !== ''

        if (isNum) {
          return dir === 'asc' ? numA - numB : numB - numA
        }
        return dir === 'asc' ? valA.localeCompare(valB, 'zh-CN') : valB.localeCompare(valA, 'zh-CN')
      })
    }

    return rows
  }, [dataset, searchQuery, sortCol])

  // 操作：提交单元格修改
  const handleCommitEdit = useCallback(() => {
    if (!editingCell || readOnly) {
      setEditingCell(null)
      return
    }
    const { row, col, val } = editingCell
    dataset.updateCell(row, col, val)
    onChange(dataset.serialize())
    setEditingCell(null)
  }, [editingCell, dataset, onChange, readOnly])

  // 操作：添加行
  const handleAddRow = useCallback(() => {
    if (readOnly) return
    dataset.insertRow()
    onChange(dataset.serialize())
  }, [dataset, onChange, readOnly])

  // 操作：添加列
  const handleAddColumn = useCallback(() => {
    if (readOnly) return
    const colName = window.prompt('请输入新列名:', `列 ${dataset.columnCount + 1}`)
    if (colName && colName.trim()) {
      dataset.insertColumn(dataset.columnCount, colName.trim())
      onChange(dataset.serialize())
    }
  }, [dataset, onChange, readOnly])

  // 操作：删除行
  const handleDeleteRow = useCallback(
    (originalRowIndex: number) => {
      if (readOnly) return
      dataset.deleteRow(originalRowIndex)
      onChange(dataset.serialize())
    },
    [dataset, onChange, readOnly],
  )

  // 操作：排序列
  const handleToggleSort = useCallback((colIndex: number) => {
    setSortCol((prev) => {
      if (prev?.index === colIndex) {
        return prev.dir === 'asc' ? { index: colIndex, dir: 'desc' } : null
      }
      return { index: colIndex, dir: 'asc' }
    })
  }, [])

  return (
    <div className="flex h-full w-full flex-col bg-background text-foreground select-text">
      {/* 顶部工具栏 */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b bg-muted/40 px-3 py-2 text-xs">
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1.5 font-medium text-muted-foreground">
            <FileSpreadsheet className="size-4 text-primary" />
            <span>
              {dataset.delimiter === '\t' ? 'TSV (制表符)' : 'CSV (逗号)'} · {dataset.rowCount} 行 × {dataset.columnCount} 列
            </span>
          </div>

          <div className="h-4 w-px bg-border" />

          {/* 搜索框 */}
          <div className="relative flex items-center">
            <Search className="absolute left-2 size-3 text-muted-foreground" />
            <Input
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="搜索表格内容..."
              className="h-7 w-40 rounded pl-7 pr-6 text-xs focus-visible:ring-1"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery('')}
                className="absolute right-1.5 text-muted-foreground hover:text-foreground"
              >
                <X className="size-3" />
              </button>
            )}
          </div>

          {sortCol && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setSortCol(null)}
              className="h-7 gap-1 px-2 text-xs text-muted-foreground hover:text-foreground"
              title="清除列排序"
            >
              <RotateCcw className="size-3" />
              重置排序
            </Button>
          )}
        </div>

        {/* 视图模式切换与增行增列 */}
        <div className="flex items-center gap-1.5">
          {!readOnly && viewMode === 'table' && (
            <>
              <Button
                variant="outline"
                size="sm"
                onClick={handleAddRow}
                className="h-7 gap-1 px-2 text-xs"
              >
                <Plus className="size-3 text-primary" />
                新增行
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={handleAddColumn}
                className="h-7 gap-1 px-2 text-xs"
              >
                <Plus className="size-3 text-primary" />
                新增列
              </Button>
              <div className="h-4 w-px bg-border" />
            </>
          )}

          <div className="flex items-center rounded-md border bg-muted/60 p-0.5">
            <Button
              variant={viewMode === 'table' ? 'secondary' : 'ghost'}
              size="sm"
              onClick={() => setViewMode('table')}
              className="h-6 gap-1 px-2 text-xs"
            >
              <TableIcon className="size-3" />
              表格
            </Button>
            <Button
              variant={viewMode === 'raw' ? 'secondary' : 'ghost'}
              size="sm"
              onClick={() => setViewMode('raw')}
              className="h-6 gap-1 px-2 text-xs"
            >
              <Code2 className="size-3" />
              源码
            </Button>
          </div>
        </div>
      </div>

      {/* 主展示区 */}
      <div className="relative flex-1 overflow-auto">
        {viewMode === 'raw' ? (
          <textarea
            value={content}
            readOnly={readOnly}
            onChange={(e) => onChange(e.target.value)}
            className="h-full w-full resize-none bg-background p-4 font-mono text-xs leading-relaxed outline-none"
            spellCheck={false}
          />
        ) : (
          <div className="min-w-full">
            <table className="w-full border-collapse text-left text-xs">
              {/* 粘性表头 */}
              <thead className="sticky top-0 z-10 border-b bg-muted/90 shadow-sm backdrop-blur">
                <tr>
                  <th className="w-12 border-r px-2 py-2 text-center font-medium text-muted-foreground select-none">
                    #
                  </th>
                  {dataset.headers.map((header, colIdx) => {
                    const isSorted = sortCol?.index === colIdx
                    return (
                      <th
                        key={colIdx}
                        onClick={() => handleToggleSort(colIdx)}
                        className="group cursor-pointer border-r px-3 py-2 font-semibold text-foreground transition-colors hover:bg-muted select-none"
                      >
                        <div className="flex items-center justify-between gap-1.5">
                          <span className="truncate">{header}</span>
                          <span className="shrink-0 text-muted-foreground opacity-60 group-hover:opacity-100">
                            {isSorted ? (
                              sortCol.dir === 'asc' ? (
                                <ArrowUpAZ className="size-3.5 text-primary" />
                              ) : (
                                <ArrowDownAZ className="size-3.5 text-primary" />
                              )
                            ) : (
                              <ArrowDownAZ className="size-3 opacity-0 group-hover:opacity-40" />
                            )}
                          </span>
                        </div>
                      </th>
                    )
                  })}
                  {!readOnly && <th className="w-12 px-2 py-2 text-center text-muted-foreground">操作</th>}
                </tr>
              </thead>

              {/* 表体 */}
              <tbody className="divide-y divide-border">
                {displayRows.length === 0 ? (
                  <tr>
                    <td
                      colSpan={dataset.columnCount + 2}
                      className="py-12 text-center text-muted-foreground"
                    >
                      {searchQuery ? '未找到匹配的数据内容' : '表格暂无数据'}
                    </td>
                  </tr>
                ) : (
                  displayRows.map(({ originalIndex, cells }, rowSeq) => (
                    <tr
                      key={originalIndex}
                      className="group transition-colors hover:bg-muted/40"
                    >
                      {/* 行号 */}
                      <td className="border-r px-2 py-1.5 text-center font-mono text-[11px] text-muted-foreground select-none">
                        {rowSeq + 1}
                      </td>

                      {/* 单元格列表 */}
                      {dataset.headers.map((_, colIdx) => {
                        const cellVal = cells[colIdx] ?? ''
                        const isEditing =
                          editingCell?.row === originalIndex && editingCell?.col === colIdx

                        return (
                          <td
                            key={colIdx}
                            onDoubleClick={() => {
                              if (!readOnly) {
                                setEditingCell({
                                  row: originalIndex,
                                  col: colIdx,
                                  val: cellVal,
                                })
                              }
                            }}
                            className={cn(
                              'relative max-w-xs border-r px-3 py-1.5 align-top break-words transition-colors',
                              isEditing
                                ? 'bg-background p-0.5 ring-2 ring-primary ring-offset-1'
                                : 'hover:bg-accent/30',
                            )}
                          >
                            {isEditing ? (
                              <textarea
                                autoFocus
                                value={editingCell.val}
                                onChange={(e) =>
                                  setEditingCell((prev) =>
                                    prev ? { ...prev, val: e.target.value } : null,
                                  )
                                }
                                onBlur={handleCommitEdit}
                                onKeyDown={(e) => {
                                  if (e.key === 'Enter' && !e.shiftKey) {
                                    e.preventDefault()
                                    handleCommitEdit()
                                  } else if (e.key === 'Escape') {
                                    setEditingCell(null)
                                  }
                                }}
                                className="w-full resize-none rounded bg-transparent p-1 font-sans text-xs outline-none"
                                rows={Math.max(1, (editingCell.val.match(/\n/g) || []).length + 1)}
                              />
                            ) : (
                              <div className="whitespace-pre-wrap leading-relaxed">
                                {cellVal.trim() === '' ? (
                                  <span className="text-muted-foreground/40 italic">空</span>
                                ) : (
                                  cellVal
                                )}
                              </div>
                            )}
                          </td>
                        )
                      })}

                      {/* 行删除操作 */}
                      {!readOnly && (
                        <td className="px-2 py-1.5 text-center">
                          <button
                            type="button"
                            onClick={() => handleDeleteRow(originalIndex)}
                            title="删除整行"
                            className="rounded p-1 text-muted-foreground opacity-0 transition-opacity hover:bg-destructive/10 hover:text-destructive group-hover:opacity-100"
                          >
                            <Trash2 className="size-3.5" />
                          </button>
                        </td>
                      )}
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
})
