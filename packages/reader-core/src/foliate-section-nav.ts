import { isDocumentHtmlElement } from './reader-viewport-nav'

/**
 * foliate 统一链路的节内分片导航（替代旧链路 scrollEpubChapterInRendition）。
 * 背景：z-library 类 EPUB 常把一部/一卷做成单个 spine，目录项以 `#分片` 指向其内部；
 * 只按章节号跳转会永远落到大篇章开头。
 */

/** 章节 href 拆出 base 与分片 */
export function splitChapterFragment(href: string): { base: string; fragment: string | null } {
  const hashIndex = href.indexOf('#')
  if (hashIndex < 0) return { base: href, fragment: null }
  const fragment = href.slice(hashIndex + 1).trim()
  return { base: href.slice(0, hashIndex), fragment: fragment || null }
}

/**
 * spine 同源判定：归一化全路径相等，或 basename 相等（foliate 的目录 href 与
 * spine id 常差一个 `OEBPS/` 前缀，两边来回解析必须容忍）。
 */
export function isSameSpineBase(
  aHref: string,
  bHref: string,
  normalize: (value: string) => string,
): boolean {
  const aBase = normalize(aHref.split('#')[0] ?? aHref)
  const bBase = normalize(bHref.split('#')[0] ?? bHref)
  if (!aBase || !bBase) return false
  if (aBase === bBase) return true
  const aTail = aBase.split('/').pop() ?? aBase
  const bTail = bBase.split('/').pop() ?? bBase
  return aTail !== '' && aTail === bTail
}

/**
 * 在已渲染章节文档内滚动到分片锚点（id / name 兼容）。写后验位：
 * scrollIntoView 在跨 iframe + shadow 链路下可能静默失效，验位失败时从
 * frameElement 起跳逐级上找真正的滚动容器直接写 scrollTop（含 closed shadow
 * 穿越；注意不能从目标元素向上找——iframe 文档内部走不到外层容器）。
 * 返回锚点最终是否落在视口顶部附近。
 */
export function scrollFoliateSectionToFragment(doc: Document, fragment: string | null): boolean {
  if (!fragment) return false
  let target: Element | null = null
  try {
    target = doc.getElementById(fragment)
  } catch {
    target = null
  }
  if (!target) {
    try {
      target = doc.querySelector(`[name="${fragment.replace(/"/g, '')}"]`)
    } catch {
      target = null
    }
  }
  if (!isDocumentHtmlElement(target)) return false
  try {
    target.scrollIntoView({ block: 'start' })
  } catch {
    // 继续走下面的验位纠正
  }
  if (isNearViewportTop(target)) return true
  // 验位失败：从宿主 iframe 起跳上找可滚动祖先（穿 shadow，直达 paginator 容器）
  //（不用 instanceof：链路穿过 iframe 与 closed shadow，realm 各异）
  const iframe = doc.defaultView?.frameElement ?? null
  let node: Node | null = iframe ?? target
  for (let depth = 0; depth < 12 && node; depth++) {
    const parent: Node | null =
      node.parentNode ?? (node as ShadowRoot).host ?? null
    if (parent?.nodeType === 1) {
      const scroller = parent as HTMLElement
      let scrollable = false
      try {
        scrollable =
          (scroller.scrollHeight ?? 0) > (scroller.clientHeight ?? 0) + 8
      } catch {
        scrollable = false
      }
      if (scrollable) {
        try {
          const top = (target as HTMLElement).getBoundingClientRect().top +
            (iframe?.getBoundingClientRect().top ?? 0) - scroller.getBoundingClientRect().top
          scroller.scrollTop += top - 120
        } catch {
          // 忽略，继续上找
        }
        if (isNearViewportTop(target)) return true
      }
    }
    node = parent
  }
  return isNearViewportTop(target)
}

function isNearViewportTop(element: HTMLElement): boolean {
  try {
    let top = element.getBoundingClientRect().top
    const frame = element.ownerDocument.defaultView?.frameElement
    if (frame) {
      top += frame.getBoundingClientRect().top
      let node: Node | null = frame
      for (let depth = 0; depth < 12 && node; depth++) {
        const parent: Node | null = node.parentNode ?? (node as ShadowRoot).host ?? null
        if (parent?.nodeType === 1) {
          const host = parent as HTMLElement
          if (host.scrollHeight > host.clientHeight + 8) {
            top -= host.getBoundingClientRect().top
            break
          }
        }
        node = parent
      }
    }
    return top >= -40 && top <= 240
  } catch {
    return false
  }
}
