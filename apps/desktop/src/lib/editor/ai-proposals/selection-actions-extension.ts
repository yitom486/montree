import { StateEffect, StateField, type EditorState, type Extension } from '@codemirror/state'
import { EditorView, keymap, showTooltip, type Tooltip } from '@codemirror/view'
import { SELECTION_ACTIONS, type SelectionAction } from './selection-prompt'

/**
 * 选区浮动操作条：选中文本后出现（改写/润色/缩短/扩写/翻译/自定义指令），
 * Ctrl/Cmd+J 直接打开自定义指令输入。结果经当前 Agent 以修改建议返回。
 */
export type SelectionActionHandler = (action: SelectionAction, instruction?: string) => void

const openCustomEffect = StateEffect.define<boolean>()
const dismissEffect = StateEffect.define<null>()

interface ToolbarState { tooltip: Tooltip | null; custom: boolean; dismissedAt: number | null }

function selectionTooltip(state: EditorState, custom: boolean, create: (custom: boolean) => Tooltip['create']): Tooltip | null {
  const range = state.selection.main
  if (range.empty) return null
  return { pos: range.from, above: true, strictSide: false, arrow: false, create: create(custom) }
}

export function selectionActionsExtension(handler: SelectionActionHandler): Extension {
  const create = (custom: boolean): Tooltip['create'] => (view) => {
    const dom = document.createElement('div')
    dom.className = 'cm-ai-selection-toolbar'
    dom.setAttribute('role', 'toolbar')
    dom.setAttribute('aria-label', 'AI 选区操作')
    dom.dataset.testid = 'selection-ai-toolbar'
    dom.addEventListener('mousedown', (event) => { if (!(event.target instanceof HTMLInputElement)) event.preventDefault() })
    const run = (action: SelectionAction, instruction?: string) => {
      handler(action, instruction)
      view.dispatch({ effects: dismissEffect.of(null) })
    }
    const input = document.createElement('input')
    const showCustom = () => {
      dom.replaceChildren(input)
      input.focus()
    }
    input.className = 'cm-ai-selection-input'
    input.placeholder = '输入指令，回车发送给 Agent（Esc 取消）'
    input.setAttribute('aria-label', '自定义 AI 指令')
    input.addEventListener('keydown', (event) => {
      event.stopPropagation()
      if (event.key === 'Enter' && !event.isComposing && input.value.trim()) { event.preventDefault(); run('custom', input.value) }
      else if (event.key === 'Escape') { event.preventDefault(); view.dispatch({ effects: dismissEffect.of(null) }); view.focus() }
    })
    for (const item of SELECTION_ACTIONS) {
      const button = document.createElement('button')
      button.type = 'button'
      button.className = 'cm-ai-selection-btn'
      button.textContent = item.label
      button.title = item.instruction
      button.dataset.selectionAction = item.id
      button.addEventListener('click', () => run(item.id))
      dom.append(button)
    }
    const more = document.createElement('button')
    more.type = 'button'
    more.className = 'cm-ai-selection-btn'
    more.textContent = '自定义…'
    more.title = '自定义指令（Ctrl/Cmd+J）'
    more.dataset.selectionAction = 'custom'
    more.addEventListener('click', showCustom)
    dom.append(more)
    if (custom) queueMicrotask(showCustom)
    return { dom }
  }

  const field = StateField.define<ToolbarState>({
    create: () => ({ tooltip: null, custom: false, dismissedAt: null }),
    update(value, tr) {
      let custom = value.custom, dismissedAt = value.dismissedAt
      for (const effect of tr.effects) {
        if (effect.is(openCustomEffect)) { custom = effect.value; dismissedAt = null }
        if (effect.is(dismissEffect)) return { tooltip: null, custom: false, dismissedAt: tr.state.selection.main.from }
      }
      const range = tr.state.selection.main
      if (range.empty) return { tooltip: null, custom: false, dismissedAt: null }
      // 关闭后同一选区不再弹出；选区变化后恢复
      if (dismissedAt !== null && !tr.selection && !tr.docChanged) return value
      if (dismissedAt !== null && tr.selection) dismissedAt = null
      if (dismissedAt !== null) return { ...value, tooltip: null }
      if (!tr.selection && !tr.docChanged && custom === value.custom && value.tooltip) return value
      return { tooltip: selectionTooltip(tr.state, custom, create), custom, dismissedAt }
    },
    provide: (f) => showTooltip.from(f, (value) => value.tooltip),
  })

  const openCustom = (view: EditorView): boolean => {
    const range = view.state.selection.main
    const effects = [openCustomEffect.of(true)]
    if (range.empty) {
      // 无选区：选中当前行再打开
      const line = view.state.doc.lineAt(range.head)
      if (line.from === line.to) return false
      view.dispatch({ selection: { anchor: line.from, head: line.to }, effects })
    } else view.dispatch({ effects })
    return true
  }

  return [
    field,
    keymap.of([{ key: 'Mod-j', run: openCustom, preventDefault: true }]),
    EditorView.baseTheme({
      '.cm-tooltip.cm-ai-selection-tooltip, .cm-tooltip:has(> .cm-ai-selection-toolbar)': { border: 'none', background: 'transparent' },
      '.cm-ai-selection-toolbar': { display: 'flex', gap: '2px', padding: '3px', borderRadius: '8px', border: '1px solid rgba(127,127,127,0.3)', background: 'var(--popover, #fff)', color: 'var(--popover-foreground, inherit)', boxShadow: '0 4px 14px rgba(0,0,0,0.12)', font: '500 12px/1.4 system-ui, sans-serif' },
      '.cm-ai-selection-btn': { padding: '2px 8px', border: 'none', borderRadius: '5px', background: 'transparent', color: 'inherit', cursor: 'pointer' },
      '.cm-ai-selection-btn:hover': { background: 'rgba(16, 185, 129, 0.14)' },
      '.cm-ai-selection-input': { width: '320px', padding: '3px 8px', border: '1px solid rgba(127,127,127,0.35)', borderRadius: '5px', background: 'transparent', color: 'inherit', font: 'inherit', outline: 'none' },
    }),
  ]
}
