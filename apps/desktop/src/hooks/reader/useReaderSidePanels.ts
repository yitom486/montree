import { useCallback, useState } from 'react'

/** 正文侧只保留目录；批注、划线与书签统一进入外壳卡片区。 */
export function useReaderSidePanels() {
  const [tocOpen, setTocOpen] = useState(false)
  const toggleToc = useCallback(() => setTocOpen((value) => !value), [])
  const closeToc = useCallback(() => setTocOpen(false), [])
  return { tocOpen, toggleToc, closeToc }
}
