import DOMPurify from 'dompurify'
import type { AppTheme } from '@/stores/editor-ui-store'
import {
  mermaidError,
  mermaidLog,
  mermaidWarn,
  summarizeMermaidSource,
} from '@/lib/preview/mermaid-debug'
import { repairMermaidSource } from '@/lib/preview/mermaid-repair'

let mermaidInitialized = false
let mermaidTheme: AppTheme = 'dark'
let renderSeq = 0

const DIAGRAM_FONT = '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif'

/** Pele 优先；主题写入 SVG，下载后也不依赖应用的样式表。 */
async function renderDiagramSvg(renderId: string, source: string, theme: AppTheme): Promise<{ svg: string }> {
  try {
    const { render } = await import('pele')
    const result = render(source, {
      idPrefix: renderId,
      fontFamily: DIAGRAM_FONT,
      responsive: true,
      autoDirection: false,
    })
    // 与 Markdown 预览保持一致：包一层，避免 DOM 实现剥掉唯一的根 SVG。
    const fragment = DOMPurify.sanitize(`<div>${result.svg}</div>`, {
      USE_PROFILES: { svg: true, svgFilters: true },
      RETURN_DOM_FRAGMENT: true,
    })
    const svg = fragment.querySelector('svg')
    if (!svg) throw new Error('Pele returned an empty SVG')
    svg.id = renderId
    const colors = theme === 'dark'
      ? { bg: '#0f172a', fg: '#e0e7ff', muted: '#94a3b8', line: '#818cf8', surface: '#1e1b4b', 'surface-alt': '#1e293b', border: '#6366f1', accent: '#a5b4fc' }
      : { bg: '#ffffff', fg: '#312e81', muted: '#64748b', line: '#6366f1', surface: '#f5f3ff', 'surface-alt': '#f1f5f9', border: '#818cf8', accent: '#4f46e5' }
    for (const [name, color] of Object.entries(colors)) svg.style.setProperty(`--pele-${name}`, color)
    svg.style.setProperty('--pele-radius', '8px')
    svg.setAttribute('data-montree-renderer', 'pele')
    return { svg: svg.outerHTML }
  } catch (error) {
    // 不通过兼容回退绕过 Pele 的源码、边数或输出大小限制。
    if (error && typeof error === 'object' && 'code' in error && error.code === 'limit') throw error
    mermaidWarn('pele:fallback', { message: error instanceof Error ? error.message : String(error) })
    const mermaid = await ensureMermaidConfig(theme)
    return mermaid.render(renderId, source)
  }
}

function ensureMermaidConfig(theme: AppTheme): Promise<typeof import('mermaid').default> {
  return import('mermaid').then(({ default: mermaid }) => {
    if (!mermaidInitialized || mermaidTheme !== theme) {
      mermaidLog('initialize', { theme, reinit: mermaidInitialized })
      const isDark = theme === 'dark'
      mermaid.initialize({
        startOnLoad: false,
        securityLevel: 'loose',
        theme: 'base',
        themeVariables: isDark
          ? {
              darkMode: true,
              background: 'transparent',
              fontFamily:
                '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif',
              primaryColor: '#1e1b4b',
              primaryTextColor: '#e0e7ff',
              primaryBorderColor: '#6366f1',
              lineColor: '#818cf8',
              secondaryColor: '#1e293b',
              secondaryTextColor: '#f1f5f9',
              secondaryBorderColor: '#475569',
              tertiaryColor: '#0f172a',
              tertiaryTextColor: '#cbd5e1',
              tertiaryBorderColor: '#334155',
              nodeBorder: '#6366f1',
              clusterBkg: '#090d16',
              clusterBorder: '#312e81',
              titleColor: '#f8fafc',
              edgeLabelBackground: '#1e1b4b',
              nodeTextColor: '#f8fafc',
            }
          : {
              darkMode: false,
              background: 'transparent',
              fontFamily:
                '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif',
              primaryColor: '#f5f3ff',
              primaryTextColor: '#312e81',
              primaryBorderColor: '#818cf8',
              lineColor: '#6366f1',
              secondaryColor: '#f8fafc',
              secondaryTextColor: '#1e293b',
              secondaryBorderColor: '#cbd5e1',
              tertiaryColor: '#f1f5f9',
              tertiaryTextColor: '#334155',
              tertiaryBorderColor: '#94a3b8',
              nodeBorder: '#818cf8',
              clusterBkg: '#f8fafc',
              clusterBorder: '#cbd5e1',
              titleColor: '#0f172a',
              edgeLabelBackground: '#ffffff',
              nodeTextColor: '#1e1b4b',
            },
        flowchart: {
          curve: 'basis',
          padding: 14,
          nodeSpacing: 45,
          rankSpacing: 45,
          htmlLabels: true,
        },
      })
      mermaidInitialized = true
      mermaidTheme = theme
    }
    return mermaid
  })
}

function readSource(node: HTMLElement): string {
  const stored = node.getAttribute('data-mermaid-source')
  if (stored?.trim()) return stored.trim()
  return (node.textContent ?? '').trim()
}

/** 只清 mermaid.render 挂在 body 上的临时节点；切勿删 SVG 自己的 id */
function cleanupMermaidTempDom(renderId: string): void {
  document.getElementById(`d${renderId}`)?.remove()
}

/**
 * 直接渲染 Mermaid 源码为 SVG 矢量文本字符串。
 * 供 React 组件（如 MermaidBlock）声明式挂载，避免 DOM 命令式水合竞态。
 */
const SVG_CACHE_LIMIT = 64
const svgCache = new Map<string, string>()
const inflight = new Map<string, Promise<string>>()
let renderQueue: Promise<unknown> = Promise.resolve()

function cacheKey(source: string, theme: AppTheme): string { return `${theme}\u0000${source}` }

/** 同步读取已渲染 SVG（源码 + 主题为键）。重挂载/切换预览时直接出图，不闪加载态、不跳高度。 */
export function getCachedMermaidSvg(rawSource: string, theme: AppTheme): string | undefined {
  const source = repairMermaidSource(rawSource)
  const svg = svgCache.get(cacheKey(source, theme))
  if (svg !== undefined) { svgCache.delete(cacheKey(source, theme)); svgCache.set(cacheKey(source, theme), svg) }
  return svg
}

/**
 * 直接渲染 Mermaid 源码为 SVG 矢量文本字符串。
 * 供 React 组件（如 MermaidBlock）声明式挂载，避免 DOM 命令式水合竞态。
 * Pele 优先，Mermaid 兼容回退；结果按源码 + 主题缓存（LRU），同键并发复用，串行执行。
 */
export function renderMermaidSvg(rawSource: string, theme: AppTheme): Promise<string> {
  const source = repairMermaidSource(rawSource)
  if (!source) return Promise.resolve('')
  const key = cacheKey(source, theme)
  const cached = svgCache.get(key)
  if (cached !== undefined) return Promise.resolve(cached)
  const pending = inflight.get(key)
  if (pending) return pending
  const task = renderQueue.catch(() => undefined).then(async () => {
    const renderId = `montree-mmd-${++renderSeq}`
    cleanupMermaidTempDom(renderId)
    try {
      const { svg } = await renderDiagramSvg(renderId, source, theme)
      svgCache.set(key, svg)
      while (svgCache.size > SVG_CACHE_LIMIT) svgCache.delete(svgCache.keys().next().value as string)
      return svg
    } finally {
      cleanupMermaidTempDom(renderId)
    }
  })
  renderQueue = task
  inflight.set(key, task)
  void task.finally(() => inflight.delete(key)).catch(() => undefined)
  return task
}

/**
 * 把容器内尚未出图的 `.mermaid` 用 Pele（失败时回退 Mermaid）写成 SVG。
 * 取消时不回写 DOM，避免过期异步把新图冲成源码。
 */
export async function hydrateMermaidInElement(
  root: HTMLElement,
  theme: AppTheme,
  options?: { force?: boolean; cancelled?: () => boolean; reason?: string },
): Promise<void> {
  const force = options?.force === true
  const cancelled = options?.cancelled ?? (() => false)
  const reason = options?.reason ?? 'hydrate'

  const nodes = root.classList.contains('mermaid') || root.classList.contains('mermaid-hydrating')
    ? [root]
    : [...root.querySelectorAll<HTMLElement>('.mermaid, .mermaid-hydrating')]

  mermaidLog(`${reason}:scan`, {
    theme,
    force,
    nodeCount: nodes.length,
    rootTag: root.tagName,
    rootClass: root.className,
  })

  if (nodes.length === 0) {
    mermaidWarn(`${reason}:no-nodes`)
    return
  }

  const needWork = force || nodes.some((node) => !node.querySelector('svg'))
  if (!needWork) {
    mermaidLog(`${reason}:skip-already-svg`, { nodeCount: nodes.length })
    return
  }

  if (cancelled()) {
    mermaidWarn(`${reason}:cancelled-after-import`)
    return
  }

  for (let index = 0; index < nodes.length; index++) {
    const node = nodes[index]!
    if (cancelled()) {
      mermaidWarn(`${reason}:cancelled-before-node`, { index })
      return
    }

    const hasSvg = Boolean(node.querySelector('svg'))
    if (hasSvg && !force) {
      mermaidLog(`${reason}:skip-node-has-svg`, { index })
      continue
    }

    const rawSource = readSource(node)
    if (!rawSource) {
      mermaidWarn(`${reason}:empty-source`, { index })
      continue
    }

    const source = repairMermaidSource(rawSource)

    node.setAttribute('data-mermaid-source', source)
    node.classList.remove('mermaid')
    node.classList.add('mermaid-hydrating')

    const renderId = `montree-mmd-${++renderSeq}`
    cleanupMermaidTempDom(renderId)

    mermaidLog(`${reason}:render-start`, {
      index,
      renderId,
      ...summarizeMermaidSource(source),
    })

    const t0 = performance.now()
    try {
      const { svg } = await renderDiagramSvg(renderId, source, theme)
      cleanupMermaidTempDom(renderId)
      const ms = Math.round(performance.now() - t0)

      if (cancelled()) {
        mermaidWarn(`${reason}:cancelled-after-render`, {
          index,
          renderId,
          ms,
          svgChars: svg?.length ?? 0,
        })
        return
      }

      if (!svg?.trim()) {
        mermaidError(`${reason}:empty-svg`, undefined, { index, renderId, ms })
        node.textContent = source
        continue
      }

      node.innerHTML = svg
      node.setAttribute('data-montree-mermaid', '1')
      node.removeAttribute('data-processed')

      const svgEl = node.querySelector('svg')
      mermaidLog(`${reason}:render-ok`, {
        index,
        renderId,
        ms,
        svgChars: svg.length,
        hasSvgInDom: Boolean(svgEl),
        svgId: svgEl?.id ?? null,
        childCount: node.childNodes.length,
      })
    } catch (error) {
      if (cancelled()) {
        mermaidWarn(`${reason}:cancelled-after-error`, { index, renderId })
        return
      }
      mermaidError(`${reason}:render-throw`, error, {
        index,
        renderId,
        ...summarizeMermaidSource(source),
      })
      node.textContent = source
    } finally {
      if (!cancelled()) {
        node.classList.remove('mermaid-hydrating')
        node.classList.add('mermaid')
      } else {
        mermaidWarn(`${reason}:leave-hydrating-class`, { index, renderId })
      }
      cleanupMermaidTempDom(renderId)
    }
  }
}
