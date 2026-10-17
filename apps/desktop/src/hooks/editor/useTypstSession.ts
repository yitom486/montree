import { useEffect, useRef, useState } from 'react'
import { typstApi } from '@/api/typst-api'
import { TypstSessionController, type TypstSessionState } from '@/lib/editor/typst-session'
import { typstProjectRoot } from '@/lib/editor/typst-lsp'
import type { TypstRequestMethod } from '@yitom/contracts'

const initialState: TypstSessionState = { phase: 'starting', session: null, message: null, diagnostics: [], version: 1, compileStatus: null, diagnosticsUnversioned: false, recoverableExit: false }
const fileLifetimes = new Map<string, Promise<void>>()

export function useTypstSession(filePath: string, content: string, rootPath: string | undefined, enabled: boolean) {
  const projectRoot = typstProjectRoot(filePath, rootPath)
  const controllerRef = useRef<TypstSessionController | null>(null)
  const contentRef = useRef(content)
  contentRef.current = content
  const [state, setState] = useState(initialState)
  const [generation, setGeneration] = useState(0)
  const recoveryRef = useRef({ key: '', attempts: 0 })

  useEffect(() => {
    if (!enabled) { setState(initialState); return }
    setState(initialState)
    // StrictMode and explicit restarts may run setup before the previous asynchronous close.
    const key = JSON.stringify([filePath, projectRoot])
    if (recoveryRef.current.key !== key) recoveryRef.current = { key, attempts: 0 }
    const controller = new TypstSessionController(typstApi, { filePath, rootPath: projectRoot, content: contentRef.current }, (next) => {
      if (next.phase === 'error' && recoveryRef.current.attempts > 0) {
        setState({ ...next, message: `${next.message ?? 'Typst 服务不可用'}（已尝试自动重连，请手动重启服务）` })
      } else setState(next)
      if (next.recoverableExit && recoveryRef.current.attempts === 0) {
        recoveryRef.current.attempts++
        setGeneration((value) => value + 1)
      }
    })
    controllerRef.current = controller
    const previous = fileLifetimes.get(key) ?? Promise.resolve()
    let released!: () => void
    const closed = new Promise<void>((resolve) => { released = resolve })
    const lifetime = previous.then(() => closed)
    fileLifetimes.set(key, lifetime)
    let cancelled = false
    const started = previous.then(async () => {
      if (cancelled) return
      controller.updateContent(contentRef.current)
      await controller.start()
    })
    return () => {
      cancelled = true; controllerRef.current = null
      const closing = controller.dispose()
      void Promise.allSettled([started, closing]).then(() => {
        released()
        if (fileLifetimes.get(key) === lifetime) fileLifetimes.delete(key)
      })
    }
  }, [filePath, projectRoot, enabled, generation])

  useEffect(() => { controllerRef.current?.updateContent(content) }, [content])

  return {
    ...state,
    restart: () => { recoveryRef.current.attempts = 0; setGeneration((value) => value + 1) },
    updateContent: (value: string) => controllerRef.current?.updateContent(value),
    request: (method: TypstRequestMethod, params: unknown) => controllerRef.current?.request(method, params) ?? Promise.resolve(null),
    exportPdf: () => controllerRef.current?.exportPdf() ?? Promise.resolve(null),
  }
}
