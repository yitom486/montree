import type { AppTheme } from '@/stores/editor-ui-store'
import {
  mermaidError,
  mermaidLog,
  mermaidWarn,
  summarizeMermaidSource,
} from '@/lib/preview/mermaid-debug'

let mermaidInitialized = false
let mermaidTheme: AppTheme = 'dark'
let renderSeq = 0

function ensureMermaidConfig(theme: AppTheme): Promise<typeof import('mermaid').default> {
  return import('mermaid').then(({ default: mermaid }) => {
    if (!mermaidInitialized || mermaidTheme !== theme) {
      mermaidLog('initialize', { theme, reinit: mermaidInitialized })
      mermaid.initialize({
        startOnLoad: false,
        securityLevel: 'strict',
        theme: theme === 'dark' ? 'dark' : 'neutral',
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

    const source = readSource(node)
    if (!source) {
      mermaidWarn(`${reason}:empty-source`, { index })
      continue
    }

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
