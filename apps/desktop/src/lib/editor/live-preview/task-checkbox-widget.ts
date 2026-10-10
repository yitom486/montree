import { WidgetType, type EditorView } from '@codemirror/view'

export class TaskCheckboxWidget extends WidgetType {
  constructor(
    readonly checked: boolean,
    readonly pos: number,
  ) {
    super()
  }

  toDOM(view: EditorView): HTMLElement {
    const input = document.createElement('input')
    input.type = 'checkbox'
    input.checked = this.checked
    input.className = 'cm-live-task-checkbox'
    input.setAttribute('aria-label', this.checked ? '已完成任务项' : '待办任务项')

    input.addEventListener('click', (event) => {
      event.stopPropagation()
      const text = view.state.sliceDoc(this.pos, this.pos + 3)
      // 验证目标位置仍是 [ ] 或 [x]，避免旧闭包并发冲突
      if (text === '[ ]' || text === '[x]') {
        const nextMarker = this.checked ? '[ ]' : '[x]'
        view.dispatch({
          changes: {
            from: this.pos,
            to: this.pos + 3,
            insert: nextMarker,
          },
        })
      }
    })

    return input
  }

  eq(other: TaskCheckboxWidget): boolean {
    return this.checked === other.checked && this.pos === other.pos
  }

  ignoreEvent(): boolean {
    return false
  }
}
