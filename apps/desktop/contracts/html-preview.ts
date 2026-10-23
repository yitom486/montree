import type { AppError, Result } from '@yitom/contracts'

/** 本地 HTML 预览专用协议：页面在独立源中运行，拿不到应用窗口的 preload 接口。 */
export const HTML_PREVIEW_SCHEME = 'montree-html'

export const HTML_PREVIEW_IPC = {
  register: 'html-preview:register',
  update: 'html-preview:update',
  release: 'html-preview:release',
} as const

/** 预览页与宿主之间 postMessage 的信道标记，双方都只处理带此标记的消息。 */
export const HTML_PREVIEW_BRIDGE_CHANNEL = 'montree-html-bridge'

export interface HtmlPreviewRegistration {
  /** 预览会话标识（随机，不可猜测），用于后续更新/释放 */
  token: string
  /** iframe 加载地址（不含版本参数），路径与文件在工作区内的相对位置一致，相对资源可自然解析 */
  url: string
}

export interface HtmlPreviewAPI {
  register: (filePath: string) => Promise<Result<HtmlPreviewRegistration, AppError>>
  /** 推送当前（可能未保存的）HTML 文本，iframe 随后以新版本号重新加载 */
  update: (token: string, html: string) => Promise<Result<void, AppError>>
  release: (token: string) => Promise<Result<void, AppError>>
}

/** 宿主 → 预览页 */
export type HtmlPreviewHostMessage =
  | { channel: typeof HTML_PREVIEW_BRIDGE_CHANNEL; type: 'zoom'; zoom: number }
  | { channel: typeof HTML_PREVIEW_BRIDGE_CHANNEL; type: 'anchor'; id: string }

/** 预览页 → 宿主。来自页面的消息不可信：宿主只据此执行受限动作（打开工作区文件/外链、更新阅读快照）。 */
export type HtmlPreviewFrameMessage =
  | { channel: typeof HTML_PREVIEW_BRIDGE_CHANNEL; type: 'link'; href: string }
  | { channel: typeof HTML_PREVIEW_BRIDGE_CHANNEL; type: 'snapshot'; html: string; viewport: string }
  | { channel: typeof HTML_PREVIEW_BRIDGE_CHANNEL; type: 'viewport'; viewport: string }
  | { channel: typeof HTML_PREVIEW_BRIDGE_CHANNEL; type: 'selection'; text: string; commit: boolean }
