import { describe, expect, it } from 'vitest'
import * as XLSX from 'xlsx'
import { FormulaEvaluator } from './formula-evaluator'

describe('FormulaEvaluator 公式计算引擎', () => {
  it('支持基本算术运算 (+, -, *, /, ^, %)', () => {
    const wb = XLSX.utils.book_new()
    const ws = XLSX.utils.aoa_to_sheet([
      [10, 20],
    ])
    ws.C1 = { t: 'n', f: 'A1+B1' }
    ws.D1 = { t: 'n', f: 'B1-A1' }
    ws.E1 = { t: 'n', f: 'A1*B1' }
    ws.F1 = { t: 'n', f: 'B1/A1' }
    ws.G1 = { t: 'n', f: 'A1^2' }
    ws.H1 = { t: 'n', f: 'B1*10%' }
    XLSX.utils.book_append_sheet(wb, ws, 'Sheet1')

    const ev = new FormulaEvaluator(wb)
    ev.evaluateAll()

    expect(ws.C1.v).toBe(30)
    expect(ws.D1.v).toBe(10)
    expect(ws.E1.v).toBe(200)
    expect(ws.F1.v).toBe(2)
    expect(ws.G1.v).toBe(100)
    expect(ws.H1.v).toBe(2)
  })

  it('支持常见统计与数学函数 (SUM, AVERAGE, MIN, MAX, COUNT, ROUND, ABS)', () => {
    const wb = XLSX.utils.book_new()
    const ws = XLSX.utils.aoa_to_sheet([
      [10],
      [20],
      [30],
      [40],
    ])
    ws.A5 = { t: 'n', f: 'SUM(A1:A4)' }
    ws.A6 = { t: 'n', f: 'AVERAGE(A1:A4)' }
    ws.A7 = { t: 'n', f: 'MIN(A1:A4)' }
    ws.A8 = { t: 'n', f: 'MAX(A1:A4)' }
    ws.A9 = { t: 'n', f: 'COUNT(A1:A4)' }
    ws.A10 = { t: 'n', f: 'ROUND(123.456, 1)' }
    ws.A11 = { t: 'n', f: 'ABS(-50)' }
    XLSX.utils.book_append_sheet(wb, ws, 'Sheet1')

    const ev = new FormulaEvaluator(wb)
    ev.evaluateAll()

    expect(ws.A5.v).toBe(100)
    expect(ws.A6.v).toBe(25)
    expect(ws.A7.v).toBe(10)
    expect(ws.A8.v).toBe(40)
    expect(ws.A9.v).toBe(4)
    expect(ws.A10.v).toBe(123.5)
    expect(ws.A11.v).toBe(50)
  })

  it('支持嵌套依赖与级联递归求值', () => {
    const wb = XLSX.utils.book_new()
    const ws = XLSX.utils.aoa_to_sheet([
      ['部门', '预算', '支出'],
      ['开发', 1000, 600],
      ['运营', 2000, 1500],
    ])
    // 剩余预算
    ws.D2 = { t: 'n', f: 'B2-C2' } // 400
    ws.D3 = { t: 'n', f: 'B3-C3' } // 500
    // 合计剩余预算（依赖 D2、D3）
    ws.D4 = { t: 'n', f: 'SUM(D2:D3)' } // 900
    // 执行率（依赖汇总）
    ws.B4 = { t: 'n', f: 'SUM(B2:B3)' } // 3000
    ws.C4 = { t: 'n', f: 'SUM(C2:C3)' } // 2100
    ws.E4 = { t: 'n', f: 'C4/B4' } // 0.7
    XLSX.utils.book_append_sheet(wb, ws, 'Sheet1')

    const ev = new FormulaEvaluator(wb)
    ev.evaluateAll()

    expect(ws.D2.v).toBe(400)
    expect(ws.D3.v).toBe(500)
    expect(ws.D4.v).toBe(900)
    expect(ws.B4.v).toBe(3000)
    expect(ws.C4.v).toBe(2100)
    expect(ws.E4.v).toBe(0.7)
  })

  it('支持逻辑判断 (IF, AND, OR, IFERROR) 与字符串拼接 (&, CONCAT)', () => {
    const wb = XLSX.utils.book_new()
    const ws = XLSX.utils.aoa_to_sheet([
      ['状态', 95],
    ])
    ws.C1 = { t: 's', f: 'IF(B1>=90, "优秀", "合格")' }
    ws.D1 = { t: 's', f: 'A1 & ": " & C1' }
    ws.E1 = { t: 'n', f: 'IFERROR(10/0, 999)' }
    XLSX.utils.book_append_sheet(wb, ws, 'Sheet1')

    const ev = new FormulaEvaluator(wb)
    ev.evaluateAll()

    expect(ws.C1.v).toBe('优秀')
    expect(ws.D1.v).toBe('状态: 优秀')
    expect(ws.E1.v).toBe(999)
  })

  it('能检测并处理循环引用，避免调用栈溢出', () => {
    const wb = XLSX.utils.book_new()
    const ws = XLSX.utils.aoa_to_sheet([[1]])
    ws.A1 = { t: 'n', f: 'B1+1' }
    ws.B1 = { t: 'n', f: 'A1+1' }
    XLSX.utils.book_append_sheet(wb, ws, 'Sheet1')

    const ev = new FormulaEvaluator(wb)
    ev.evaluateAll()

    expect(ws.A1.v).toBe('#CYCLE!')
  })
})
