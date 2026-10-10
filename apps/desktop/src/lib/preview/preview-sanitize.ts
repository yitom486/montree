import type { Config } from 'dompurify'

/** Markdown 预览与消毒：保留富文本标签与属性，支持 details/summary/html 样式/Alerts */
export const PREVIEW_SANITIZE_OPTIONS: Config = {
  ALLOWED_URI_REGEXP:
    /^(?:(?:(?:f|ht)tps?|mailto|tel|callto|sms|cid|xmpp|data):|[^a-z]|[a-z+.\-]+(?:[^a-z+.\-:]|$))/i,
  ADD_TAGS: ['input', 'details', 'summary', 'mark', 'kbd', 'svg', 'path'],
  ADD_ATTR: [
    'type',
    'checked',
    'disabled',
    'class',
    'id',
    'aria-hidden',
    'aria-label',
    'title',
    'style',
    'open',
    'align',
    'width',
    'height',
    'viewBox',
    'fill',
  ],
}
