/// <reference types="vite/client" />

import type { ElectronAPI } from '@yitom/contracts'

declare global {
  interface Window {
    electronAPI?: ElectronAPI
  }
}

export {}
