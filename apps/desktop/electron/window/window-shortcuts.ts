type ShortcutInput = Pick<Electron.Input, 'type' | 'key' | 'code' | 'control' | 'meta' | 'shift' | 'alt'>

/** 主进程接收 iframe 内的按键；正文编辑快捷键仍交给编辑器。 */
export function resolveWindowShortcut(input: ShortcutInput): string | undefined {
  if (input.type !== 'keyDown' || !(input.control || input.meta) || input.alt) return
  const key = input.code?.startsWith('Key') ? input.code.slice(3).toLowerCase() : input.key.toLowerCase()
  if (input.shift) {
    return ({ n: 'new-window', o: 'open-folder', s: 'save-as', i: 'devtools' } as Record<string, string>)[key]
  }
  if (input.code === 'Comma' || key === ',') return 'settings'
  return ({ o: 'open-file', s: 'save', p: 'quick-open', f: 'find', h: 'replace' } as Record<string, string>)[key]
}
