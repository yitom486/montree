import { describe, expect, it } from 'vitest'
import {
  escapeCurrencyDollars,
} from './markdown-plugins'

describe('escapeCurrencyDollars', () => {
  it('货币美元转义，公式单美元不动', () => {
    expect(escapeCurrencyDollars('价格 $100 和 $200')).toBe('价格 \\$100 和 \\$200')
    expect(escapeCurrencyDollars('行内 $E=mc^2$ 结束')).toBe('行内 $E=mc^2$ 结束')
    expect(escapeCurrencyDollars('块 $$\\frac{a}{b}$$ 结束')).toBe('块 $$\\frac{a}{b}$$ 结束')
  })

  it('围栏与行内代码内的美元不动', () => {
    expect(escapeCurrencyDollars('```ts\nconst p = "$100"\n```')).toContain('"$100"')
    expect(escapeCurrencyDollars('这是 `$100` 代码')).toContain('`$100`')
  })

  it('数字开头的合法成对公式保留，落单价格才转义', () => {
    expect(escapeCurrencyDollars('共 $100$，结果 $2x+1$')).toBe('共 $100$，结果 $2x+1$')
    expect(escapeCurrencyDollars('价格 $100')).toBe('价格 \\$100')
    expect(escapeCurrencyDollars(String.raw`显式 \$100 与 $2x+`)).toBe(String.raw`显式 \$100 与 \$2x+`)
  })

  it('多字符行内代码、波浪/加长围栏、双美元块不改写', () => {
    const source = '``$100``\n~~~text\n$100\n~~~\n````ts\n$200\n````\n$$2x+1$$'
    expect(escapeCurrencyDollars(source)).toBe(source)
  })
})

