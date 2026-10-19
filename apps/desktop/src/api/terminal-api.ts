import type { TerminalCreate, TerminalEvent } from '../../contracts/terminal'
function api() {
  if (!window.montreeTerminal) throw new Error('终端接口不可用，请重启应用')
  return window.montreeTerminal
}
export const terminalApi = {
  profiles: () => api().profiles(), list: () => api().list(),
  create: (payload: TerminalCreate) => api().create(payload),
  write: (id: string, data: string) => api().write(id, data),
  resize: (id: string, cols: number, rows: number) => api().resize(id, cols, rows),
  read: (id: string, cursor?: number) => api().read(id, cursor),
  close: (id: string) => api().close(id),
  onEvent: (callback: (event: TerminalEvent) => void) => api().onEvent(callback),
}
