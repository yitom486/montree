import type { Extension } from '@codemirror/state'
import { livePreviewPlugin } from './live-preview-inline'
import { livePreviewTheme } from './live-preview-theme'
import { livePreviewBlocks, livePreviewConfig } from './live-preview-blocks'

export { livePreviewPlugin } from './live-preview-inline'
export { livePreviewTheme } from './live-preview-theme'
export { TaskCheckboxWidget } from './task-checkbox-widget'
export { QuoteMarkWidget } from './quote-mark-widget'
export { HorizontalRuleWidget } from './horizontal-rule-widget'
export { ImageWidget } from './image-widget'

/**
 * 组合实时的所见即所得插件及主题
 */
export function livePreviewExtension(options: { filePath?: string } = {}): Extension[] {
  return [livePreviewConfig.of(options), livePreviewTheme, livePreviewBlocks, livePreviewPlugin]
}
