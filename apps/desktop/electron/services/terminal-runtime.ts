import { webContents } from 'electron'
import { TERMINAL_IPC } from '../../contracts/terminal'
import { TerminalService } from './terminal-service'

export const workspaceTerminals = new TerminalService((owner, event) => {
  const sender = webContents.fromId(Number(owner.replace(/^window-/, '')))
  if (sender && !sender.isDestroyed()) sender.send(TERMINAL_IPC.event, event)
})
