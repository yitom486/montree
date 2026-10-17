import * as XLSX from 'xlsx'
import { unzipSync, zipSync, strFromU8, strToU8 } from 'fflate'
import type { CellInput, TableSelection, TableTarget } from '@yitom/contracts'
import { FormulaEvaluator } from './formula-evaluator'

export const TABLE_CELL_LIMIT = 5000
const NS = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'
const parseXml = (text: string): Document => {
  const doc = new DOMParser().parseFromString(text, 'application/xml')
  if (doc.querySelector('parsererror')) throw new Error('Excel XML 无法解析')
  return doc
}
const xmlText = (doc: Document): Uint8Array => strToU8(new XMLSerializer().serializeToString(doc))

export function tableRange(address: string): XLSX.Range {
  if (typeof address !== 'string' || !/^[A-Z]+[1-9]\d*(?::[A-Z]+[1-9]\d*)?$/.test(address)) throw new Error('范围必须为 A1 或 A1:B2 地址')
  const range = XLSX.utils.decode_range(address)
  if (range.e.r < range.s.r || range.e.c < range.s.c || range.e.r >= 1048576 || range.e.c >= 16384) throw new Error('单元格范围越界或顺序错误')
  return range
}
const rangeCount = (range: XLSX.Range): number => (range.e.r - range.s.r + 1) * (range.e.c - range.s.c + 1)

function validateValue(value: unknown): asserts value is CellInput {
  if (value === null || typeof value === 'boolean' || (typeof value === 'number' && Number.isFinite(value))) return
  if (typeof value === 'string' && value.length <= 32767) return
  if (value && typeof value === 'object' && Object.keys(value).length === 1 && 'formula' in value &&
    typeof value.formula === 'string' && value.formula.length > 0 && value.formula.length <= 8192) return
  throw new Error('单元格值必须为有限数字、文本、布尔值、null 或 {formula: "..."}')
}

export class SpreadsheetDocument {
  workbook: XLSX.WorkBook
  activeSheet: string
  revision = 0
  selection: TableSelection | null = null
  private selectionSerial = 0
  private history: XLSX.WorkBook[] = []
  private savedState: string
  private touched = new Map<string, Set<string>>()
  private original?: Uint8Array
  private sharedFormulaRanges = new Map<string, XLSX.Range[]>()
  readonly separator: ',' | '\t'
  readonly newline: '\n' | '\r\n'
  readonly bom: boolean

  constructor(readonly filePath: string, data: string | Uint8Array) {
    this.separator = /\.tsv$/i.test(filePath) ? '\t' : ','
    this.newline = typeof data === 'string' && data.includes('\r\n') ? '\r\n' : '\n'
    this.bom = typeof data === 'string' && data.startsWith('\uFEFF')
    if (typeof data === 'string') {
      this.workbook = XLSX.read(data.replace(/^\uFEFF/, ''), { type: 'string', raw: true, FS: this.separator })
    } else {
      this.original = data.slice()
      this.workbook = XLSX.read(data, { type: 'array', cellStyles: true, cellNF: true })
      const files = unzipSync(data)
      const workbookXml = parseXml(strFromU8(files['xl/workbook.xml']))
      const rels = parseXml(strFromU8(files['xl/_rels/workbook.xml.rels']))
      for (const sheet of Array.from(workbookXml.getElementsByTagNameNS(NS, 'sheet'))) {
        const rel = Array.from(rels.getElementsByTagName('Relationship')).find((node) => node.getAttribute('Id') === sheet.getAttribute('r:id'))
        const target = rel?.getAttribute('Target')
        if (!target) continue
        const path = new URL(target, 'https://xlsx.invalid/xl/workbook.xml').pathname.slice(1)
        if (!files[path]) continue
        const doc = parseXml(strFromU8(files[path]))
        this.sharedFormulaRanges.set(sheet.getAttribute('name') ?? '', Array.from(doc.getElementsByTagNameNS(NS, 'f'))
          .filter((node) => node.getAttribute('t') === 'shared' && node.hasAttribute('ref')).map((node) => XLSX.utils.decode_range(node.getAttribute('ref')!)))
      }
    }
    if (!this.workbook.SheetNames.length) XLSX.utils.book_append_sheet(this.workbook, XLSX.utils.aoa_to_sheet([['']]), 'Sheet1')
    this.activeSheet = this.workbook.SheetNames[0]
    this.recalculate()
    this.savedState = this.stateKey()
  }

  recalculate(): void {
    new FormulaEvaluator(this.workbook).evaluateAll()
  }

  private stateKey(): string { return JSON.stringify(this.workbook.Sheets, (key, value) => key === 'w' ? undefined : value) }
  get dirty(): boolean { return this.stateKey() !== this.savedState }
  snapshotKey(): string { return this.stateKey() }
  markSaved(state = this.stateKey()): void { this.savedState = state }
  bounds(sheet = this.activeSheet): XLSX.Range {
    const ws = this.workbook.Sheets[sheet]
    if (!ws) throw new Error('工作表不存在')
    return XLSX.utils.decode_range(ws['!ref'] ?? 'A1')
  }
  cell(sheet: string, row: number, column: number) {
    const address = XLSX.utils.encode_cell({ r: row, c: column })
    const cell = this.workbook.Sheets[sheet]?.[address] as XLSX.CellObject | undefined
    const formatted = cell ? XLSX.utils.format_cell(cell) : ''
    const display = formatted || (cell?.v !== null && cell?.v !== undefined ? String(cell.v) : '')
    return { address, value: cell?.v ?? null, display, ...(cell?.f ? { formula: cell.f } : {}) }
  }
  select(sheet: string, ranges: string[]): TableSelection {
    if (!this.workbook.Sheets[sheet]) throw new Error('工作表不存在')
    if (!ranges.length || ranges.length > 20) throw new Error('选区数量应为 1–20')
    ranges.forEach(tableRange)
    this.activeSheet = sheet
    this.selection = { kind: 'table', documentPath: this.filePath, sheet, ranges, revision: this.revision,
      selectionId: `${this.filePath}:${++this.selectionSerial}:${this.revision}` }
    return this.selection
  }

  private resolve(sheet: string, target: TableTarget): string[] {
    if (!target || typeof target !== 'object') throw new Error('缺少编辑目标')
    const modes = [target.range !== undefined, target.ranges !== undefined, target.selectionId !== undefined, target.row !== undefined, target.column !== undefined].filter(Boolean).length
    if (modes !== 1) throw new Error('target 必须且只能指定 range、ranges、selectionId、row、column 之一')
    if (target.selectionId) {
      if (this.selection?.selectionId !== target.selectionId || this.selection.sheet !== sheet || this.selection.revision !== this.revision) throw new Error('选区已变化或过期，请重新读取选区')
      return this.selection.ranges
    }
    if (target.row !== undefined || target.column !== undefined) {
      if (!Number.isInteger(target.start) || !Number.isInteger(target.count) || target.start! < 1 || target.count! < 1) throw new Error('行列目标需要 start、count（从 1 开始）')
      if (target.row !== undefined) {
        if (!Number.isInteger(target.row) || target.row < 1) throw new Error('row 必须为正整数')
        return [XLSX.utils.encode_range({ s: { r: target.row - 1, c: target.start! - 1 }, e: { r: target.row - 1, c: target.start! + target.count! - 2 } })]
      }
      if (typeof target.column !== 'string' || !/^[A-Z]+$/.test(target.column)) throw new Error('column 应为 A、B、AA 等列名')
      return [`${target.column}${target.start}:${target.column}${target.start! + target.count! - 1}`]
    }
    const addresses = target.range !== undefined ? [target.range] : target.ranges
    if (!Array.isArray(addresses) || !addresses.length || addresses.length > 20) throw new Error('范围数量应为 1–20')
    return addresses
  }

  read(args: Record<string, unknown>) {
    if (args.sheet === undefined) return { documentPath: this.filePath, revision: this.revision,
      sheets: this.workbook.SheetNames.map((name) => ({ name, range: this.workbook.Sheets[name]['!ref'] ?? 'A1' })),
      activeSheet: this.activeSheet, selection: this.selection, dirty: this.dirty, formulaCalculation: '已内置公式求值引擎自动计算依赖并缓存结果' }
    if (typeof args.sheet !== 'string' || !this.workbook.Sheets[args.sheet]) throw new Error('工作表不存在')
    const ranges = this.resolve(args.sheet, (args.target ?? { range: args.range ?? this.workbook.Sheets[args.sheet]['!ref'] ?? 'A1' }) as TableTarget)
    const decoded = ranges.map(tableRange)
    if (decoded.reduce((sum, r) => sum + rangeCount(r), 0) > TABLE_CELL_LIMIT) throw new Error(`单次读取最多 ${TABLE_CELL_LIMIT} 个单元格，请缩小范围`)
    return { documentPath: this.filePath, sheet: args.sheet, revision: this.revision, regions: decoded.map((range, i) => ({ range: ranges[i],
      cells: Array.from({ length: range.e.r - range.s.r + 1 }, (_, r) => Array.from({ length: range.e.c - range.s.c + 1 }, (_, c) => this.cell(args.sheet as string, range.s.r + r, range.s.c + c))) })) }
  }

  edit(args: Record<string, unknown>) {
    if (args.revision !== this.revision) throw new Error('文档版本已变化，请重新读取后再编辑')
    const sheet = args.sheet
    if (typeof sheet !== 'string' || !this.workbook.Sheets[sheet]) throw new Error('工作表不存在')
    if (!['set', 'fill', 'clear'].includes(String(args.operation))) throw new Error('operation 应为 set、fill 或 clear')
    const addresses = this.resolve(sheet, args.target as TableTarget)
    const ranges = addresses.map(tableRange)
    const count = ranges.reduce((sum, r) => sum + rangeCount(r), 0)
    if (count > TABLE_CELL_LIMIT || args.expectedCount !== count) throw new Error(`目标为 ${count} 个单元格，expectedCount 必须一致且最多 ${TABLE_CELL_LIMIT}`)
    const positions = new Set<string>()
    const changes: Array<{ address: string; value: CellInput }> = []
    if (args.operation === 'set') {
      if (ranges.length !== 1) throw new Error('set 需要单个矩形范围；多个选区请分批 set 或使用 fill/clear')
      const range = ranges[0]
      const rows = args.values
      if (!Array.isArray(rows) || rows.length !== range.e.r - range.s.r + 1 || rows.some((row) => !Array.isArray(row) || row.length !== range.e.c - range.s.c + 1)) throw new Error('values 的行数和每行列数必须与目标范围完全匹配')
    }
    for (const range of ranges) for (let r = range.s.r; r <= range.e.r; r++) for (let c = range.s.c; c <= range.e.c; c++) {
      const address = XLSX.utils.encode_cell({ r, c })
      if (positions.has(address)) throw new Error('选区重叠，不能重复写入同一单元格')
      positions.add(address)
      const value = args.operation === 'clear' ? null : args.operation === 'fill' ? args.value : (args.values as CellInput[][])[r - range.s.r][c - range.s.c]
      validateValue(value)
      if (!this.original && typeof value === 'object' && value !== null) throw new Error('CSV/TSV 不支持公式，请写入明确的文本值')
      const ws = this.workbook.Sheets[sheet]
      const existing = ws[address] as XLSX.CellObject | undefined
      if (existing?.F || (existing as (XLSX.CellObject & { D?: boolean }) | undefined)?.D) throw new Error('不能单独修改数组公式或动态数组单元格')
      if ((this.sharedFormulaRanges.get(sheet) ?? []).some((range) => r >= range.s.r && r <= range.e.r && c >= range.s.c && c <= range.e.c)) throw new Error('不能单独修改共享公式区域，请先在 Excel 中解除共享公式')
      if ((ws['!merges'] ?? []).some((merge) => r >= merge.s.r && r <= merge.e.r && c >= merge.s.c && c <= merge.e.c)) throw new Error('合并单元格暂不支持工具写入，请先取消合并')
      changes.push({ address, value })
    }
    this.history.push(structuredClone(this.workbook))
    if (this.history.length > 30) this.history.shift()
    const ws = this.workbook.Sheets[sheet]
    const touched = this.touched.get(sheet) ?? new Set<string>()
    const bounds = this.bounds(sheet)
    for (const { address, value } of changes) {
      const old = ws[address] as XLSX.CellObject | undefined
      const { w: _w, f: _f, F: _F, v: _v, t: _t, ...style } = old ?? {}
      if (value === null) { if (Object.keys(style).length) ws[address] = { ...style, t: 'z' }; else delete ws[address] }
      else if (typeof value === 'object') ws[address] = { ...style, t: 'n', f: value.formula.replace(/^=/, '') }
      else ws[address] = { ...style, t: typeof value === 'number' ? 'n' : typeof value === 'boolean' ? 'b' : 's', v: value }
      touched.add(address)
      const pos = XLSX.utils.decode_cell(address)
      bounds.s.r = Math.min(bounds.s.r, pos.r); bounds.s.c = Math.min(bounds.s.c, pos.c)
      bounds.e.r = Math.max(bounds.e.r, pos.r); bounds.e.c = Math.max(bounds.e.c, pos.c)
    }
    ws['!ref'] = XLSX.utils.encode_range(bounds)
    this.recalculate()
    this.touched.set(sheet, touched)
    this.revision++
    return { documentPath: this.filePath, revision: this.revision, sheet, ranges: addresses, changedCount: count, dirty: this.dirty }
  }

  undo(): void {
    const previous = this.history.pop()
    if (!previous) throw new Error('没有可撤销的表格修改')
    this.workbook = previous
    this.recalculate()
    this.revision++
  }

  serializeText(): string {
    return `${this.bom ? '\uFEFF' : ''}${XLSX.utils.sheet_to_csv(this.workbook.Sheets[this.workbook.SheetNames[0]], { FS: this.separator, RS: this.newline })}`
  }

  /** 定点改 XML，不重建工作簿，保留图表、样式、图片和其他未编辑部件。 */
  serializeBinary(): Uint8Array {
    if (!this.original) throw new Error('当前不是 XLSX 文档')
    const files: Record<string, Uint8Array> = unzipSync(this.original)
    const workbook = parseXml(strFromU8(files['xl/workbook.xml']))
    const rels = parseXml(strFromU8(files['xl/_rels/workbook.xml.rels']))
    for (const [sheet, touched] of this.touched) {
      const item = Array.from(workbook.getElementsByTagNameNS(NS, 'sheet')).find((node) => node.getAttribute('name') === sheet)
      const rid = item?.getAttribute('r:id')
      const rel = Array.from(rels.getElementsByTagName('Relationship')).find((node) => node.getAttribute('Id') === rid)
      const target = rel?.getAttribute('Target')
      if (!target) throw new Error('找不到工作表 XML 关系')
      const path = new URL(target, 'https://xlsx.invalid/xl/workbook.xml').pathname.slice(1)
      if (!files[path]) throw new Error('工作表 XML 不存在')
      const doc = parseXml(strFromU8(files[path]))
      const data = doc.getElementsByTagNameNS(NS, 'sheetData')[0]
      if (!data) throw new Error('工作表缺少 sheetData')
      for (const address of touched) {
        const pos = XLSX.utils.decode_cell(address)
        let row = Array.from(data.children).find((node) => node.localName === 'row' && node.getAttribute('r') === String(pos.r + 1))
        if (!row) {
          row = doc.createElementNS(NS, 'row'); row.setAttribute('r', String(pos.r + 1))
          data.insertBefore(row, Array.from(data.children).find((node) => Number(node.getAttribute('r')) > pos.r + 1) ?? null)
        }
        let cell = Array.from(row.children).find((node) => node.localName === 'c' && node.getAttribute('r') === address)
        if (!cell) {
          cell = doc.createElementNS(NS, 'c'); cell.setAttribute('r', address)
          row.insertBefore(cell, Array.from(row.children).find((node) => XLSX.utils.decode_cell(node.getAttribute('r') ?? 'A1').c > pos.c) ?? null)
        }
        Array.from(cell.children).filter((node) => ['v', 'f', 'is'].includes(node.localName)).forEach((node) => node.remove())
        cell.removeAttribute('t')
        const value = this.workbook.Sheets[sheet][address] as XLSX.CellObject | undefined
        if (value?.f) { const f = doc.createElementNS(NS, 'f'); f.textContent = value.f; cell.append(f); const v = doc.createElementNS(NS, 'v'); v.textContent = String(value.v ?? 0); cell.append(v) }
        else if (value?.v !== undefined) {
          if (typeof value.v === 'string') {
            cell.setAttribute('t', 'inlineStr')
            const inline = doc.createElementNS(NS, 'is'); const t = doc.createElementNS(NS, 't')
            t.setAttribute('xml:space', 'preserve'); t.textContent = value.v; inline.append(t); cell.append(inline)
          } else { cell.setAttribute('t', typeof value.v === 'boolean' ? 'b' : 'n'); const v = doc.createElementNS(NS, 'v'); v.textContent = typeof value.v === 'boolean' ? value.v ? '1' : '0' : String(value.v); cell.append(v) }
        }
      }
      const dimension = doc.getElementsByTagNameNS(NS, 'dimension')[0]
      dimension?.setAttribute('ref', this.workbook.Sheets[sheet]['!ref'] ?? 'A1')
      files[path] = xmlText(doc)
    }
    if (this.touched.size) {
      let calc = workbook.getElementsByTagNameNS(NS, 'calcPr')[0]
      if (!calc) { calc = workbook.createElementNS(NS, 'calcPr'); workbook.documentElement.append(calc) }
      calc.setAttribute('fullCalcOnLoad', '1'); calc.setAttribute('forceFullCalc', '1')
      files['xl/workbook.xml'] = xmlText(workbook)
      for (const node of Array.from(rels.getElementsByTagName('Relationship'))) {
        if (node.getAttribute('Type')?.endsWith('/calcChain')) node.remove()
      }
      files['xl/_rels/workbook.xml.rels'] = xmlText(rels)
      delete files['xl/calcChain.xml']
      const types = parseXml(strFromU8(files['[Content_Types].xml']))
      Array.from(types.getElementsByTagName('Override')).filter((node) => node.getAttribute('PartName') === '/xl/calcChain.xml').forEach((node) => node.remove())
      files['[Content_Types].xml'] = xmlText(types)
    }
    return zipSync(files)
  }
}
