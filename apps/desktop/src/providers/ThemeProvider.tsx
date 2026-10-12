import type { ReactNode } from 'react'
import { useEffect } from 'react'
import { useEditorUiStore, type AppTheme } from '@/stores/editor-ui-store'

export function useApplyTheme(theme: AppTheme) {
  useEffect(() => {
    const root = document.documentElement
    if (!root.classList.contains(theme)) {
      root.classList.remove('light', 'sepia', 'dark')
      root.classList.add(theme)
    }
  }, [theme])
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const theme = useEditorUiStore((state) => state.theme)
  useApplyTheme(theme)
  return children
}
