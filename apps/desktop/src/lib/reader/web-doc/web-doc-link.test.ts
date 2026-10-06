// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest'
import {
  MONTREE_NAV_HREF_ATTR,
  MONTREE_SOURCE_HREF_ATTR,
  WEB_DOC_READER_MARKER_ATTR,
  WEB_DOC_READER_MARKER_VALUE,
  detectWebDocIframeEscape,
  isWebDocNavigationTarget,
  isWebDocReaderDocument,
  neutralizeWebDocNavigationLinks,
  resolveWebDocClickHref,
  resolveWebDocFragment,
  shouldNavigateWebDocInApp,
} from './web-doc-link'

describe('web-doc-link', () => {
  const current =
    'https://paper.people.com.cn/rmrb/pc/content/202609/01/content_30178364.html'

  it('同站链接应在应用内导航', () => {
    expect(
      shouldNavigateWebDocInApp(
        'https://paper.people.com.cn/rmrb/pc/content/202609/01/content_30178365.html',
        current,
      ),
    ).toBe(true)
  })

  it('外站链接应打开外部浏览器', () => {
    expect(shouldNavigateWebDocInApp('https://www.people.com.cn/', current)).toBe(false)
  })

  it('neutralize 将 href 改写为 data 属性', () => {
    const html = neutralizeWebDocNavigationLinks(
      '<a href="node_02.html">02版</a><a href="#top">顶部</a>',
      'https://paper.people.com.cn/rmrb/pc/layout/202609/01/node_03.html',
    )
    const root = document.createElement('div')
    root.innerHTML = html
    const link = root.querySelector('a')
    expect(link?.getAttribute('href')).toBeNull()
    expect(link?.getAttribute(MONTREE_NAV_HREF_ATTR)).toBe(
      'https://paper.people.com.cn/rmrb/pc/layout/202609/01/node_02.html',
    )
    expect(root.querySelectorAll('a')[1]?.getAttribute('href')).toBeNull()
    expect(root.querySelectorAll('a')[1]?.getAttribute(MONTREE_NAV_HREF_ATTR)).toBe(
      'https://paper.people.com.cn/rmrb/pc/layout/202609/01/node_03.html#top',
    )
  })

  it('neutralize 将空 href 置为惰性（避免导航到 srcdoc base 即应用自身）', () => {
    const root = document.createElement('div')
    root.innerHTML = neutralizeWebDocNavigationLinks(
      '<a href="">空</a><a href="   ">空白</a><a>无href</a>',
      'https://bojieli.github.io/ai-infra-book/',
    )
    const links = root.querySelectorAll('a')
    expect(links[0]?.getAttribute('href')).toBeNull()
    expect(links[0]?.getAttribute(MONTREE_NAV_HREF_ATTR)).toBeNull()
    expect(links[1]?.getAttribute('href')).toBeNull()
    expect(links[2]?.getAttribute('href')).toBeNull()
    // 惰性链接不再是导航目标，点击走默认行为也不会离开 srcdoc
    expect(isWebDocNavigationTarget(links[0], 'https://bojieli.github.io/ai-infra-book/')).toBe(false)
  })

  it('neutralize 将非 anchor 卡片根节点的来源 href 提升为导航目标', () => {
    const root = document.createElement('div')
    root.innerHTML = neutralizeWebDocNavigationLinks(
      `<div role="link" tabindex="0" ${MONTREE_SOURCE_HREF_ATTR}="/protocol/v1/elicitation"><span>Learn more</span></div>`,
      'https://agentclientprotocol.com/protocol/v1/initialization',
    )

    const card = root.firstElementChild
    expect(card?.getAttribute(MONTREE_SOURCE_HREF_ATTR)).toBeNull()
    expect(card?.getAttribute(MONTREE_NAV_HREF_ATTR)).toBe(
      'https://agentclientprotocol.com/protocol/v1/elicitation',
    )
    expect(card?.getAttribute('role')).toBe('link')
    expect(card?.getAttribute('tabindex')).toBe('0')
    expect(resolveWebDocClickHref(card?.firstElementChild ?? null, current)).toBe(
      'https://agentclientprotocol.com/protocol/v1/elicitation',
    )
  })

  it('卡片内部 display-contents anchor 不会抢走外层导航目标', () => {
    const root = document.createElement('div')
    root.innerHTML = neutralizeWebDocNavigationLinks(
      `<div ${MONTREE_SOURCE_HREF_ATTR}="/next"><a class="web-doc-card-inner-link" href="/next"><span>Next</span></a></div>`,
      'https://example.com/docs/start',
    )

    const inner = root.querySelector('a')
    expect(inner?.getAttribute('href')).toBeNull()
    expect(inner?.getAttribute(MONTREE_NAV_HREF_ATTR)).toBeNull()
    expect(resolveWebDocClickHref(inner?.firstElementChild ?? null, 'https://example.com/docs/start')).toBe(
      'https://example.com/next',
    )
  })

  it('保留 mailto/tel 系统动作链接', () => {
    const root = document.createElement('div')
    root.innerHTML = neutralizeWebDocNavigationLinks(
      '<a href="mailto:reader@example.com">邮件</a><a href="tel:+8613800000000">电话</a>',
      current,
    )

    const links = root.querySelectorAll('a')
    expect(links[0]?.getAttribute('href')).toBe('mailto:reader@example.com')
    expect(links[1]?.getAttribute('href')).toBe('tel:+8613800000000')
    expect(links[0]?.getAttribute(MONTREE_NAV_HREF_ATTR)).toBeNull()
    expect(links[1]?.getAttribute(MONTREE_NAV_HREF_ATTR)).toBeNull()
  })

  it('解析 SVG 命名空间的 a 链接（SVGAElement 同样可点击导航）', () => {
    const svgAnchor = document.createElementNS('http://www.w3.org/2000/svg', 'a')
    svgAnchor.setAttribute('href', '#')
    svgAnchor.setAttribute(MONTREE_NAV_HREF_ATTR, 'https://bojieli.github.io/ai-infra-book/manuscripts/00-x.html')
    expect(svgAnchor instanceof HTMLAnchorElement).toBe(false)
    expect(resolveWebDocClickHref(svgAnchor, 'https://bojieli.github.io/ai-infra-book/')).toBe(
      'https://bojieli.github.io/ai-infra-book/manuscripts/00-x.html',
    )
    expect(isWebDocNavigationTarget(svgAnchor, 'https://bojieli.github.io/ai-infra-book/')).toBe(true)
  })

  it('detectWebDocIframeEscape 识别非宿主 URL（逃逸恢复触发条件）', () => {
    const iframe = document.createElement('iframe')
    Object.defineProperty(iframe, 'contentWindow', {
      value: { location: { href: 'http://localhost:5173/' } },
    })
    // 与宿主同源 → 视为正常 srcdoc，不恢复
    expect(detectWebDocIframeEscape(iframe, 'http://localhost:5173')).toBeNull()
    expect(detectWebDocIframeEscape(iframe, 'http://localhost:5173/')).toBeNull()
    // 与宿主不同源 → 逃逸，需要拉回 srcdoc
    expect(detectWebDocIframeEscape(iframe, 'https://bojieli.github.io')).toBe('http://localhost:5173/')
  })

  it('解析 data-montree-href 链接', () => {
    const anchor = document.createElement('a')
    anchor.setAttribute(MONTREE_NAV_HREF_ATTR, 'https://paper.people.com.cn/rmrb/pc/content/202609/01/content_30178365.html')
    const href = resolveWebDocClickHref(anchor, current)
    expect(href).toBe('https://paper.people.com.cn/rmrb/pc/content/202609/01/content_30178365.html')
  })

  it('isWebDocNavigationTarget 识别 data 链接', () => {
    const anchor = document.createElement('a')
    anchor.setAttribute(MONTREE_NAV_HREF_ATTR, 'https://paper.people.com.cn/rmrb/pc/content/202609/01/content_30178365.html')
    expect(isWebDocNavigationTarget(anchor, current)).toBe(true)
  })

  it('解析不同 DOM realm 的链接目标（真实 iframe 点击）', () => {
    const otherDocument = document.implementation.createHTMLDocument('iframe')
    const anchor = otherDocument.createElement('a')
    anchor.setAttribute(MONTREE_NAV_HREF_ATTR, 'https://paper.people.com.cn/rmrb/pc/content/202609/01/content_30178365.html')
    otherDocument.body.append(anchor)

    expect(resolveWebDocClickHref(anchor, current)).toBe(
      'https://paper.people.com.cn/rmrb/pc/content/202609/01/content_30178365.html',
    )
  })

  it('hash 链接解析为当前页片段，不触发重新抓取', () => {
    expect(resolveWebDocFragment('#top', current)).toBe('top')
    expect(resolveWebDocFragment(`${current}#top`, current)).toBe('top')
    expect(resolveWebDocFragment('https://paper.people.com.cn/other#top', current)).toBeNull()
  })

  it('reader marker 可区分正常 srcdoc 与同源 Electron 页面', () => {
    const readerDocument = document.implementation.createHTMLDocument('reader')
    readerDocument.documentElement.setAttribute(WEB_DOC_READER_MARKER_ATTR, WEB_DOC_READER_MARKER_VALUE)
    expect(isWebDocReaderDocument(readerDocument)).toBe(true)

    const appDocument = document.implementation.createHTMLDocument('app')
    expect(isWebDocReaderDocument(appDocument)).toBe(false)

    const iframe = document.createElement('iframe')
    Object.defineProperty(iframe, 'contentDocument', { value: appDocument })
    Object.defineProperty(iframe, 'contentWindow', {
      value: { location: { href: 'http://localhost:5173/' } },
    })
    expect(detectWebDocIframeEscape(iframe, 'http://localhost:5173')).toBe('http://localhost:5173/')
  })
})
