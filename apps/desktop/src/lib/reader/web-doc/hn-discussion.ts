import { READER_PALETTE, type EpubThemeMode } from '@yitom/reader-core'

/**
 * Hacker News 讨论页专用抽取。
 *
 * HN 页面没有头像，也没有配图；正文里的 <img> 只有两种：
 * - `y18.svg` 站点 logo；
 * - `s.gif`（1×1）缩进占位图，靠 width=40/80/120 撑出评论层级。
 *
 * 通用 Readability 会把这些占位图原样留下（变成破图），同时把评论树压平。
 * 这里直接按 `tr.comtr` + `td.ind[indent]` 重建嵌套评论，正文与评论各归其位。
 */

export function isHackerNewsItemUrl(pageUrl: string | undefined): boolean {
  if (!pageUrl) return false
  try {
    const url = new URL(pageUrl)
    return url.hostname === 'news.ycombinator.com' && url.pathname === '/item'
  } catch {
    return false
  }
}

function normalizeSpace(value: string | null | undefined): string {
  return (value ?? '').replace(/\s+/g, ' ').trim()
}

/**
 * 阅读器正文使用中文字体时，U+2019 会按全角标点排版，英文里看起来像
 * `isn’ t`。HN 评论是英文论坛内容，统一还原成 ASCII 引号，避免字间裂开。
 */
function normalizeHnTypography(html: string): string {
  return html.replace(/[\u2018\u2019]/g, "'").replace(/[\u201C\u201D]/g, '"')
}

/** 从 `.titleline` 取真实标题，避免 `| Hacker News` 后缀进阅读器标题栏 */
export function extractHackerNewsTitle(doc: Document): string | null {
  const title = normalizeSpace(doc.querySelector('.fatitem .titleline > a')?.textContent)
  if (title) return title
  const fallback = normalizeSpace(doc.querySelector('title')?.textContent)
  return fallback ? fallback.replace(/\s*\|\s*Hacker News\s*$/i, '') : null
}

function buildComment(doc: Document, row: HTMLElement, topLevel: boolean): HTMLElement | null {
  const text = row.querySelector<HTMLElement>('.commtext')
  if (!text) return null

  const comment = doc.createElement('div')
  comment.className = 'hn-comment'

  // 顶层评论用 h3 承载作者行：进入阅读器「目录」大纲，可点击直接跳到该层讨论。
  const head = doc.createElement(topLevel ? 'h3' : 'div')
  head.className = topLevel ? 'hn-comment-head hn-comment-heading' : 'hn-comment-head'
  const rowId = row.getAttribute('id')
  if (topLevel && rowId) head.id = `hn-comment-${rowId}`
  const author = normalizeSpace(row.querySelector('.comhead .hnuser')?.textContent)
  const age = normalizeSpace(row.querySelector('.comhead .age')?.textContent)
  if (author) {
    const name = doc.createElement('span')
    name.className = 'hn-comment-author'
    name.textContent = author
    head.appendChild(name)
  }
  if (age) {
    const time = doc.createElement('span')
    time.className = 'hn-comment-age'
    time.textContent = age
    // 空格文本节点不参与 flex 布局，但能让大纲标题读成「作者 时间」
    head.appendChild(doc.createTextNode(' '))
    head.appendChild(time)
  }
  comment.appendChild(head)

  const body = doc.createElement('div')
  body.className = 'hn-comment-body'
  body.innerHTML = normalizeHnTypography(text.innerHTML)
  // HN 允许首段不写 <p>（直接以文本开头）；不补段落会与第二段贴在一起，
  // 也会让 `p:first-child` 的 margin-top:0 误命中第二段。
  const firstParagraph = body.firstElementChild
  if (!firstParagraph && body.textContent?.trim()) {
    // 纯文本评论：整体补成一段，保证与其它评论一致的行距
    const paragraph = doc.createElement('p')
    while (body.firstChild) paragraph.appendChild(body.firstChild)
    body.appendChild(paragraph)
  } else if (firstParagraph?.tagName === 'P') {
    const leading: Node[] = []
    for (let node = body.firstChild; node && node !== firstParagraph; node = node.nextSibling) {
      if (node.nodeType === Node.TEXT_NODE && !node.textContent?.trim()) continue
      leading.push(node)
    }
    if (leading.length > 0) {
      const paragraph = doc.createElement('p')
      firstParagraph.before(paragraph)
      for (const node of leading) paragraph.appendChild(node)
    }
  }
  comment.appendChild(body)

  return comment
}

/**
 * 生成 HN 讨论页的 article 根节点；不是 HN item 页或页面没有标题时返回 null，
 * 交给通用抽取链路处理。
 */
export function buildHackerNewsDiscussion(
  doc: Document,
  pageUrl: string,
): HTMLElement | null {
  const story = doc.querySelector<HTMLElement>('.fatitem')
  const title = extractHackerNewsTitle(doc)
  if (!story || !title) return null

  const root = doc.createElement('article')
  root.className = 'hn-discussion'

  const header = doc.createElement('header')
  header.className = 'hn-story-head'

  const heading = doc.createElement('h1')
  heading.className = 'hn-story-title'
  const titleLink = doc.createElement('a')
  titleLink.href = story.querySelector<HTMLAnchorElement>('.titleline > a')?.getAttribute('href') ?? pageUrl
  titleLink.textContent = title
  heading.appendChild(titleLink)
  header.appendChild(heading)

  const metaParts = [
    normalizeSpace(story.querySelector('.subtext .score')?.textContent),
    normalizeSpace(story.querySelector('.subtext .hnuser')?.textContent),
    normalizeSpace(story.querySelector('.subtext .age')?.textContent),
  ].filter(Boolean)
  const meta = doc.createElement('p')
  meta.className = 'hn-story-meta'
  meta.textContent = metaParts.join(' · ')
  if (meta.textContent) header.appendChild(meta)

  root.appendChild(header)

  const storyText = story.querySelector<HTMLElement>('.toptext')
  if (storyText?.textContent?.trim()) {
    const body = doc.createElement('div')
    body.className = 'hn-story-text'
    body.innerHTML = storyText.innerHTML
    root.appendChild(body)
  }

  const rows = Array.from(doc.querySelectorAll<HTMLElement>('tr.athing.comtr'))
  if (rows.length === 0) return root

  const comments = doc.createElement('div')
  comments.className = 'hn-comments'
  // 用缩进栈还原树：indent 变浅就回到上一层，兄弟与子回复天然分层。
  const stack: Array<{ indent: number; container: HTMLElement }> = [
    { indent: -1, container: comments },
  ]

  for (const row of rows) {
    const indent = Number(row.querySelector<HTMLElement>('td.ind')?.getAttribute('indent') ?? 0)
    const comment = buildComment(doc, row, indent === 0)
    if (!comment) continue
    while (stack.length > 1 && stack[stack.length - 1]!.indent >= indent) stack.pop()
    const parent = stack[stack.length - 1]!.container
    parent.appendChild(comment)
    const children = doc.createElement('div')
    children.className = 'hn-comment-children'
    comment.appendChild(children)
    stack.push({ indent, container: children })
  }

  root.appendChild(comments)
  return root
}

/** 评论层级用左边线表达；HN 自带的缩进占位图已被移除 */
export function buildWebDocHnDiscussionCss(theme: EpubThemeMode): string {
  const palette = READER_PALETTE[theme]
  const isDark = theme === 'dark'
  const border = isDark ? 'rgba(255,255,255,0.14)' : 'rgba(0,0,0,0.12)'
  const muted = isDark ? 'rgba(255,255,255,0.58)' : 'rgba(0,0,0,0.55)'

  return `
    body .hn-story-head,
    body .hn-comments { max-width: 46rem; margin-left: auto; margin-right: auto; }
    body .hn-story-head { margin-bottom: 1.6em; }
    body .hn-story-title { margin: 0 0 0.4em; font-size: 1.55em; line-height: 1.3; }
    body .hn-story-title a { color: ${palette.text}; text-decoration: none; border-bottom: 1px solid transparent; }
    body .hn-story-title a:hover { border-bottom-color: ${palette.link}; }
    body .hn-story-meta { margin: 0; font-size: 0.82em; color: ${muted}; }
    body .hn-story-text { margin: 0 0 1.6em; }
    body .hn-comments { display: flex; flex-direction: column; gap: 0.2em; margin-top: 0.6em; }
    body .hn-comment { border-left: 2px solid ${border}; padding: 0.2em 0 0.3em 1em; margin: 0.55em 0; }
    body .hn-comment:first-child { margin-top: 0; }
    body .hn-comment-head { display: flex; flex-wrap: wrap; align-items: baseline; gap: 0.5em; margin-bottom: 0.35em; font-size: 0.78em; color: ${muted}; }
    body .hn-comment-heading { margin: 0 0 0.35em; font-size: 0.78em; font-weight: 400; line-height: 1.4; }
    body .hn-comment-author { font-weight: 600; color: ${palette.text}; }
    body .hn-comment-body { display: flow-root; font-size: 0.95em; line-height: 1.75; }
    body .hn-comment-body p { margin: 0.85em 0; }
    body .hn-comment-body p:first-child { margin-top: 0; }
    body .hn-comment-body p:last-child { margin-bottom: 0; }
    body .hn-comment-children:empty { display: none; }
    body .hn-comment-children { margin: 0.55em 0 0 0.25em; }
  `
}
