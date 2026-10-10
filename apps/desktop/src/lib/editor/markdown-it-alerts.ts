import type { StateCore } from 'markdown-it'
import type { MarkdownItInstance } from './markdown-it-wikilinks'

const ALERT_CONFIG: Record<
  string,
  { type: string; title: string; iconSvg: string }
> = {
  note: {
    type: 'note',
    title: 'Note',
    iconSvg:
      '<svg class="alert-icon" viewBox="0 0 16 16" width="16" height="16" fill="currentColor"><path d="M0 8a8 8 0 1 1 16 0A8 8 0 0 1 0 8Zm8-6.5a6.5 6.5 0 1 0 0 13 6.5 6.5 0 0 0 0-13ZM6.5 7.75A.75.75 0 0 1 7.25 7h1a.75.75 0 0 1 .75.75v2.75h.25a.75.75 0 0 1 0 1.5h-2.5a.75.75 0 0 1 0-1.5h.25v-2h-.25a.75.75 0 0 1-.75-.75ZM8 6a1 1 0 1 1 0-2 1 1 0 0 1 0 2Z"/></svg>',
  },
  tip: {
    type: 'tip',
    title: 'Tip',
    iconSvg:
      '<svg class="alert-icon" viewBox="0 0 16 16" width="16" height="16" fill="currentColor"><path d="M8 1.5c-2.363 0-4 1.69-4 3.75 0 .984.424 1.625.984 2.304l.214.253c.223.264.47.556.673.868.401.617.629 1.258.629 1.825v.5h3v-.5c0-.567.228-1.208.629-1.825.203-.312.45-.604.673-.868l.214-.253c.56-.679.984-1.32.984-2.304 0-2.06-1.637-3.75-4-3.75ZM6 11.5v1h4v-1H6Zm1 2.5v.5a.5.5 0 0 0 .5.5h1a.5.5 0 0 0 .5-.5V14H7Z"/></svg>',
  },
  important: {
    type: 'important',
    title: 'Important',
    iconSvg:
      '<svg class="alert-icon" viewBox="0 0 16 16" width="16" height="16" fill="currentColor"><path d="M0 1.75C0 .784.784 0 1.75 0h12.5C15.216 0 16 .784 16 1.75v9.5A1.75 1.75 0 0 1 14.25 13H8.06l-2.573 2.573A1.458 1.458 0 0 1 3 14.543V13H1.75A1.75 1.75 0 0 1 0 11.25Zm1.75-.25a.25.25 0 0 0-.25.25v9.5c0 .138.112.25.25.25h2a.75.75 0 0 1 .75.75v2.19l2.72-2.72a.749.749 0 0 1 .53-.22h6.5a.25.25 0 0 0 .25-.25v-9.5a.25.25 0 0 0-.25-.25Zm7 2.25v2.5a.75.75 0 0 1-1.5 0v-2.5a.75.75 0 0 1 1.5 0ZM9 9a1 1 0 1 1-2 0 1 1 0 0 1 2 0Z"/></svg>',
  },
  warning: {
    type: 'warning',
    title: 'Warning',
    iconSvg:
      '<svg class="alert-icon" viewBox="0 0 16 16" width="16" height="16" fill="currentColor"><path d="M6.457 1.047c.659-1.234 2.427-1.234 3.086 0l6.082 11.378A1.75 1.75 0 0 1 14.082 15H1.918a1.75 1.75 0 0 1-1.543-2.575Zm1.763.707a.25.25 0 0 0-.44 0L1.698 13.132a.25.25 0 0 0 .22.368h12.164a.25.25 0 0 0 .22-.368Zm.53 3.996v2.5a.75.75 0 0 1-1.5 0v-2.5a.75.75 0 0 1 1.5 0ZM9 11a1 1 0 1 1-2 0 1 1 0 0 1 2 0Z"/></svg>',
  },
  caution: {
    type: 'caution',
    title: 'Caution',
    iconSvg:
      '<svg class="alert-icon" viewBox="0 0 16 16" width="16" height="16" fill="currentColor"><path d="M4.47.22A.749.749 0 0 1 5 0h6c.199 0 .389.079.53.22l4.25 4.25c.141.14.22.331.22.53v6a.749.749 0 0 1-.22.53l-4.25 4.25A.749.749 0 0 1 11 16H5a.749.749 0 0 1-.53-.22L.22 11.53A.749.749 0 0 1 0 11V5c0-.199.079-.389.22-.53Zm.84 1.28L1.5 5.31v5.38l3.81 3.81h5.38l3.81-3.81V5.31L10.69 1.5ZM8 4a.75.75 0 0 1 .75.75v3.5a.75.75 0 0 1-1.5 0v-3.5A.75.75 0 0 1 8 4Zm0 8a1 1 0 1 1 0-2 1 1 0 0 1 0 2Z"/></svg>',
  },
}

const ALERT_REGEX = /^\s*\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]\s*(?:\r?\n)?/i

/**
 * GitHub 风格 Alert / Callout 提示块 markdown-it 插件
 * 识别 > [!NOTE], > [!WARNING] 等并转译为美观的呼出卡片
 */
export function markdownItAlerts(md: MarkdownItInstance): void {
  md.core.ruler.after('block', 'github_alerts', (state: StateCore) => {
    const tokens = state.tokens

    for (let i = 0; i < tokens.length; i++) {
      if (tokens[i].type !== 'blockquote_open') continue

      // 检查 blockquote 内部第一个 paragraph
      const nextPIndex = i + 1
      if (nextPIndex >= tokens.length || tokens[nextPIndex].type !== 'paragraph_open') {
        continue
      }

      const inlineIndex = nextPIndex + 1
      if (inlineIndex >= tokens.length || tokens[inlineIndex].type !== 'inline') {
        continue
      }

      const inlineToken = tokens[inlineIndex]
      const match = inlineToken.content.match(ALERT_REGEX)
      if (!match) continue

      const alertKey = match[1].toLowerCase()
      const cfg = ALERT_CONFIG[alertKey]
      if (!cfg) continue

      // 1. 将 blockquote_open 增加 alert 样式类
      tokens[i].attrJoin('class', `markdown-alert markdown-alert-${cfg.type}`)

      // 2. 将 [!TYPE] 从文本中剥除
      inlineToken.content = inlineToken.content.slice(match[0].length)
      if (inlineToken.children && inlineToken.children.length > 0) {
        const firstTextChild = inlineToken.children[0]
        if (firstTextChild && firstTextChild.type === 'text') {
          firstTextChild.content = firstTextChild.content.replace(ALERT_REGEX, '')
        }
      }

      // 3. 在段落内部插入 Alert Title 标记
      const titleToken = new state.Token('html_inline', '', 0)
      titleToken.content = `<div class="markdown-alert-title">${cfg.iconSvg}<span>${cfg.title}</span></div>`
      inlineToken.children = [titleToken, ...(inlineToken.children ?? [])]
    }
  })
}
