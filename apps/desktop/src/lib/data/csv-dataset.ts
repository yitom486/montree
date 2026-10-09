/**
 * CSV / TSV 结构化数据核心模型
 * 支持 RFC 4180 规范解析（字段带引号、引号转义、跨行内容等）、
 * 多分隔符探测（逗号/制表符/分号）、以及对行列和单元格的完整增删改查（CRUD）与无损序列化导出。
 */

export type CsvDelimiter = ',' | '\t' | ';'

export interface CsvDatasetOptions {
  delimiter?: CsvDelimiter
  hasHeader?: boolean
}

export interface CsvSearchResult {
  rowIndex: number
  columnIndex: number
  value: string
  matchIndices: [number, number]
}

export class CsvDataset {
  private _headers: string[]
  private _rows: string[][]
  private _delimiter: CsvDelimiter

  constructor(headers: string[] = [], rows: string[][] = [], delimiter: CsvDelimiter = ',') {
    this._headers = [...headers]
    this._rows = rows.map((r) => [...r])
    this._delimiter = delimiter
  }

  // ---- 基础访问器 ----

  get headers(): readonly string[] {
    return this._headers
  }

  get rowCount(): number {
    return this._rows.length
  }

  get columnCount(): number {
    return this._headers.length
  }

  get delimiter(): CsvDelimiter {
    return this._delimiter
  }

  setDelimiter(delimiter: CsvDelimiter): void {
    this._delimiter = delimiter
  }

  getRows(): string[][] {
    return this._rows.map((r) => [...r])
  }

  getRow(rowIndex: number): string[] | undefined {
    if (rowIndex < 0 || rowIndex >= this._rows.length) return undefined
    return [...this._rows[rowIndex]]
  }

  getCell(rowIndex: number, colIndex: number): string | undefined {
    if (rowIndex < 0 || rowIndex >= this._rows.length) return undefined
    const row = this._rows[rowIndex]
    if (colIndex < 0 || colIndex >= row.length) return undefined
    return row[colIndex]
  }

  // ---- 查 (Query / Filter / Sort) ----

  /**
   * 全表模糊检索
   */
  search(query: string, options: { caseSensitive?: boolean } = {}): CsvSearchResult[] {
    const q = options.caseSensitive ? query : query.toLowerCase()
    if (!q) return []
    const results: CsvSearchResult[] = []

    for (let r = 0; r < this._rows.length; r++) {
      const row = this._rows[r]
      for (let c = 0; c < row.length; c++) {
        const cell = row[c] ?? ''
        const target = options.caseSensitive ? cell : cell.toLowerCase()
        const idx = target.indexOf(q)
        if (idx !== -1) {
          results.push({
            rowIndex: r,
            columnIndex: c,
            value: cell,
            matchIndices: [idx, idx + q.length],
          })
        }
      }
    }
    return results
  }

  /**
   * 按指定列进行排序（支持数值与文本自适应）
   */
  sortBy(colIndex: number, order: 'asc' | 'desc' = 'asc'): this {
    if (colIndex < 0 || colIndex >= this._headers.length) return this

    this._rows.sort((a, b) => {
      const valA = a[colIndex] ?? ''
      const valB = b[colIndex] ?? ''

      const numA = Number(valA.trim())
      const numB = Number(valB.trim())
      const isNumA = valA.trim() !== '' && !Number.isNaN(numA)
      const isNumB = valB.trim() !== '' && !Number.isNaN(numB)

      let cmp = 0
      if (isNumA && isNumB) {
        cmp = numA - numB
      } else {
        cmp = valA.localeCompare(valB, undefined, { numeric: true })
      }
      return order === 'asc' ? cmp : -cmp
    })
    return this
  }

  // ---- 增 (Create) ----

  /**
   * 在指定索引位置插入新行（默认末尾）
   */
  insertRow(rowIndex: number = this._rows.length, rowData?: string[]): number {
    const targetIndex = Math.max(0, Math.min(rowIndex, this._rows.length))
    const row = new Array(this._headers.length).fill('')
    if (rowData) {
      for (let i = 0; i < Math.min(rowData.length, this._headers.length); i++) {
        row[i] = rowData[i] ?? ''
      }
    }
    this._rows.splice(targetIndex, 0, row)
    return targetIndex
  }

  /**
   * 在指定索引位置插入新列（默认末尾）
   */
  insertColumn(colIndex: number = this._headers.length, headerName?: string, defaultValue = ''): number {
    const targetIndex = Math.max(0, Math.min(colIndex, this._headers.length))
    const header = headerName?.trim() || `列 ${targetIndex + 1}`
    this._headers.splice(targetIndex, 0, header)
    for (const row of this._rows) {
      row.splice(targetIndex, 0, defaultValue)
    }
    return targetIndex
  }

  // ---- 删 (Delete) ----

  /**
   * 删除指定行
   */
  deleteRow(rowIndex: number): boolean {
    if (rowIndex < 0 || rowIndex >= this._rows.length) return false
    this._rows.splice(rowIndex, 1)
    return true
  }

  /**
   * 删除指定列
   */
  deleteColumn(colIndex: number): boolean {
    if (colIndex < 0 || colIndex >= this._headers.length) return false
    this._headers.splice(colIndex, 1)
    for (const row of this._rows) {
      if (colIndex < row.length) {
        row.splice(colIndex, 1)
      }
    }
    return true
  }

  // ---- 改 (Update) ----

  /**
   * 修改指定单元格值
   */
  updateCell(rowIndex: number, colIndex: number, value: string): boolean {
    if (rowIndex < 0 || rowIndex >= this._rows.length) return false
    const row = this._rows[rowIndex]
    if (colIndex < 0 || colIndex >= this._headers.length) return false
    while (row.length <= colIndex) {
      row.push('')
    }
    row[colIndex] = value
    return true
  }

  /**
   * 重命名表头列名
   */
  renameColumn(colIndex: number, newName: string): boolean {
    if (colIndex < 0 || colIndex >= this._headers.length) return false
    this._headers[colIndex] = newName.trim()
    return true
  }

  // ---- 解析与序列化 (Parse & Serialize) ----

  /**
   * 探测文本使用的分隔符（优先检查制表符、分号与逗号）
   */
  static detectDelimiter(rawText: string): CsvDelimiter {
    const sanitized = rawText.startsWith('\uFEFF') ? rawText.slice(1) : rawText
    const firstLines = sanitized.split(/\r?\n/).slice(0, 5).join('\n')
    const countTab = (firstLines.match(/\t/g) ?? []).length
    const countSemicolon = (firstLines.match(/;/g) ?? []).length
    const countComma = (firstLines.match(/,/g) ?? []).length

    if (countTab > countComma && countTab > countSemicolon) return '\t'
    if (countSemicolon > countComma && countSemicolon > countTab) return ';'
    return ','
  }

  /**
   * 从原始文本解析为 CsvDataset 实例
   * 采用状态机算法完整支持 RFC 4180 引号与换行转义
   */
  static parse(text: string, options: CsvDatasetOptions = {}): CsvDataset {
    const cleanText = text.startsWith('\uFEFF') ? text.slice(1) : text
    const delimiter = options.delimiter ?? CsvDataset.detectDelimiter(cleanText)
    const hasHeader = options.hasHeader ?? true

    const rawRows: string[][] = []
    let currentRow: string[] = []
    let currentField = ''
    let insideQuote = false

    const chars = Array.from(cleanText)
    for (let i = 0; i < chars.length; i++) {
      const char = chars[i]
      const nextChar = chars[i + 1]

      if (char === '"') {
        if (insideQuote && nextChar === '"') {
          // 转义双引号 "" -> "
          currentField += '"'
          i++
        } else {
          // 切换引号状态
          insideQuote = !insideQuote
        }
      } else if (!insideQuote && char === delimiter) {
        currentRow.push(currentField)
        currentField = ''
      } else if (!insideQuote && (char === '\r' || char === '\n')) {
        // 遇到行结束
        if (char === '\r' && nextChar === '\n') {
          i++
        }
        currentRow.push(currentField)
        currentField = ''
        // 忽略纯空行（如文件末尾空换行）
        if (currentRow.length > 1 || (currentRow.length === 1 && currentRow[0] !== '')) {
          rawRows.push(currentRow)
        }
        currentRow = []
      } else {
        currentField += char
      }
    }

    // 处理末尾残留字段
    if (currentField !== '' || currentRow.length > 0) {
      currentRow.push(currentField)
      rawRows.push(currentRow)
    }

    if (rawRows.length === 0) {
      return new CsvDataset([], [], delimiter)
    }

    let headers: string[] = []
    let dataRows: string[][] = []

    if (hasHeader) {
      headers = rawRows[0] ?? []
      dataRows = rawRows.slice(1)
    } else {
      const maxCol = Math.max(...rawRows.map((r) => r.length), 0)
      headers = Array.from({ length: maxCol }, (_, idx) => `列 ${idx + 1}`)
      dataRows = rawRows
    }

    // 对齐所有行长度与表头一致
    const colCount = headers.length
    for (const row of dataRows) {
      while (row.length < colCount) {
        row.push('')
      }
    }

    return new CsvDataset(headers, dataRows, delimiter)
  }

  /**
   * 序列化回标准 CSV / TSV 文本格式
   */
  serialize(): string {
    const formatCell = (val: string): string => {
      const str = val ?? ''
      // 若包含分隔符、换行符、或双引号，必须加引号并转义内部引号
      if (
        str.includes(this._delimiter) ||
        str.includes('\n') ||
        str.includes('\r') ||
        str.includes('"')
      ) {
        return `"${str.replaceAll('"', '""')}"`
      }
      return str
    }

    const lines: string[] = []
    if (this._headers.length > 0) {
      lines.push(this._headers.map(formatCell).join(this._delimiter))
    }
    for (const row of this._rows) {
      lines.push(row.map(formatCell).join(this._delimiter))
    }
    return lines.join('\n')
  }
}
