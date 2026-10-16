export type ComposerAttachmentKind = 'file' | 'image'

/** 用户气泡里展示的附件摘要（可持久化） */
export interface AcpMessageAttachment {
  id: string
  kind: ComposerAttachmentKind
  name: string
  mimeType: string
  absolutePath?: string
  size?: number
  /** 历史回看用；过大时可无 */
  previewUrl?: string
}
