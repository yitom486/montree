import { createContext, useContext, useEffect, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { useReaderHudUiStore } from '@/stores/acp/reader-hud-store'

export const WorkspaceCardRailContext = createContext<{
  host: HTMLDivElement | null
  setReaderAvailable: (available: boolean) => void
} | null>(null)

/** 卡片仍由阅读器管理数据与回调，只把展示位置移入外壳的共享辅助区。 */
export function WorkspaceCardRail({ children }: { children: ReactNode }) {
  const context = useContext(WorkspaceCardRailContext)
  const setReaderAvailable = context?.setReaderAvailable
  const cardRailOpen = useReaderHudUiStore((s) => s.isCardRailOpen)
  const zenMode = useReaderHudUiStore((s) => s.zenMode)

  useEffect(() => {
    setReaderAvailable?.(true)
    return () => setReaderAvailable?.(false)
  }, [setReaderAvailable])

  if (context) return context.host ? createPortal(children, context.host) : null
  return cardRailOpen && !zenMode ? children : null
}
