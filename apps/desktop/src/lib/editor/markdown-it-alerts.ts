import { alert } from '@mdit/plugin-alert'
import type { MarkdownItInstance } from './markdown-it-wikilinks'

/** Community GFM alert parser; keep the same shared preview CSS classes. */
export function markdownItAlerts(md: MarkdownItInstance): void {
  md.use(alert, { deep: true })
}