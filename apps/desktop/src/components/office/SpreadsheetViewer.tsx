import { useCallback, useEffect, useRef, useState } from 'react'
import * as XLSX from 'xlsx'
import { isOk, type CellInput } from '@montree/contracts'
import { fileApi } from '@/api/file-api'
import { SpreadsheetDocument, tableRange } from '@/lib/data/spreadsheet-document'
import { commitDocumentSelection, clearReaderSelection } from '@/lib/agent/context/reader-selection-registry'
import { registerDocumentTools, notifyDocumentTools } from '@/lib/agent/context/document-tool-registry'
import { useDocumentReader } from '@/hooks/agent/useDocumentReader'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { UniverSheetViewer } from './UniverSheetViewer'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'

interface SpreadsheetViewerProps { filePath?: string; content?: string; onChange?: (content: string) => void; readOnly?: boolean; className?: string }

export function SpreadsheetViewer({ filePath = '', content = '', onChange, readOnly = false, className }: SpreadsheetViewerProps) {
  const model = useRef<SpreadsheetDocument | null>(null)
  const root = useRef<HTMLDivElement>(null)
  const hash = useRef('')
  const emitted = useRef(content)
  const callbacks = useRef({ onChange, readOnly })
  callbacks.current = { onChange, readOnly }
  const [, refresh] = useState(0)
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const [search, setSearch] = useState('')
  const [mode, setMode] = useState<'grid' | 'univer'>('grid')
  const [jump, setJump] = useState('A1')
  const [origin, setOrigin] = useState({ r: 0, c: 0 })
  const anchor = useRef<{ r: number; c: number } | null>(null)
  const binary = /\.xlsx$/i.test(filePath)
  const update = useCallback(() => {
    if (!model.current) return
    if (!binary) { emitted.current = model.current.serializeText(); callbacks.current.onChange?.(emitted.current) }
    refresh((n) => n + 1)
    notifyDocumentTools()
  }, [binary])
  const edit = useCallback((args: Record<string, unknown>) => {
    if (callbacks.current.readOnly) throw new Error('当前表格为只读')
    const result = model.current!.edit(args)
    update()
    return result
  }, [update])
  const save = useCallback(async () => {
    const doc = model.current
    if (!doc) throw new Error('表格正在加载')
    if (callbacks.current.readOnly) throw new Error('当前表格为只读')
    const savedState = doc.snapshotKey()
    setSaving(true)
    try {
      const result = binary ? await fileApi.saveBinaryDocument({ filePath, data: doc.serializeBinary(), expectedHash: hash.current }) : await fileApi.saveFile({ filePath, content: doc.serializeText() })
      if (!isOk(result)) throw new Error(result.error.message)
      if ('hash' in result.value && typeof result.value.hash === 'string') hash.current = result.value.hash
      doc.markSaved(savedState)
      refresh((n) => n + 1); notifyDocumentTools()
    } finally { setSaving(false) }
  }, [binary, filePath])
  useEffect(() => {
    let cancelled = false
    let dispose: (() => void) | undefined
    emitted.current = content
    model.current = null; setError(''); setOrigin({ r: 0, c: 0 }); anchor.current = null
    async function load() {
      try {
        let data: string | Uint8Array = emitted.current
        if (binary) {
          const result = await fileApi.readBinaryFile(filePath)
          if (!isOk(result)) throw new Error(result.error.message)
          data = result.value.data; hash.current = result.value.hash ?? ''
        }
        if (cancelled) return
        model.current = new SpreadsheetDocument(filePath, data)
        dispose = registerDocumentTools({ filePath, kind: 'table', isDirty: () => Boolean(model.current?.dirty), save,
          undo: () => { model.current!.undo(); update() }, read: (args) => model.current!.read(args), edit })
        refresh((n) => n + 1)
      } catch (reason) { if (!cancelled) setError(reason instanceof Error ? reason.message : String(reason)) }
    }
    void load()
    return () => { cancelled = true; dispose?.(); clearReaderSelection() }
  }, [filePath, binary, edit, save, update])
  useEffect(() => {
    if (binary) return
    if (content !== emitted.current) {
      emitted.current = content
      if (model.current) {
        const next = new SpreadsheetDocument(filePath, content)
        next.revision = model.current.revision + 1
        model.current = next
        refresh((n) => n + 1); notifyDocumentTools()
      }
    }
  }, [content, binary, filePath])
  const unitText = (sheet: string): string => {
    const doc = model.current!
    const bounds = doc.bounds(sheet)
    const lines: string[] = []
    for (let r = 0; r <= Math.min(bounds.e.r, 199); r++) {
      const values = Array.from({ length: Math.min(bounds.e.c + 1, 40) }, (_, c) => doc.cell(sheet, r, c))
      lines.push(values.map((cell) => `${cell.address}=${cell.formula ? `=${cell.formula}` : JSON.stringify(cell.value)}`).join('\t'))
    }
    return `工作表 ${sheet}；范围 ${XLSX.utils.encode_range(bounds)}；revision=${doc.revision}\n${lines.join('\n')}\n[正文最多展示前200行40列，其他区域请用 montree_table_read 按地址读取。]`
  }
  useDocumentReader({ filePath, root: () => model.current ? root.current : null, selectionManaged: true,
    text: () => { if (!model.current) throw new Error('表格正在加载'); return unitText(model.current.activeSheet) },
    units: () => model.current?.workbook.SheetNames.map((sheet) => ({ label: sheet, text: unitText(sheet) })) ?? [],
    currentIndex: () => model.current?.workbook.SheetNames.indexOf(model.current.activeSheet) ?? 0,
    viewportText: () => Array.from(root.current?.querySelectorAll<HTMLInputElement>('input[aria-label*="!"]') ?? [])
      .filter((input) => { const rect = input.getBoundingClientRect(); const host = root.current!.getBoundingClientRect(); return rect.bottom > host.top && rect.top < host.bottom && rect.right > host.left && rect.left < host.right })
      .map((input) => `${input.getAttribute('aria-label')}=${JSON.stringify(input.value)}`).join('\n'),
    iterateUnits: async function* () {
      const current = model.current
      if (!current) throw new Error('表格正在加载')
      for (const name of current.workbook.SheetNames) {
        const cells = Object.keys(current.workbook.Sheets[name]).filter((address) => /^[A-Z]+[1-9]\d*$/.test(address))
        for (let i = 0; i < cells.length; i += 100) {
          yield { label: `${name} · ${cells[i]}–${cells[Math.min(cells.length - 1, i + 99)]}`,
            text: cells.slice(i, i + 100).map((address) => { const pos = XLSX.utils.decode_cell(address); const cell = current.cell(name, pos.r, pos.c); return `${address}=${cell.formula ? `=${cell.formula}` : JSON.stringify(cell.value)}` }).join('\n') }
        }
      }
    } })
  const doc = model.current
  const sheet = doc?.activeSheet ?? ''
  const bounds = doc?.bounds(sheet)
  const run = (action: () => void): void => { try { action() } catch (reason) { toast.error(reason instanceof Error ? reason.message : String(reason)) } }
  const select = (ranges: string[]): void => {
    if (!doc) return
    const target = doc.select(sheet, ranges)
    commitDocumentSelection(target, `${sheet}!${ranges.join(', ')}`)
    refresh((n) => n + 1)
  }
  const selectCell = (r: number, c: number, extend: boolean, additive: boolean): void => {
    if (!extend || !anchor.current) anchor.current = { r, c }
    const start = anchor.current
    const range = XLSX.utils.encode_range({ s: { r: Math.min(start.r, r), c: Math.min(start.c, c) }, e: { r: Math.max(start.r, r), c: Math.max(start.c, c) } })
    select(additive && doc?.selection ? [...doc.selection.ranges, range] : [range])
  }
  const rows = bounds ? Array.from({ length: Math.min(500, Math.max(bounds.e.r + 1, origin.r + 30) - origin.r) }, (_, i) => origin.r + i)
    .filter((r) => !search || Array.from({ length: Math.min(bounds.e.c + 1, 100) }, (_, c) => doc!.cell(sheet, r, c).display).some((value) => value.toLowerCase().includes(search.toLowerCase()))) : []
  const columns = bounds ? Array.from({ length: Math.min(100, Math.max(bounds.e.c + 1, origin.c + 10) - origin.c) }, (_, i) => origin.c + i) : []
  const selected = doc?.selection?.ranges.map(tableRange) ?? []
  const commitCell = (address: string, raw: string): void => {
    if (!doc) return
    const pos = XLSX.utils.decode_cell(address)
    const old = doc.cell(sheet, pos.r, pos.c)
    if (raw === (old.formula ? `=${old.formula}` : old.display)) return
    const value: CellInput = binary && raw.startsWith('=') ? { formula: raw.slice(1) } : raw
    run(() => { edit({ revision: doc.revision, sheet, target: { range: address }, operation: 'set', values: [[value]], expectedCount: 1 }) })
  }
  return <div ref={root} className={cn('flex h-full min-h-0 min-w-0 flex-col overflow-hidden', className)}>
    <div className="flex flex-wrap items-center gap-2 border-b p-2 text-xs">
      <span>{filePath.split(/[/\\]/).pop()}{doc?.dirty ? ' · 未保存' : ''}</span>
      <Button size="xs" onClick={() => setMode(mode === 'grid' ? 'univer' : 'grid')}>{mode === 'grid' ? '画布预览' : '数据网格'}</Button>
      <Input aria-label="搜索表格" placeholder="搜索行…" value={search} onChange={(e) => setSearch(e.target.value)} className="h-7 w-32" />
      <Input aria-label="单元格地址" value={jump} onChange={(e) => setJump(e.target.value)} className="h-7 w-24" onKeyDown={(e) => { if (e.key === 'Enter') run(() => { const range = tableRange(jump.toUpperCase()); setOrigin(range.s); select([jump.toUpperCase()]) }) }} />
      <Button size="xs" disabled={!doc || readOnly} onClick={() => run(() => { doc!.undo(); update() })}>撤销</Button>
      <Button size="xs" disabled={!doc || !doc.dirty || saving || readOnly} onClick={() => void save().then(() => toast.success('表格已保存')).catch((reason: Error) => toast.error(reason.message))}>{saving ? '保存中…' : '保存'}</Button>
      <Button size="xs" disabled={!doc || readOnly} onClick={() => run(() => { const range = `${XLSX.utils.encode_col(bounds!.e.c + 1)}1`; edit({ revision: doc!.revision, sheet, target: { range }, operation: 'fill', value: '', expectedCount: 1 }) })}>加一列</Button>
      <Button size="xs" disabled={!doc || readOnly} onClick={() => run(() => { edit({ revision: doc!.revision, sheet, target: { row: bounds!.e.r + 2, start: 1, count: bounds!.e.c + 1 }, operation: 'fill', value: '', expectedCount: bounds!.e.c + 1 }) })}>加一行</Button>
      <span className="text-muted-foreground">Shift 扩展选区，Ctrl 添加选区；输入地址可定位。画布暂为只读预览。</span>
    </div>
    {error ? <p className="p-4 text-destructive">{error}</p> : !doc ? <p className="p-4">正在读取表格…</p> : mode === 'univer' ? <UniverSheetViewer filePath={filePath} workbook={doc.workbook} revision={doc.revision} readOnly onSelection={(name, ranges) => { const target = doc.select(name, ranges); commitDocumentSelection(target, `${name}!${ranges.join(', ')}`); refresh((n) => n + 1) }} /> : <div className="min-h-0 min-w-0 flex-1 overflow-auto">
      <table className="border-collapse text-xs"><thead><tr><th className="sticky top-0 bg-muted p-2">#</th>{columns.map((c) => <th key={c} className="sticky top-0 min-w-32 border bg-muted p-2" onClick={() => select([`${XLSX.utils.encode_col(c)}1:${XLSX.utils.encode_col(c)}${bounds!.e.r + 1}`])}>{XLSX.utils.encode_col(c)}</th>)}</tr></thead>
        <tbody>{rows.map((r) => <tr key={r}><th className="border bg-muted p-2" onClick={() => select([`A${r + 1}:${XLSX.utils.encode_col(bounds!.e.c)}${r + 1}`])}>{r + 1}</th>{columns.map((c) => {
          const cell = doc.cell(sheet, r, c); const active = selected.some((range) => r >= range.s.r && r <= range.e.r && c >= range.s.c && c <= range.e.c)
          return <td key={`${cell.address}:${doc.revision}`} data-cell-address={cell.address} className={cn('border', active && 'bg-primary/15 ring-1 ring-inset ring-primary')} onMouseDown={(e) => selectCell(r, c, e.shiftKey, e.ctrlKey || e.metaKey)} onMouseEnter={(e) => { if (e.buttons === 1) selectCell(r, c, true, false) }}>
            <input aria-label={`${sheet}!${cell.address}`} readOnly={readOnly} defaultValue={cell.formula ? `=${cell.formula}` : cell.display} className="w-36 bg-transparent px-2 py-1.5 outline-none" onBlur={(e) => commitCell(cell.address, e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur() }} />
          </td>
        })}</tr>)}</tbody></table>
      <p className="p-2 text-xs text-muted-foreground">网格一次展示最多500行100列；工具可按任意合法地址读取与修改，每次最多5000格。</p>
    </div>}
    <div className="flex shrink-0 gap-2 border-t p-2">{doc?.workbook.SheetNames.map((name) => <Button key={name} size="xs" variant={sheet === name ? 'secondary' : 'ghost'} onClick={() => { doc.activeSheet = name; doc.selection = null; clearReaderSelection(); setOrigin({ r: 0, c: 0 }); refresh((n) => n + 1) }}>{name}</Button>)}</div>
  </div>
}
