// 宿主 `apps/desktop/src/lib/agent/acp-layout-probe.ts` 逐字复刻（私有，不进 barrel；
// 供包内 `AgentChatItem` 的 DEV 布局探针使用）。唯一改动：`acpDevLog` 改引包内 `./dev-log`。
import { acpDevLog } from './dev-log'

export type AcpLayoutProbeSample = {
  tag: string
  role?: string
  messageId?: string
  streaming?: boolean
  clientWidth: number
  scrollWidth: number
  overflowX: boolean
  /** 向上采样几层祖先的宽，便于定位是谁被撑开 */
  ancestors: Array<{
    name: string
    clientWidth: number
    scrollWidth: number
    overflowX: boolean
  }>
}

function nodeName(el: Element): string {
  const id = el.id ? `#${el.id}` : ''
  const cls =
    typeof el.className === 'string' && el.className.trim()
      ? `.${el.className.trim().split(/\s+/).slice(0, 3).join('.')}`
      : ''
  const slot = el.getAttribute('data-slot')
  const probe = el.getAttribute('data-acp-probe')
  return `${el.tagName.toLowerCase()}${id}${cls}${slot ? `[slot=${slot}]` : ''}${probe ? `[probe=${probe}]` : ''}`
}

/** 测量节点及其祖先是否被内容横向撑开（scrollWidth > clientWidth）。 */
export function sampleAcpLayout(
  el: HTMLElement | null,
  meta: {
    tag: string
    role?: string
    messageId?: string
    streaming?: boolean
    ancestorDepth?: number
  },
): AcpLayoutProbeSample | null {
  if (!el) return null
  const depth = meta.ancestorDepth ?? 6
  const ancestors: AcpLayoutProbeSample['ancestors'] = []
  let cur: HTMLElement | null = el.parentElement
  for (let i = 0; i < depth && cur; i += 1) {
    ancestors.push({
      name: nodeName(cur),
      clientWidth: cur.clientWidth,
      scrollWidth: cur.scrollWidth,
      overflowX: cur.scrollWidth > cur.clientWidth + 1,
    })
    cur = cur.parentElement
  }
  return {
    tag: meta.tag,
    role: meta.role,
    messageId: meta.messageId,
    streaming: meta.streaming,
    clientWidth: el.clientWidth,
    scrollWidth: el.scrollWidth,
    overflowX: el.scrollWidth > el.clientWidth + 1,
    ancestors,
  }
}

let lastKey = ''
let lastOverflow = false

/**
 * DEV：对比流式/结束时同一 DOM 节点的宽度。
 * 若 streaming 翻转前后节点仍是同一 ref，说明不是「两套容器」，而是宽度被兄弟/祖先撑开。
 */
export function logAcpLayoutProbe(
  el: HTMLElement | null,
  meta: {
    tag: string
    role?: string
    messageId?: string
    streaming?: boolean
    /** 强制打一条（例如 streaming 翻转） */
    force?: boolean
  },
): void {
  if (!import.meta.env.DEV) return
  const sample = sampleAcpLayout(el, meta)
  if (!sample) return

  const key = `${meta.tag}:${meta.messageId ?? ''}:${meta.streaming ? 1 : 0}`
  const overflowChanged = sample.overflowX !== lastOverflow
  const shouldLog =
    meta.force ||
    sample.overflowX ||
    overflowChanged ||
    key !== lastKey

  if (!shouldLog) return
  lastKey = key
  lastOverflow = sample.overflowX

  const wideAncestor = sample.ancestors.find((a) => a.overflowX)
  acpDevLog('layout-probe', {
    ...sample,
    sameComponentHint:
      'agent/thought/tool 流式与结束共用各自组件；若 messageId 不变且仅 streaming 翻转，则不是两套容器',
    firstWideAncestor: wideAncestor?.name ?? null,
  })
}
