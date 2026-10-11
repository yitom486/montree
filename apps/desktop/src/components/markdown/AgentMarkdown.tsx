import { createContext, memo, useContext, useId, useLayoutEffect, useMemo, useRef, type JSX, type ReactNode } from 'react'
import { Children, isValidElement } from 'react'
import { Block, Streamdown, defaultComponents, defaultRehypePlugins, useIsCodeFenceIncomplete, type BlockProps } from 'streamdown'
import { code } from '@streamdown/code'
import { createMermaidPlugin } from '@streamdown/mermaid'
import 'streamdown/styles.css'
import { createMathPlugin } from '@streamdown/math'
import { cjk } from '@streamdown/cjk'
import remarkBreaks from 'remark-breaks'
import remarkGfm from 'remark-gfm'
import rehypeSanitize from 'rehype-sanitize'
import { normalizeLatexDelimiters } from '@/lib/editor/latex-delimiters'
import { normalizeRawSvgDataUriImages } from '@/lib/editor/markdown'
import { sanitizeAgentUrl } from '@/lib/agent/streamdown-url-policy'
import {
  ALERT_TAG,
  agentSanitizeSchema,
  alertKindOf,
  escapeCurrencyDollars,
  rehypeMarkSubSup,
  rehypeAgentAnchors,
  remarkAgentAlert,
} from '@/components/markdown/agent-markdown-plugins'
import { cn } from '@/lib/utils'

/**
 * Agent 专用 Markdown 入口（S1）：Streamdown 真实安装使用。
 * 编辑器/文档预览继续用 markdown-it，本文件只给 Agent 聊天正文。
 *
 * 插件取舍（体积与行为证据见 README/计划）：
 * - math（KaTeX，包内 CSS 已随构建提供）/ cjk（中文强调边界）真实安装；
 * - breaks/task-lists/表格经 remark-gfm + remark-breaks；
 * - footnote 经 micromark 官方扩展桥接；alert 经 remark 插件（输出 .markdown-alert，与既有 CSS 同源）；
 * - mark/sub/sup 经自研 rehype 微插件（消毒之后运行，不扩消毒面）；
 * - code / mermaid 用 Streamdown 官方插件，工具栏、复制、下载、全屏交给社区；
 * - animated 接管增量揭示，不再自建文字队列或节流解析；
 * - 不启用 raw HTML：与聊天 strictSafe 同语义，裸标签转义为文本。
 */

const mathPlugin = createMathPlugin({ singleDollarTextMath: true })

const mermaidPlugin = createMermaidPlugin({ config: { securityLevel: 'strict', startOnLoad: false, suppressErrorRendering: true } })
const AnchorPrefix = createContext('agent')
const StreamingFlag = createContext(false)

/** The upstream diagram renderer eagerly tries partial syntax; defer only unfinished diagrams. */
function StreamingCode(props: React.ComponentProps<NonNullable<typeof defaultComponents.code>>) {
  const incomplete = useIsCodeFenceIncomplete()
  const streaming = useContext(StreamingFlag)
  const Code = defaultComponents.code!
  if (streaming && incomplete && props.className === 'language-mermaid') {
    return <div role="status" className="my-2 min-h-11 text-xs text-muted-foreground">图表生成中…</div>
  }
  return <Code {...props} className={props.className ?? ('data-block' in props ? 'language-text' : undefined)} />
}

const AgentBlock = memo(function AgentBlock(props: BlockProps) {
  const prefix = useContext(AnchorPrefix)
  const plugins = useMemo(() => props.rehypePlugins?.map((plugin) =>
    Array.isArray(plugin) && plugin[0] === rehypeAgentAnchors
      ? [rehypeAgentAnchors, { prefix, blockIndex: props.index }] : plugin,
  ) as BlockProps['rehypePlugins'], [props.rehypePlugins, props.index, prefix])
  return <Block {...props} rehypePlugins={plugins} />
})

function textOf(children: ReactNode): string {
  if (typeof children === 'string') return children
  if (typeof children === 'number') return String(children)
  if (Array.isArray(children)) return children.map(textOf).join('')
  if (isValidElement<{ children?: ReactNode }>(children)) return textOf(children.props.children)
  return ''
}

interface SemanticProps {
  children?: ReactNode
  id?: string
  className?: string
  'aria-label'?: string
  'aria-labelledby'?: string
  'aria-describedby'?: string
  'data-agent-heading'?: string
}

function AgentLink({ href, children, ...semantic }: SemanticProps & { href?: string }) {
  const safe = sanitizeAgentUrl(href ?? '')
  return (
    <a
      id={semantic.id}
      aria-label={semantic['aria-label']}
      aria-labelledby={semantic['aria-labelledby']}
      aria-describedby={semantic['aria-describedby']}
      href={safe}
      onClick={safe?.startsWith('#') ? (event) => {
        event.preventDefault()
        const href = event.currentTarget.getAttribute('href') ?? safe
        const target = document.getElementById(href.slice(1))
        if (!target) return
        target.scrollIntoView?.({ block: 'nearest' })
        if (!target.hasAttribute('tabindex')) target.setAttribute('tabindex', '-1')
        target.focus({ preventScroll: true })
      } : undefined}
    >
      {children}
    </a>
  )
}

function AgentImage({ src, alt }: { src?: string; alt?: string }) {
  return <img src={sanitizeAgentUrl(src ?? '', 'src')} alt={alt ?? ''} loading="lazy" />
}

function AgentCheckbox({ checked }: { checked?: boolean }) {
  return <input type="checkbox" disabled checked={Boolean(checked)} readOnly />
}

function AgentTable({ children }: { children?: ReactNode }) {
  return (
    <div className="overflow-x-auto">
      <table>{children}</table>
    </div>
  )
}

function AgentAlert({ children }: { children?: ReactNode }) {
  const items = Children.toArray(children)
  const [titleNode, ...body] = items
  const title = textOf(titleNode).trim()
  const kind = alertKindOf(title)
  return (
    <div className={cn('markdown-alert', `markdown-alert-${kind}`)}>
      <p className="markdown-alert-title">{title || kind.toUpperCase()}</p>
      {body}
    </div>
  )
}

// react-markdown 组件表：语义裸标签，样式只走 .markdown-preview CSS，
// 不引入 Streamdown 默认排版类，保证与既有预览视觉同源。
function plain(tag: keyof JSX.IntrinsicElements) {
  const Plain = ({ children, id, className, ...semantic }: SemanticProps) => {
    const Tag = tag as 'div'
    return <Tag id={id} className={className} data-agent-heading={semantic['data-agent-heading']} aria-label={semantic['aria-label']} aria-labelledby={semantic['aria-labelledby']} aria-describedby={semantic['aria-describedby']}>{children}</Tag>
  }
  Plain.displayName = `AgentPlain(${tag})`
  return Plain
}

const agentComponents = {
  code: StreamingCode,
  a: AgentLink,
  [ALERT_TAG]: AgentAlert,
  blockquote: plain('blockquote'),
  del: plain('del'),
  em: plain('em'),
  h1: plain('h1'),
  h2: plain('h2'),
  h3: plain('h3'),
  h4: plain('h4'),
  h5: plain('h5'),
  h6: plain('h6'),
  hr: plain('hr'),
  img: AgentImage,
  input: AgentCheckbox,
  li: plain('li'),
  ol: plain('ol'),
  p: plain('p'),
  section: plain('section'),
  sup: plain('sup'),
  // 注意：不得覆盖 pre——默认 pre 负责透传 data-block
  strong: plain('strong'),
  table: AgentTable,
  tbody: plain('tbody'),
  td: plain('td'),
  th: plain('th'),
  thead: plain('thead'),
  tr: plain('tr'),
  ul: plain('ul'),
}

export interface AgentMarkdownProps {
  text: string
  /** 流式接收/展示中：isAnimating 对应，交互占位；完成态只读渲染 */
  streaming: boolean
  className?: string
}

export const AgentMarkdown = memo(function AgentMarkdown({ text, streaming, className }: AgentMarkdownProps) {
  const anchorPrefix = `agent-${useId().replace(/[^\w-]/g, '')}`
  const rootRef = useRef<HTMLDivElement>(null)
  const rehypePlugins = useMemo(() => [
    [rehypeSanitize, agentSanitizeSchema],
    [rehypeAgentAnchors, { prefix: anchorPrefix }],
    defaultRehypePlugins.harden,
    rehypeMarkSubSup,
  ] as NonNullable<React.ComponentProps<typeof Streamdown>['rehypePlugins']>, [anchorPrefix])
  const source = useMemo(() => {
    // 顺序：SVG 规范化 → 货币 $ 转义（只看原文手写 $）→ LaTeX 定界符规范
    // （`\(2+2\)`→`$2+2$`，不受转义影响）。流式未闭合公式不补全。
    return normalizeLatexDelimiters(
      escapeCurrencyDollars(normalizeRawSvgDataUriImages(text)),
    )
  }, [text])
  // Streamdown 分块解析：跨块标题链接在 DOM 提交后绑定首个同名标题，
  // 仅修正锚点属性，不重新灌入正文或重建代码/图表。
  useLayoutEffect(() => {
    const root = rootRef.current
    if (!root) return
    const headings = new Map<string, string>()
    for (const heading of root.querySelectorAll<HTMLElement>('[data-agent-heading]')) {
      const key = heading.dataset.agentHeading!
      if (!headings.has(key)) headings.set(key, heading.id)
    }
    for (const anchor of root.querySelectorAll<HTMLAnchorElement>('a[href^="#"]')) {
      let key = anchor.getAttribute('href')!.slice(1)
      try { key = decodeURIComponent(key) } catch { continue }
      const target = headings.get(key)
      if (target) anchor.setAttribute('href', `#${target}`)
    }
  }, [source, streaming])
  return (
    <div ref={rootRef}>
    <AnchorPrefix.Provider value={anchorPrefix}>
    <StreamingFlag.Provider value={streaming}>
      <Streamdown
        mode="streaming"
        isAnimating={streaming}
        animated={{ animation: 'fadeIn', duration: 140, stagger: 8, maxBacklogMs: 180 }}
        lineNumbers
        translations={{ copyCode: '复制代码', copied: '已复制', downloadFile: '下载代码', viewFullscreen: '全屏查看', exitFullscreen: '退出全屏', close: '关闭', zoomIn: '放大', zoomOut: '缩小', resetView: '重置视图', downloadDiagram: '下载图表', downloadDiagramAsSvg: '下载 SVG', downloadDiagramAsPng: '下载 PNG', downloadDiagramAsMmd: '下载 Mermaid 源码' }}
        codeBlockMaxHeight={360}
        mermaid={{ config: { securityLevel: 'strict', startOnLoad: false, suppressErrorRendering: true } }}
        plugins={{ math: mathPlugin, cjk, code, mermaid: mermaidPlugin }}
        remarkPlugins={[remarkGfm, remarkBreaks, remarkAgentAlert]}
        rehypePlugins={rehypePlugins}
        allowedTags={{ [ALERT_TAG]: [] }}
        urlTransform={(url, key) => sanitizeAgentUrl(url, key)}
        components={agentComponents}
        BlockComponent={AgentBlock}
        className={className}
      >
        {source}
      </Streamdown>
    </StreamingFlag.Provider>
    </AnchorPrefix.Provider>
    </div>
  )
})
