/// <reference types="vite/client" />

import type { ElectronAPI } from '@montree/contracts'

declare global {
  interface Window {
    electronAPI?: ElectronAPI
  }
}

export {}
