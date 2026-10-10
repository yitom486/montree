import { WidgetType } from '@codemirror/view'

/** 所见即所得下的水平分割线 Widget（光标离开时将 --- 替换为精致分割线） */
export class HorizontalRuleWidget extends WidgetType {
  toDOM(): HTMLElement {
    const hr = document.createElement('div')
    hr.className = 'cm-live-hr'
    hr.setAttribute('role', 'separator')
    return hr
  }

  eq(): boolean {
    return true
  }

  ignoreEvent(): boolean {
    return true
  }
}
