import { isPeopleDailyLayoutPath } from '@montree/web-doc'

function normalizeText(text: string | null | undefined): string {
  return text?.replace(/\s+/g, ' ').trim() ?? ''
}

function stripPeopleDailyLayoutChrome(root: HTMLElement): void {
  root.querySelectorAll(
    '.title, .date-box, #daydh, .swiper-box, .prev, .next, script, style, map, area, img[usemap], form',
  ).forEach((node) => node.remove())
}

/** 版面索引页（node_*.html）→ 阅读区 DOM：标题 + 版面导航 + 本版新闻列表 */
export function buildPeopleDailyLayoutReaderRoot(doc: Document): HTMLElement {
  const root = doc.createElement('div')
  root.className = 'people-daily-layout'

  const ban = doc.querySelector('.paper-bot .ban, .main .ban')
  const banText = normalizeText(ban?.textContent)
  if (banText) {
    const heading = doc.createElement('p')
    heading.className = 'people-daily-page-title'
    heading.textContent = banText
    root.appendChild(heading)
  }

  const slides = doc.querySelectorAll('.swiper-slide a[href]')
  if (slides.length > 0) {
    const nav = doc.createElement('div')
    nav.className = 'people-daily-edition-nav-wrap'
    nav.setAttribute('aria-label', '版面导航')
    const ul = doc.createElement('ul')
    ul.className = 'people-daily-edition-nav'
    slides.forEach((anchor) => {
      if (!(anchor instanceof HTMLAnchorElement)) return
      const href = anchor.getAttribute('href')?.trim()
      const label = normalizeText(anchor.textContent)
      if (!href || !label) return
      const li = doc.createElement('li')
      const link = doc.createElement('a')
      link.setAttribute('href', href)
      link.textContent = label
      li.appendChild(link)
      ul.appendChild(li)
    })
    if (ul.childElementCount > 0) {
      nav.appendChild(ul)
      root.appendChild(nav)
    }
  }

  const newsList = doc.querySelector('.news-list')
  if (newsList) {
    const section = doc.createElement('div')
    section.className = 'people-daily-news'
    const heading = doc.createElement('p')
    heading.className = 'people-daily-section-title'
    heading.textContent = '本版新闻'
    section.appendChild(heading)
    section.appendChild(newsList.cloneNode(true))
    root.appendChild(section)
  }

  if (root.textContent?.trim()) {
    return root
  }

  const rightMain = doc.querySelector('.right-main')
  if (rightMain instanceof HTMLElement) {
    const clone = rightMain.cloneNode(true) as HTMLElement
    stripPeopleDailyLayoutChrome(clone)
    return clone
  }

  const fallback = doc.createElement('div')
  fallback.textContent = '未能提取版面内容'
  return fallback
}

export function extractPeopleDailyTitle(doc: Document, pageUrl: string): string | null {
  if (isPeopleDailyLayoutPath(pageUrl)) {
    const banText = normalizeText(doc.querySelector('.paper-bot .ban, .main .ban')?.textContent)
    if (banText) return banText
  }

  const h1Text = normalizeText(doc.querySelector('.article h1')?.textContent)
  if (h1Text) return h1Text

  return null
}

export function pickPeopleDailyArticleRoot(doc: Document, pageUrl: string): HTMLElement {
  for (const selector of ['.article', '#ozoom']) {
    const node = doc.querySelector(selector)
    if (node instanceof HTMLElement && node.textContent?.trim()) {
      return node
    }
  }

  if (isPeopleDailyLayoutPath(pageUrl)) {
    return buildPeopleDailyLayoutReaderRoot(doc)
  }

  const rightMain = doc.querySelector('.right-main')
  if (rightMain instanceof HTMLElement && rightMain.textContent?.trim()) {
    const clone = rightMain.cloneNode(true) as HTMLElement
    stripPeopleDailyLayoutChrome(clone)
    return clone
  }

  const fallback = doc.createElement('div')
  fallback.textContent = '未能提取正文'
  return fallback
}
