/// <reference types="vite/client" />

import type { ElectronAPI } from '@yitom/contracts'
import type { TerminalAPI } from '../contracts/terminal'

declare global {
  interface Window {
    electronAPI?: ElectronAPI
    montreeTerminal?: TerminalAPI
  }
}

export {}
