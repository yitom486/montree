import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { MermaidBlock } from '@/components/markdown/MermaidBlock'
import { cn } from '@/lib/utils'

const MarkdownArtifact = lazy(() => import('./MarkdownArtifact').then((module) => ({ default: module.MarkdownArtifact })))

interface MarkdownContentProps {
  html: string
  className?: string
  /** 为 true 时不拆 Mermaid（流式中间态），整段 HTML 直出 */
  deferMermaid?: boolean
}

/**
 * 预览与 Agent 共用的 Markdown DOM 渲染：
 * 保留完整 HTML 容器，Mermaid 通过 React portal 原位出图。
 */
export function MarkdownContent({ html, className, deferMermaid = false }: MarkdownContentProps) {
  const prepared = useMemo(() => {
    if (!html || deferMermaid || typeof DOMParser === 'undefined') return { html, diagrams: [], artifacts: [] }
    const doc = new DOMParser().parseFromString(html, 'text/html')
    const diagrams = Array.from(doc.body.querySelectorAll('.mermaid, .mermaid-hydrating')).map((node, index) => {
      const source = (node.getAttribute('data-mermaid-source') || node.textContent || '').trim()
      const placeholder = doc.createElement('div')
      placeholder.setAttribute('data-montree-mermaid-slot', String(index))
      node.replaceWith(placeholder)
      return source
    })
    const artifacts = Array.from(doc.body.querySelectorAll('[data-montree-artifact]')).map((node, index) => {
      const data = { kind: node.getAttribute('data-montree-artifact') ?? '', source: node.getAttribute('data-montree-spec') ?? '', fallback: node.innerHTML }
      const placeholder = doc.createElement('div')
      placeholder.setAttribute('data-montree-artifact-slot', String(index))
      node.replaceWith(placeholder)
      return data
    })
    return { html: diagrams.length || artifacts.length ? doc.body.innerHTML : html, diagrams, artifacts }
  }, [html, deferMermaid])
  // Stable props prevent React from replacing the portal hosts or resetting native details.
  const innerHtml = useMemo(() => ({ __html: prepared.html }), [prepared.html])
  const container = useRef<HTMLDivElement>(null)
  const [mounts, setMounts] = useState<{ prepared: typeof prepared; nodes: Element[]; artifacts: Element[] }>()
  useEffect(() => {
    setMounts({ prepared, nodes: Array.from(container.current?.querySelectorAll('[data-montree-mermaid-slot]') ?? []), artifacts: Array.from(container.current?.querySelectorAll('[data-montree-artifact-slot]') ?? []) })
  }, [prepared])

  if (!html) return null
  return (
    <>
      <div ref={container} className={cn('min-w-0 max-w-full', className)}
        dangerouslySetInnerHTML={innerHtml} />
      {mounts?.prepared === prepared && mounts.nodes.map((node, index) => prepared.diagrams[index]
        ? createPortal(<MermaidBlock source={prepared.diagrams[index]} />, node, `mmd-${index}`) : null)}
      {mounts?.prepared === prepared && mounts.artifacts.map((node, index) => {
        const artifact = prepared.artifacts[index]
        return artifact ? createPortal(<Suspense fallback={<div dangerouslySetInnerHTML={{ __html: artifact.fallback || '正在加载文档组件…' }} />}>
          <MarkdownArtifact kind={artifact.kind} source={artifact.source} fallback={artifact.fallback} />
        </Suspense>, node, `artifact-${index}`) : null
      })}
    </>
  )
}
