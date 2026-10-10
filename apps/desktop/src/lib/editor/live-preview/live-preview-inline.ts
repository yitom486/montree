import {
  Decoration,
  type DecorationSet,
  EditorView,
  ViewPlugin,
  WidgetType,
  type ViewUpdate,
} from '@codemirror/view'
import { ensureSyntaxTree, syntaxTree } from '@codemirror/language'
import { TaskCheckboxWidget } from './task-checkbox-widget'
import { QuoteMarkWidget } from './quote-mark-widget'
import { HorizontalRuleWidget } from './horizontal-rule-widget'
import { ImageWidget } from './image-widget'
import { livePreviewBlocks, livePreviewConfig } from './live-preview-blocks'
import { markdownParser } from '@/lib/editor/markdown'

interface DecoItem {
  from: number
  to: number
  deco: Decoration
}

class BulletMarkerWidget extends WidgetType {
  eq(): boolean { return true }
  toDOM(): HTMLElement {
    const marker = document.createElement('span')
    marker.textContent = '•'
    marker.setAttribute('aria-hidden', 'true')
    return marker
  }
}

export function buildLivePreviewDecorations(view: EditorView): DecorationSet {
  const state = view.state
  // 确保语法树已解析
  const tree = ensureSyntaxTree(state, state.doc.length, 50) ?? syntaxTree(state)
  const items: DecoItem[] = []
  // Block source editing must expose every marker, including styles in unselected table cells.
  const replaced = state.field(livePreviewBlocks, false)?.blocks ?? []

  // 辅助函数：判断选区或光标是否相交
  const touchesSelection = (from: number, to: number): boolean => {
    return state.selection.ranges.some((range) => {
      if (range.empty) {
        // 光标在边界或节点内部
        return range.from >= from && range.from <= to
      }
      // 非空选区相交
      return range.from <= to && range.to >= from
    })
  }

  // 辅助函数：判断光标是否在整行内（针对标题、引用、分割线等行级结构）
  const lineTouchesSelection = (from: number): boolean => {
    const line = state.doc.lineAt(from)
    return state.selection.ranges.some((range) => range.from <= line.to && range.to >= line.from)
  }

  // 对当前可见区域进行装饰遍历
  for (const { from: viewFrom, to: viewTo } of view.visibleRanges) {
    tree.iterate({
      from: viewFrom,
      to: viewTo,
      enter(node) {
        const name = node.name
        if (replaced.some((range) => node.from >= range.from && node.to <= range.to)) return false

        if (name === 'ListMark' && node.node.parent?.parent?.name === 'BulletList' && !lineTouchesSelection(node.from)) {
          items.push({ from: node.from, to: node.to, deco: Decoration.replace({ widget: new BulletMarkerWidget() }) })
          return
        }

        // 1. 标题（ATXHeading1 ~ ATXHeading6）
        if (name.startsWith('ATXHeading')) {
          const level = name.slice(-1)
          const markNode = node.node.getChild('HeaderMark')
          const isLineActive = lineTouchesSelection(node.from)

          if (markNode) {
            let markEnd = markNode.to
            if (state.sliceDoc(markEnd, markEnd + 1) === ' ') {
              markEnd++
            }

            if (!isLineActive) {
              // 光标远离：折叠隐藏 # 前缀及紧跟的空格
              items.push({
                from: markNode.from,
                to: markEnd,
                deco: Decoration.replace({}),
              })
            } else {
              // 光标在当前行：显示 # 前缀，统一大字阶，弱化颜色供精确编辑
              items.push({
                from: markNode.from,
                to: markEnd,
                deco: Decoration.mark({ class: `cm-live-header-mark cm-live-h${level}` }),
              })
            }

            // 标题正文始终保持对应的标题字阶，绝不因光标进入而塌陷缩水
            if (markEnd < node.to) {
              items.push({
                from: markEnd,
                to: node.to,
                deco: Decoration.mark({ class: `cm-live-h${level}` }),
              })
            }
          }
          return
        }

        // 2. 加粗（StrongEmphasis）
        if (name === 'StrongEmphasis') {
          const marks = node.node.getChildren('EmphasisMark')
          if (marks.length === 2 && marks[0].to < marks[1].from) {
            const isActive = touchesSelection(node.from, node.to)
            if (!isActive) {
              items.push({ from: marks[0].from, to: marks[0].to, deco: Decoration.replace({}) })
              items.push({
                from: marks[0].to,
                to: marks[1].from,
                deco: Decoration.mark({ class: 'cm-live-bold' }),
              })
              items.push({ from: marks[1].from, to: marks[1].to, deco: Decoration.replace({}) })
            } else {
              items.push({
                from: marks[0].from,
                to: marks[0].to,
                deco: Decoration.mark({ class: 'cm-live-syntax-mark' }),
              })
              items.push({
                from: marks[0].to,
                to: marks[1].from,
                deco: Decoration.mark({ class: 'cm-live-bold' }),
              })
              items.push({
                from: marks[1].from,
                to: marks[1].to,
                deco: Decoration.mark({ class: 'cm-live-syntax-mark' }),
              })
            }
          }
          return
        }

        // 3. 斜体（Emphasis）
        if (name === 'Emphasis') {
          const marks = node.node.getChildren('EmphasisMark')
          if (marks.length === 2 && marks[0].to < marks[1].from) {
            const isActive = touchesSelection(node.from, node.to)
            if (!isActive) {
              items.push({ from: marks[0].from, to: marks[0].to, deco: Decoration.replace({}) })
              items.push({
                from: marks[0].to,
                to: marks[1].from,
                deco: Decoration.mark({ class: 'cm-live-italic' }),
              })
              items.push({ from: marks[1].from, to: marks[1].to, deco: Decoration.replace({}) })
            } else {
              items.push({
                from: marks[0].from,
                to: marks[0].to,
                deco: Decoration.mark({ class: 'cm-live-syntax-mark' }),
              })
              items.push({
                from: marks[0].to,
                to: marks[1].from,
                deco: Decoration.mark({ class: 'cm-live-italic' }),
              })
              items.push({
                from: marks[1].from,
                to: marks[1].to,
                deco: Decoration.mark({ class: 'cm-live-syntax-mark' }),
              })
            }
          }
          return
        }

        // 4. 删除线（Strikethrough）
        if (name === 'Strikethrough') {
          const marks = node.node.getChildren('StrikethroughMark')
          if (marks.length === 2 && marks[0].to < marks[1].from) {
            const isActive = touchesSelection(node.from, node.to)
            if (!isActive) {
              items.push({ from: marks[0].from, to: marks[0].to, deco: Decoration.replace({}) })
              items.push({
                from: marks[0].to,
                to: marks[1].from,
                deco: Decoration.mark({ class: 'cm-live-strike' }),
              })
              items.push({ from: marks[1].from, to: marks[1].to, deco: Decoration.replace({}) })
            } else {
              items.push({
                from: marks[0].from,
                to: marks[0].to,
                deco: Decoration.mark({ class: 'cm-live-syntax-mark' }),
              })
              items.push({
                from: marks[0].to,
                to: marks[1].from,
                deco: Decoration.mark({ class: 'cm-live-strike' }),
              })
              items.push({
                from: marks[1].from,
                to: marks[1].to,
                deco: Decoration.mark({ class: 'cm-live-syntax-mark' }),
              })
            }
          }
          return
        }

        // 5. 行内代码（InlineCode）
        if (name === 'InlineCode') {
          const marks = node.node.getChildren('CodeMark')
          if (marks.length === 2 && marks[0].to < marks[1].from) {
            const isActive = touchesSelection(node.from, node.to)
            if (!isActive) {
              items.push({ from: marks[0].from, to: marks[0].to, deco: Decoration.replace({}) })
              items.push({
                from: marks[0].to,
                to: marks[1].from,
                deco: Decoration.mark({ class: 'cm-live-inline-code' }),
              })
              items.push({ from: marks[1].from, to: marks[1].to, deco: Decoration.replace({}) })
            } else {
              items.push({
                from: marks[0].from,
                to: marks[0].to,
                deco: Decoration.mark({ class: 'cm-live-syntax-mark' }),
              })
              items.push({
                from: marks[0].to,
                to: marks[1].from,
                deco: Decoration.mark({ class: 'cm-live-inline-code' }),
              })
              items.push({
                from: marks[1].from,
                to: marks[1].to,
                deco: Decoration.mark({ class: 'cm-live-syntax-mark' }),
              })
            }
          }
          return
        }

        // 6. 任务列表项（TaskMarker: [ ] 或 [x]）
        if (name === 'TaskMarker') {
          const isSelected = state.selection.ranges.some(
            (r) => !r.empty && r.from <= node.to && r.to >= node.from,
          )
          if (!isSelected) {
            const markerText = state.sliceDoc(node.from, node.to)
            const isChecked = markerText.toLowerCase() === '[x]'
            items.push({
              from: node.from,
              to: node.to,
              deco: Decoration.replace({
                widget: new TaskCheckboxWidget(isChecked, node.from),
              }),
            })
          }
          return
        }

        // 7. 引用符（QuoteMark: >）
        if (name === 'QuoteMark') {
          const isLineActive = lineTouchesSelection(node.from)
          if (!isLineActive) {
            let hideTo = node.to
            if (state.sliceDoc(hideTo, hideTo + 1) === ' ') {
              hideTo++
            }
            items.push({
              from: node.from,
              to: hideTo,
              deco: Decoration.replace({
                widget: new QuoteMarkWidget(),
              }),
            })
          } else {
            items.push({
              from: node.from,
              to: node.to,
              deco: Decoration.mark({ class: 'cm-live-syntax-mark' }),
            })
          }
          return
        }

        // 8. 水平分割线（HorizontalRule: --- 等）
        if (name === 'HorizontalRule') {
          const isLineActive = lineTouchesSelection(node.from)
          if (!isLineActive) {
            items.push({
              from: node.from,
              to: node.to,
              deco: Decoration.replace({
                widget: new HorizontalRuleWidget(),
              }),
            })
          } else {
            items.push({
              from: node.from,
              to: node.to,
              deco: Decoration.mark({ class: 'cm-live-syntax-mark' }),
            })
          }
          return
        }

        if (name === 'Autolink') {
          const url = node.node.getChild('URL')
          if (url) {
            if (!touchesSelection(node.from, node.to)) {
              for (const mark of node.node.getChildren('LinkMark')) {
                items.push({ from: mark.from, to: mark.to, deco: Decoration.replace({}) })
              }
            }
            items.push({ from: url.from, to: url.to, deco: Decoration.mark({ class: 'cm-live-link' }) })
          }
          return false
        }

        if (name === 'URL' && !['Link', 'Autolink', 'LinkReference'].includes(node.node.parent?.name ?? '')) {
          items.push({ from: node.from, to: node.to, deco: Decoration.mark({ class: 'cm-live-link' }) })
          return
        }

        // 9. 超链接（Link: [文本](url)）
        if (name === 'Link') {
          // Lezer accepts unresolved references. markdown-it validates them against the document.
          const parsed = markdownParser.parseInline(state.sliceDoc(node.from, node.to), replaced[0]?.env ?? {})[0]
          if (!parsed?.children?.some((token) => token.type === 'link_open')) return false
          const marks = node.node.getChildren('LinkMark')
          if (marks.length >= 2) {
            const openBracket = marks[0]
            const closeBracket = marks[1]
            const isActive = touchesSelection(node.from, node.to)

            if (!isActive && openBracket.to < closeBracket.from) {
              // 隐藏开括号 [
              items.push({
                from: openBracket.from,
                to: openBracket.to,
                deco: Decoration.replace({}),
              })
              // 正文应用超链接富文本样式
              items.push({
                from: openBracket.to,
                to: closeBracket.from,
                deco: Decoration.mark({ class: 'cm-live-link' }),
              })
              // 隐藏 ](url...)
              if (closeBracket.from < node.to) {
                items.push({
                  from: closeBracket.from,
                  to: node.to,
                  deco: Decoration.replace({}),
                })
              }
            } else if (openBracket.to < closeBracket.from) {
              // 光标在链接内：保留超链接颜色供识别
              items.push({
                from: openBracket.to,
                to: closeBracket.from,
                deco: Decoration.mark({ class: 'cm-live-link' }),
              })
            }
          }
          return
        }

        // 10. 图片（Image: ![alt](url)）
        if (name === 'Image') {
          const isLineActive = lineTouchesSelection(node.from)
          if (!isLineActive) {
            const urlNode = node.node.getChild('URL')
            const url = urlNode ? state.sliceDoc(urlNode.from, urlNode.to) : ''
            const marks = node.node.getChildren('LinkMark')
            let alt = ''
            if (marks.length >= 2) {
              alt = state.sliceDoc(marks[0].to, marks[1].from)
            }
            if (url) {
              items.push({
                from: node.from,
                to: node.to,
                deco: Decoration.replace({
                  widget: new ImageWidget(url, alt, state.facet(livePreviewConfig).filePath),
                }),
              })
            }
          }
          return
        }

        // 11. HTML 注释（Comment / CommentBlock: <!-- ... -->）
        if (name === 'Comment' || name === 'CommentBlock') {
          if (state.doc.lineAt(node.from).number !== state.doc.lineAt(node.to).number) return
          const isLineActive = lineTouchesSelection(node.from)
          if (!isLineActive) {
            items.push({
              from: node.from,
              to: node.to,
              deco: Decoration.replace({}),
            })
          }
          return
        }
      },
    })
  }

  // Marks can nest (bold + italic + link); CodeMirror sorts them by their own sides.
  return Decoration.set(items.map(({ from, to, deco }) => deco.range(from, to)), true)
}

export const livePreviewPlugin = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet

    constructor(view: EditorView) {
      this.decorations = buildLivePreviewDecorations(view)
    }

    update(update: ViewUpdate) {
      // 中文输入法状态下（view.composing）禁止重新生成折叠装饰，防止拼音选词跳动
      if (update.view.composing) {
        if (update.docChanged) {
          this.decorations = this.decorations.map(update.changes)
        }
        return
      }

      if (update.docChanged || update.selectionSet || update.viewportChanged) {
        this.decorations = buildLivePreviewDecorations(update.view)
      }
    }
  },
  {
    decorations: (v) => v.decorations,
  },
)
