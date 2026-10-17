import type { InkdownMcpToolDefinition } from '@yitom/acp-client'
import type { MontreeSnapshotArgs, MontreeSnapshotResource, ReaderViewportImage } from '@yitom/contracts'

export interface ReaderVisualToolContext {
  readSnapshot: (resource: MontreeSnapshotResource, args?: MontreeSnapshotArgs) => Promise<string>
}

export const READER_VISUAL_TOOLS: readonly InkdownMcpToolDefinition[] = [
  {
    name: 'montree_list_images',
    description: '列出当前文档/章节或视口里的图片引用（最多20项）：地址、alt、图注、加载/可见状态。Markdown/PDF无法精确筛选视口时返回scope=current并说明范围。链接不是图片像素，blob仅当前应用有效；PDF只统计当前页栅格图片绘制，矢量图可能不计入。读图可调用 montree_capture_viewport。',
    inputSchema: { type: 'object', properties: { scope: { type: 'string', enum: ['current', 'viewport'] } }, additionalProperties: false },
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
  },
  {
    name: 'montree_capture_viewport',
    description: '按需获取当前文档阅读区的PNG截图，直接返回图片内容及文档定位。只包含当前可见区域，不翻页、不截图其他应用、不写文件。可用于图表、矢量图、扫描页或排版问题；不能据此推断屏幕外内容。需要支持视觉输入的模型。',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
  },
]

export async function callReaderVisualTool(name: string, context: ReaderVisualToolContext, args?: Record<string, unknown>) {
  if (name === 'montree_list_images') {
    if (args?.scope !== undefined && args.scope !== 'current' && args.scope !== 'viewport') throw new Error('scope 只能是 current 或 viewport')
    return { content: [{ type: 'text' as const, text: await context.readSnapshot('visual-context', { scope: args?.scope ?? 'current' }) }] }
  }
  if (name !== 'montree_capture_viewport') throw new Error('未知阅读视觉工具')
  const image = JSON.parse(await context.readSnapshot('viewport-image', { scope: 'viewport' })) as ReaderViewportImage
  if (image.mimeType !== 'image/png' || !image.data || !image.documentPath) throw new Error('阅读区截图返回无效')
  return { content: [
    { type: 'text' as const, text: JSON.stringify({ documentPath: image.documentPath, width: image.width, height: image.height, scope: 'visible-reading-viewport' }) },
    { type: 'image' as const, mimeType: image.mimeType, data: image.data },
  ] }
}
