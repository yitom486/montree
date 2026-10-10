// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Compartment, EditorSelection, EditorState } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { markdown } from '@codemirror/lang-markdown'
import { GFM } from '@lezer/markdown'
import { history, undo } from '@codemirror/commands'
import { livePreviewExtension } from './index'
import { livePreviewBlocks, parsePreviewBlocks, showBlockPreview, tableCellRange } from './live-preview-blocks'
import { buildLivePreviewDecorations } from './live-preview-inline'

vi.mock('@/components/markdown/LivePreviewBlock', () => ({ LivePreviewBlock: () => null }))
const views: EditorView[] = []
afterEach(() => { views.splice(0).forEach((view) => view.destroy()); document.body.replaceChildren() })
const source = '# 文档\n\n| 名称 | 数值 |\n| :--- | ---: |\n| **Apple** | `a\\|b` |\n\n<img src="./a.png" width="300">\n\n$$\nE=mc^2\n$$\n\n```mermaid\ngraph TD\nA --> B\n```\n\n```python\n# 代码注释\nprint(1)\n```\n\n行内公式 $a+b$ 。\n\n末尾正文'
function state(doc = source, cursor = 0): EditorState {
  return EditorState.create({ doc, selection: { anchor: cursor }, extensions: [EditorState.allowMultipleSelections.of(true), markdown({ extensions: [GFM] }), livePreviewExtension()] })
}
describe('live preview block integration', () => {
  it('嵌套引用和社区提示块整体渲染，包含提示标记的完整原文可编辑', () => {
    const text = '# 文档\n\n> 普通引用\n>\n> > 嵌套引用\n> > - 列表 `code`\n\n> [!NOTE]\n> **提示内容**\n\n> [!WARNING]\n> 公式 $x>0$\n\n末尾'
    const current = state(text, text.length)
    const blocks = current.field(livePreviewBlocks).blocks
    expect(blocks.map((block) => block.kind)).toEqual(['blockquote_open', 'alert_open', 'alert_open'])
    expect(blocks[0].source).toContain('> > - 列表 `code`')
    expect(blocks[1].source).toBe('> [!NOTE]\n> **提示内容**')
    expect(blocks[2].source).toContain('> [!WARNING]')
    const offset = text.indexOf('提示内容')
    const edited = current.update({ selection: { anchor: offset }, changes: { from: offset, to: offset + 4, insert: '新提示' } }).state
    expect(edited.field(livePreviewBlocks).blocks[1].source).toBe('> [!NOTE]\n> **新提示**')
  })
  it('跨空行的嵌套折叠区包含 Markdown、代码和表格，正文不泄漏为独立块', () => {
    const text = '# 文档\n\n<details>\n<summary>展开</summary>\n\n正文 **粗体**\n\n```text\n<details>代码示例</details>\n```\n\n<details><summary>内层</summary>\n\n| 名称 |\n| --- |\n| 表格 |\n\n</details>\n\n</details>\n\n外部正文'
    const current = state(text, text.length)
    const blocks = current.field(livePreviewBlocks).blocks
    expect(blocks).toHaveLength(1)
    expect(blocks[0].kind).toBe('details')
    expect(blocks[0].source).toBe(text.slice(text.indexOf('<details>'), text.lastIndexOf('</details>') + 10))
    const container = document.createElement('div')
    container.innerHTML = blocks[0].renderedHtml!
    const outer = container.querySelector('details')!
    expect(outer.querySelector('strong')?.textContent).toBe('粗体')
    expect(outer.querySelector('table')?.textContent).toContain('表格')
    expect(outer.querySelectorAll('details')).toHaveLength(1)
    expect(outer.querySelector('code')?.textContent).toContain('<details>代码示例</details>')
    expect(container.textContent).not.toContain('外部正文')
    expect(current.doc.toString()).toBe(text)
  })
  it('伪折叠标签、HTML 注释和代码不参与跨块合并，相邻折叠区保持独立', () => {
    const text = '# 文档\n\n<!-- <details> -->\n\n```html\n<details><summary>代码</summary>\n```\n\n<details><summary>一</summary>\n\n正文一\n\n</details>\n\n<details><summary>二</summary>\n\n正文二\n\n</details>\n\n末尾'
    const blocks = state(text, text.length).field(livePreviewBlocks).blocks
    expect(blocks.map((block) => block.kind)).toEqual(['fence', 'details', 'details'])
    expect(blocks[1].source).not.toContain('正文二')
    expect(blocks[2].source).not.toContain('末尾')
  })
  it('中文混排、重复引用、行内注和未定义引用可共存', () => {
    const text = '# 文档\n\n这里有短脚注[^short]，长脚注[^long]，再次短脚注[^short]，行内注^[**行内说明**]，未知[^missing]。\n\n[^short]: 短\n\n[^long]: 长\n\n末尾'
    const html = state(text, text.length).field(livePreviewBlocks).blocks[0].renderedHtml!
    expect(html).toContain('id="fn3"')
    expect(html.match(/class="footnote-ref"/g)).toHaveLength(4)
    expect(html).toContain('[^missing]')
  })
  it('脚注复用全篇插件编号，重复引用有独立回链，长脚注完整定位并可编辑', () => {
    const text = '先长[^long]、短[^short]、再长[^long]。\n\n[^short]: 短脚注 **粗体**。\n\n[^long]: 长脚注\n\n    - 列表 `code`\n    - **样式**\n\n    第二段内容。\n\n末尾'
    const current = state(text, text.length)
    const blocks = current.field(livePreviewBlocks).blocks
    expect(blocks.map((block) => block.kind)).toEqual(['rich-paragraph', 'footnote-definition', 'footnote-definition'])
    expect(blocks[0].renderedHtml).toContain('id="fnref1:1"')
    expect(blocks[0].footnoteTargets).toEqual(['fnref1', 'fnref2', 'fnref1:1'])
    expect(blocks[1].renderedHtml).toContain('value="2"')
    expect(blocks[2].renderedHtml).toContain('value="1"')
    expect(blocks[2].renderedHtml).toContain('<ul>')
    expect(blocks[2].renderedHtml).toContain('<strong>样式</strong>')
    expect(blocks[2].renderedHtml).toContain('href="#fnref1:1"')
    expect(blocks[2].source).toContain('    第二段内容。')
    expect(blocks[2].source).not.toContain('末尾')
    const offset = text.indexOf('第二段内容')
    const edited = current.update({ changes: { from: offset, to: offset + 5, insert: '修改正文' }, selection: { anchor: blocks[2].from } }).state
    expect(edited.field(livePreviewBlocks).blocks[2].renderedHtml).toContain('修改正文')
    expect(edited.doc.toString()).toContain('先长[^long]、短[^short]、再长[^long]。')
  })
  it('行内脚注与表格内脚注使用社区渲染，未引用定义不会泄漏到正文', () => {
    const text = '行内注^[**内联正文**]。\n\n| 名称 |\n| --- |\n| 表格[^note] |\n\n[^note]: 表格脚注\n\n[^unused]: 未引用\n\n末尾'
    const blocks = state(text, text.length).field(livePreviewBlocks).blocks
    expect(blocks[0].renderedHtml).toContain('内联正文')
    expect(blocks[0].footnoteTargets).toContain('fn1')
    expect(blocks[1].renderedHtml).toContain('href="#fn2"')
    expect(blocks[2].renderedHtml).toContain('value="2"')
    expect(blocks[3].renderedHtml).toBe('')
  })
  it('脚注定义首行没有内容时也保留准确的原始范围，代码中的脚注不解析', () => {
    const text = '引用[^empty]。\n\n[^empty]:\n    正文 **粗体**\n\n```md\n[^fake]: 代码\n```\n\n末尾'
    const blocks = state(text, text.length).field(livePreviewBlocks).blocks
    expect(blocks[1].source).toContain('[^empty]:\n    正文')
    expect(blocks[1].renderedHtml).toContain('<strong>粗体</strong>')
    expect(blocks.filter((block) => block.kind === 'footnote-definition')).toHaveLength(1)
  })
  it('引用定义复用 Lezer 边界，收起多行定义且不改动原文，选中可编辑', () => {
    const text = '参见 [报告][ref]\n\n[ref]: https://example.com/report.pdf\n  "报告 PDF"\n\n尾部'
    const initial = state(text, text.length)
    const block = initial.field(livePreviewBlocks).blocks[0]
    expect(block.kind).toBe('reference-definition')
    expect(block.source).toBe('[ref]: https://example.com/report.pdf\n  "报告 PDF"')
    const replacements: number[] = []
    initial.field(livePreviewBlocks).decorations.between(block.from, block.to, (from, to) => { if (to > from) replacements.push(from) })
    expect(replacements).toEqual([block.from])
    const editing = initial.update({ selection: { anchor: block.from + 3 } }).state
    expect(editing.doc.toString()).toBe(text)
    const view = new EditorView({ state: initial })
    views.push(view)
    const classes: string[] = []
    buildLivePreviewDecorations(view).between(0, block.from, (_from, _to, value) => { if (value.spec.class) classes.push(value.spec.class) })
    expect(classes).toContain('cm-live-link')
  })
  it('无定义的引用和代码里的引用定义保持普通原文', () => {
    const text = '[未知][missing]\n\n```md\n[missing]: https://example.com\n```\n\n末尾'
    const current = state(text, text.length)
    expect(current.field(livePreviewBlocks).blocks.map((block) => block.kind)).toEqual(['fence'])
    const view = new EditorView({ state: current })
    views.push(view)
    const classes: string[] = []
    buildLivePreviewDecorations(view).between(0, text.indexOf('```'), (_from, _to, value) => { if (value.spec.class) classes.push(value.spec.class) })
    expect(classes).not.toContain('cm-live-link')
  })
  it('只有一个块的文档也可完成编辑恢复预览，选区再次进入时重新展开', () => {
    let current = state('```js\nlet a = 1\n```')
    const widgets = () => {
      let count = 0
      current.field(livePreviewBlocks).decorations.between(0, current.doc.length, (from, to) => { if (to > from) count++ })
      return count
    }
    expect(widgets()).toBe(0)
    current = current.update({ effects: showBlockPreview.of(0) }).state
    expect(widgets()).toBe(1)
    current = current.update({ selection: { anchor: 8 } }).state
    expect(widgets()).toBe(0)
    expect(current.doc.toString()).toBe('```js\nlet a = 1\n```')
  })
  it('引用式图片保留文档外部定义的环境，并随定义变化更新', () => {
    const initial = state('前文\n\n![引用图][pic]\n\n[pic]: ./old.png')
    const block = initial.field(livePreviewBlocks).blocks[0]
    expect(block.env?.references?.PIC.href).toBe('./old.png')
    const next = initial.update({ changes: { from: initial.doc.length - 7, insert: 'new-' } }).state
    expect(next.field(livePreviewBlocks).blocks[0].referenceKey).not.toBe(block.referenceKey)
  })
  it('复用 markdown-it source map 识别表格、HTML、公式、图表和代码', () => {
    const blocks = parsePreviewBlocks(state())
    expect(blocks.map((block) => block.kind)).toEqual(['table_open', 'html_block', 'math_block', 'fence', 'fence', 'rich-paragraph'])
    for (const block of blocks) expect(source.slice(block.from, block.to)).toBe(block.source)
  })
  it('代码内的表格、HTML、公式不会生成额外组件', () => {
    const blocks = parsePreviewBlocks(state('```md\n| A | B |\n|---|---|\n<img src="x">\n$$\nx\n$$\n```'))
    expect(blocks).toHaveLength(1)
    expect(blocks[0].kind).toBe('fence')
  })
  it('Lezer 精确定位单元格，保留转义管道符及样式', () => {
    const block = parsePreviewBlocks(state())[0]
    const range = tableCellRange(block, 1, 1)!
    expect(source.slice(range.from, range.to).trim()).toBe('`a\\|b`')
    expect(tableCellRange(block, 0, 0)).toBeDefined()
    expect(tableCellRange(block, 20, 20)).toBeUndefined()
  })
  it('所有选区相交时展开源码，离开恢复预览，原文不变', () => {
    const before = state()
    const block = before.field(livePreviewBlocks).blocks[0]
    let current = before.update({ selection: EditorSelection.create([EditorSelection.cursor(0), EditorSelection.range(block.from, block.to)]) }).state
    let replacements = 0
    current.field(livePreviewBlocks).decorations.between(block.from, block.to, (from, to, value) => { if (to > from && value.spec.widget) replacements++ })
    expect(replacements).toBe(0)
    current = current.update({ selection: { anchor: source.length } }).state
    current.field(livePreviewBlocks).decorations.between(block.from, block.to, (from, to, value) => { if (to > from && value.spec.widget) replacements++ })
    expect(replacements).toBe(1)
    expect(current.doc.toString()).toBe(source)
  })
  it('光标移动复用解析，正文插入后范围同步', () => {
    const initial = state()
    const moved = initial.update({ selection: { anchor: source.length } }).state
    expect(moved.field(livePreviewBlocks).blocks).toBe(initial.field(livePreviewBlocks).blocks)
    const changed = moved.update({ changes: { from: 0, insert: '新增\n\n' } }).state
    expect(changed.field(livePreviewBlocks).blocks[0].from).toBe(initial.field(livePreviewBlocks).blocks[0].from + 4)
  })
  it('实际 EditorView 接受跨行替换，模式切换保留光标、原文及撤销', () => {
    const compartment = new Compartment()
    const parent = document.createElement('div')
    document.body.appendChild(parent)
    const view = new EditorView({ parent, state: EditorState.create({ doc: source, extensions: [markdown({ extensions: [GFM] }), history(), compartment.of(livePreviewExtension())] }) })
    views.push(view)
    const offset = source.indexOf('Apple')
    view.dispatch({ selection: { anchor: offset }, changes: { from: offset, to: offset + 5, insert: 'Cherry' } })
    const selection = view.state.selection
    view.dispatch({ effects: compartment.reconfigure([]) })
    view.dispatch({ effects: compartment.reconfigure(livePreviewExtension()) })
    expect(view.state.doc.toString()).toContain('Cherry')
    expect(view.state.selection.eq(selection)).toBe(true)
    expect(undo(view)).toBe(true)
    expect(view.state.doc.toString()).toBe(source)
  })
  it('嵌套粗体、斜体、链接不会被重叠保护吞掉', () => {
    const text = '**外层 *斜体* [链接](https://example.com)**\n\n末尾'
    const view = new EditorView({ state: state(text, text.length) })
    views.push(view)
    const classes: string[] = []
    buildLivePreviewDecorations(view).between(0, text.length, (_from, _to, value) => { if (value.spec.class) classes.push(value.spec.class) })
    expect(classes).toContain('cm-live-bold')
    expect(classes).toContain('cm-live-italic')
    expect(classes).toContain('cm-live-link')
  })
})
