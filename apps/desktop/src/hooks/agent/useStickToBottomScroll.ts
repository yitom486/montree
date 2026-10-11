import { useCallback, useLayoutEffect, useRef, type RefObject } from 'react'
import { useStickToBottom } from 'use-stick-to-bottom'
import { resolveScrollViewport } from '@/lib/agent/stick-to-bottom'

export interface ChatScrollSnapshot { scrollTop: number; pinned: boolean }
interface Options {
  contentRef: RefObject<HTMLElement | null>
  threadId?: string
  enabled?: boolean
  loadScroll?: () => ChatScrollSnapshot | undefined
  saveScroll?: (snapshot: ChatScrollSnapshot) => void
}

/** Community owns scrolling. Only the existing viewport and thread memory are adapted here. */
export function useStickToBottomScroll({ contentRef, threadId, enabled = true, loadScroll, saveScroll }: Options) {
  const instance = useStickToBottom({ initial: false, resize: 'instant' })
  const { contentRef: communityContent, scrollRef, stopScroll, scrollToBottom } = instance
  const saveRef = useRef(saveScroll)
  saveRef.current = saveScroll
  useLayoutEffect(() => {
    if (!enabled) return
    const content = contentRef.current
    const viewport = resolveScrollViewport(content)
    if (!content || !viewport) return
    communityContent(content)
    scrollRef(viewport)
    const saved = loadScroll?.()
    if (saved && !saved.pinned) {
      stopScroll()
      viewport.scrollTop = saved.scrollTop
    } else {
      void scrollToBottom('instant')
    }
    // 保存读 DOM 实测（监听器闭包里读实例快照会 stale 一帧）；
    // 渲染层按钮可见性仍走实例 escapedFromLock（随 render 更新）。
    // effect 只在挂载/线程切换运行，不随滚动重跑恢复。
    const save = () => {
      const distance = viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight
      saveRef.current?.({ scrollTop: viewport.scrollTop, pinned: distance <= 70 })
    }
    viewport.addEventListener('scroll', save, { passive: true })
    return () => {
      save()
      viewport.removeEventListener('scroll', save)
      communityContent(null)
      scrollRef(null)
    }
    // Restore only on mount and thread change; callbacks are stable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [threadId, enabled, contentRef, communityContent, scrollRef, stopScroll, scrollToBottom])
  const goToBottom = useCallback(() => { void scrollToBottom('instant') }, [scrollToBottom])
  return { instance, pinned: !instance.escapedFromLock, scrollToBottom: goToBottom }
}
