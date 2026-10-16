import { createContext, memo, useCallback, useContext, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type JSX, type ReactNode } from 'react'
import { Children, isValidElement } from 'react'
import { Block, Streamdown, defaultComponents, defaultRehypePlugins, useIsCodeFenceIncomplete, type BlockProps } from 'streamdown'
import { code } from '@streamdown/code'
import { createMermaidPlugin } from '@streamdown/mermaid'
import 'streamdown/styles.css'
import { createMathPlugin } from '@streamdown/math'
import { cjk } from '@streamdown/cjk'
import remarkBreaks from 'remark-breaks'
import remarkGfm from 'remark-gfm'
import rehypeRaw from 'rehype-raw'
import rehypeSanitize from 'rehype-sanitize'
import { normalizeLatexDelimiters, normalizeRawSvgDataUriImages } from './md-normalize'
import { ChevronUp } from 'lucide-react'
import { sanitizeAgentUrl } from '@montree/chat-core'
import {
  ALERT_TAG,
  agentSanitizeSchema,
  alertKindOf,
  escapeCurrencyDollars,
  rehypeMarkSubSup,
  rehypeAgentAnchors,
  remarkAgentAlert,
} from '@montree/chat-core'
import { cn } from './cn'


/**
 * 聊天专用 Markdown 入口（S1）：Streamdown 真实安装使用。
 * 整搬自 `apps/desktop/src/components/markdown/AgentMarkdown.tsx`（改名 `AgentMarkdown→ChatMarkdown`），
 * 解耦仅两处：主题经 `theme` prop 传入（不再读宿主 `useEditorUiStore`）、
 * 预处理/消毒/URL 策略改引包内模块与 `@montree/chat-core`；其余逐字，渲染逻辑不重写。
 * 编辑器/文档预览继续用 markdown-it，本文件只给 Agent 聊天正文。
 *
 * 插件取舍（体积与行为证据见宿主 README/计划）：
 * - math（KaTeX，包内 CSS 已随构建提供）/ cjk（中文强调边界）真实安装；
 * - breaks/task-lists/表格经 remark-gfm + remark-breaks；
 * - footnote 经 micromark 官方扩展桥接；alert 经 remark 插件（输出 .markdown-alert，与既有 CSS 同源）；
 * - mark/sub/sup 经自研 rehype 微插件（消毒之后运行，不扩消毒面）；
 * - code / mermaid 用 Streamdown 官方插件，工具栏、复制、下载、全屏交给社区；
 * - Streamdown 原生字符淡入负责显现，内置分块复用已完成节点；
 * - 不解析任意 raw HTML：裸标签先经 rehype-raw 转元素、再按消毒表剥离——
 *   details/summary/kbd 在表内成元素，其余（script/iframe/事件属性等）
 *   剥离或转义，与聊天消毒语义一致（见单测“裸 script/iframe 不执行”）。
 */

/** 聊天 Markdown 主题：沿用宿主 `AppTheme` 三态（`light | dark | sepia`），经 prop 传入。 */
export type ChatMarkdownTheme = 'light' | 'dark' | 'sepia'

const mathPlugin = createMathPlugin({ singleDollarTextMath: true })

const mermaidPlugin = createMermaidPlugin({ config: { securityLevel: 'strict', startOnLoad: false, suppressErrorRendering: true } })
const AnchorPrefix = createContext('agent')
const StreamingFlag = createContext(false)
/** 主题沿组件树下钻：嵌套 ChatMarkdown（details 胎内二次解析）与外层同主题。 */
const ChatThemeFlag = createContext<ChatMarkdownTheme>('light')

/**
 * 静态 Streamdown 配置全部提升到模块级：引用稳定，
 * 块 memo 才能跳过重渲染（行内字面量每帧都是新引用，memo 必穿透）。
 * 保持可变类型（Streamdown 要 Pluggable[]/AllowedTags）。
 * 唯一例外是 mermaid 主题：跟随主题 prop，引用随主题翻转（低频），
 * 正文随之重渲染一次，图表重绘新主题（E2E 锁定）。
 */
const STREAMDOWN_TRANSLATIONS = { copyCode: '复制代码', copied: '已复制', downloadFile: '下载代码', viewFullscreen: '全屏查看', exitFullscreen: '退出全屏', close: '关闭', zoomIn: '放大', zoomOut: '缩小', resetView: '重置视图', downloadDiagram: '下载图表', downloadDiagramAsSvg: '下载 SVG', downloadDiagramAsPng: '下载 PNG', downloadDiagramAsMmd: '下载 Mermaid 源码' }
const STREAMDOWN_MERMAID_BASE = { securityLevel: 'strict', startOnLoad: false, suppressErrorRendering: true } as const
/**
 * Mermaid 主题跟随主题 prop（纯函数，单测锁定映射）：
 * mermaid 内置只有 default/neutral/dark/forest，sepia 取 neutral（暖灰浅底）。
 */
export function resolveMermaidTheme(appTheme: ChatMarkdownTheme): 'default' | 'neutral' | 'dark' {
  if (appTheme === 'dark') return 'dark'
  if (appTheme === 'sepia') return 'neutral'
  return 'default'
}
const STREAMDOWN_PLUGINS = { math: mathPlugin, cjk, code, mermaid: mermaidPlugin }
const STREAMDOWN_ANIMATION = { animation: 'fadeIn', sep: 'char', duration: 150, stagger: 8, maxBacklogMs: 320 } as const
const STREAMDOWN_REMARK_PLUGINS = [remarkGfm, remarkBreaks, remarkAgentAlert]
// 允许透传的原生标签：自研 alert 之外，只放行 inert 展示标签——
// details/summary（原生折叠，无 JS 参与；open 为惰性布尔属性）、kbd（按键帽）。
// script/style/iframe/on* 事件仍由消毒层剥离；_nonce 等一律不放。
const STREAMDOWN_ALLOWED_TAGS = { [ALERT_TAG]: [], details: ['open'], summary: [], kbd: [] }
const STREAMDOWN_URL_TRANSFORM = (url: string, key?: string) => sanitizeAgentUrl(url, key ?? '')

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
  // 只保留稳定块壳；文字显现交给 Block 的原生 animatePlugin，不叠加整块淡入。
  return (
    <div>
      <Block {...props} rehypePlugins={plugins} />
    </div>
  )
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
// 注意 plain() 只透传已知语义属性；需透传布尔属性的标签（如 details/open）
// 用专用组件，避免 ...rest 把 node 等非 DOM 属性漏到 React 上。
function AgentDetails({ children, open }: { children?: ReactNode; open?: boolean | string }) {
  const initialOpen = open !== undefined && open !== false
  const [expanded, setExpanded] = useState(initialOpen)
  const detailsRef = useRef<HTMLDetailsElement>(null)
  const streaming = useContext(StreamingFlag)
  const theme = useContext(ChatThemeFlag)
  // HTML 块内的 markdown 胎文本不会被 remark 二次解析（标准行为）——
  // 这里拆出 summary 元素，胎内纯文本走嵌套 ChatMarkdown 解析；
  // 已解析的元素子节点（如空行分隔的段落）原样保留。
  let summary: ReactNode = null
  const rest: ReactNode[] = []
  Children.forEach(children, (child) => {
    if (summary === null && isValidElement(child) && child.type === AgentSummary) summary = child
    else rest.push(child)
  })
  const bodyText = rest.every((n) => typeof n === 'string' || typeof n === 'number')
    ? rest.map(String).join('')
    : null
  // 展开锚定不归这里管：assistant-ui 视口在点击捕获期识别 summary/
  // aria-expanded 并暂停跟底（pauseFollowOnExpand），前提是气泡根带
  // data-message-id（见 AgentChatItem）。这里只跟 expanded 显隐底部收起钮。
  const onToggle = useCallback((event: React.SyntheticEvent<HTMLDetailsElement>) => {
    setExpanded(event.currentTarget.open)
  }, [])
  const collapse = useCallback(() => {
    // 经 DOM 关（触发 toggle，state 与锚定走同一路径）；
    // 无 toggle 实现的环境兜底直设 state，保证按钮立即可用。
    detailsRef.current?.removeAttribute('open')
    setExpanded(false)
  }, [])
  return (
    <details ref={detailsRef} open={initialOpen} onToggle={onToggle}>
      {summary ?? <summary>展开查看详情</summary>}
      {bodyText !== null
        ? (bodyText.trim()
          ? <ChatMarkdown text={bodyText} streaming={streaming} theme={theme} />
          : null)
        : rest}
      {expanded ? (
        <button
          type="button"
          onClick={collapse}
          aria-label="收起折叠内容"
          className="mt-2 flex w-full cursor-pointer items-center justify-center gap-1 rounded-md border border-dashed border-border/60 py-1 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          <ChevronUp className="size-3.5" />
          收起
        </button>
      ) : null}
    </details>
  )
}
function AgentSummary({ children }: { children?: ReactNode }) {
  return <summary>{children}</summary>
}
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
  details: AgentDetails,
  summary: AgentSummary,
  kbd: plain('kbd'),
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

export interface ChatMarkdownProps {
  text: string
  /** 流式接收/展示中：isAnimating 对应，交互占位；完成态只读渲染 */
  streaming: boolean
  className?: string
  /** 主题（宿主 `useEditorUiStore` 的 `theme` 直接透传；缺省 `light`） */
  theme?: ChatMarkdownTheme
}

export const ChatMarkdown = memo(function ChatMarkdown({ text, streaming, className, theme = 'light' }: ChatMarkdownProps) {
  const anchorPrefix = `agent-${useId().replace(/[^\w-]/g, '')}`
  const rootRef = useRef<HTMLDivElement>(null)
  const mermaidProp = useMemo(() => ({
    config: { ...STREAMDOWN_MERMAID_BASE, theme: resolveMermaidTheme(theme) },
  }) as NonNullable<React.ComponentProps<typeof Streamdown>['mermaid']>, [theme])
  // 顺序即 Streamdown 内置链（raw → sanitize → harden）：raw 先把裸 HTML
  // 转成元素（只解析不放行），sanitize 按 agentSanitizeSchema 剥离——
  // 白名单内（details/summary/kbd 等）成元素，危险项剥离（见单测）。
  // 注意：传自定义 rehypePlugins 会跳过 Streamdown 内置的整条 raw 链
  // （源码 `a === hr` 守卫），故 raw 必须显式列在此处，缺之 details 永为文本。
  const rehypePlugins = useMemo(() => [
    rehypeRaw,
    [rehypeSanitize, agentSanitizeSchema],
    [rehypeAgentAnchors, { prefix: anchorPrefix }],
    defaultRehypePlugins.harden,
    rehypeMarkSubSup,
  ] as NonNullable<React.ComponentProps<typeof Streamdown>['rehypePlugins']>, [anchorPrefix])
  const source = useMemo(() => {
    // 顺序：SVG 规范化 → 货币 $ 转义（只看原文手写 $）→ LaTeX 定界符规范
    // （`\(2+2\)`→`$2+2$`，不受转义影响）。流式未闭合公式不补全。
    // 预处理仍是整文一次（纯字符扫描，相对解析可忽略）；解析交给 Streamdown 内置分块。
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
  // Mermaid 滚轮门：社区 PanZoom 容器对**普通滚轮** preventDefault 做缩放，
  // 会把页面滚动卡住。捕获阶段截停（只 stopPropagation、不 preventDefault，
  // 页面与内层滚动照常进行），±按钮/拖拽平移保留，全屏门户在根外不受影响。
  // 单个委托监听，无逐块成本。
  useEffect(() => {
    const root = rootRef.current
    if (!root) return
    const onWheel = (e: WheelEvent) => {
      const t = e.target as Element | null
      if (t && typeof t.closest === 'function' && t.closest('[data-streamdown="mermaid-block"]')) {
        e.stopPropagation()
      }
    }
    root.addEventListener('wheel', onWheel, { capture: true })
    return () => root.removeEventListener('wheel', onWheel, { capture: true })
  }, [])
  return (
    <div ref={rootRef} data-status={streaming ? 'running' : 'complete'}>
    <ChatThemeFlag.Provider value={theme}>
    <AnchorPrefix.Provider value={anchorPrefix}>
    <StreamingFlag.Provider value={streaming}>
      <Streamdown
        key={theme}
        mode="streaming"
        isAnimating={streaming}
        animated={STREAMDOWN_ANIMATION}
        lineNumbers
        translations={STREAMDOWN_TRANSLATIONS}
        codeBlockMaxHeight={360}
        mermaid={mermaidProp}
        plugins={STREAMDOWN_PLUGINS}
        remarkPlugins={STREAMDOWN_REMARK_PLUGINS}
        rehypePlugins={rehypePlugins}
        allowedTags={STREAMDOWN_ALLOWED_TAGS}
        urlTransform={STREAMDOWN_URL_TRANSFORM}
        components={agentComponents}
        BlockComponent={AgentBlock}
        className={className}
      >
        {source}
      </Streamdown>
    </StreamingFlag.Provider>
    </AnchorPrefix.Provider>
    </ChatThemeFlag.Provider>
    </div>
  )
})
