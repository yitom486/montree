import {
  MONTREE_BOOTSTRAP_CLOSE_TAG,
  MONTREE_BOOTSTRAP_OPEN_TAG,
  MONTREE_CLIENT_CLOSE_TAG,
  MONTREE_CLIENT_OPEN_TAG,
} from './montree-static-skill'
import {
  MONTREE_TURN_CONTEXT_CLOSE_TAG,
  MONTREE_TURN_CONTEXT_OPEN_TAG,
} from './turn-context'

/**
 * cursor load 回放清洗（第二道网，第一道是主进程定居压制）。
 *
 * 根因：`sendPrompt` 把会话 bootstrap（静态 Skill + 工具概览）与每轮
 * turn-context 以普通 prompt 文本发给 Agent；本地只存用户原文所以平时不可见。
 * 但 cursor 不支持 resume、只能 load，load 把发过的内容（含脚手架）原样重播为
 * user chunks，渲染端若直接 append，脚手架就会整坨进用户气泡。
 * codex/opencode 走 resume（静默续接、零重播）所以没事。
 *
 * 纯函数：无 React、无 store，跨 chunk 的续接状态由调用方
 *（`chat-slice.applySessionUpdate` 的 user-chunk 分支）持有。
 */
export interface ReplayStripResult {
  /** 清洗后的文本；无标记时与入参逐字相同（同一引用） */
  text: string
  /**
   * 悬垂：本 chunk 以未闭合的 opening 标记结尾（closing 在后续 chunk）。
   * 调用方此时应暂缓渲染，把**原文**缓存、与下一 chunk 拼接后再洗；
   * 洗空（text === ''）即丢弃该消息。
   */
  dangling: boolean
}

const MARKER_PAIRS: ReadonlyArray<readonly [string, string]> = [
  [MONTREE_BOOTSTRAP_OPEN_TAG, MONTREE_BOOTSTRAP_CLOSE_TAG],
  [MONTREE_CLIENT_OPEN_TAG, MONTREE_CLIENT_CLOSE_TAG],
  [MONTREE_TURN_CONTEXT_OPEN_TAG, MONTREE_TURN_CONTEXT_CLOSE_TAG],
]

/** 文本是否含我方脚手架标记（store 门限用：正常用户输入零影响） */
export function hasReplayScaffoldingMarkers(text: string): boolean {
  return MARKER_PAIRS.some(([open, close]) => text.includes(open) || text.includes(close))
}

function indexOfAny(haystack: string, needles: readonly string[], from = 0): number {
  let best = -1
  for (const needle of needles) {
    const idx = haystack.indexOf(needle, from)
    if (idx !== -1 && (best === -1 || idx < best)) best = idx
  }
  return best
}

export function stripReplayScaffolding(text: string): ReplayStripResult {
  if (!hasReplayScaffoldingMarkers(text)) return { text, dangling: false }

  let out = text

  // 1. 整段剥离完整标记对（含标记本身）；循环到稳定以处理嵌套与相邻多段。
  //    bootstrap 包着 client（`<montree-bootstrap><montree-client>…`），
  //    先剥内层 client、再剥外层 bootstrap，循环自然收敛。
  let changed = true
  while (changed) {
    changed = false
    for (const [open, close] of MARKER_PAIRS) {
      let openIdx = out.indexOf(open)
      while (openIdx !== -1) {
        const closeIdx = out.indexOf(close, openIdx + open.length)
        if (closeIdx === -1) break
        out = out.slice(0, openIdx) + out.slice(closeIdx + close.length)
        changed = true
        openIdx = out.indexOf(open)
      }
    }
  }

  // 2. 孤儿 closing（opening 留在更早的 chunk）：之前的一切都是脚手架残片，
  //    丢到最后一个孤儿 closing 为止。完整剥离后残留的 closing 一定没有
  //    同类 opening 在前（否则第 1 步已配对剥掉），可直接截断。
  const closes = MARKER_PAIRS.map(([, close]) => close)
  const opens = MARKER_PAIRS.map(([open]) => open)
  let lastCloseEnd = -1
  for (const close of closes) {
    let from = 0
    while (true) {
      const idx = out.indexOf(close, from)
      if (idx === -1) break
      lastCloseEnd = Math.max(lastCloseEnd, idx + close.length)
      from = idx + close.length
    }
  }
  if (lastCloseEnd !== -1) {
    // opening 若也在 closing 之后残留（如 `残片</a> 你好 <b>半截`），只丢
    // closing 之前的部分，opening 交第 3 步处理。
    const firstOpen = indexOfAny(out, opens)
    if (firstOpen === -1 || firstOpen > lastCloseEnd) {
      out = out.slice(lastCloseEnd)
    } else {
      // closing 落在 opening 之前（如跨块撕裂的尾巴）：只清 opening 之前
      // 的前缀中的 closing 残片，保留 opening 之前的真实文本。
      const beforeOpen = out.slice(0, firstOpen)
      let cut = 0
      for (const close of closes) {
        let from = 0
        while (true) {
          const idx = beforeOpen.indexOf(close, from)
          if (idx === -1) break
          cut = Math.max(cut, idx + close.length)
          from = idx + close.length
        }
      }
      out = out.slice(cut)
    }
  }

  // 3. 悬垂 opening（closing 在后续 chunk）：截断 opening 之后（含 opening），
  //    调用方暂缓渲染、缓存原文续接下一 chunk 再洗。
  const danglingAt = indexOfAny(out, opens)
  let dangling = false
  if (danglingAt !== -1) {
    out = out.slice(0, danglingAt)
    dangling = true
  }

  // 动过刀才整理：块间换行是脚手架排版，堆叠的空行压成一段；
  // 无标记原文上一行已原样返回。
  if (out !== text) out = out.replace(/\n{3,}/g, '\n\n').trim()
  return { text: out, dangling }
}
