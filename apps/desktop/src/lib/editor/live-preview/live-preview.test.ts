// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest'
import { EditorState } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { markdown } from '@codemirror/lang-markdown'
import { GFM, Table, TaskList, Strikethrough } from '@lezer/markdown'
import { buildLivePreviewDecorations } from './live-preview-inline'
import { TaskCheckboxWidget } from './task-checkbox-widget'
import { QuoteMarkWidget } from './quote-mark-widget'
import { HorizontalRuleWidget } from './horizontal-rule-widget'
import { ImageWidget } from './image-widget'

function createTestView(doc: string, cursor = 0): EditorView {
  const container = document.createElement('div')
  document.body.appendChild(container)

  const state = EditorState.create({
    doc,
    selection: { anchor: cursor },
    extensions: [
      markdown({
        extensions: [GFM, Table, TaskList, Strikethrough],
      }),
    ],
  })

  return new EditorView({
    state,
    parent: container,
  })
}

describe('Markdown Live Preview (所见即所得核心扩展)', () => {
  it('自动链接折叠尖括号，进入时显示原始语法；裸链接也有链接样式', () => {
    const text = '<https://github.com> 与 https://example.com\n\n末尾'
    const view = createTestView(text, text.length)
    const ranges: Array<{ from: number; to: number; className?: string }> = []
    buildLivePreviewDecorations(view).between(0, text.length, (from, to, value) => { ranges.push({ from, to, className: value.spec.class }) })
    expect(ranges.filter((range) => range.className === 'cm-live-link')).toHaveLength(2)
    expect(ranges.some((range) => range.from === 0 && range.to === 1 && !range.className)).toBe(true)
    view.dispatch({ selection: { anchor: 5 } })
    const collapsed: number[] = []
    buildLivePreviewDecorations(view).between(0, 19, (from, _to, value) => { if (!value.spec.class) collapsed.push(from) })
    expect(collapsed).toEqual([])
    expect(view.state.doc.toString()).toBe(text)
    view.destroy()
  })
  it('光标远离时，自动折叠语法符号并应用美化样式', () => {
    const text = '# 一级标题\n\n**加粗内容** 与 *斜体* 以及 ~~删除线~~\n\n普通末尾文字'
    const view = createTestView(text, text.length)

    const decos = buildLivePreviewDecorations(view)
    const decoratedRanges: Array<{ from: number; to: number; value: any }> = []
    decos.between(0, text.length, (from, to, value) => {
      decoratedRanges.push({ from, to, value })
    })

    const headingReplaced = decoratedRanges.some((r) => r.from === 0 && r.value.spec?.class === undefined)
    expect(headingReplaced).toBe(true)

    const headingStyled = decoratedRanges.some((r) => r.value.spec?.class === 'cm-live-h1')
    expect(headingStyled).toBe(true)

    const boldStyled = decoratedRanges.some((r) => r.value.spec?.class === 'cm-live-bold')
    expect(boldStyled).toBe(true)

    const italicStyled = decoratedRanges.some((r) => r.value.spec?.class === 'cm-live-italic')
    expect(italicStyled).toBe(true)

    const strikeStyled = decoratedRanges.some((r) => r.value.spec?.class === 'cm-live-strike')
    expect(strikeStyled).toBe(true)
  })

  it('光标进入加粗语法节点时，展开 ** 辅助符号但正文依然保持粗体', () => {
    const text = '这是 **加粗测试** 内容'
    const view = createTestView(text, 9)

    const decos = buildLivePreviewDecorations(view)
    const decoratedRanges: Array<{ from: number; to: number; value: any }> = []
    decos.between(0, text.length, (from, to, value) => {
      decoratedRanges.push({ from, to, value })
    })

    const hasSyntaxMark = decoratedRanges.some((r) => r.value.spec?.class === 'cm-live-syntax-mark')
    expect(hasSyntaxMark).toBe(true)

    const hasBoldDeco = decoratedRanges.some((r) => r.value.spec?.class === 'cm-live-bold')
    expect(hasBoldDeco).toBe(true)
  })

  it('光标在标题行时，保留 # 辅助符号，同时标题正文绝不发生字阶塌陷', () => {
    const text = '## 这是一个二级标题\n\n正文内容'
    const view = createTestView(text, 5)

    const decos = buildLivePreviewDecorations(view)
    const decoratedRanges: Array<{ from: number; to: number; value: any }> = []
    decos.between(0, text.length, (from, to, value) => {
      decoratedRanges.push({ from, to, value })
    })

    const headingMarkCollapsed = decoratedRanges.some((r) => r.from === 0 && r.value.spec?.class === undefined)
    expect(headingMarkCollapsed).toBe(false)
    const hasHeaderMark = decoratedRanges.some((r) => r.value.spec?.class?.includes('cm-live-header-mark'))
    expect(hasHeaderMark).toBe(true)

    const hasHeadingStyle = decoratedRanges.some((r) => r.value.spec?.class === 'cm-live-h2')
    expect(hasHeadingStyle).toBe(true)
  })

  it('任务列表项自动渲染为 Checkbox 并支持点击交互切换底本状态', () => {
    const text = '- [ ] 待办任务 1\n- [x] 已完成任务 2'
    const view = createTestView(text, text.length)

    const decos = buildLivePreviewDecorations(view)
    const widgets: TaskCheckboxWidget[] = []
    decos.between(0, text.length, (_from, _to, value) => {
      if (value.spec?.widget instanceof TaskCheckboxWidget) {
        widgets.push(value.spec.widget)
      }
    })

    expect(widgets.length).toBe(2)
    expect(widgets[0].checked).toBe(false)
    expect(widgets[1].checked).toBe(true)

    const dom = widgets[0].toDOM(view)
    dom.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    expect(view.state.sliceDoc(0, 5)).toBe('- [x]')
  })

  it('光标不在引用行时，将 > 替换为优雅 QuoteMarkWidget 竖条', () => {
    const text = '> 这是一段引言文字\n\n正文末尾'
    const view = createTestView(text, text.length)

    const decos = buildLivePreviewDecorations(view)
    const quoteWidgets: QuoteMarkWidget[] = []
    decos.between(0, text.length, (_from, _to, value) => {
      if (value.spec?.widget instanceof QuoteMarkWidget) {
        quoteWidgets.push(value.spec.widget)
      }
    })

    expect(quoteWidgets.length).toBe(1)
  })

  it('光标不在分割线行时，将 --- 替换为 HorizontalRuleWidget', () => {
    const text = '第一段\n\n---\n\n第二段'
    const view = createTestView(text, 0)

    const decos = buildLivePreviewDecorations(view)
    const hrWidgets: HorizontalRuleWidget[] = []
    decos.between(0, text.length, (_from, _to, value) => {
      if (value.spec?.widget instanceof HorizontalRuleWidget) {
        hrWidgets.push(value.spec.widget)
      }
    })

    expect(hrWidgets.length).toBe(1)
  })

  it('光标不在链接内时，折叠 URL 并将正文渲染为超链接样式', () => {
    const text = '访问 [Montree 官网](https://montree.example.com) 探索'
    // 光标在开头（远离链接）
    const view = createTestView(text, 0)

    const decos = buildLivePreviewDecorations(view)
    const decoratedRanges: Array<{ from: number; to: number; value: any }> = []
    decos.between(0, text.length, (from, to, value) => {
      decoratedRanges.push({ from, to, value })
    })

    // 链接文字应用了 cm-live-link
    const hasLinkDeco = decoratedRanges.some((r) => r.value.spec?.class === 'cm-live-link')
    expect(hasLinkDeco).toBe(true)

    // 开括号 [ 以及后面的 (url) 应该被 replace 折叠
    const replacedCount = decoratedRanges.filter((r) => r.value.spec?.class === undefined).length
    expect(replacedCount).toBeGreaterThanOrEqual(2)
  })

  it('光标不在图片行时，将 ![alt](url) 替换为 ImageWidget 就地预览', () => {
    const text = '前文\n\n![示例图片](https://example.com/pic.png)\n\n后文'
    const view = createTestView(text, 0)

    const decos = buildLivePreviewDecorations(view)
    const imageWidgets: ImageWidget[] = []
    decos.between(0, text.length, (_from, _to, value) => {
      if (value.spec?.widget instanceof ImageWidget) {
        imageWidgets.push(value.spec.widget)
      }
    })

    expect(imageWidgets.length).toBe(1)
    expect(imageWidgets[0].src).toBe('https://example.com/pic.png')
    expect(imageWidgets[0].alt).toBe('示例图片')
  })

  it('光标不在 HTML 注释行时，自动折叠隐藏注释代码', () => {
    const text = '正文行\n<!-- 这是内部注释 -->\n下一行'
    const view = createTestView(text, 0)

    const decos = buildLivePreviewDecorations(view)
    const replacedRanges: Array<{ from: number; to: number }> = []
    decos.between(0, text.length, (from, to, value) => {
      if (value.spec?.class === undefined && !value.spec?.widget) {
        replacedRanges.push({ from, to })
      }
    })

    // 注释所在位置被 replace 折叠隐藏
    const commentReplaced = replacedRanges.some((r) => r.from === 4 && r.to === 19)
    expect(commentReplaced).toBe(true)
  })
})
