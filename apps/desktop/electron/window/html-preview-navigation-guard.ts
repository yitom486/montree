import { HTML_PREVIEW_FRAME_NAME_PREFIX } from '../../contracts/html-preview'

export interface HtmlPreviewFrame {
  frameTreeNodeId: number
  name: string
  detached: boolean
  /** 从直接父 frame 开始，最后为主 frame。 */
  ancestorIds: number[]
}

/** 按不可变的 frame ID 保护预览；页面改 window.name 或创建后代 frame 都不能脱离限制。 */
export function createHtmlPreviewFrameGuard(options: {
  mainFrameId: number
  isRegisteredUrl: (token: string, url: string) => boolean
  listLiveFrameIds: () => Iterable<number>
}) {
  const tokens = new Map<number, string>()
  function tokenFor(frame: HtmlPreviewFrame): string | undefined {
    const known = tokens.get(frame.frameTreeNodeId)
    if (known) return known
    if (frame.ancestorIds[0] !== options.mainFrameId || !frame.name.startsWith(HTML_PREVIEW_FRAME_NAME_PREFIX)) return
    const token = frame.name.slice(HTML_PREVIEW_FRAME_NAME_PREFIX.length)
    if (!/^[a-f0-9]{32}$/.test(token)) return
    tokens.set(frame.frameTreeNodeId, token)
    return token
  }
  function isPreviewFrame(frame: HtmlPreviewFrame | null): boolean {
    return Boolean(frame && !frame.detached && (tokenFor(frame) || frame.ancestorIds.some(id => tokens.has(id))))
  }
  return {
    handleFrameCreated(frame: HtmlPreviewFrame) {
      if (frame.detached) return
      tokenFor(frame)
      const live = new Set(options.listLiveFrameIds())
      for (const id of tokens.keys()) if (id !== frame.frameTreeNodeId && !live.has(id)) tokens.delete(id)
    },
    isPreviewFrame,
    shouldBlockNavigation(frame: HtmlPreviewFrame | null, target: string, initiatorId: number | null): boolean {
      if (!frame || !isPreviewFrame(frame)) return false
      const token = tokenFor(frame)
      // 只有宿主可替换 src；页面、后代 frame 与重定向不能切换文档身份。
      return !token || (initiatorId !== null && initiatorId !== options.mainFrameId) || !options.isRegisteredUrl(token, target)
    },
  }
}
