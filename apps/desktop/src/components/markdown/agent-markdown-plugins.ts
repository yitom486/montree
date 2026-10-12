import { remarkAlert } from 'remark-github-blockquote-alert'
import { defaultSchema } from 'hast-util-sanitize'

/**
 * Agent 消毒 schema：在 Streamdown 默认 GitHub schema 上做最小显式扩展，
 * 与既有 DOMPurify 策略对齐。凡不在此列的一律不放行；自定义 rehype 插件
 * 不得绕过本表（mark/sub/sup 与 alert 的创建插件均在本表约束内）。
 */
export const agentSanitizeSchema = {
  ...defaultSchema,
  tagNames: [...(defaultSchema.tagNames ?? []), 'mark', 'alert'],
  attributes: {
    ...defaultSchema.attributes,
    mark: [],
    alert: [],
    // details/summary/kbd 本体已在默认表；只补惰性布尔属性 open。
    // on* / href / src 等一律不补，仍剥离。
    details: ['open'],
  },
  protocols: {
    ...defaultSchema.protocols,
    href: [...(defaultSchema.protocols?.href ?? []), 'tel'],
    src: [...(defaultSchema.protocols?.src ?? []), 'data'],
  },
}

/**
 * 提示块自定义标签名：`> [!NOTE]` 经 remarkAgentAlert 转成该标签，
 * 再经 Streamdown `allowedTags` 放行、自定义组件渲染。
 * 不用默认 div：sanitize 会剥掉其 class，样式无法落到既有 CSS。
 */
export const ALERT_TAG = 'alert' as const

/**
 * 提示块 remark 插件：`> [!NOTE]` 等转成自定义 `<alert>` 标签，
 * 再经 `allowedTags` + 自定义组件渲染（样式走既有 markdown-alert CSS）。
 * 不用默认 div：sanitize 会剥掉其 class。
 */
export function remarkAgentAlert(): (tree: { type: string }) => void {
  const factory = remarkAlert as unknown as (opts: {
    tagName: string
    classNames?: string
  }) => (tree: { type: string }) => void
  return factory({ tagName: ALERT_TAG, classNames: '' })
}

export const ALERT_KINDS = ['note', 'tip', 'important', 'warning', 'caution'] as const
export type AlertKind = (typeof ALERT_KINDS)[number]

export function alertKindOf(title: string): AlertKind {
  const kind = title.trim().toLowerCase()
  return (ALERT_KINDS as readonly string[]).includes(kind) ? (kind as AlertKind) : 'note'
}

export interface MermaidFenceInfo {
  /** fence 信息串首个词（小写），如 ```mermaid / ```ts */
  lang: string
  /** fence 信息串全文（小写） */
  info: string
  /** 围栏内源码 */
  content: string
}

/**
 * 优先保留合法成对的单美元公式，只转义数字开头的落单美元。
 * 结束符前不能有空白、后不能紧接数字，避免把两笔价格串成公式。
 * 围栏（包括波浪围栏）、行内代码、显式转义与双美元块保持原文。
 */
export function escapeCurrencyDollars(source: string): string {
  let output = ''
  let prose = ''
  let fence: string | null = null
  for (const line of source.split(/(?<=\n)/)) {
    const marker = /^ {0,3}(`{3,}|~{3,})(.*)/.exec(line)
    if (fence) {
      output += line
      if (marker && marker[1]![0] === fence[0] && marker[1]!.length >= fence.length && !marker[2]!.trim()) fence = null
    } else if (marker) {
      output += escapeCurrencyInSegment(prose) + line
      prose = ''
      fence = marker[1]!
    } else prose += line
  }
  return output + escapeCurrencyInSegment(prose)
}

function escapeCurrencyInSegment(segment: string): string {
  let output = ''
  for (let i = 0; i < segment.length;) {
    const char = segment[i]!
    if (char === '\\') {
      output += segment.slice(i, i + 2)
      i += 2
      continue
    }
    if (char === '`') {
      const run = /^`+/.exec(segment.slice(i))![0]
      const end = segment.indexOf(run, i + run.length)
      if (end >= 0) {
        output += segment.slice(i, end + run.length)
        i = end + run.length
        continue
      }
    }
    if (segment.startsWith('$$', i)) {
      const end = segment.indexOf('$$', i + 2)
      const stop = end < 0 ? segment.length : end + 2
      output += segment.slice(i, stop)
      i = stop
      continue
    }
    if (char === '$') {
      let close = -1
      if (segment[i + 1] && !/\s/.test(segment[i + 1]!)) {
        for (let j = i + 1; j < segment.length && segment[j] !== '\n'; j++) {
          if (segment[j] === '\\') { j++; continue }
          if (segment[j] === '$') {
            if (j > i + 1 && !/\s/.test(segment[j - 1]!) && !/[\d$]/.test(segment[j + 1] ?? '') && segment[j - 1] !== '$') close = j
            break
          }
        }
      }
      if (close >= 0) {
        output += segment.slice(i, close + 1)
        i = close + 1
        continue
      }
      if (/\d/.test(segment[i + 1] ?? '')) output += '\\'
    }
    output += char
    i++
  }
  return output
}

interface HastNode {
  type: string
  tagName?: string
  value?: string
  children?: HastNode[]
  properties?: Record<string, unknown>
}

/** 消毒后生成/隔离锚点；脚注引用、定义、返回和 aria 引用共享同一命名空间。 */
export function rehypeAgentAnchors(options: { prefix: string; blockIndex?: number }) {
  return (tree: HastNode) => {
    const aliases = new Map<string, string>()
    const counts = new Map<string, number>()
    const canonical = (id: string) => id.replace(/^(?:user-content-)+/, '')
    const text = (node: HastNode): string => node.value ?? (node.children ?? []).map(text).join('')
    const visit = (node: HastNode, fn: (node: HastNode) => void) => {
      fn(node)
      node.children?.forEach((child) => visit(child, fn))
    }
    visit(tree, (node) => {
      if (node.type !== 'element') return
      const props = node.properties ??= {}
      let old = typeof props.id === 'string' ? props.id : undefined
      let heading = false
      if (!old && /^h[1-6]$/.test(node.tagName ?? '')) {
        const slug = text(node).trim().toLowerCase().replace(/[^\p{L}\p{N}\s_-]/gu, '').replace(/\s+/g, '-') || 'heading'
        const count = counts.get(slug) ?? 0
        counts.set(slug, count + 1)
        old = count ? `${slug}-${count}` : slug
        heading = true
        props.dataAgentHeading = old
      }
      if (!old) return
      const key = canonical(old)
      const scoped = `${options.prefix}-${key}${heading ? `-block${options.blockIndex ?? 0}` : ''}`
      aliases.set(old, scoped)
      aliases.set(key, scoped)
      props.id = scoped
    })
    visit(tree, (node) => {
      const props = node.properties
      if (!props) return
      if (typeof props.href === 'string' && props.href.startsWith('#')) {
        const target = aliases.get(canonical(props.href.slice(1)))
        if (target) props.href = `#${target}`
      }
      for (const field of ['ariaDescribedBy', 'ariaLabelledBy']) {
        const refs = props[field]
        if (refs) props[field] = (Array.isArray(refs) ? refs : String(refs).split(/\s+/)).map((id) => aliases.get(canonical(String(id))) ?? id)
      }
    })
  }
}

function splitTextNode(value: string): HastNode[] {
  // ==mark== / ~sub~ / ^sup^：与 markdown-it mark/sub/sup 插件同语法。
  // 只处理单行内闭合、不跨空格边界失败的情况；代码/数学子树由调用方跳过。
  const pattern = /(==[^=\n]+?==|~[^~\n]+?~|\^[^^\n]+?\^)/g
  const out: HastNode[] = []
  let last = 0
  for (const match of value.matchAll(pattern)) {
    const index = match.index ?? 0
    if (index > last) out.push({ type: 'text', value: value.slice(last, index) })
    const token = match[0]
    const inner = token.slice(token[0] === '=' ? 2 : 1, token[0] === '=' ? -2 : -1)
    const tagName = token[0] === '=' ? 'mark' : token[0] === '~' ? 'sub' : 'sup'
    out.push({ type: 'element', tagName, properties: {}, children: [{ type: 'text', value: inner }] })
    last = index + token.length
  }
  if (last < value.length) out.push({ type: 'text', value: value.slice(last) })
  return out
}

function visitText(node: HastNode, insideLiteral: boolean): void {
  if (!node.children) return
  const next: HastNode[] = []
  for (const child of node.children) {
    if (child.type === 'text' && !insideLiteral && child.value) {
      next.push(...splitTextNode(child.value))
      continue
    }
    if (child.type === 'element') {
      const tag = child.tagName ?? ''
      // 代码、公式、脚本样式子树保持原文，不做行内标记解析
      visitText(child, insideLiteral || tag === 'code' || tag === 'pre' || tag === 'math' || tag === 'script' || tag === 'style')
    }
    next.push(child)
  }
  node.children = next
}

/**
 * rehype 插件：在 sanitize 之后运行，把行内 ==mark== / ~sub~ / ^sup^ 包成元素。
 * 放在消毒后是为了不引入新的消毒配置面；元素固定三种标签、无属性，
 * 默认消毒不受影响（sanitize 已先行，harden 只处理 URL）。
 */
export function rehypeMarkSubSup() {
  return (tree: HastNode) => {
    visitText(tree, false)
  }
}


