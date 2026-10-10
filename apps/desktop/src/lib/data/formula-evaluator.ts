import * as XLSX from 'xlsx'

interface Token {
  type: 'NUMBER' | 'STRING' | 'IDENT' | 'OP'
  value: string
}

export interface RangeRef {
  isRange: true
  sheet: string
  start: string
  end: string
}

export class FormulaEvaluator {
  private evaluating = new Set<string>()
  private cache = new Map<string, unknown>()

  constructor(private workbook: XLSX.WorkBook) {}

  /**
   * 遍历工作簿中所有包含公式（cell.f）的单元格并重新计算，
   * 将计算结果填入 cell.v，并同步校正 cell.t（类型）以便 format_cell 格式化。
   */
  evaluateAll(): void {
    this.cache.clear()
    this.evaluating.clear()

    for (const sheet of this.workbook.SheetNames) {
      const ws = this.workbook.Sheets[sheet]
      if (!ws) continue
      for (const key of Object.keys(ws)) {
        if (key.startsWith('!')) continue
        const cell = ws[key] as XLSX.CellObject | undefined
        if (cell?.f) {
          const val = this.getCellValue(sheet, key)
          if (typeof val === 'number') {
            cell.t = 'n'
            cell.v = val
          } else if (typeof val === 'boolean') {
            cell.t = 'b'
            cell.v = val
          } else if (typeof val === 'string') {
            cell.t = 's'
            cell.v = val
          } else {
            cell.v = undefined
          }
        }
      }
    }
  }

  getCellValue(sheetName: string, address: string): unknown {
    const ws = this.workbook.Sheets[sheetName]
    if (!ws) return 0
    const cell = ws[address] as XLSX.CellObject | undefined
    if (!cell) return 0

    // 如果该单元格有公式，需计算并缓存
    if (cell.f) {
      const key = `${sheetName}!${address.toUpperCase()}`
      if (this.cache.has(key)) return this.cache.get(key)
      if (this.evaluating.has(key)) return '#CYCLE!'

      this.evaluating.add(key)
      try {
        const result = this.eval(cell.f, sheetName)
        this.cache.set(key, result)
        if (typeof result === 'number') {
          cell.t = 'n'
          cell.v = result
        } else if (typeof result === 'boolean') {
          cell.t = 'b'
          cell.v = result
        } else if (typeof result === 'string') {
          cell.t = 's'
          cell.v = result
        } else {
          cell.v = undefined
        }
        return result
      } finally {
        this.evaluating.delete(key)
      }
    }

    // 无公式的常量单元格
    return cell.v ?? 0
  }

  eval(formula: string, currentSheet: string): unknown {
    let f = formula.trim()
    if (f.startsWith('=')) f = f.slice(1)
    if (!f) return ''

    const tokens = this.tokenize(f)
    let pos = 0

    const peek = (): Token | undefined => tokens[pos]
    const consume = (expected?: string): Token => {
      const t = tokens[pos]
      if (expected && (!t || t.value.toUpperCase() !== expected.toUpperCase())) {
        throw new Error(`Expected ${expected}, got ${t ? t.value : 'EOF'}`)
      }
      pos++
      return t
    }

    const parseExpr = (): unknown => parseComparison()

    const isError = (v: unknown): v is string => typeof v === 'string' && v.startsWith('#')

    const parseComparison = (): unknown => {
      let left = parseConcat()
      while (pos < tokens.length) {
        const t = peek()
        if (t && ['=', '<>', '!=', '<', '<=', '>', '>='].includes(t.value)) {
          consume()
          const right = parseConcat()
          if (isError(left)) return left
          if (isError(right)) return right
          if (t.value === '=') {
            left = typeof left === 'string' && typeof right === 'string'
              ? left.toLowerCase() === right.toLowerCase()
              : Number(left) === Number(right)
          } else if (t.value === '<>' || t.value === '!=') {
            left = typeof left === 'string' && typeof right === 'string'
              ? left.toLowerCase() !== right.toLowerCase()
              : Number(left) !== Number(right)
          } else if (t.value === '<') left = Number(left) < Number(right)
          else if (t.value === '<=') left = Number(left) <= Number(right)
          else if (t.value === '>') left = Number(left) > Number(right)
          else if (t.value === '>=') left = Number(left) >= Number(right)
        } else {
          break
        }
      }
      return left
    }

    const parseConcat = (): unknown => {
      let left = parseAdditive()
      while (pos < tokens.length) {
        const t = peek()
        if (t && t.value === '&') {
          consume()
          const right = parseAdditive()
          if (isError(left)) return left
          if (isError(right)) return right
          left = String(left ?? '') + String(right ?? '')
        } else {
          break
        }
      }
      return left
    }

    const parseAdditive = (): unknown => {
      let left = parseMultiplicative()
      while (pos < tokens.length) {
        const t = peek()
        if (t && (t.value === '+' || t.value === '-')) {
          consume()
          const right = parseMultiplicative()
          if (isError(left)) return left
          if (isError(right)) return right
          if (t.value === '+') left = Number(left) + Number(right)
          else if (t.value === '-') left = Number(left) - Number(right)
        } else {
          break
        }
      }
      return left
    }

    const parseMultiplicative = (): unknown => {
      let left = parsePower()
      while (pos < tokens.length) {
        const t = peek()
        if (t && (t.value === '*' || t.value === '/')) {
          consume()
          const right = parsePower()
          if (isError(left)) return left
          if (isError(right)) return right
          if (t.value === '*') left = Number(left) * Number(right)
          else if (t.value === '/') left = Number(right) === 0 ? '#DIV/0!' : Number(left) / Number(right)
        } else {
          break
        }
      }
      return left
    }

    const parsePower = (): unknown => {
      let left = parseUnary()
      while (pos < tokens.length) {
        const t = peek()
        if (t && t.value === '^') {
          consume()
          const right = parseUnary()
          if (isError(left)) return left
          if (isError(right)) return right
          left = Math.pow(Number(left), Number(right))
        } else {
          break
        }
      }
      return left
    }

    const parseUnary = (): unknown => {
      const t = peek()
      if (t && (t.value === '+' || t.value === '-')) {
        consume()
        const operand = parseUnary()
        if (isError(operand)) return operand
        return t.value === '-' ? -Number(operand) : Number(operand)
      }
      return parsePrimary()
    }

    const parsePrimary = (): unknown => {
      const t = peek()
      if (!t) return 0

      if (t.type === 'NUMBER') {
        consume()
        let val = Number(t.value)
        if (peek() && peek()?.value === '%') {
          consume()
          val = val / 100
        }
        return val
      }

      if (t.type === 'STRING') {
        consume()
        return t.value
      }

      if (t.type === 'IDENT') {
        const name = t.value.toUpperCase()
        if (name === 'TRUE') { consume(); return true }
        if (name === 'FALSE') { consume(); return false }

        // 函数调用：NAME ( ... )
        if (tokens[pos + 1] && tokens[pos + 1].value === '(') {
          consume()
          consume('(')
          const args: unknown[] = []
          if (peek() && peek()?.value !== ')') {
            while (true) {
              args.push(parseArg())
              if (peek() && peek()?.value === ',') {
                consume(',')
              } else {
                break
              }
            }
          }
          consume(')')
          return this.callFunction(name, args, currentSheet)
        }

        // 单元格引用：A1, $A$1, Sheet1!A1, 'Sheet 1'!A1
        consume()
        let ref = t.value
        let sheet = currentSheet
        if (ref.includes('!')) {
          const parts = ref.split('!')
          sheet = parts[0].replace(/^'|'$/g, '')
          ref = parts[1]
        }
        ref = ref.replace(/\$/g, '').toUpperCase()
        return this.getCellValue(sheet, ref)
      }

      if (t.value === '(') {
        consume('(')
        const val = parseExpr()
        consume(')')
        return val
      }

      consume()
      return 0
    }

    const parseArg = (): unknown => {
      const t = peek()
      if (t && t.type === 'IDENT') {
        const next = tokens[pos + 1]
        if (next && next.value === ':') {
          const startRef = consume().value
          consume(':')
          const endRef = consume().value
          return { isRange: true, start: startRef, end: endRef, sheet: currentSheet } as RangeRef
        }
      }
      return parseExpr()
    }

    try {
      return parseExpr()
    } catch {
      return '#VALUE!'
    }
  }

  private callFunction(name: string, args: unknown[], currentSheet: string): unknown {
    const flattenNumbers = (list: unknown[]): number[] => {
      const nums: number[] = []
      for (const a of list) {
        if (a && typeof a === 'object' && 'isRange' in a) {
          const rangeObj = a as RangeRef
          let start = rangeObj.start.replace(/\$/g, '')
          let end = rangeObj.end.replace(/\$/g, '')
          let sheet = rangeObj.sheet || currentSheet
          if (start.includes('!')) {
            const parts = start.split('!')
            sheet = parts[0].replace(/^'|'$/g, '')
            start = parts[1]
          }
          if (end.includes('!')) {
            end = end.split('!')[1]
          }
          const range = XLSX.utils.decode_range(`${start}:${end}`)
          for (let r = range.s.r; r <= range.e.r; r++) {
            for (let c = range.s.c; c <= range.e.c; c++) {
              const addr = XLSX.utils.encode_cell({ r, c })
              const val = this.getCellValue(sheet, addr)
              if (typeof val === 'number') nums.push(val)
              else if (val !== null && val !== '' && !Number.isNaN(Number(val))) nums.push(Number(val))
            }
          }
        } else if (Array.isArray(a)) {
          nums.push(...flattenNumbers(a))
        } else {
          const n = Number(a)
          if (!Number.isNaN(n)) nums.push(n)
        }
      }
      return nums
    }

    const flattenAll = (list: unknown[]): unknown[] => {
      const values: unknown[] = []
      for (const a of list) {
        if (a && typeof a === 'object' && 'isRange' in a) {
          const rangeObj = a as RangeRef
          let start = rangeObj.start.replace(/\$/g, '')
          let end = rangeObj.end.replace(/\$/g, '')
          let sheet = rangeObj.sheet || currentSheet
          if (start.includes('!')) {
            const parts = start.split('!')
            sheet = parts[0].replace(/^'|'$/g, '')
            start = parts[1]
          }
          if (end.includes('!')) {
            end = end.split('!')[1]
          }
          const range = XLSX.utils.decode_range(`${start}:${end}`)
          for (let r = range.s.r; r <= range.e.r; r++) {
            for (let c = range.s.c; c <= range.e.c; c++) {
              const addr = XLSX.utils.encode_cell({ r, c })
              values.push(this.getCellValue(sheet, addr))
            }
          }
        } else if (Array.isArray(a)) {
          values.push(...flattenAll(a))
        } else {
          values.push(a)
        }
      }
      return values
    }

    switch (name) {
      case 'SUM':
        return flattenNumbers(args).reduce((sum, v) => sum + v, 0)
      case 'AVERAGE': {
        const nums = flattenNumbers(args)
        return nums.length ? nums.reduce((s, v) => s + v, 0) / nums.length : 0
      }
      case 'COUNT':
        return flattenNumbers(args).length
      case 'COUNTA':
        return flattenAll(args).filter((v) => v !== null && v !== undefined && v !== '' && v !== 0).length
      case 'MAX': {
        const nums = flattenNumbers(args)
        return nums.length ? Math.max(...nums) : 0
      }
      case 'MIN': {
        const nums = flattenNumbers(args)
        return nums.length ? Math.min(...nums) : 0
      }
      case 'ROUND':
        return Number(Number(args[0]).toFixed(Number(args[1] ?? 0)))
      case 'ROUNDUP': {
        const factor = Math.pow(10, Number(args[1] ?? 0))
        return Math.ceil(Number(args[0]) * factor) / factor
      }
      case 'ROUNDDOWN':
      case 'INT': {
        if (name === 'INT') return Math.floor(Number(args[0]))
        const factor = Math.pow(10, Number(args[1] ?? 0))
        return Math.floor(Number(args[0]) * factor) / factor
      }
      case 'ABS':
        return Math.abs(Number(args[0]))
      case 'MOD':
        return Number(args[0]) % Number(args[1])
      case 'SQRT':
        return Math.sqrt(Number(args[0]))
      case 'POWER':
        return Math.pow(Number(args[0]), Number(args[1]))
      case 'PRODUCT':
        return flattenNumbers(args).reduce((p, v) => p * v, 1)
      case 'IF':
        return args[0] ? args[1] : (args[2] ?? false)
      case 'IFS': {
        for (let i = 0; i < args.length; i += 2) {
          if (args[i]) return args[i + 1]
        }
        return '#N/A'
      }
      case 'IFERROR': {
        const val = args[0]
        if (typeof val === 'string' && val.startsWith('#')) return args[1] ?? ''
        return val
      }
      case 'CONCAT':
      case 'CONCATENATE':
        return flattenAll(args).map((v) => String(v ?? '')).join('')
      case 'LEN':
        return String(args[0] ?? '').length
      case 'LEFT': {
        const str = String(args[0] ?? '')
        const len = Number(args[1] ?? 1)
        return str.slice(0, len)
      }
      case 'RIGHT': {
        const str = String(args[0] ?? '')
        const len = Number(args[1] ?? 1)
        return str.slice(Math.max(0, str.length - len))
      }
      case 'MID': {
        const str = String(args[0] ?? '')
        const start = Math.max(0, Number(args[1] ?? 1) - 1)
        const len = Number(args[2] ?? 0)
        return str.slice(start, start + len)
      }
      case 'TRIM':
        return String(args[0] ?? '').trim()
      case 'UPPER':
        return String(args[0] ?? '').toUpperCase()
      case 'LOWER':
        return String(args[0] ?? '').toLowerCase()
      case 'AND':
        return args.every(Boolean)
      case 'OR':
        return args.some(Boolean)
      case 'NOT':
        return !args[0]
      default:
        return '#NAME?'
    }
  }

  private tokenize(expr: string): Token[] {
    const tokens: Token[] = []
    let i = 0
    while (i < expr.length) {
      const c = expr[i]
      if (/\s/.test(c)) {
        i++
        continue
      }
      // 数字常量（包括小数）
      if (/[0-9]/.test(c) || (c === '.' && /[0-9]/.test(expr[i + 1] ?? ''))) {
        let num = ''
        while (i < expr.length && /[0-9.]/.test(expr[i])) {
          num += expr[i++]
        }
        tokens.push({ type: 'NUMBER', value: num })
        continue
      }
      // 字符串常量
      if (c === '"') {
        i++
        let str = ''
        while (i < expr.length && expr[i] !== '"') {
          str += expr[i++]
        }
        if (i < expr.length) i++
        tokens.push({ type: 'STRING', value: str })
        continue
      }
      // 比较操作符
      if (['<', '>', '=', '!'].includes(c)) {
        let op = c
        if (['<=', '>=', '<>', '!='].includes(expr.slice(i, i + 2))) {
          op = expr.slice(i, i + 2)
          i += 2
        } else {
          i++
        }
        tokens.push({ type: 'OP', value: op })
        continue
      }
      // 单字符操作符及分隔符
      if (['+', '-', '*', '/', '^', '%', '&', '(', ')', ',', ':'].includes(c)) {
        tokens.push({ type: 'OP', value: c })
        i++
        continue
      }
      // 标识符（单元格、函数名、工作表名）
      if (/[a-zA-Z_$]/.test(c) || c === "'") {
        let ident = ''
        if (c === "'") {
          ident += expr[i++]
          while (i < expr.length && expr[i] !== "'") ident += expr[i++]
          if (i < expr.length) ident += expr[i++]
        }
        while (i < expr.length && /[a-zA-Z0-9_$.\!]/.test(expr[i])) {
          ident += expr[i++]
        }
        tokens.push({ type: 'IDENT', value: ident })
        continue
      }
      i++
    }
    return tokens
  }
}
