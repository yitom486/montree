import { describe, expect, it } from 'vitest'
import { splitStreamText, STREAM_TAIL_CAP } from './stream-blocks'

describe('splitStreamText 稳定块切分', () => {
  it('空文本与无空行不切分', () => {
    expect(splitStreamText('')).toEqual({ head: '', tail: '', fallbackFull: false })
    expect(splitStreamText('单行无空行')).toEqual({ head: '', tail: '单行无空行', fallbackFull: false })
  })

  it('切在最后一个空行，头尾拼接还原', () => {
    const text = '第一段。\n\n第二段。\n\n第三段。'
    const { head, tail, fallbackFull } = splitStreamText(text)
    expect(fallbackFull).toBe(false)
    expect(head).toBe('第一段。\n\n第二段。')
    expect(tail).toBe('第三段。')
  })

  it('未闭合围栏内的空行不切，整段围栏留在尾部', () => {
    const text = '前言。\n\n```ts\nconst a = 1;\n\nconst b = 2;\n'
    const { head, tail } = splitStreamText(text)
    expect(head).toBe('前言。')
    expect(tail).toContain('```ts')
    expect(tail).toContain('const b = 2;')
  })

  it('已闭合围栏后的空行可切，围栏不撕裂', () => {
    const text = '```ts\nconst a = 1;\n```\n\n后文。'
    const { head, tail } = splitStreamText(text)
    // 闭合围栏整体留在头：最后一个空行在它之后
    expect(head).toContain('```ts')
    expect(head).toContain('\n```')
    expect(tail).toBe('后文。')
  })

  it('波浪围栏与 info 串同样识别', () => {
    const text = '前言。\n\n~~~mermaid title\nA-->B\n\nC-->D\n~~~\n\n后文。'
    const { head, tail } = splitStreamText(text)
    // 围栏内空行跳过：切点在闭合后的空行，围栏整体进头
    expect(head).toContain('~~~mermaid title')
    expect(tail).toBe('后文。')
  })

  it('未闭合围栏切点退到围栏之前', () => {
    const text = '前言。\n\n```mermaid\ngraph TD; A-->\n\nB-->C'
    const { head, tail } = splitStreamText(text)
    expect(head).toBe('前言。')
    expect(tail).toContain('```mermaid')
  })

  it('含脚注引用回退整文单解析', () => {
    const text = '正文[^1]\n\n[^1]: 脚注内容'
    expect(splitStreamText(text)).toEqual({ head: '', tail: text, fallbackFull: true })
  })

  it('表格（无空行）整体留在尾部', () => {
    const text = '说明。\n\n| 甲 | 乙 |\n|---|---|\n| 1 | 2 |'
    const { head, tail } = splitStreamText(text)
    expect(head).toBe('说明。')
    expect(tail).toContain('| 甲 | 乙 |')
  })

  it(`超长尾部向前找切点（上限 ${STREAM_TAIL_CAP}）`, () => {
    const longPara = `x`.repeat(STREAM_TAIL_CAP + 500)
    const text = `开头。\n\n${longPara}\n\n结尾。`
    const { head, tail, fallbackFull } = splitStreamText(text)
    expect(fallbackFull).toBe(false)
    // 首选切点已在 cap 内：head 含长段，tail 只有结尾
    expect(tail).toBe('结尾。')
    expect(head).toContain(longPara)
  })

  it('超长无空行尾向前无切点时退回首选', () => {
    const longPara = `y`.repeat(STREAM_TAIL_CAP + 500)
    const text = `开头。\n\n中间。\n\n${longPara}`
    const { head, tail } = splitStreamText(text)
    // 边界后无空行：退回首选切点（中间之后），而非整文尾
    expect(head).toContain('中间。')
    expect(tail).toBe(longPara)
  })
})
