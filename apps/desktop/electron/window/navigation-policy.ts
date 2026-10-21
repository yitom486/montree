/**
 * 窗口导航策略（纯函数，便于单测）：
 * - 应用自身页面：仅限渲染器入口 HTML（file://…/renderer/index.html）与 dev server 同源；
 *   其他 file:// 一律不在应用窗口内打开（避免任意本地 HTML 拿到 preload 桥接）。
 * - 外部链接：只有 http / https / mailto 交给系统浏览器/邮件客户端；
 *   其他协议（file、smb、自定义 scheme、javascript 等）直接丢弃。
 */
export type NavigationDecision = 'allow' | 'external' | 'block'

export function decideNavigation(target: string, appEntryUrl: string, devServerUrl?: string): NavigationDecision {
  let url: URL
  try {
    url = new URL(target)
  } catch {
    return 'block'
  }
  if (url.protocol === 'devtools:') return 'allow'
  if (devServerUrl) {
    try {
      if (url.origin === new URL(devServerUrl).origin) return 'allow'
    } catch { /* ignore */ }
  }
  if (url.protocol === 'file:') {
    const entry = new URL(appEntryUrl)
    return url.pathname === entry.pathname ? 'allow' : 'block'
  }
  if (url.protocol === 'http:' || url.protocol === 'https:' || url.protocol === 'mailto:') return 'external'
  return 'block'
}

/** 渲染端可交给系统打开的链接（聊天正文 onLinkClick 用同一判定）。 */
export function isExternalOpenable(href: string): boolean {
  try {
    const { protocol } = new URL(href)
    return protocol === 'http:' || protocol === 'https:' || protocol === 'mailto:'
  } catch {
    return false
  }
}
