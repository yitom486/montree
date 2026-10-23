// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest'
import { readHtmlReaderContent } from './reader-content'

describe('readHtmlReaderContent', () => {
  afterEach(() => {
    document.body.innerHTML = ''
  })

  it('返回渲染区域的纯文本并排除导航、页脚、脚本和隐藏内容', () => {
    document.body.innerHTML = `
      <nav>导航文本</nav>
      <header><h1>架构总览</h1><p>标题说明</p></header>
      <main>
        <h2>接入方式</h2>
        <p>正文 <strong>重点</strong></p>
        <script>window.secret = '脚本源码'</script>
        <p hidden>隐藏文本</p>
        <footer>页脚文本</footer>
      </main>`

    const result = readHtmlReaderContent(document.body)

    expect(result.text).toContain('架构总览')
    expect(result.text).toContain('正文 重点')
    expect(result.text).not.toContain('导航文本')
    expect(result.text).not.toContain('页脚文本')
    expect(result.text).not.toContain('脚本源码')
    expect(result.text).not.toContain('隐藏文本')
    expect(result.text).not.toContain('<h1>')
    expect(result.units.map((unit) => [unit.label, unit.level])).toEqual([
      ['架构总览', 1],
      ['接入方式', 2],
    ])
    expect(result.units[1]?.text).toContain('正文 重点')
    expect(result.units[1]?.text).not.toContain('导航文本')
  })

  it('没有标题时退化为单个正文单元', () => {
    document.body.innerHTML = '<p>只有正文</p><p>第二段</p>'
    const result = readHtmlReaderContent(document.body)
    expect(result.units).toEqual([{ label: '正文', text: '只有正文\n第二段' }])
  })

  it('解析失败或空根节点不抛错', () => {
    expect(readHtmlReaderContent(null)).toEqual({ text: '', units: [{ label: '正文', text: '' }] })
  })
})
