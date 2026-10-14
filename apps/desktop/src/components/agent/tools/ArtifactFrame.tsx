import { useEffect, useLayoutEffect, useMemo, useRef } from 'react'
import { stripHostileHtmlHead } from '@/lib/agent/context/present-result-builder'
import { parseReactArtifactRequest, REACT_ARTIFACT_REQUEST_MAX_BYTES } from '@montree/contracts'

/**
 * 隔离 iframe 共享宿主（I1）：内联 React 预览与 HTML 对话框共用同一套
 * srcDoc 构建、来源校验、挂载 ID、错误与高度处理。不复制安全逻辑，
 * 不另建 HtmlViewer，不开 allow-same-origin。
 */
export const ARTIFACT_CSP =
  "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; " +
  'img-src data:; font-src data:; connect-src \'none\'; object-src \'none\'; ' +
  "base-uri 'none'; form-action 'none'; frame-src 'none';"

/** 桥接消息上限（JSON 字节）：超限忽略，不带函数/IPC 名/路径 */
export const ARTIFACT_MESSAGE_MAX_BYTES = 2048
/** 高度钳制与上报限频 */
export const ARTIFACT_HEIGHT_MIN = 120
export const ARTIFACT_HEIGHT_MAX = 1200
export const ARTIFACT_HEIGHT_MIN_INTERVAL_MS = 300
/** 高度微差忽略阈值（px）：防 ResizeObserver 与 style.height 反馈循环抖动 */
export const ARTIFACT_HEIGHT_EPSILON_PX = 2

export function newArtifactMountId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}

function hostScript(mountId: string, allowRequests: boolean): string {
  const requestApi = allowRequests ? `window.montreeArtifact=Object.freeze({requestAnalysis:function(text){if(typeof text!=="string"||!text.trim()||new TextEncoder().encode(text.trim()).byteLength>${REACT_ARTIFACT_REQUEST_MAX_BYTES})return false;send("artifact-request-analysis",text.trim());return true}});` : ''
  return `<script>(function(){var m=${JSON.stringify(mountId)};function send(t,v){try{var o={mountId:m,type:t,value:v};if(new TextEncoder().encode(JSON.stringify(o)).byteLength>${ARTIFACT_MESSAGE_MAX_BYTES})return;parent.postMessage(o,"*")}catch(e){}}${requestApi}try{send("artifact-ready",1)}catch(e){}var last=0;function report(){try{var now=Date.now();if(now-last<${ARTIFACT_HEIGHT_MIN_INTERVAL_MS})return;last=now;var h=document.documentElement?document.documentElement.scrollHeight:0;send("artifact-height",h||0)}catch(e){}}try{if("ResizeObserver" in window&&document.documentElement){new ResizeObserver(report).observe(document.documentElement)}window.addEventListener("load",report);setTimeout(report,500)}catch(e){}window.addEventListener("error",function(e){try{send("artifact-error",String((e&&e.message)||"error").slice(0,200))}catch(_){}});})();</script>`
}

/**
 * 宿主组装预览文档（纯函数，可单测）：把模型来源规范化并重新组装为
 * 受控完整文档，保证宿主 CSP 永远在任何主动内容之前生效。
 *
 * - 只搬运 `<html>` 之前的前置资源与 head 内联资源到 head（CSP 之后，
 *   保持原文相对顺序）；body 内脚本/样式原地保留（依赖解析顺序）；
 * - base 与全部 meta 丢弃（宿主重加 charset+CSP），模型策略不得覆盖；
 * - 未闭合 script/style 按浏览器语义原样保留（CSP 已先生效，安全不受影响）；
 * - host 桥接脚本对片段/完整/缺 head/异常 HTML 唯一追加。
 */
export function buildArtifactDocument(source: string, mountId: string, allowRequests = false): string {
  const csp = `<meta http-equiv="Content-Security-Policy" content="${ARTIFACT_CSP}">`
  const host = hostScript(mountId, allowRequests)
  const cleaned = stripHostileHtmlHead(source)
  // 只搬运 <html> 之前的前置资源与 head 内联资源（保持原文相对顺序）；
  // body 内脚本/样式原地保留（依赖解析顺序，如先取元素再绑定）。
  const extras: string[] = []
  const takeExtras = (segment: string): string =>
    segment.replace(/<(style|script)\b[^>]*>([\s\S]*?)(<\/\1\s*>|$)/gi, (match) => {
      extras.push(match)
      return ''
    })
  let bodyContent: string
  if (/<\s*html[\s>]/i.test(cleaned)) {
    const htmlAt = cleaned.search(/<\s*html[\s>]/i)
    bodyContent = takeExtras(cleaned.slice(0, htmlAt))
    const rest = cleaned.slice(htmlAt)
    const headMatch = /<\s*head\b[^>]*>([\s\S]*?)(<\/\s*head\s*>|$)/i.exec(rest)
    let bodyRest = rest
    if (headMatch) {
      takeExtras(headMatch[1] ?? '')
      bodyRest = rest.replace(headMatch[0], '')
    }
    bodyContent += bodyRest.replace(/<\/?\s*(html|head|body|title)\b[^>]*>/gi, '')
  } else {
    bodyContent = cleaned.replace(/<\/?\s*(html|head|body|title)\b[^>]*>/gi, '')
  }
  return (
    '<!DOCTYPE html><html><head><meta charset="utf-8">' +
    `${csp}${allowRequests ? host : ''}${extras.join('')}</head><body>${bodyContent}${allowRequests ? '' : host}</body></html>`
  )
}

export type ArtifactBridgeMessage =
  | { kind: 'ready' }
  | { kind: 'react-ready' }
  | { kind: 'error'; message: string }
  | { kind: 'analysis-request'; text: string }

export interface ArtifactFrameProps {
  title: string
  /** 模型/编译后的 HTML 源码（内部套壳，不在此执行） */
  html: string
  /** 本次挂载 ID：调用方拥有，源码变化或用户重跑时才更新 */
  mountId: string
  /** 初始高度 px（内容区预留，避免零高跳变） */
  initialHeight?: number
  /** 高度钳制上/下限 px */
  minHeight?: number
  maxHeight?: number
  frameTestId?: string
  className?: string
  onBridgeMessage?: (message: ArtifactBridgeMessage) => void
  allowRequests?: boolean
}

/**
 * 隔离 iframe：sandbox 仅 allow-scripts，无 preload/Node/electronAPI/父 DOM；
 * 只认当前挂载 frame 自身来源 + 本次 mountId + 2KiB 上限 + 白名单消息。
 * 高度通知限频并忽略微差；调用方 key 必须按 result.id + mountId 稳定，
 * 源码展开/宿主更新不得重建。
 */
export function ArtifactFrame({
  title,
  html,
  mountId,
  initialHeight = 320,
  minHeight = ARTIFACT_HEIGHT_MIN,
  maxHeight = ARTIFACT_HEIGHT_MAX,
  frameTestId = 'artifact-frame',
  className,
  onBridgeMessage,
  allowRequests = false,
}: ArtifactFrameProps) {
  const frameRef = useRef<HTMLIFrameElement>(null)
  const lastHeight = useRef(initialHeight)
  const lastHeightAt = useRef(0)
  const sinkRef = useRef(onBridgeMessage)
  sinkRef.current = onBridgeMessage

  useEffect(() => {
    lastHeight.current = initialHeight
    lastHeightAt.current = 0
  }, [mountId, initialHeight])

  const srcDoc = useMemo(
    () => buildArtifactDocument(html, mountId, allowRequests),
    [html, mountId, allowRequests],
  )

  useLayoutEffect(() => {
    const expectedMountId = mountId
    const onMessage = (event: MessageEvent) => {
      const frame = frameRef.current
      // 只认当前挂载 frame 自身来源；opaque origin 常为 null，不只凭 origin 判断
      if (!frame || event.source !== frame.contentWindow) return
      const data = event.data
      if (!data || typeof data !== 'object') return
      const message = data as { mountId?: unknown; type?: unknown; value?: unknown }
      if (message.mountId !== expectedMountId) return
      let size = 0
      try {
        size = new TextEncoder().encode(JSON.stringify(data)).byteLength
      } catch {
        return
      }
      if (size > ARTIFACT_MESSAGE_MAX_BYTES) return
      if (allowRequests && message.type === 'artifact-request-analysis') {
        const text = parseReactArtifactRequest(message.value)
        if (text) sinkRef.current?.({ kind: 'analysis-request', text })
        return
      }
      // 白名单消息；不带函数、IPC 方法名或路径
      if (message.type === 'artifact-ready') {
        sinkRef.current?.({ kind: 'ready' })
        return
      }
      // React 首次 commit 确认：只有生成包装层会发出，普通 HTML 保持原语义
      if (message.type === 'artifact-react-ready') {
        sinkRef.current?.({ kind: 'react-ready' })
        return
      }
      if (message.type === 'artifact-height' && typeof message.value === 'number' && Number.isFinite(message.value)) {
        const now = Date.now()
        if (now - lastHeightAt.current < ARTIFACT_HEIGHT_MIN_INTERVAL_MS) return
        const height = Math.max(minHeight, Math.min(maxHeight, Math.round(message.value)))
        // 忽略微差：防 ResizeObserver 与 style.height 反馈循环导致气泡抖动
        if (Math.abs(height - lastHeight.current) < ARTIFACT_HEIGHT_EPSILON_PX) return
        lastHeightAt.current = now
        lastHeight.current = height
        if (frameRef.current) frameRef.current.style.height = `${height}px`
        return
      }
      if (message.type === 'artifact-error' && typeof message.value === 'string') {
        sinkRef.current?.({ kind: 'error', message: message.value.slice(0, 500) })
      }
    }
    window.addEventListener('message', onMessage)
    return () => window.removeEventListener('message', onMessage)
  }, [mountId, minHeight, maxHeight, allowRequests])

  return (
    <iframe
      ref={frameRef}
      title={title}
      name={`montree-artifact-${mountId}`}
      sandbox="allow-scripts"
      srcDoc={srcDoc}
      data-testid={frameTestId}
      className={className ?? 'h-full min-h-[320px] w-full border-0 bg-transparent'}
      style={className ? { height: initialHeight } : undefined}
    />
  )
}
