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
export async function renderMermaidSvg(rawSource: string, theme: AppTheme): Promise<string> {
  const source = repairMermaidSource(rawSource)
  if (!source) return ''
  const mermaid = await ensureMermaidConfig(theme)
  const renderId = `montree-mmd-${++renderSeq}`
  cleanupMermaidTempDom(renderId)
  try {
    const { svg } = await mermaid.render(renderId, source)
    cleanupMermaidTempDom(renderId)
    return svg
  } catch (error) {
    cleanupMermaidTempDom(renderId)
    throw error
  }
}

/**
 * 把容器内尚未出图的 `.mermaid` 用 `mermaid.render` 写成 SVG。
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

  const mermaid = await ensureMermaidConfig(theme)
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
      const { svg } = await mermaid.render(renderId, source)
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
