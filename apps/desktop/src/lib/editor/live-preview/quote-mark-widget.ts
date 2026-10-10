import { WidgetType } from '@codemirror/view'

/** 所见即所得下的引用标识 Widget（光标离开时将 > 替换为优雅的高亮竖条） */
export class QuoteMarkWidget extends WidgetType {
  toDOM(): HTMLElement {
    const span = document.createElement('span')
    span.className = 'cm-live-quote-bar'
    span.setAttribute('aria-hidden', 'true')
    return span
  }

  eq(): boolean {
    return true
  }

  ignoreEvent(): boolean {
    return true
  }
}
