import MarkdownIt from 'markdown-it'

const outlineParser = new MarkdownIt({ html: true })

export interface MarkdownHeading {
  level: number
  text: string
  /** 0-based line index in source */
  line: number
  id: string
}

export function stripMarkdownInline(text: string): string {
  return text
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/(\*\*|__|\*|_|`)/g, '')
    .trim()
}

export function slugifyHeading(text: string): string {
  const stripped = stripMarkdownInline(text)
  const slug = stripped
    .toLowerCase()
    .replace(/[^\w\u4e00-\u9fff-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80)

  return slug || 'heading'
}

export function assignHeadingIds(texts: string[]): string[] {
  const counts = new Map<string, number>()

  return texts.map((text) => {
    const base = slugifyHeading(text)
    const count = counts.get(base) ?? 0
    counts.set(base, count + 1)
    return count === 0 ? base : `${base}-${count}`
  })
}

export function parseMarkdownHeadings(content: string): MarkdownHeading[] {
  const tokens = outlineParser.parse(content, {})
  const raw: { level: number; text: string; line: number }[] = []

  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i]
    if (token.type !== 'heading_open' || !token.map) continue
    raw.push({
      level: Number(token.tag.slice(1)),
      text: tokens[i + 1]?.content ?? '',
      line: token.map[0],
    })
  }

  const ids = assignHeadingIds(raw.map((item) => item.text))

  return raw.map((item, index) => ({
    level: item.level,
    text: stripMarkdownInline(item.text),
    line: item.line,
    id: ids[index]!,
  }))
}

/** 根据编辑器当前可见行，找到应对齐的标题 */
export function findActiveHeading(
  headings: MarkdownHeading[],
  visibleLine: number,
): MarkdownHeading | undefined {
  let active: MarkdownHeading | undefined

  for (const heading of headings) {
    if (heading.line <= visibleLine) {
      active = heading
    } else {
      break
    }
  }

  return active
}

/** 根据预览区标题位置与 scrollTop，找到当前应对齐的标题 */
export function findActiveHeadingByPositions(
  headings: MarkdownHeading[],
  positions: Array<{ id: string; top: number }>,
  scrollTop: number,
  offset = 32,
): MarkdownHeading | undefined {
  const threshold = scrollTop + offset
  let activeId: string | undefined

  for (const position of positions) {
    if (position.top <= threshold) {
      activeId = position.id
    } else {
      break
    }
  }

  if (!activeId) return undefined
  return headings.find((heading) => heading.id === activeId)
}

export function collectPreviewHeadingPositions(
  container: HTMLElement,
): Array<{ id: string; top: number }> {
  const containerTop = container.getBoundingClientRect().top
  const positions: Array<{ id: string; top: number }> = []

  for (const element of container.querySelectorAll<HTMLElement>(
    'h1[id],h2[id],h3[id],h4[id],h5[id],h6[id]',
  )) {
    if (!element.id) continue
    positions.push({
      id: element.id,
      top: element.getBoundingClientRect().top - containerTop + container.scrollTop,
    })
  }

  return positions
}

export function scrollRatio(element: HTMLElement): number {
  const max = element.scrollHeight - element.clientHeight
  if (max <= 0) return 0
  return element.scrollTop / max
}

export function applyScrollRatio(element: HTMLElement, ratio: number): void {
  const max = element.scrollHeight - element.clientHeight
  element.scrollTop = Math.max(0, Math.min(max, ratio * max))
}
